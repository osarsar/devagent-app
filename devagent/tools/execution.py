"""Tools — what is RUNNING on this PC for a project: ports, previews, its console, the disk."""
import shutil

import controller
import ports
import preview
import projects as P

from .. import RISK_WRITE
from ..registry import PROJET, ToolError, tool
from ._common import project_dir, resolve_project


@tool("execution_ce_qui_tourne", "Tout ce qui ecoute sur un port de ce PC, range par projet : port, processus, "
      "commande. Les ports qui n'appartiennent a aucun projet sont dans 'autres'.")
def execution_ce_qui_tourne(ctx):
    by_project, owned = [], set()
    for p in P.all_projects():
        try:
            pp = ports.project_ports(p["id"]).get("ports", [])
        except Exception:
            pp = []
        if pp:
            by_project.append({"projet": p["name"], "ports": pp})
            owned.update(x["port"] for x in pp)
    others = [x for x in ports.listening() if x["port"] not in owned]
    return {"projets": by_project, "autres": others}


@tool("execution_ports", "Les ports tenus par les processus d'un projet, et d'ou ils viennent.",
      params={"projet": PROJET})
def execution_ports(ctx, projet=None):
    return ports.project_ports(resolve_project(ctx, projet)["id"])


@tool("execution_apercus", "Ou voir tourner chaque depot du projet sur ce PC (localhost:port), ou la commande "
      "qui le demarre s'il ne tourne pas.", params={"projet": PROJET})
def execution_apercus(ctx, projet=None):
    return preview.previews(resolve_project(ctx, projet)["id"])


@tool("execution_arreter_port", "Libere un port tenu par un processus du projet (arrete ce processus et ce "
      "qu'il a lance). Refuse si le port n'appartient pas au projet.", risk=RISK_WRITE,
      params={"projet": PROJET, "port": {"type": "integer", "minimum": 1, "maximum": 65535}},
      required=("port",))
def execution_arreter_port(ctx, port, projet=None):
    return ports.stop_port(resolve_project(ctx, projet)["id"], port)


@tool("console_etat", "La console propre au projet (ex. md_console) : existe-t-elle, tourne-t-elle, son adresse.",
      params={"projet": PROJET})
def console_etat(ctx, projet=None):
    p = resolve_project(ctx, projet)
    ctrl = controller.get(p["id"])
    if not ctrl:
        return {"console": None, "message": "Ce projet n'a pas de console propre."}
    return {"console": ctrl, "etat": controller.status(ctrl, project_dir(p))}


@tool("console_demarrer", "Demarre la console propre au projet.", risk=RISK_WRITE, params={"projet": PROJET})
def console_demarrer(ctx, projet=None):
    return controller.start(resolve_project(ctx, projet)["id"])


@tool("console_arreter", "Arrete la console propre au projet.", risk=RISK_WRITE, params={"projet": PROJET})
def console_arreter(ctx, projet=None):
    return controller.stop(resolve_project(ctx, projet)["id"])


@tool("console_journal", "Les dernieres lignes du journal de la console du projet.",
      params={"projet": PROJET, "lignes": {"type": "integer", "minimum": 1, "maximum": 400}})
def console_journal(ctx, projet=None, lignes=80):
    return controller.log_tail(resolve_project(ctx, projet)["id"], n=lignes)


@tool("pc_disque", "L'espace disque de ce PC et la taille du dossier de chaque projet.")
def pc_disque(ctx):
    import sizes
    du = shutil.disk_usage(str(P.DEVPILOT_PROJECTS) if hasattr(P, "DEVPILOT_PROJECTS") else "/")
    projs = []
    for p in P.all_projects():
        n = sizes.size(p["path"]) if p.get("path") else None
        projs.append({"projet": p["name"], "octets": n, "taille": _fmt(n)})
    projs.sort(key=lambda x: -(x["octets"] or 0))
    return {"disque": {"total": _fmt(du.total), "utilise": _fmt(du.used), "libre": _fmt(du.free),
                       "pourcent_utilise": round(du.used * 100 / du.total, 1)},
            "projets": projs}


def _fmt(n):
    if n is None:
        return "calcul en cours"
    for unit in ("o", "Ko", "Mo", "Go", "To"):
        if n < 1024 or unit == "To":
            return f"{n:.0f} {unit}" if unit == "o" else f"{n:.1f} {unit}"
        n /= 1024


@tool("execution_demarrer", "Lance un depot du projet en local (son dev.sh, « npm run dev », run.sh… : la commande "
      "est celle que DevAgent a trouvee, pas une commande libre), dans un terminal de DevAgent qui survit. "
      "Renvoie l'adresse ou le voir une fois demarre (execution_apercus la redonne).", risk=RISK_WRITE,
      params={"projet": PROJET, "depot": {"type": "string", "description": "Dossier du depot dans le projet ('.' = la racine)"}})
def execution_demarrer(ctx, projet=None, depot="."):
    import time
    import persist
    p = resolve_project(ctx, projet)
    pv = preview.previews(p["id"])
    key = depot or "."
    if key not in pv:
        raise ToolError(f"Depot « {key} » inconnu dans ce projet. Depots : " + ", ".join(pv) or "aucun")
    entry = pv[key]
    if entry.get("running"):
        return {"deja_lance": True, "adresses": [r.get("url") for r in entry["running"]]}
    start = entry.get("start")
    if not start:
        raise ToolError(f"Je ne sais pas comment lancer « {key} » : ni dev.sh, ni script « dev » dans package.json, ni run.sh.")
    if not persist.available():
        raise ToolError("tmux n'est pas installe sur ce PC (sudo apt install tmux) : lance-le a la main : " + start["cmd"])
    cwd = str((project_dir(p) / start["cwd"]).resolve())
    sid = f"dev-{p['id']}-{time.time_ns() % 10**10}"
    persist.create(sid, cwd, ["bash", "-lc", f"{start['cmd']}; exec bash --login"],
                   {"pid": p["id"], "repo": key, "kind": "terminal", "label": f"{key} · {start['cmd']}"},
                   env={"TERM": "xterm-256color", "COLORTERM": "truecolor"})
    url = None
    for _ in range(40):                                  # up to ~20 s for the server to answer
        time.sleep(0.5)
        running = (preview.previews(p["id"]).get(key) or {}).get("running") or []
        if running:
            url = running[0].get("url")
            break
    return {"lance": True, "commande": start["cmd"], "dossier": start["cwd"], "session": sid, "adresse": url,
            "note": None if url else "Demarrage en cours (installation des dependances ?) : regarde dans "
                                     "DevAgent → Sessions, ou rappelle execution_apercus dans un instant."}
