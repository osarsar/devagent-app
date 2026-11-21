"""The journal: every tool call leaves a line (who, what, when, result), and the
confirmations waiting for the user.

Tables (in devpilot.db, created on first use):
    agent_actions     one row per tool call
    agent_approvals   an irreversible action waiting for (or after) the user's decision
"""
import json
from datetime import datetime

import db

from . import vault

_ready_for = None
MAX_TEXT = 4000


def _ensure():
    global _ready_for
    if _ready_for == str(db.DB_PATH):
        return
    with db.get_db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS agent_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at TEXT NOT NULL,
                actor TEXT NOT NULL,
                tool TEXT NOT NULL,
                risk TEXT NOT NULL,
                project_id INTEGER,
                args TEXT DEFAULT '{}',
                status TEXT NOT NULL,
                result TEXT DEFAULT '',
                duration_ms INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_agent_actions_at ON agent_actions(at);
            CREATE TABLE IF NOT EXISTS agent_approvals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                actor TEXT NOT NULL,
                tool TEXT NOT NULL,
                project_id INTEGER,
                args TEXT DEFAULT '{}',
                reason TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'attente',
                decided_at TEXT,
                result TEXT DEFAULT ''
            );
        """)
    _ready_for = str(db.DB_PATH)


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _dump(obj):
    """JSON text of a value, secrets removed, bounded in size."""
    try:
        s = json.dumps(vault.redact(obj), ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        s = json.dumps(str(obj))
    return s if len(s) <= MAX_TEXT else s[:MAX_TEXT] + "…"


def _row(r, *json_fields):
    d = dict(r)
    for f in json_fields:
        try:
            d[f] = json.loads(d[f]) if d.get(f) else None
        except (ValueError, TypeError):
            pass
    return d


# ── Actions ─────────────────────────────────────────────────────────────────

def record(actor, tool, risk, args, status, result=None, project_id=None, duration_ms=0):
    _ensure()
    with db.get_db() as c:
        cur = c.execute(
            "INSERT INTO agent_actions (at, actor, tool, risk, project_id, args, status, result, duration_ms)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (_now(), actor, tool, risk, project_id, _dump(args), status, _dump(result), int(duration_ms)))
        return cur.lastrowid


def actions(limit=100, project_id=None, actor=None, tool=None):
    _ensure()
    q, a = "SELECT * FROM agent_actions WHERE 1=1", []
    if project_id is not None:
        q += " AND project_id = ?"
        a.append(project_id)
    if actor:
        q += " AND actor LIKE ?"
        a.append(actor + "%")
    if tool:
        q += " AND tool = ?"
        a.append(tool)
    q += " ORDER BY id DESC LIMIT ?"
    a.append(max(1, min(int(limit), 1000)))
    with db.get_db() as c:
        return [_row(r, "args") for r in c.execute(q, a).fetchall()]


# ── Approvals ───────────────────────────────────────────────────────────────

def ask(actor, tool, args, reason="", project_id=None):
    """Store an action waiting for the user. The REAL arguments are kept (the
    action runs with them once approved): no tool takes a secret as argument."""
    _ensure()
    with db.get_db() as c:
        cur = c.execute(
            "INSERT INTO agent_approvals (created_at, actor, tool, project_id, args, reason) VALUES (?,?,?,?,?,?)",
            (_now(), actor, tool, project_id, json.dumps(args, ensure_ascii=False, default=str), reason))
        return cur.lastrowid


def approval(aid):
    _ensure()
    with db.get_db() as c:
        r = c.execute("SELECT * FROM agent_approvals WHERE id = ?", (aid,)).fetchone()
    return _row(r, "args") if r else None


def approvals(status="attente", limit=50):
    _ensure()
    q, a = "SELECT * FROM agent_approvals", []
    if status:
        q += " WHERE status = ?"
        a.append(status)
    q += " ORDER BY id DESC LIMIT ?"
    a.append(limit)
    with db.get_db() as c:
        return [_row(r, "args") for r in c.execute(q, a).fetchall()]


def decide(aid, status, result=None, only_from="attente"):
    """Move an approval to a new status; False when it was not in ``only_from``
    any more (two decisions at once: the second one loses)."""
    _ensure()
    with db.get_db() as c:
        cur = c.execute(
            "UPDATE agent_approvals SET status = ?, decided_at = ?, result = ? WHERE id = ? AND status = ?",
            (status, _now(), _dump(result) if result is not None else "", aid, only_from))
        return cur.rowcount == 1
