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
- Quand quelque chose doit etre fait par l'utilisateur lui-meme (un accord a donner sur un site, une cle a creer ou \
renouveler, une decision, une commande avec sudo), ne te contente pas de le dire : note-le avec `a_faire_ajouter`, avec \
le lien exact, pour qu'il le retrouve a l'ouverture de DevAgent. Si un outil de lecture peut constater que c'est fait, \
donne-le comme verification.
- Pour lire ou modifier le CODE d'un projet, tu as `claude_code` : donne-lui la tache complete. Ensuite, toi, tu \
enchaines : `execution_demarrer` pour voir, `git_commit` et `git_synchroniser` pour envoyer, `vercel_etat` pour la mise \
en ligne.
- S'il te manque un outil : `outil_construire` le fait ecrire (il est utilisable aussitot, chaque appel confirme par \
l'utilisateur). Pour une action ponctuelle, `commande_proposer` suffit.
- S'il te manque un outil pour faire ce qui est demande, ne t'arrete pas la : propose la commande exacte avec \
`commande_proposer` (l'utilisateur la confirme, tu lis ensuite sa sortie avec `confirmation_etat`), puis note le \
manque avec `outil_demander`. Ne renvoie l'utilisateur vers un site que si aucune commande ne peut le faire.
- Reponds en francais simple, court. Commence par le resultat. Dis ce que tu as fait, ce qui a echoue, \
et la prochaine etape quand il y en a une."""

# what a read-only turn (the guide) may still do: take notes for the user, change nothing else
NOTE_TOOLS = ("a_faire_ajouter", "outil_demander")

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


def api_tools(read_only=False):
    """The registry as API tool definitions — always in the same order (the prompt cache needs it).
    read_only: the tools that only look (a guide must not change anything)."""
    tools = registry.all_tools()
    if read_only:
        tools = [t for t in tools if t.risk == "lecture" or t.name in NOTE_TOOLS]
    return [{"name": t.name, "description": f"[{t.risk}] {t.description}", "input_schema": t.input_schema} for t in tools]


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

def send(cid, text, client=None, wait=False, read_only=False, shown=None):
    """Add the user's message and run the turn (background thread unless wait=True).
    read_only: this turn may only use tools that look. shown: what the conversation displays
    instead of the full text (a guide's long instruction is not interesting to read)."""
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
    d["events"].append({"type": "user", "text": shown or text, "at": _now()})
    _save(cid, messages=d["messages"], events=d["events"], status="en_cours", error="",
          title=d["title"] or (shown or text)[:60])
    if wait:
        _turn(cid, client, read_only)
    else:
        t = threading.Thread(target=_turn, args=(cid, client, read_only), name=f"devagent-chat-{cid}", daemon=True)
        with _lock:
            _threads[cid] = t
        t.start()
    return {"ok": True, "chat": get(cid)}


def _turn(cid, client=None, read_only=False):
    d = _load(cid)
    messages, events = d["messages"], d["events"]
    try:
        client = client or _client()
        project = db.get_project(d["project_id"]) if d["project_id"] else None
        ctx = {"project_id": d["project_id"]} if d["project_id"] else {}
        params = {"model": model(), "max_tokens": MAX_TOKENS, "system": _system(project),
                  "tools": api_tools(read_only), "thinking": {"type": "adaptive"},
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
                    if read_only and registry.get(b["name"]).risk != "lecture" and b["name"] not in NOTE_TOOLS:
                        answer = {"statut": "erreur", "message": "Ce tour ne fait que regarder : aucune modification."}
                    else:
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


# ── Guide: the agent looks at the real state and says what to do ─────────────

GUIDE_PROJECT = """Regarde l'etat REEL de ce projet avec tes outils avant de repondre : projet_etat, projet_acces, git_depots, et selon le cas vercel_etat, domaine_etat, serveur_lister, automatisation_lister. Ne modifie rien.

Puis dis-moi quoi faire maintenant :
1. Une phrase : ou en est le projet.
2. Les prochaines actions, 5 au plus, dans l'ordre ou il faut les faire. Pour chacune : ce qu'il faut faire, pourquoi maintenant, et comment — « je peux le faire si tu me le demandes » (nomme l'outil) ou « a faire par toi » (donne la page ou la commande exacte).
3. Ce qui bloque ou risque de casser bientot (acces qui expire, site mal configure, travail non pousse), s'il y en a.

Pour chaque action « a faire par toi », note-la aussi avec a_faire_ajouter (titre court, lien exact, et la \
verification quand un outil de lecture peut constater que c'est fait) : elle restera dans la liste de l'utilisateur.

N'ecris que ce qui decoule de ce que tu as lu. Si une information manque, dis laquelle."""

GUIDE_ALL = """Fais le point sur TOUS les projets, pour un message court a lire le matin. Regarde avec tes outils (projet_lister, puis pour chaque projet actif projet_etat ; acces_etat une fois ; les automatisations et leur dernier resultat avec automatisation_historique). Ne modifie rien.

Ecris, en texte simple sans tableau ni titre Markdown (le message part sur Telegram ou par email) :
- ce qui demande une action aujourd'hui, le plus urgent d'abord (un acces expire ou en panne, un site qui ne repond plus, une automatisation qui echoue, du travail non pousse) ;
- pour chaque projet actif, une ligne : ou il en est et la prochaine etape ;
- si tout va bien, dis-le en une phrase.
400 mots au plus."""

GUIDE_EXPLAIN = """Un probleme vient d'etre detecte :

{probleme}

Cherche la cause avec tes outils (par exemple site_tester, domaine_verifier, dns_resoudre, vercel_etat, serveur_tester, acces_etat). Ne modifie rien. Puis ecris un message court, en texte simple : la cause la plus probable d'apres ce que tu as vu, ce que tu as verifie, et quoi faire maintenant, etape par etape. 150 mots au plus."""


def last_text(cid):
    c = get(cid)
    texts = [e["text"] for e in (c or {}).get("events", []) if e["type"] == "assistant"]
    return texts[-1] if texts else ""


def guide(project_id=None, client=None, wait=False):
    """Start a read-only « what should I do now? » conversation. Returns the chat."""
    c = start(project_id)
    out = send(c["id"], GUIDE_PROJECT if project_id else GUIDE_ALL, client=client, wait=wait, read_only=True,
               shown="Que faire maintenant ?" if project_id else "Fais le point sur tous mes projets.")
    if not out.get("ok"):
        delete(c["id"])
        return out
    return {"ok": True, "chat": get(c["id"])}


def run_once(instruction, title, project_id=None, client=None):
    """One read-only run, to the end: the text the agent wrote (for automations)."""
    import projects as P
    c = start(project_id)
    out = send(c["id"], instruction, client=client, wait=True, read_only=True, shown=title)
    if not out.get("ok"):
        delete(c["id"])
        raise P.ProjectError(out.get("message") or "Le guide n'a pas pu demarrer")
    done = get(c["id"])
    if done["error"]:
        raise P.ProjectError(done["error"])
    return {"texte": last_text(c["id"]), "conversation": c["id"]}
