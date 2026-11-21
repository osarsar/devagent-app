"""The guard: the ONLY way to run a tool.

    call("github_creer_depot", {"nom": "site-x"}, actor="mcp", ctx={...})

Rules, the same for every caller (interface, Claude Code, chat, automations):
  - lecture       runs.
  - ecriture      runs, and is written in the journal.
  - irreversible  never runs from the agent. A confirmation is stored; YOU approve
                  it (interface, or `devagent approuver <n>`), and the approval
                  itself runs the action.
  - an automation can never run an irreversible tool.
  - pause (setting ``agent_pause``): the agent and the automations only read.

Every call returns a dict with ``statut``:
    ok                      + resultat
    erreur                  + message
    confirmation_requise    + confirmation (its number) + message
"""
import time

import jsonschema

import db

from . import RISK_IRREVERSIBLE, RISK_READ, journal, registry
from .registry import NeedsConfirmation, ToolError

MAX_RESULT_CHARS = 20000
HUMAN = "interface"          # the actor of a direct click in the interface


def paused():
    return db.get_setting("agent_pause", "0") == "1"


def set_paused(on):
    db.set_setting("agent_pause", "1" if on else "0")
    return paused()


def _refused(e):
    """An operation refused with a message for the user (ProjectError, ToolError):
    by name, because the tests reload ``projects`` and its exception class."""
    return isinstance(e, ToolError) or type(e).__name__ == "ProjectError"


def _is_automation(actor):
    return (actor or "").startswith("automatisation")


def _project_id(ctx, args):
    """The project this call is about (for the journal), without raising."""
    try:
        from .tools._common import resolve_project
        ref = (args or {}).get("projet")
        if ref or (ctx or {}).get("project_id"):
            return resolve_project(ctx or {}, ref)["id"]
    except Exception:
        pass
    return None


