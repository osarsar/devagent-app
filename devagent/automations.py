"""Automations: « when this happens, do these steps » — per project.

An automation is one YAML file in the project, .devpilot/automations/<nom>.yml:

    description: Sauvegarde chaque nuit
    declencheur:
      type: horaire            # horaire | intervalle | depot | webhook | manuel
      a: "03:00"               # horaire : chaque jour a cette heure (jours: [lun, mar...] facultatif)
      # toutes: 15m            # intervalle : 30s, 15m, 2h, 1j
      # type: depot            # un nouveau commit arrive sur GitHub (depot: ".", branche: main,
      #                        # toutes: 5m = a quelle frequence regarder). Variable {{commit}}.
    etapes:
      - outil: sauvegarde_lancer
      - outil: site_tester
        args: {url: "https://exemple.ma"}
        attendu: {ok: true}                         # sinon l'etape compte comme un echec
        minimum: {certificat_jours_restants: 14}
      - outil: notifier
        si: echec_nouveau        # succes (defaut) | echec | toujours | echec_nouveau | retabli
        args: {message: "{{projet}} : {{erreur}}"}

Rules:
  - a step is a tool call, through the guard, as actor « automatisation:<nom> »:
    an irreversible tool is refused, always.
  - an automation runs only when YOU activated it, and the activation is tied to
    the content of the file: a changed file is inactive until you activate it again.
  - pause (devagent pause) stops every automation.
  - the scheduler lives in DevAgent: automations run while DevAgent is running.
"""
import hashlib
import json
import re
import secrets
import threading
import time
from datetime import datetime, timedelta

import yaml

import db
import projects as P

from . import RISK_IRREVERSIBLE, guard, registry

TRIGGERS = ("horaire", "intervalle", "depot", "webhook", "manuel")
REPO_POLL_DEFAULT, REPO_POLL_MIN = "5m", 60
CONDITIONS = ("succes", "echec", "toujours", "echec_nouveau", "retabli")
DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")
MIN_INTERVAL = 30                      # seconds
CATCH_UP = timedelta(hours=12)         # a missed daily run is still done within this window
MAX_STEPS = 20

_ready_for = None
_running = set()
_lock = threading.Lock()


# ── Storage ─────────────────────────────────────────────────────────────────

