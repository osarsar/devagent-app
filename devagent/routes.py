"""DevAgent — HTTP routes (Flask blueprint). They only translate HTTP to the
guard, the journal, the automations and the chat: no logic here."""
from flask import Blueprint, jsonify, request

from . import guard, journal, registry

agent_bp = Blueprint("devagent", __name__)


def _body():
    return request.get_json(silent=True) or {}


@agent_bp.route("/api/agent/tools")
def api_tools():
    return jsonify({"tools": [t.public() for t in registry.all_tools()], "domains": registry.domains()})


@agent_bp.route("/api/agent/tools/<name>", methods=["POST"])
def api_call_tool(name):
    """A tool run from the interface: the user clicked, so the actor is « interface »
    — but an irreversible tool still goes through a confirmation."""
    b = _body()
    ctx = {"project_id": b.get("project_id")} if b.get("project_id") else {}
    return jsonify(guard.call(name, b.get("args") or {}, actor=guard.HUMAN, ctx=ctx))


@agent_bp.route("/api/agent/journal")
def api_journal():
    pid = request.args.get("project_id", type=int)
    return jsonify({"actions": journal.actions(limit=request.args.get("limit", 100, type=int), project_id=pid,
                                               actor=request.args.get("actor") or None)})


@agent_bp.route("/api/agent/approvals")
def api_approvals():
    status = request.args.get("status", "attente")
    items = journal.approvals(None if status == "toutes" else status)
    for a in items:
        try:
            a["confirm_name"] = registry.get(a["tool"]).confirm_name
            a["description"] = registry.get(a["tool"]).description
        except registry.ToolError:
            a["confirm_name"] = False
        if a["tool"].startswith("deploiement_") and a["tool"] != "deploiement_configurer":
            a["preview"] = _deploy_preview(a)
        elif a["tool"] == "dns_appliquer" and a["status"] == "attente":
            a["preview"] = _dns_preview(a)
        elif a["tool"] == "commande_proposer":
            args = a["args"] or {}
            a["preview"] = (f"{args.get('pourquoi', '')} — commande : {args.get('commande', '')}"
                            + (f"  (projet {args['projet']})" if args.get("projet") else ""))
    return jsonify({"approvals": items})


def _deploy_preview(a):
    """What exactly will run on the server, shown before the user approves."""
    try:
        from .connectors import deploy
        from .tools._common import resolve_project
        from .tools.serveur import find_server
        p = resolve_project({"project_id": a.get("project_id")}, (a["args"] or {}).get("projet"))
        s = find_server(p["id"], (a["args"] or {}).get("serveur"))
        return (f"Sur {s['name']} ({s.get('user')}@{s.get('host')}), dossier {s.get('remote_path') or '?'} : "
                f"git pull puis « {deploy.command_for(p, s) or '(aucune commande)'} »")
    except Exception as e:
        return getattr(e, "message", None) or str(e)


def _dns_preview(a):
    """The DNS changes that approving would make, read now at the provider."""
    try:
        out = guard.call("dns_plan", {"projet": (a["args"] or {}).get("projet")}, actor=guard.HUMAN,
                         ctx={"project_id": a.get("project_id")})
        if out["statut"] != "ok":
            return out.get("message", "")
        ch = [c for c in out["resultat"]["changes"] if c["action"] != "identique"]
        return (f"Zone {out['resultat']['zone']} : " + ("; ".join(
            f"{c['action']} {c['type']} {c['name']} → {c['valeur']}" for c in ch) or "rien a changer"))
    except Exception as e:
        return getattr(e, "message", None) or str(e)


@agent_bp.route("/api/agent/approvals/<int:aid>/approve", methods=["POST"])
def api_approve(aid):
    return jsonify(guard.approve(aid, _body().get("confirm")))


@agent_bp.route("/api/agent/approvals/<int:aid>/refuse", methods=["POST"])
def api_refuse(aid):
    return jsonify(guard.refuse(aid))


@agent_bp.route("/api/agent/state")
def api_state():
    from . import mcp_install, vault
    from . import todos
    return jsonify({"paused": guard.paused(), "tools": len(registry.all_tools()),
                    "waiting": len(journal.approvals("attente")), "todos": todos.count(),
                    "vault_key": vault.key_path().exists()})


