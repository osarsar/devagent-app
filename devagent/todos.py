"""« A faire par toi » — what the agent could not do itself and asks the user to do.

When something needs the user (an agreement to give on a site, a key to create, a decision), the
agent adds it here with the exact link or command. The list is shown when DevAgent opens.

An item may carry a CHECK: a read-only tool and what its result must be. DevAgent runs the checks
now and then; an item whose check passes is closed by itself — the user never has to tick it.
"""
import json
from datetime import datetime

import db
import projects as P

from . import guard, registry

_ready_for = None


def _ensure():
    global _ready_for
    if _ready_for == str(db.DB_PATH):
        return
    with db.get_db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS agent_todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, project_id INTEGER,
            title TEXT NOT NULL, how TEXT DEFAULT '', why TEXT DEFAULT '', link TEXT DEFAULT '',
            check_tool TEXT DEFAULT '', check_args TEXT DEFAULT '{}', check_expect TEXT DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'ouverte', done_at TEXT, done_by TEXT DEFAULT '', last_check TEXT DEFAULT '')""")
    _ready_for = str(db.DB_PATH)


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _row(r):
    d = dict(r)
    for k in ("check_args", "check_expect"):
        try:
            d[k] = json.loads(d[k] or "{}")
        except ValueError:
            d[k] = {}
    return d


def add(title, how="", why="", link="", project_id=None, actor="agent", check_tool="", check_args=None, check_expect=None):
    _ensure()
    title = (title or "").strip()[:200]
    if not title:
        raise P.ProjectError("Donne un titre a la chose a faire")
    if link and not link.startswith(("https://", "http://")):
        raise P.ProjectError("Le lien doit commencer par https://")
    if check_tool:
        t = registry.get(check_tool)
        if t.risk != "lecture":
            raise P.ProjectError(f"La verification doit etre un outil de lecture ({check_tool} ne l'est pas)")
        if not isinstance(check_expect, dict) or not check_expect:
            raise P.ProjectError("Avec un outil de verification, dis ce que son resultat doit valoir (verifier_attendu)")
    with db.get_db() as c:
        same = c.execute("SELECT id FROM agent_todos WHERE status = 'ouverte' AND lower(title) = ? AND "
                         "coalesce(project_id, 0) = ?", (title.lower(), project_id or 0)).fetchone()
        if same:
            return {"numero": same["id"], "deja_notee": True}
        rid = c.execute("INSERT INTO agent_todos (at, actor, project_id, title, how, why, link, check_tool, check_args, "
                        "check_expect) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (_now(), actor, project_id, title, (how or "")[:1500], (why or "")[:600], link or "",
                         check_tool or "", json.dumps(check_args or {}), json.dumps(check_expect or {}))).lastrowid
    return {"numero": rid}


def items(status="ouverte", project_id=None):
    _ensure()
    q, a = "SELECT t.*, p.name AS project FROM agent_todos t LEFT JOIN projects p ON p.id = t.project_id WHERE 1=1", []
    if status:
        q += " AND t.status = ?"
        a.append(status)
    if project_id:
        q += " AND t.project_id = ?"
        a.append(project_id)
    with db.get_db() as c:
        return [_row(r) for r in c.execute(q + " ORDER BY t.id DESC LIMIT 200", a).fetchall()]


def count():
    _ensure()
    with db.get_db() as c:
        return c.execute("SELECT count(*) FROM agent_todos WHERE status = 'ouverte'").fetchone()[0]


def close(tid, status="faite", by="utilisateur"):
    _ensure()
    with db.get_db() as c:
        return c.execute("UPDATE agent_todos SET status = ?, done_at = ?, done_by = ? WHERE id = ? AND status = 'ouverte'",
                         (status, _now(), by, tid)).rowcount == 1


def reopen(tid):
    _ensure()
    with db.get_db() as c:
        return c.execute("UPDATE agent_todos SET status = 'ouverte', done_at = NULL, done_by = '' WHERE id = ?", (tid,)).rowcount == 1


def check(tid=None):
    """Run the checks of the open items (or of one). Returns the items that got closed."""
    from .automations import _expectations
    closed = []
    for t in items("ouverte"):
        if (tid and t["id"] != tid) or not t["check_tool"]:
            continue
        out = guard.call(t["check_tool"], t["check_args"], actor="verification",
                         ctx={"project_id": t["project_id"]} if t["project_id"] else {})
        ok = out["statut"] == "ok" and not _expectations({"attendu": t["check_expect"]}, out.get("resultat"))
        with db.get_db() as c:
            c.execute("UPDATE agent_todos SET last_check = ? WHERE id = ?", (_now(), t["id"]))
        if ok and close(t["id"], by="verification"):
            closed.append({"numero": t["id"], "titre": t["title"]})
    return closed


def public(t):
    return {"numero": t["id"], "titre": t["title"], "projet": t.get("project"), "comment": t["how"], "pourquoi": t["why"],
            "lien": t["link"] or None, "verifie_tout_seul": bool(t["check_tool"]), "etat": t["status"], "depuis": t["at"]}