def _ensure():
    global _ready_for
    if _ready_for == str(db.DB_PATH):
        return
    with db.get_db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS automation_state (
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                active_hash TEXT DEFAULT '',
                hook_token TEXT DEFAULT '',
                memo TEXT DEFAULT '',
                PRIMARY KEY (project_id, name)
            );
            CREATE TABLE IF NOT EXISTS automation_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                trigger TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                status TEXT NOT NULL,
                steps TEXT DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_automation_runs ON automation_runs(project_id, name, id);
        """)
        cols = [r["name"] for r in c.execute("PRAGMA table_info(automation_state)").fetchall()]
        if "memo" not in cols:                       # a database created before the « depot » trigger
            c.execute("ALTER TABLE automation_state ADD COLUMN memo TEXT DEFAULT ''")
    _ready_for = str(db.DB_PATH)


def _dir(project):
    if not project.get("path"):
        raise P.ProjectError("Projet sans dossier")
    return P.space_dir(project["path"]) / "automations"


def _file(project, name):
    if not NAME_RE.match(name or ""):
        raise P.ProjectError("Nom d'automatisation invalide : minuscules, chiffres et tirets (ex. sauvegarde-nuit)")
    return _dir(project) / f"{name}.yml"


def _state(pid, name):
    _ensure()
    with db.get_db() as c:
        r = c.execute("SELECT * FROM automation_state WHERE project_id = ? AND name = ?", (pid, name)).fetchone()
    return dict(r) if r else {"active_hash": "", "hook_token": "", "memo": ""}


def _set_state(pid, name, **kw):
    _ensure()
    cur = _state(pid, name)
    cur.update(kw)
    with db.get_db() as c:
        c.execute("INSERT OR REPLACE INTO automation_state (project_id, name, active_hash, hook_token, memo)"
                  " VALUES (?,?,?,?,?)",
                  (pid, name, cur.get("active_hash") or "", cur.get("hook_token") or "", cur.get("memo") or ""))


# ── Reading and checking a file ─────────────────────────────────────────────

def parse_duration(text):
    """'30s' | '15m' | '2h' | '1j' → seconds."""
    m = re.fullmatch(r"\s*(\d+)\s*([smhj])\s*", str(text or ""))
    if not m:
        raise P.ProjectError(f"Duree invalide : « {text} » (ex. 30s, 15m, 2h, 1j)")
    return int(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "j": 86400}[m.group(2)]


def check(spec):
    """Problems of an automation (empty list = valid)."""
    errs = []
    if not isinstance(spec, dict):
        return ["Le fichier doit etre un dictionnaire YAML"]
    trig = spec.get("declencheur") or {}
    ttype = trig.get("type") if isinstance(trig, dict) else None
    if ttype not in TRIGGERS:
        errs.append(f"declencheur.type doit etre : {', '.join(TRIGGERS)}")
    elif ttype == "horaire":
        if not re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", str(trig.get("a", ""))):
            errs.append("declencheur.a : une heure HH:MM (ex. \"03:00\", entre guillemets)")
        bad = [d for d in (trig.get("jours") or []) if d not in DAYS]
        if bad:
            errs.append(f"declencheur.jours inconnus : {bad} (attendu : {', '.join(DAYS)})")
    elif ttype == "intervalle":
        try:
            if parse_duration(trig.get("toutes")) < MIN_INTERVAL:
                errs.append(f"declencheur.toutes : au moins {MIN_INTERVAL}s")
        except P.ProjectError as e:
            errs.append(f"declencheur.toutes : {e.message}")
    elif ttype == "depot":
        try:
            if parse_duration(trig.get("toutes", REPO_POLL_DEFAULT)) < REPO_POLL_MIN:
                errs.append(f"declencheur.toutes : au moins {REPO_POLL_MIN}s pour surveiller un depot")
        except P.ProjectError as e:
            errs.append(f"declencheur.toutes : {e.message}")
    steps = spec.get("etapes")
    if not isinstance(steps, list) or not steps:
        errs.append("etapes : au moins une etape")
        return errs
    if len(steps) > MAX_STEPS:
        errs.append(f"etapes : {MAX_STEPS} au plus")
    for i, st in enumerate(steps, 1):
        if not isinstance(st, dict) or not st.get("outil"):
            errs.append(f"etape {i} : il manque « outil »")
            continue
        try:
            t = registry.get(st["outil"])
        except registry.ToolError:
            errs.append(f"etape {i} : outil inconnu « {st['outil']} »")
            continue
        if t.risk == RISK_IRREVERSIBLE or not t.automation:
            errs.append(f"etape {i} : « {t.name} » est irreversible, une automatisation ne peut pas le lancer")
        if st.get("si", "succes") not in CONDITIONS:
            errs.append(f"etape {i} : si doit etre {', '.join(CONDITIONS)}")
        if not isinstance(st.get("args") or {}, dict):
            errs.append(f"etape {i} : args doit etre un dictionnaire")
        unknown = set(st.get("args") or {}) - set(t.params)
        if unknown:
            errs.append(f"etape {i} : arguments inconnus pour {t.name} : {sorted(unknown)}")
        for key in ("attendu", "minimum", "maximum"):
            if key in st and not isinstance(st[key], dict):
                errs.append(f"etape {i} : {key} doit etre un dictionnaire chemin → valeur")
    return errs


def _load_file(project, f):
    text = f.read_text(encoding="utf-8")
    h = hashlib.sha256(text.encode()).hexdigest()
    try:
        spec = yaml.safe_load(text)
        errs = check(spec)
    except yaml.YAMLError as e:
        spec, errs = {}, [f"YAML invalide : {e}"]
    spec = spec if isinstance(spec, dict) else {}
    name = f.stem
    st = _state(project["id"], name)
    last = last_run(project["id"], name)
    return {"nom": name, "projet": project["name"], "project_id": project["id"], "fichier": str(f),
            "description": spec.get("description", ""), "declencheur": spec.get("declencheur") or {},
            "etapes": spec.get("etapes") or [], "erreurs": errs, "hash": h,
            "actif": bool(st["active_hash"]) and st["active_hash"] == h and not errs,
            "modifie_depuis_activation": bool(st["active_hash"]) and st["active_hash"] != h,
            "webhook": bool(st["hook_token"]),
            "dernier": {k: last[k] for k in ("id", "started_at", "status", "trigger")} if last else None}


def load(project):
    """Every automation of a project."""
    try:
        d = _dir(project)
    except P.ProjectError:
        return []
    if not d.is_dir():
        return []
    return [_load_file(project, f) for f in sorted(d.glob("*.yml"))]


def get(project, name):
    f = _file(project, name)
    if not f.is_file():
        raise P.ProjectError(f"Automatisation « {name} » introuvable dans {project['name']}")
    return _load_file(project, f)


def all_automations():
    out = []
    for p in P.all_projects():
        if p.get("path"):
            out.extend(load(p))
    return out


# ── Writing ─────────────────────────────────────────────────────────────────

def save(project, name, spec):
    """Write (or replace) an automation file. It is NEVER active after this: the
    user activates it. Returns the loaded automation."""
    errs = check(spec)
    if errs:
        raise P.ProjectError("Automatisation invalide : " + " ; ".join(errs), details=errs)
    f = _file(project, name)
    f.parent.mkdir(parents=True, exist_ok=True)
    ordered = {k: spec[k] for k in ("description", "declencheur", "etapes") if k in spec}
    f.write_text(yaml.safe_dump(ordered, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return _load_file(project, f)


def set_active(project, name, active):
    """The user's decision. Activating records the CURRENT content of the file."""
    a = get(project, name)
    if active and a["erreurs"]:
        raise P.ProjectError("Automatisation invalide : " + " ; ".join(a["erreurs"]))
    _set_state(project["id"], name, active_hash=a["hash"] if active else "")
    return get(project, name)