@agent_bp.route("/api/agent/pause", methods=["POST"])
def api_pause():
    return jsonify({"paused": guard.set_paused(bool(_body().get("paused", True)))})


@agent_bp.route("/api/agent/mcp")
def api_mcp_status():
    from . import mcp_install
    return jsonify(mcp_install.status())


@agent_bp.route("/api/agent/mcp", methods=["POST"])
def api_mcp_install():
    from . import mcp_install
    return jsonify(mcp_install.install() if _body().get("install", True) else mcp_install.remove())


# ── Automations ─────────────────────────────────────────────────────────────

def _project(pid):
    import projects as P
    return P.get(pid)


def _guarded(fn):
    """Run fn(); a refused operation becomes {ok: False, message}."""
    try:
        return jsonify({"ok": True, "result": fn()})
    except Exception as e:
        if not guard._refused(e):
            raise
        return jsonify({"ok": False, "message": getattr(e, "message", None) or str(e)}), 400


@agent_bp.route("/api/agent/automations")
def api_automations():
    from . import automations
    pid = request.args.get("project_id", type=int)
    items = automations.load(_project(pid)) if pid else automations.all_automations()
    return jsonify({"automations": items, "templates": automations.TEMPLATES, "paused": guard.paused()})


@agent_bp.route("/api/agent/automations/runs")
def api_automation_runs():
    from . import automations
    return jsonify({"runs": automations.runs(request.args.get("project_id", type=int),
                                             request.args.get("name") or None,
                                             request.args.get("limit", 50, type=int))})


@agent_bp.route("/api/agent/automations/<int:pid>/template", methods=["POST"])
def api_automation_template(pid):
    from . import automations
    b = _body()
    return _guarded(lambda: automations.from_template(_project(pid), b.get("template"), b.get("name") or None,
                                                      b.get("url") or None))


@agent_bp.route("/api/agent/automations/<int:pid>/<name>", methods=["GET", "PUT", "DELETE"])
def api_automation(pid, name):
    import yaml
    from . import automations
    if request.method == "GET":
        def read():
            a = automations.get(_project(pid), name)
            return {**a, "yaml": open(a["fichier"], encoding="utf-8").read()}
        return _guarded(read)
    if request.method == "DELETE":
        return _guarded(lambda: automations.delete(_project(pid), name))

    def write():
        try:
            spec = yaml.safe_load(_body().get("yaml") or "")
        except yaml.YAMLError as e:
            raise registry.ToolError(f"YAML invalide : {e}")
        return automations.save(_project(pid), name, spec)
    return _guarded(write)


@agent_bp.route("/api/agent/automations/<int:pid>/<name>/active", methods=["POST"])
def api_automation_active(pid, name):
    from . import automations
    return _guarded(lambda: automations.set_active(_project(pid), name, bool(_body().get("active", True))))


@agent_bp.route("/api/agent/automations/<int:pid>/<name>/run", methods=["POST"])
def api_automation_run(pid, name):
    """The user clicks « Lancer » : runs even when inactive (to try it before activating)."""
    from . import automations
    return _guarded(lambda: automations.run(_project(pid), name, trigger="manuel", require_active=False))


@agent_bp.route("/api/agent/automations/<int:pid>/<name>/hook", methods=["POST"])
def api_automation_hook_token(pid, name):
    from . import automations
    return _guarded(lambda: {"token": automations.hook_token(_project(pid), name, renew=bool(_body().get("renew")))})


@agent_bp.route("/api/agent/hooks/<token>", methods=["POST"])
def api_hook(token):
    """Local webhook: POST here starts the automation that owns this token."""
    import threading
    from . import automations
    found = automations.find_by_hook(token)
    if not found:
        return jsonify({"ok": False, "message": "webhook inconnu"}), 404
    pid, name = found

    def go():
        try:
            automations.run(_project(pid), name, trigger="webhook")
        except Exception:
            pass
    threading.Thread(target=go, daemon=True).start()
    return jsonify({"ok": True, "started": name})


# ── Notifications ───────────────────────────────────────────────────────────

