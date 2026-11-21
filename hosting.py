"""DevPilot — hosting accounts (Vercel, Netlify, Railway...) and their link to a project.

The accounts are one setting, ``hosting_accounts`` (a JSON list, stored encrypted:
each account holds its API token). This module is the only place that reads or
writes it; the routes and the agent tools both call it.
"""
import json

import db
import projects as P


def accounts():
    try:
        return json.loads(db.get_setting("hosting_accounts", "[]") or "[]")
    except (json.JSONDecodeError, TypeError):
        return []


def save_accounts(accts):
    db.set_setting("hosting_accounts", json.dumps(accts))


def public_accounts():
    """The accounts without their token (what the interface and the agent may see)."""
    return [{**{k: v for k, v in a.items() if k != "token"}, "token_present": bool(a.get("token"))}
            for a in accounts()]


def find(account_ref):
    """An account by id or by name."""
    ref = (account_ref or "").strip().lower()
    for a in accounts():
        if a.get("id", "").lower() == ref or a.get("name", "").lower() == ref:
            return a
    return None


def link_project(pid, account_id, site_url="", project_url=""):
    """Link a project to a hosting account: the project's « deploy » connection
    points to it. Returns {account, platform}."""
    project = db.get_project(pid)
    if not project:
        raise P.ProjectError("Projet introuvable")
    accts = accounts()
    account = next((a for a in accts if a["id"] == account_id), None)
    if not account:
        raise P.ProjectError("Compte introuvable")
    if pid not in account.get("projects", []):
        account.setdefault("projects", []).append(pid)
        save_accounts(accts)

    cfg = {"platform": account["platform"], "account_id": account_id, "account_name": account["name"]}
    if site_url:
        cfg["site_url"] = site_url
    if project_url:
        cfg["project_url"] = project_url
    existing = db.get_project_component(pid, "deploy")
    if existing:
        merged = existing.get("config", {})
        if isinstance(merged, str):
            try:
                merged = json.loads(merged)
            except (ValueError, TypeError):
                merged = {}
        merged.update(cfg)
        db.update_project_component(pid, "deploy", config=merged, enabled=True)
    else:
        db.add_project_component(pid, "deploy", enabled=True, config=cfg)
    try:                                    # the folder is the reference (.devpilot/connections.json)
        import connections as _C
        _C.mirror(pid)
    except Exception:
        pass
    return {"account": account["name"], "platform": account["platform"]}