def delete(project, name):
    f = _file(project, name)
    if f.is_file():
        P.move_to_trash(str(f))
    _ensure()
    with db.get_db() as c:
        c.execute("DELETE FROM automation_state WHERE project_id = ? AND name = ?", (project["id"], name))
    return {"supprime": name}


def hook_token(project, name, renew=False):
    """The secret of the automation's local webhook (created on first use)."""
    get(project, name)
    st = _state(project["id"], name)
    if renew or not st["hook_token"]:
        _set_state(project["id"], name, hook_token=secrets.token_urlsafe(24))
        st = _state(project["id"], name)
    return st["hook_token"]


def find_by_hook(token):
    if not token or len(token) < 16:
        return None
    _ensure()
    with db.get_db() as c:
        r = c.execute("SELECT project_id, name FROM automation_state WHERE hook_token = ?", (token,)).fetchone()
    return (r["project_id"], r["name"]) if r else None


# ── Runs ────────────────────────────────────────────────────────────────────

def last_run(pid, name, finished_only=False):
    _ensure()
    q = "SELECT * FROM automation_runs WHERE project_id = ? AND name = ?"
    if finished_only:
        q += " AND status != 'en_cours'"
    with db.get_db() as c:
        r = c.execute(q + " ORDER BY id DESC LIMIT 1", (pid, name)).fetchone()
    return dict(r) if r else None