NOTIFY_KEYS = ("notify_telegram_bot_token", "notify_telegram_chat_id", "notify_smtp_host", "notify_smtp_port",
               "notify_smtp_user", "notify_smtp_password", "notify_email_from", "notify_email_to",
               "dns_cloudflare_api_token", "dns_ovh_application_key", "dns_ovh_application_secret",
               "dns_ovh_consumer_key", "dns_hostinger_api_token")


@agent_bp.route("/api/agent/notify")
def api_notify_get():
    import db
    from . import vault
    from .connectors import notify
    vals = {k: db.get_setting(k, "") for k in NOTIFY_KEYS}
    return jsonify({"channels": notify.channels(),
                    "settings": {k: ("****" if v and vault.is_secret_setting(k) else v) for k, v in vals.items()}})


@agent_bp.route("/api/agent/notify", methods=["POST"])
def api_notify_set():
    import db
    for k, v in _body().items():
        if k in NOTIFY_KEYS and isinstance(v, str) and "****" not in v:
            db.set_setting(k, v.strip())
    return api_notify_get()


@agent_bp.route("/api/agent/notify/test", methods=["POST"])
def api_notify_test():
    from .connectors import notify
    return jsonify(notify.send("Ceci est un message de test de DevAgent.", title="DevAgent — test",
                               channel=_body().get("channel") or None))


# ── Chat ────────────────────────────────────────────────────────────────────

@agent_bp.route("/api/agent/chat/config")
def api_chat_config():
    import db
    from . import chat
    return jsonify({"configured": chat.configured(), "model": chat.model(),
                    "effort": db.get_setting("agent_effort", "") or "medium",
                    "key_saved": bool(db.get_setting("anthropic_api_key", ""))})


@agent_bp.route("/api/agent/chat/config", methods=["POST"])
def api_chat_config_set():
    import db
    b = _body()
    if isinstance(b.get("api_key"), str) and "****" not in b["api_key"]:
        db.set_setting("anthropic_api_key", b["api_key"].strip())
    if isinstance(b.get("model"), str):
        db.set_setting("agent_model", b["model"].strip())
    if b.get("effort") in ("low", "medium", "high", "xhigh", "max"):
        db.set_setting("agent_effort", b["effort"])
    return api_chat_config()


@agent_bp.route("/api/agent/chats")
def api_chats():
    from . import chat
    return jsonify({"chats": chat.chats(request.args.get("project_id", type=int))})


@agent_bp.route("/api/agent/chats", methods=["POST"])
def api_chat_start():
    from . import chat
    return jsonify(chat.start(_body().get("project_id") or None))


@agent_bp.route("/api/agent/chats/<int:cid>", methods=["GET", "DELETE"])
def api_chat(cid):
    from . import chat
    if request.method == "DELETE":
        return jsonify(chat.delete(cid))
    c = chat.get(cid, since=request.args.get("since", 0, type=int))
    return (jsonify(c), 200) if c else (jsonify({"error": "introuvable"}), 404)


@agent_bp.route("/api/agent/chats/<int:cid>/send", methods=["POST"])
def api_chat_send(cid):
    from . import chat
    out = chat.send(cid, _body().get("text", ""))
    return (jsonify(out), 200 if out.get("ok") else 400)


# ── Map, vault, projects ────────────────────────────────────────────────────

@agent_bp.route("/api/agent/map/<int:pid>")
def api_map(pid):
    from . import carte
    return _guarded(lambda: carte.build(pid))


@agent_bp.route("/api/agent/vault")
def api_vault():
    import db
    from . import cli, vault
    return jsonify(cli._vault_state(db, vault))


@agent_bp.route("/api/agent/projects")
def api_agent_projects():
    import projects as P
    return jsonify({"projects": [{"id": p["id"], "name": p["name"], "profile": p.get("profile") or "",
                                  "status": p.get("status")} for p in P.all_projects()]})


# ── The interface ───────────────────────────────────────────────────────────
# One page (/agent). Each screen is ONE file in devagent/web/pages/: adding a
# screen = adding a file there, nothing else to edit.

from pathlib import Path as _Path

from flask import Response, abort, send_from_directory

WEB = _Path(__file__).resolve().parent / "web"