def _jsonable(obj, _depth=0):
    """Tool results → plain JSON types (paths, sets, bytes, objects become text)."""
    if _depth > 12:
        return str(obj)
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _jsonable(v, _depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [_jsonable(v, _depth + 1) for v in obj]
    if isinstance(obj, bytes):
        return obj.decode("utf-8", "replace")
    return str(obj)


def _validate(tool, args):
    args = {k: v for k, v in (args or {}).items() if v is not None}
    try:
        jsonschema.validate(args, tool.input_schema)
    except jsonschema.ValidationError as e:
        where = ".".join(str(p) for p in e.path)
        raise ToolError(f"Arguments invalides pour {tool.name}{' (' + where + ')' if where else ''} : {e.message}")
    return args


def _run(tool, args, actor, ctx, approved):
    """Run the function, journal the call, return the public answer."""
    c = dict(ctx or {})
    c.update(actor=actor, approved=approved)
    pid = _project_id(c, args)
    t0 = time.time()
    try:
        from . import vault
        result = vault.redact(_jsonable(tool.fn(c, **args)))
    except NeedsConfirmation as e:
        if approved:                               # approved, and still asking: a bug in the tool
            journal.record(actor, tool.name, tool.risk, args, "erreur", str(e), pid)
            return {"statut": "erreur", "message": str(e)}
        return _ask(tool, args, actor, pid, str(e))
    except Exception as e:
        if not _refused(e):                        # a bug or an outside failure: never a traceback to the agent
            msg = f"{type(e).__name__} : {e}"
            journal.record(actor, tool.name, tool.risk, args, "erreur", msg, pid, (time.time() - t0) * 1000)
            return {"statut": "erreur", "message": msg}
        msg = getattr(e, "message", None) or str(e)
        out = {"statut": "erreur", "message": msg}
        if getattr(e, "details", None):
            out["details"] = _jsonable(e.details)
        if tool.risk != RISK_READ:
            journal.record(actor, tool.name, tool.risk, args, "erreur", msg, pid, (time.time() - t0) * 1000)
        return out
    if tool.risk != RISK_READ:
        journal.record(actor, tool.name, tool.risk, args, "ok", result, pid, (time.time() - t0) * 1000)
    return {"statut": "ok", "resultat": result}


def _ask(tool, args, actor, pid, reason=""):
    if _is_automation(actor):
        msg = f"{tool.name} ne peut pas etre lance par une automatisation (action irreversible)."
        journal.record(actor, tool.name, RISK_IRREVERSIBLE, args, "refuse", msg, pid)
        return {"statut": "erreur", "message": msg}
    aid = journal.ask(actor, tool.name, args, reason, pid)
    journal.record(actor, tool.name, RISK_IRREVERSIBLE, args, "attente", {"confirmation": aid}, pid)
    return {"statut": "confirmation_requise", "confirmation": aid,
            "message": (f"Action irreversible : elle attend ta confirmation (n° {aid}). "
                        f"Ouvre DevAgent → Agent → Confirmations, ou tape : devagent approuver {aid}"
                        + (f" — {reason}" if reason else ""))}


def call(name, args=None, actor="agent", ctx=None):
    """Run a tool for ``actor`` (mcp, chat, automatisation:<nom>, interface)."""
    try:
        tool = registry.get(name)
        args = _validate(tool, args)
    except ToolError as e:
        return {"statut": "erreur", "message": str(e)}
    if actor != HUMAN and tool.risk != RISK_READ and paused():
        return {"statut": "erreur",
                "message": "L'agent est en pause : seules les lectures sont permises (DevAgent → Agent → Reprendre)."}
    if _is_automation(actor) and not tool.automation:
        return {"statut": "erreur", "message": f"{name} n'est pas permis dans une automatisation."}
    if tool.precheck:
        try:
            tool.precheck(args)
        except ToolError as e:
            return {"statut": "erreur", "message": str(e)}
    if tool.risk == RISK_IRREVERSIBLE:
        return _ask(tool, args, actor, _project_id(ctx, args))
    return _run(tool, args, actor, ctx, approved=False)


def approve(aid, confirm_text=None):
    """The user approves a waiting action: it runs now, with the stored arguments."""
    a = journal.approval(aid)
    if not a:
        return {"statut": "erreur", "message": f"Confirmation n° {aid} introuvable"}
    if a["status"] != "attente":
        return {"statut": "erreur", "message": f"Confirmation n° {aid} deja traitee ({a['status']})"}
    try:
        tool = registry.get(a["tool"])
    except ToolError as e:
        return {"statut": "erreur", "message": str(e)}
    args = a["args"] or {}
    if tool.confirm_name:
        from .tools._common import resolve_project
        try:
            name = resolve_project({"project_id": a.get("project_id")}, args.get("projet"))["name"]
        except Exception as e:
            return {"statut": "erreur", "message": getattr(e, "message", None) or str(e)}
        if (confirm_text or "").strip() != name:
            return {"statut": "erreur", "nom_requis": True,
                    "message": f"Tape exactement le nom du projet (« {name} ») pour confirmer."}
    if not journal.decide(aid, "en_cours"):
        return {"statut": "erreur", "message": f"Confirmation n° {aid} deja traitee"}
    out = _run(tool, args, f"{a['actor']}+approuve", {"project_id": a.get("project_id")}, approved=True)
    journal.decide(aid, "fait" if out["statut"] == "ok" else "echec", out, only_from="en_cours")
    return out


def refuse(aid):
    if not journal.decide(aid, "refuse"):
        return {"statut": "erreur", "message": f"Confirmation n° {aid} introuvable ou deja traitee"}
    a = journal.approval(aid)
    journal.record(HUMAN, a["tool"], RISK_IRREVERSIBLE, a["args"], "refuse", None, a.get("project_id"))
    return {"statut": "ok", "resultat": {"confirmation": aid, "status": "refuse"}}


def approval_state(aid):
    a = journal.approval(aid)
    if not a:
        return {"statut": "erreur", "message": f"Confirmation n° {aid} introuvable"}
    return {"statut": "ok", "resultat": {k: a[k] for k in ("id", "tool", "status", "created_at", "decided_at", "result")}}


def compact(answer):
    """The answer as text for a model, bounded in size."""
    import json
    s = json.dumps(answer, ensure_ascii=False, default=str)
    if len(s) > MAX_RESULT_CHARS:
        s = s[:MAX_RESULT_CHARS] + f'… [tronque : {len(s)} caracteres]'
    return s
