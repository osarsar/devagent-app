"""The chat: talk to DevAgent in the interface. Claude decides which tools to
call; every call goes through the guard, like any other caller.

A conversation is stored in the database (table agent_chats) as the exact list
of messages sent to the API, plus the events shown in the interface.

    start(project_id) -> chat
    send(chat_id, text)          starts the turn in a background thread
    get(chat_id)                 {status, events, ...} — the interface polls it

The API key is the user's own (setting ``anthropic_api_key``, encrypted, or the
environment). Each message is billed by Anthropic to that key.
"""
import json
import threading
from datetime import datetime

import db

from . import guard, registry

DEFAULT_MODEL = "claude-opus-5-5"
MAX_TOKENS = 16000
MAX_STEPS = 30                    # tool rounds in one turn
FALLBACK_BETA = "server-side-fallback-2026-07-01"

SYSTEM = """Tu es DevAgent, l'assistant qui gere les projets de developpement de l'utilisateur sur son PC \
et leurs connexions : GitHub, hebergement, serveurs, nom de domaine, email, stockage, sauvegardes, automatisations.

Comment travailler :
- Regarde avant d'agir : `projet_etat` dit ou en est un projet et ce qui lui manque.
- Agis avec les outils. N'invente jamais un etat : si tu ne l'as pas lu avec un outil, tu ne le sais pas.
- Chaque outil repond avec `statut` : `ok`, `erreur` (lis `message` et dis-le simplement), ou `confirmation_requise`.
- `confirmation_requise` : l'action est irreversible et n'a PAS ete faite. L'utilisateur voit un bouton pour \
la confirmer. Dis-lui clairement ce qui attend, et ne cherche pas une autre facon de la faire.
- Tu ne vois jamais de secret (token, mot de passe). S'il en manque un, l'utilisateur le saisit dans les reglages.
- Pour une tache qui doit se repeter (chaque nuit, toutes les 10 minutes, quand un site tombe), propose une \
automatisation avec `automatisation_depuis_modele` ou `automatisation_proposer`. Elle reste inactive : \
l'utilisateur l'active lui-meme.
- Reponds en francais simple, court. Commence par le resultat. Dis ce que tu as fait, ce qui a echoue, \
et la prochaine etape quand il y en a une."""

_ready_for = None
_threads = {}
_lock = threading.Lock()
_use_fallbacks = True


# ── Storage ─────────────────────────────────────────────────────────────────