@agent_bp.route("/agent")
def agent_page():
    html = (WEB / "agent.html").read_text(encoding="utf-8")
    pages = sorted(f.name for f in (WEB / "pages").glob("*.js"))
    tags = "\n".join(f'<script src="/agent/assets/pages/{n}"></script>' for n in pages)
    return Response(html.replace("<!--PAGES-->", tags), mimetype="text/html")


@agent_bp.route("/agent/assets/<path:name>")
def agent_asset(name):
    if not (WEB / name).is_file():
        abort(404)
    resp = send_from_directory(str(WEB), name)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


_QUIET = ("/api/agent/", "/api/terminal/", "/api/events", "/api/jobs/", "/api/scan/detect", "/api/servers/test",
          "/api/server/test")


@agent_bp.after_app_request
def _journal_interface_writes(resp):
    """What the user does with the classic buttons of the dashboard is journalled too:
    the method and the path only — never the body, it may hold a secret."""
    try:
        p = request.path
        if request.method != "GET" and p.startswith("/api/") and not p.startswith(_QUIET):
            parts = p.split("/")
            pid = int(parts[3]) if len(parts) > 3 and parts[2] == "projects" and parts[3].isdigit() else None
            journal.record(guard.HUMAN, f"{request.method} {p}"[:120], "ecriture", {},
                           "ok" if resp.status_code < 400 else "erreur", {"http": resp.status_code}, pid)
    except Exception:
        pass
    return resp


# ── Access to the outside platforms ─────────────────────────────────────────

@agent_bp.route("/api/agent/access")
def api_access():
    from . import access
    pid = request.args.get("project_id", type=int)
    out = {"access": access.status()}
    for e in out["access"]:
        e["explain"] = access.explain(e)
    if pid:
        try:
            out["project"] = access.for_project(pid)
        except Exception as e:
            if not guard._refused(e):
                raise
    return jsonify(out)


@agent_bp.route("/api/agent/access", methods=["POST"])
def api_access_save():
    from . import access
    return jsonify({"saved": access.save(_body())})


@agent_bp.route("/api/agent/access/test", methods=["POST"])
def api_access_test():
    from . import access
    return _guarded(lambda: access.test(_body().get("key") or None))


# ── Bitwarden: the keys shared between the user's PCs ───────────────────────
# The master password arrives in the request body, is used once and never stored;
# the journal of interface actions records the path only.

@agent_bp.route("/api/agent/bitwarden")
def api_bitwarden():
    from . import bitwarden
    return jsonify(bitwarden.info())


@agent_bp.route("/api/agent/bitwarden/<action>", methods=["POST"])
def api_bitwarden_do(action):
    from . import bitwarden
    if action not in ("push", "pull"):
        return jsonify({"ok": False, "message": "action inconnue"}), 404
    pw = _body().get("password") or ""

    def go():
        try:
            out = bitwarden.push(pw) if action == "push" else bitwarden.pull(pw)
        except Exception as e:
            journal.record(guard.HUMAN, f"bitwarden_{action}", "ecriture", {}, "erreur",
                           getattr(e, "message", None) or type(e).__name__)
            raise
        journal.record(guard.HUMAN, f"bitwarden_{action}", "ecriture", {}, "ok",
                       {"cles": len(out["cles"]), "hebergeurs": len(out["hebergeurs"])})
        return out
    return _guarded(go)


# ── State of the projects, shared between the user's PCs ────────────────────

@agent_bp.route("/api/agent/sync")
def api_sync_info():
    from . import etat
    return jsonify(etat.info())


@agent_bp.route("/api/agent/sync", methods=["POST"])
def api_sync():
    import db
    from . import etat
    b = _body()
    if "auto" in b:
        db.set_setting("etat_sync_auto", "1" if b["auto"] else "0")
        return jsonify({"ok": True, "result": etat.info()})
    if b.get("connect"):
        return _guarded(lambda: etat.connect(b.get("url") or None))
    return _guarded(etat.sync)


# ── Guide ───────────────────────────────────────────────────────────────────

@agent_bp.route("/api/agent/guide", methods=["POST"])
def api_guide():
    """« Que faire maintenant ? » — a read-only conversation on the project (or on all of them)."""
    from . import chat
    out = chat.guide(_body().get("project_id") or None)
    return (jsonify(out), 200 if out.get("ok") else 400)