def runs(pid=None, name=None, limit=50):
    _ensure()
    q, a = "SELECT r.*, p.name AS project_name FROM automation_runs r LEFT JOIN projects p ON p.id = r.project_id WHERE 1=1", []
    if pid is not None:
        q += " AND r.project_id = ?"
        a.append(pid)
    if name:
        q += " AND r.name = ?"
        a.append(name)
    with db.get_db() as c:
        rows = c.execute(q + " ORDER BY r.id DESC LIMIT ?", a + [max(1, min(int(limit), 500))]).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["steps"] = json.loads(d["steps"] or "[]")
        except ValueError:
            d["steps"] = []
        out.append(d)
    return out


def _path(obj, dotted):
    for part in str(dotted).split("."):
        if isinstance(obj, dict):
            obj = obj.get(part)
        elif isinstance(obj, list) and part.isdigit() and int(part) < len(obj):
            obj = obj[int(part)]
        else:
            return None
    return obj


def _expectations(step, result):
    """Why the result does not meet the step's expectations ('' = it does)."""
    for path, want in (step.get("attendu") or {}).items():
        got = _path(result, path)
        if got != want:
            return f"{path} = {got!r} (attendu : {want!r})"
    for path, lim in (step.get("minimum") or {}).items():
        got = _path(result, path)
        if not isinstance(got, (int, float)) or got < lim:
            return f"{path} = {got!r} (minimum : {lim})"
    for path, lim in (step.get("maximum") or {}).items():
        got = _path(result, path)
        if not isinstance(got, (int, float)) or got > lim:
            return f"{path} = {got!r} (maximum : {lim})"
    return ""


def _fill(value, variables):
    if isinstance(value, str):
        return re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda m: str(variables.get(m.group(1), m.group(0))), value)
    if isinstance(value, dict):
        return {k: _fill(v, variables) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill(v, variables) for v in value]
    return value


def run(project, name, trigger="manuel", require_active=True):
    """Run an automation now. Returns the run {id, status, steps}."""
    a = get(project, name)
    if a["erreurs"]:
        raise P.ProjectError("Automatisation invalide : " + " ; ".join(a["erreurs"]))
    if require_active and not a["actif"]:
        raise P.ProjectError(f"« {name} » n'est pas active : c'est toi qui l'actives (DevAgent → Automatisations)."
                           + (" Le fichier a change depuis l'activation." if a["modifie_depuis_activation"] else ""))
    key = (project["id"], name)
    with _lock:
        if key in _running:
            raise P.ProjectError(f"« {name} » est deja en cours")
        _running.add(key)
    try:
        return _run(project, a, trigger)
    finally:
        with _lock:
            _running.discard(key)


def _run(project, a, trigger):
    pid, name = project["id"], a["nom"]
    previous = last_run(pid, name, finished_only=True)
    was_failing = bool(previous and previous["status"] == "echec")
    started = datetime.now().isoformat(timespec="seconds")
    with db.get_db() as c:
        rid = c.execute("INSERT INTO automation_runs (project_id, name, trigger, started_at, status) VALUES (?,?,?,?,?)",
                        (pid, name, trigger, started, "en_cours")).lastrowid
    failed, error, log = False, "", []
    variables = {"projet": project["name"], "automatisation": name, "date": started, "erreur": "", "resultat": "",
                 "commit": _memo(pid, name).get("sha", "")[:10]}
    for i, st in enumerate(a["etapes"], 1):
        cond = st.get("si", "succes")
        wanted = {"succes": not failed, "echec": failed, "toujours": True,
                  "echec_nouveau": failed and not was_failing,
                  "retabli": (not failed) and was_failing}[cond]
        entry = {"n": i, "outil": st["outil"], "si": cond}
        if not wanted:
            entry["statut"] = "saute"
            log.append(entry)
            continue
        variables["erreur"] = error
        out = guard.call(st["outil"], _fill(st.get("args") or {}, variables),
                         actor=f"automatisation:{name}", ctx={"project_id": pid})
        entry["statut"] = out["statut"]
        if out["statut"] == "ok":
            why = _expectations(st, out.get("resultat"))
            if why:
                res = out.get("resultat")
                if isinstance(res, dict) and res.get("resume"):
                    why = str(res["resume"])               # the tool's own words are clearer than « x != y »
                entry.update(statut="echec", message=why)
        else:
            entry["message"] = out.get("message", "")
        if entry["statut"] != "ok" and cond in ("succes", "toujours"):
            # only a step of the main path makes the run fail; a failing alert step does not
            # hide the first error
            if not failed:
                failed, error = True, f"{st['outil']} : {entry.get('message', '')}"
        entry["resultat"] = _short(out.get("resultat"))
        res = out.get("resultat")
        if entry["statut"] == "ok" and isinstance(res, dict) and (res.get("texte") or res.get("resume")):
            variables["resultat"] = str(res.get("texte") or res.get("resume"))   # for the next steps: {{resultat}}
        log.append(entry)
    status = "echec" if failed else "ok"
    with db.get_db() as c:
        c.execute("UPDATE automation_runs SET ended_at = ?, status = ?, steps = ? WHERE id = ?",
                  (datetime.now().isoformat(timespec="seconds"), status,
                   json.dumps(log, ensure_ascii=False, default=str), rid))
    return {"id": rid, "nom": name, "statut": status, "declencheur": trigger, "erreur": error, "etapes": log}


