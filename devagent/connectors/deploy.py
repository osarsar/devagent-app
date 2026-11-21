"""Connector — deploy a project on one of its servers, over SSH.

What a deployment does, on the server, in the project's remote folder:
    1. remember the current commit (for the rollback)
    2. git fetch + git pull --ff-only      (the server PULLS from GitHub)
    3. run the project's deploy command    (ex. docker compose up -d --build)

The deploy command is part of the project's configuration
(.devpilot/deploiement.json), set by the user. The history of deployments is
kept there too: previous commit → new commit, when, ok or not.
"""
import json
import shlex
import subprocess
from datetime import datetime

import projects as P
import servers

HISTORY_MAX = 30
TIMEOUT = 900


def _file(project):
    return P.space_dir(project["path"]) / "deploiement.json"


def config(project):
    try:
        return json.loads(_file(project).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(project, cfg):
    f = _file(project)
    f.parent.mkdir(parents=True, exist_ok=True)
    P._write_json(f, cfg)


def command_for(project, server):
    return (config(project).get("commandes") or {}).get(server["id"], "")


def set_command(project, server, command):
    command = (command or "").strip()
    if "\n" in command or len(command) > 500:
        raise P.ProjectError("Commande de deploiement : une seule ligne, 500 caracteres au plus")
    cfg = config(project)
    cfg.setdefault("commandes", {})[server["id"]] = command
    _save(project, cfg)
    return {"serveur": server["name"], "commande": command}


def history(project, limit=10):
    return (config(project).get("historique") or [])[:limit]


def _ssh(server, script, timeout=TIMEOUT):
    """(rc, stdout, stderr) of a script on the server. Replaced in the tests."""
    r = subprocess.run(servers.ssh_base(server) + [script], capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def _script(server, command, ref=None):
    d = servers.remote_dir_expr(server.get("remote_path"))
    move = (f"git checkout -q --detach {shlex.quote(ref)}" if ref
            else "git fetch -q origin && git pull -q --ff-only")
    return ("set -e; cd " + d + "; "
            "echo DEVAGENT_PREV=$(git rev-parse HEAD); "
            + move + "; "
            "echo DEVAGENT_NEW=$(git rev-parse HEAD); "
            "echo DEVAGENT_RUN; "
            + (command or "true"))


def _mark(out, key):
    for line in out.splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    return ""


def _do(project, server, ref=None, kind="deploiement"):
    if not server.get("remote_path"):
        raise P.ProjectError(f"Le serveur « {server['name']} » n'a pas de dossier distant : ou vit le projet dessus ?")
    command = command_for(project, server)
    try:
        rc, out, err = _ssh(server, _script(server, command, ref))
    except subprocess.TimeoutExpired:
        rc, out, err = 124, "", f"Delai depasse ({TIMEOUT} s)"
    prev, new = _mark(out, "DEVAGENT_PREV"), _mark(out, "DEVAGENT_NEW")
    tail = out.split("DEVAGENT_RUN", 1)[-1].strip()[-1500:]
    entry = {"quand": datetime.now().isoformat(timespec="seconds"), "type": kind, "serveur": server["name"],
             "serveur_id": server["id"], "avant": prev, "apres": new, "commande": command, "ok": rc == 0}
    cfg = config(project)
    cfg["historique"] = ([entry] + (cfg.get("historique") or []))[:HISTORY_MAX]
    _save(project, cfg)
    res = {**entry, "sortie": tail}
    if rc != 0:
        res["erreur"] = servers.explain_ssh_error(err, server) if not prev else (err.strip()[-800:] or f"code {rc}")
    return res


def deploy(project, server):
    return _do(project, server)


def rollback(project, server):
    """Back to the commit that was live before the last successful deployment on this server."""
    last = next((h for h in history(project, HISTORY_MAX)
                 if h.get("serveur_id") == server["id"] and h.get("type") == "deploiement"
                 and h.get("ok") and h.get("avant") and h.get("avant") != h.get("apres")), None)
    if not last:
        raise P.ProjectError("Aucun deploiement precedent a retablir sur ce serveur")
    return _do(project, server, ref=last["avant"], kind="retour")