# ── Missing tools ───────────────────────────────────────────────────────────

@agent_bp.route("/api/agent/tool-requests")
def api_tool_requests():
    from .tools import manque
    return jsonify({"requests": manque.requests(request.args.get("status", "ouverte") or None)})


@agent_bp.route("/api/agent/tool-requests/<int:rid>", methods=["POST"])
def api_tool_request(rid):
    """{status: faite | ouverte}  or  {build: true} → opens Claude Code in DevAgent's own code with the brief."""
    import shlex
    import shutil
    import subprocess
    from .tools import manque
    b = _body()
    if b.get("status") in ("faite", "ouverte", "ecartee"):
        return jsonify({"ok": manque.set_status(rid, b["status"])})

    def build():
        import dev
        text = manque.brief(rid)
        app_dir = WEB.parent.parent
        f = app_dir.parent / "data" / f"demande-outil-{rid}.md"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
        cmd = f"cd {shlex.quote(str(app_dir))} && {dev.claude_cmd()} \"$(cat {shlex.quote(str(f))})\""
        term = next((t for t in ("gnome-terminal", "konsole", "x-terminal-emulator", "xterm") if shutil.which(t)), None)
        opened = False
        if term and not b.get("command_only"):
            inner = f"{cmd}; exec bash"
            argv = ([term, "--title", "DevAgent — nouvel outil", "--", "bash", "-lc", inner] if term == "gnome-terminal"
                    else [term, "-e", "bash", "-lc", inner])
            try:
                subprocess.Popen(argv, start_new_session=True, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                opened = True
            except OSError:
                pass
        return {"opened": opened, "command": cmd, "brief": text}
    return _guarded(build)


# ── « A faire par toi » ─────────────────────────────────────────────────────

@agent_bp.route("/api/agent/todos")
def api_todos():
    from . import todos
    closed = todos.check() if request.args.get("check", "1") == "1" else []
    return jsonify({"closed": closed, "open": todos.items("ouverte", request.args.get("project_id", type=int)),
                    "done": todos.items("faite")[:15]})


@agent_bp.route("/api/agent/todos/<int:tid>", methods=["POST"])
def api_todo(tid):
    from . import todos
    action = _body().get("action")
    if action == "done":
        return jsonify({"ok": todos.close(tid)})
    if action == "drop":
        return jsonify({"ok": todos.close(tid, "ecartee")})
    if action == "reopen":
        return jsonify({"ok": todos.reopen(tid)})
    if action == "check":
        return jsonify({"ok": True, "closed": todos.check(tid)})
    return jsonify({"ok": False, "message": "action inconnue"}), 400


# ── Tools « a l'essai » ──────────────────────────────────────────────────────

@agent_bp.route("/api/agent/trial")
def api_trial():
    files = []
    errors = registry.trial_errors()
    tools = [t for t in registry.all_tools() if t.trial]
    for f in sorted(registry.trial_dir().glob("*.py")):
        if f.name.startswith("_"):
            continue
        files.append({"file": f.name, "error": errors.get(f.name, ""),
                      "source": f.read_text(encoding="utf-8", errors="replace")[:20000],
                      "tools": [{"name": t.name, "risk": t.risk, "description": t.description}
                                for t in tools if t.source and _Path(t.source).name == f.name]})
    return jsonify({"files": files})


@agent_bp.route("/api/agent/trial/<filename>", methods=["POST"])
def api_trial_do(filename):
    action = _body().get("action")
    if action == "approve":
        def go():
            out = registry.approve_trial(filename)
            journal.record(guard.HUMAN, "outil_approuver", "ecriture", {"fichier": filename}, "ok", out)
            return out
        return _guarded(go)
    if action == "delete":
        f = registry.trial_dir() / filename
        if not f.is_file() or f.parent != registry.trial_dir() or filename.startswith("_"):
            return jsonify({"ok": False, "message": "fichier introuvable"}), 404
        import projects as P
        P.move_to_trash(str(f))
        registry.load_trial()
        journal.record(guard.HUMAN, "outil_ecarter", "ecriture", {"fichier": filename}, "ok", None)
        return jsonify({"ok": True})
    return jsonify({"ok": False, "message": "action inconnue"}), 400