def _short(result):
    s = json.dumps(result, ensure_ascii=False, default=str)
    return result if len(s) <= 1500 else s[:1500] + "…"


# ── Scheduler ───────────────────────────────────────────────────────────────

def due(a, now=None):
    """Is this (active) automation due now?"""
    now = now or datetime.now()
    trig = a["declencheur"]
    ttype = trig.get("type")
    last = last_run(a["project_id"], a["nom"])
    last_at = datetime.fromisoformat(last["started_at"]) if last else None
    if ttype == "intervalle":
        return last_at is None or (now - last_at).total_seconds() >= parse_duration(trig["toutes"])
    if ttype == "horaire":
        hh, mm = (int(x) for x in str(trig["a"]).split(":"))
        slot = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if slot > now:
            slot -= timedelta(days=1)
        if now - slot > CATCH_UP:
            return False
        days = trig.get("jours")
        if days and DAYS[slot.weekday()] not in days:
            return False
        return last_at is None or last_at < slot
    if ttype == "depot":
        return _repo_changed(a, now)
    return False


def _memo(pid, name):
    try:
        return json.loads(_state(pid, name).get("memo") or "{}")
    except ValueError:
        return {}


def remote_head(project, repo=".", branch=None):
    """The commit at the tip of the branch ON THE REMOTE (git ls-remote): '' when unknown."""
    import dev
    path = dev.repo_path(project["id"], repo or ".")
    branch = branch or dev.base_branch(path)
    rc, out, _ = P.git(["ls-remote", "origin", f"refs/heads/{branch}"], cwd=path, timeout=25)
    return out.split()[0] if rc == 0 and out.strip() else ""


def _repo_changed(a, now):
    """True when the remote branch moved since the last look. The first look only
    records where the branch is: an automation never fires for old commits."""
    pid, name, trig = a["project_id"], a["nom"], a["declencheur"]
    memo = _memo(pid, name)
    every = parse_duration(trig.get("toutes", REPO_POLL_DEFAULT))
    last = memo.get("checked")
    if last and (now - datetime.fromisoformat(last)).total_seconds() < every:
        return False
    try:
        sha = remote_head(P.get(pid), trig.get("depot") or ".", trig.get("branche"))
    except Exception:
        sha = ""
    fire = bool(sha) and bool(memo.get("sha")) and sha != memo["sha"]
    _set_state(pid, name, memo=json.dumps({"sha": sha or memo.get("sha", ""), "checked": now.isoformat(timespec="seconds")}))
    return fire


