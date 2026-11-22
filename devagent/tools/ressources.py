"""Tools — what a project costs this PC: disk, and RAM / CPU / GPU while it runs."""
from .. import RISK_READ
from ..registry import PROJET, tool
from ._common import resolve_project


def _h(n):
    n = float(n or 0)
    for u in ("o", "Ko", "Mo", "Go", "To"):
        if n < 1024 or u == "To":
            return f"{n:.1f} {u}" if u != "o" else f"{int(n)} o"
        n /= 1024


@tool("projet_ressources", "Ce que le projet prend sur ce PC : sa place sur le disque (dependances, builds et caches, "
      "historique git, code et donnees, volumes Docker) et, s'il tourne, sa consommation en direct (CPU, RAM, memoire GPU) "
      "avec les processus et conteneurs qui la font. La mesure du disque se refait en arriere-plan.",
      risk=RISK_READ, params={"projet": PROJET})
def projet_ressources(ctx, projet=None):
    from .. import ressources
    p = resolve_project(ctx, projet)
    d = ressources.disk(p["id"]) or {}
    l = ressources.live(p["id"])
    out = {"projet": p["name"]}
    if d.get("total"):
        out["disque"] = {"total": _h(d["total"]), "mesure_le": d.get("mesure_le"),
                         "parts": {x["nom"]: _h(x["taille"]) for x in d["parts"]},
                         "plus_gros_dossiers": [f"{g['chemin']} ({_h(g['taille'])})" for x in d["parts"] for g in x["plus_gros"]][:8],
                         "volumes_docker": [f"{v['nom']} ({_h(v['taille'])})" for v in d.get("docker", [])]}
    else:
        out["disque"] = "mesure en cours, redemande dans une minute"
    out["en_marche"] = l["en_marche"]
    if l["en_marche"]:
        out["direct"] = {"cpu_pourcent_du_pc": l["cpu"], "ram": _h(l["ram"]), "memoire_gpu": _h(l["gpu"]),
                         "processus": [f"{x['nom']} (pid {x['pid']}) : {_h(x['ram'])}, {x['cpu']} % CPU" for x in l["processus"][:6]],
                         "conteneurs": [f"{x['nom']} : {_h(x['ram'])}, {x['cpu']} % CPU" for x in l["conteneurs"][:8]]}
    return out