def _ensure():
    global _ready_for
    if _ready_for == str(db.DB_PATH):
        return
    with db.get_db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS agent_chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                title TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pret',
                error TEXT DEFAULT '',
                messages TEXT DEFAULT '[]',
                events TEXT DEFAULT '[]'
            );
        """)
        c.execute("UPDATE agent_chats SET status = 'pret', error = 'Interrompu : DevAgent a redemarre.' "
                  "WHERE status = 'en_cours'")
    _ready_for = str(db.DB_PATH)


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _load(cid):
    _ensure()
    with db.get_db() as c:
        r = c.execute("SELECT * FROM agent_chats WHERE id = ?", (cid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["messages"] = json.loads(d["messages"] or "[]")
    d["events"] = json.loads(d["events"] or "[]")
    return d


def _save(cid, **kw):
    sets, vals = ["updated_at = ?"], [_now()]
    for k, v in kw.items():
        sets.append(f"{k} = ?")
        vals.append(json.dumps(v, ensure_ascii=False, default=str) if k in ("messages", "events") else v)
    with db.get_db() as c:
        c.execute(f"UPDATE agent_chats SET {', '.join(sets)} WHERE id = ?", vals + [cid])


def start(project_id=None):
    _ensure()
    now = _now()
    with db.get_db() as c:
        cid = c.execute("INSERT INTO agent_chats (project_id, created_at, updated_at) VALUES (?,?,?)",
                        (project_id, now, now)).lastrowid
    return get(cid)


def get(cid, since=0):
    """The chat as the interface needs it: status and the events after ``since``."""
    d = _load(cid)
    if not d:
        return None
    return {"id": d["id"], "project_id": d["project_id"], "title": d["title"], "status": d["status"],
            "error": d["error"], "updated_at": d["updated_at"], "total": len(d["events"]),
            "events": d["events"][max(0, int(since)):]}


def chats(project_id=None, limit=30):
    _ensure()
    q, a = "SELECT id, project_id, title, updated_at, status FROM agent_chats", []
    if project_id is not None:
        q += " WHERE project_id = ?"
        a.append(project_id)
    with db.get_db() as c:
        return [dict(r) for r in c.execute(q + " ORDER BY updated_at DESC LIMIT ?", a + [limit]).fetchall()]


def delete(cid):
    _ensure()
    with db.get_db() as c:
        c.execute("DELETE FROM agent_chats WHERE id = ?", (cid,))
    return {"supprime": cid}


# ── The model ───────────────────────────────────────────────────────────────

def configured():
    """Can the chat reach the API? (a key in the settings or in the environment)"""
    import os
    return bool(db.get_setting("anthropic_api_key", "") or os.environ.get("ANTHROPIC_API_KEY")
                or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def model():
    return (db.get_setting("agent_model", "") or DEFAULT_MODEL).strip()


def _client():
    import anthropic
    key = db.get_setting("anthropic_api_key", "")
    return anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()


def api_tools():
    """The registry as API tool definitions — always in the same order (the prompt cache needs it)."""
    return [{"name": t.name, "description": f"[{t.risk}] {t.description}", "input_schema": t.input_schema}
            for t in registry.all_tools()]


def _system(project):
    if not project:
        return SYSTEM
    return (SYSTEM + f"\n\nProjet ouvert dans cette conversation : « {project['name']} » "
            f"(dossier {project.get('path')}). Le parametre `projet` des outils peut rester vide : c'est lui.")


def _create(client, **params):
    """One request. Refusal fallbacks are on by default; a platform or SDK that does
    not know the parameter gets the plain request."""
    global _use_fallbacks
    import anthropic
    if _use_fallbacks:
        try:
            return client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **params)
        except (anthropic.BadRequestError, TypeError, AttributeError) as e:
            if "fallback" not in str(e).lower() and not isinstance(e, (TypeError, AttributeError)):
                raise
            _use_fallbacks = False
    return client.messages.create(**params)


def _blocks(content):
    """Response content → plain dicts, unchanged (thinking blocks must go back as they came)."""
    out = []
    for b in content:
        out.append(b if isinstance(b, dict) else b.model_dump(mode="json", exclude_none=True))
    return out


def _explain(e):
    import anthropic
    if isinstance(e, anthropic.AuthenticationError):
        return "Cle API refusee par Anthropic. Verifie-la dans Agent → Reglages."
    if isinstance(e, anthropic.PermissionDeniedError):
        return "Cette cle API n'a pas le droit d'utiliser ce modele."
    if isinstance(e, anthropic.NotFoundError):
        return f"Modele introuvable : {model()}. Change-le dans Agent → Reglages."
    if isinstance(e, anthropic.RateLimitError):
        return "Limite de debit atteinte chez Anthropic. Reessaie dans une minute."
    if isinstance(e, anthropic.APIStatusError):
        return f"Erreur de l'API Anthropic ({e.status_code}) : {getattr(e, 'message', '')}"[:400]
    if isinstance(e, anthropic.APIConnectionError):
        return "Impossible de joindre l'API Anthropic : verifie la connexion internet."
    return f"{type(e).__name__} : {e}"[:400]


# ── A turn ──────────────────────────────────────────────────────────────────

def send(cid, text, client=None, wait=False):
    """Add the user's message and run the turn (background thread unless wait=True)."""
    text = (text or "").strip()
    d = _load(cid)
    if not d:
        return {"ok": False, "message": "Conversation introuvable"}
    if not text:
        return {"ok": False, "message": "Message vide"}
    if d["status"] == "en_cours":
        return {"ok": False, "message": "L'agent travaille deja sur ta demande precedente"}
    if client is None and not configured():
        return {"ok": False, "message": "Pas de cle API Anthropic. Ajoute-la dans Agent → Reglages."}
    d["messages"].append({"role": "user", "content": text})
    d["events"].append({"type": "user", "text": text, "at": _now()})
    _save(cid, messages=d["messages"], events=d["events"], status="en_cours", error="",
          title=d["title"] or text[:60])
    if wait:
        _turn(cid, client)
    else:
        t = threading.Thread(target=_turn, args=(cid, client), name=f"devagent-chat-{cid}", daemon=True)
        with _lock:
            _threads[cid] = t
        t.start()
    return {"ok": True, "chat": get(cid)}