def tick(now=None):
    """One pass of the scheduler: run what is due. Returns the runs started."""
    if guard.paused():
        return []
    started = []
    for p in P.all_projects():
        if not p.get("path") or p.get("status") not in (None, "active"):
            continue
        for a in load(p):
            try:
                if a["actif"] and due(a, now):
                    started.append(run(p, a["nom"], trigger=a["declencheur"]["type"]))
            except P.ProjectError:
                pass
            except Exception as e:                       # one broken automation never stops the others
                try:
                    db.log_event("automation_error", "agent", a["nom"], "", 0, p["id"], str(e)[:500])
                except Exception:
                    pass
    return started


_thread = None
_stop = threading.Event()


def start_scheduler(period=30):
    """Start the background scheduler (once). DevAgent calls it at launch."""
    global _thread
    if _thread and _thread.is_alive():
        return _thread
    _stop.clear()

    def loop():
        _cleanup_interrupted()
        while not _stop.wait(period):
            try:
                tick()
            except Exception:
                pass
            try:
                from . import etat
                etat.auto_tick()                      # the projects' state, shared with the other PCs
            except Exception:
                pass

    _thread = threading.Thread(target=loop, name="devagent-automations", daemon=True)
    _thread.start()
    return _thread


def stop_scheduler():
    _stop.set()


def _cleanup_interrupted():
    """Runs left « en_cours » by a previous DevAgent that stopped in the middle."""
    _ensure()
    with db.get_db() as c:
        c.execute("UPDATE automation_runs SET status = 'interrompu', ended_at = ? WHERE status = 'en_cours'",
                  (datetime.now().isoformat(timespec="seconds"),))


# ── Templates ───────────────────────────────────────────────────────────────

TEMPLATES = {
    "sauvegarde-nuit": {
        "description": "Sauvegarde les fichiers du projet vers R2 chaque nuit, et previent si elle echoue.",
        "declencheur": {"type": "horaire", "a": "03:00"},
        "etapes": [{"outil": "sauvegarde_lancer"},
                   {"outil": "notifier", "si": "echec",
                    "args": {"message": "La sauvegarde de {{projet}} a echoue : {{erreur}}"}}]},
    "surveillance-site": {
        "description": "Verifie toutes les 10 minutes que le site repond. Previent quand il tombe et quand il revient.",
        "declencheur": {"type": "intervalle", "toutes": "10m"},
        "etapes": [{"outil": "site_tester", "args": {"url": "https://exemple.ma"}, "attendu": {"ok": True}},
                   {"outil": "notifier", "si": "echec_nouveau",
                    "args": {"message": "Le site de {{projet}} ne repond plus : {{erreur}}"}},
                   {"outil": "notifier", "si": "retabli",
                    "args": {"message": "Le site de {{projet}} repond a nouveau."}}]},
    "certificat": {
        "description": "Chaque matin, previent si le certificat HTTPS expire dans moins de 14 jours.",
        "declencheur": {"type": "horaire", "a": "08:00"},
        "etapes": [{"outil": "site_tester", "args": {"url": "https://exemple.ma"},
                    "minimum": {"certificat_jours_restants": 14}},
                   {"outil": "notifier", "si": "echec_nouveau",
                    "args": {"message": "Certificat de {{projet}} bientot expire : {{erreur}}"}}]},
    "point-du-matin": {
        "description": "Chaque matin, l'agent fait le point sur tous tes projets et te l'envoie : ce qui demande "
                       "une action, ou en est chaque projet. Utilise ta cle API Anthropic (quelques centimes par jour).",
        "declencheur": {"type": "horaire", "a": "08:00", "jours": ["lun", "mar", "mer", "jeu", "ven"]},
        "etapes": [{"outil": "guide_point"},
                   {"outil": "notifier", "args": {"titre": "DevAgent — point du matin", "message": "{{resultat}}"}}]},
    "surveillance-site-expliquee": {
        "description": "Comme surveillance-site, mais quand le site tombe l'agent cherche la cause et t'ecrit quoi "
                       "faire. Utilise ta cle API Anthropic, seulement au moment d'une panne.",
        "declencheur": {"type": "intervalle", "toutes": "10m"},
        "etapes": [{"outil": "site_tester", "args": {"url": "https://exemple.ma"}, "attendu": {"ok": True}},
                   {"outil": "guide_expliquer", "si": "echec_nouveau",
                    "args": {"probleme": "Le site de {{projet}} ne repond plus : {{erreur}}"}},
                   {"outil": "notifier", "si": "echec_nouveau",
                    "args": {"message": "Le site de {{projet}} ne repond plus : {{erreur}}\n\n{{resultat}}"}},
                   {"outil": "notifier", "si": "retabli", "args": {"message": "Le site de {{projet}} repond a nouveau."}}]},
    "verifier-acces": {
        "description": "Chaque matin, essaie tous les acces (tokens, cles) et previent si l'un ne marche plus ou expire bientot.",
        "declencheur": {"type": "horaire", "a": "09:00"},
        "etapes": [{"outil": "acces_tester", "attendu": {"tout_ok": True}},
                   {"outil": "notifier", "si": "echec_nouveau", "args": {"message": "Acces a regler : {{erreur}}"}},
                   {"outil": "notifier", "si": "retabli", "args": {"message": "Tous les acces fonctionnent a nouveau."}}]},
    "nouveau-commit": {
        "description": "Quand un nouveau commit arrive sur GitHub : met les depots a jour sur ce PC et previent.",
        "declencheur": {"type": "depot", "toutes": "5m"},
        "etapes": [{"outil": "github_tout_mettre_a_jour"},
                   {"outil": "notifier", "si": "toujours",
                    "args": {"message": "{{projet}} : nouveau commit {{commit}} sur GitHub."}}]},
    "depots-a-jour": {
        "description": "Chaque matin, met a jour les depots propres du projet (git pull, avance rapide).",
        "declencheur": {"type": "horaire", "a": "08:30", "jours": ["lun", "mar", "mer", "jeu", "ven"]},
        "etapes": [{"outil": "github_tout_mettre_a_jour"}]},
}


def from_template(project, template, name=None, url=None):
    if template not in TEMPLATES:
        raise P.ProjectError(f"Modele inconnu : {template}. Modeles : {', '.join(TEMPLATES)}")
    spec = json.loads(json.dumps(TEMPLATES[template]))
    if url is None:
        try:
            import connections
            dom = connections.domain_state(project["id"])["config"].get("domain")
            url = f"https://{dom}" if dom else None
        except Exception:
            url = None
    for st in spec["etapes"]:
        if st["outil"] == "site_tester" and url:
            st["args"]["url"] = url
    return save(project, name or template, spec)


# ── CLI ─────────────────────────────────────────────────────────────────────

def cli(argv):
    from .tools._common import resolve_project
    sub = argv[0] if argv else "lister"
    if sub == "lister":
        for a in all_automations():
            mark = "●" if a["actif"] else ("!" if a["erreurs"] else "○")
            t = a["declencheur"]
            when = t.get("a") or t.get("toutes") or t.get("type", "?")
            last = f"{a['dernier']['started_at']} {a['dernier']['status']}" if a["dernier"] else "jamais lancee"
            print(f"{mark} {a['projet']:<20} {a['nom']:<24} {t.get('type', '?'):<10} {when:<8} {last}")
        print("\n● active   ○ inactive   ! invalide")
        return 0
    if sub in ("lancer", "activer", "desactiver") and len(argv) >= 3:
        p = resolve_project({}, argv[1])
        try:
            if sub == "lancer":
                out = run(p, argv[2], trigger="manuel")
            else:
                out = set_active(p, argv[2], sub == "activer")
        except P.ProjectError as e:
            print(f"✗ {e.message}")
            return 1
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
        return 0
    if sub == "historique":
        for r in reversed(runs(limit=30)):
            print(f"{r['started_at']}  {r['status']:<10} {r.get('project_name') or '?':<20} {r['name']:<24} {r['trigger']}")
        return 0
    print("devagent auto lister | lancer <projet> <nom> | activer <projet> <nom> | desactiver <projet> <nom> | historique")
    return 2