def _turn(cid, client=None):
    d = _load(cid)
    messages, events = d["messages"], d["events"]
    try:
        client = client or _client()
        project = db.get_project(d["project_id"]) if d["project_id"] else None
        ctx = {"project_id": d["project_id"]} if d["project_id"] else {}
        params = {"model": model(), "max_tokens": MAX_TOKENS, "system": _system(project),
                  "tools": api_tools(), "thinking": {"type": "adaptive"},
                  "output_config": {"effort": db.get_setting("agent_effort", "") or "medium"},
                  "cache_control": {"type": "ephemeral"}}
        for _ in range(MAX_STEPS):
            resp = _create(client, messages=messages, **params)
            content = _blocks(resp.content)
            messages.append({"role": "assistant", "content": content})
            for b in content:
                if b.get("type") == "text" and b.get("text", "").strip():
                    events.append({"type": "assistant", "text": b["text"], "at": _now()})
            reason = resp.stop_reason
            if reason == "tool_use":
                results = []
                for b in content:
                    if b.get("type") != "tool_use":
                        continue
                    answer = guard.call(b["name"], b.get("input") or {}, actor="chat", ctx=ctx)
                    events.append({"type": "tool", "name": b["name"], "args": b.get("input") or {},
                                   "statut": answer["statut"], "message": answer.get("message", ""),
                                   "confirmation": answer.get("confirmation"), "at": _now()})
                    results.append({"type": "tool_result", "tool_use_id": b["id"],
                                    "content": guard.compact(answer),
                                    **({"is_error": True} if answer["statut"] == "erreur" else {})})
                messages.append({"role": "user", "content": results})       # every result in ONE message
                _save(cid, messages=messages, events=events)
                continue
            if reason == "pause_turn":
                _save(cid, messages=messages, events=events)
                continue
            if reason == "refusal":
                events.append({"type": "note", "text": "Le modele a refuse de repondre a cette demande.", "at": _now()})
            elif reason == "max_tokens":
                events.append({"type": "note", "text": "Reponse coupee (limite de longueur atteinte).", "at": _now()})
            break
        else:
            events.append({"type": "note", "text": f"Arrete apres {MAX_STEPS} series d'outils. Dis « continue » "
                           "pour poursuivre.", "at": _now()})
        _save(cid, messages=messages, events=events, status="pret")
    except Exception as e:
        # the conversation must stay valid for the API: drop a trailing user message
        # (text or tool results) that never got its answer
        while messages and messages[-1]["role"] == "user":
            messages.pop()
        while messages and messages[-1]["role"] == "assistant" and any(
                isinstance(b, dict) and b.get("type") == "tool_use" for b in messages[-1]["content"]):
            messages.pop()
            while messages and messages[-1]["role"] == "user":
                messages.pop()
        msg = _explain(e)
        events.append({"type": "error", "text": msg, "at": _now()})
        _save(cid, messages=messages, events=events, status="pret", error=msg)
