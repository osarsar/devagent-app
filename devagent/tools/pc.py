"""Tools — this PC (system, Docker, cleanup suggestions) and a project's connections as
the interface shows them. They call the same functions as the dashboard's routes
(system_ops, cloud_ops)."""
import cloud_ops
import system_ops

from .. import RISK_IRREVERSIBLE
from ..registry import PROJET, ToolError, tool
from ._common import resolve_project

# cleanup actions that need no free path: nothing here can point at an arbitrary file
CLEAN_ACTIONS = {
    "trash": "vider la corbeille",
    "clean_expired": "supprimer les ressources temporaires expirees",
    "docker_dangling": "supprimer les images Docker sans nom",
    "docker_cache": "vider le cache de build Docker",
    "pip_cache": "vider le cache pip",
    "clear_all_pycache": "supprimer les dossiers __pycache__ des projets",
}


def _plain(res):
    """(answer, http_status) → the answer, or a ToolError when the status is an error."""
    if isinstance(res, tuple) and len(res) == 2 and isinstance(res[1], int):
        body, status = res
        if status >= 400:
            raise ToolError((body or {}).get("message") or (body or {}).get("error") or f"Erreur {status}")
        return body
    if isinstance(res, dict) and res.get("success") is False:
        raise ToolError(res.get("message") or "Echec")
    return res


@tool("pc_systeme", "L'etat de ce PC : processeur, memoire, disques (espace libre), corbeille.")
def pc_systeme(ctx):
    return _plain(system_ops.system())


@tool("pc_docker", "Docker sur ce PC : conteneurs, images, volumes, espace recuperable.")
def pc_docker(ctx):
    return _plain(system_ops.docker())


@tool("pc_suggestions", "Ce qui peut etre nettoye sur ce PC pour liberer de la place, avec la taille de chaque element.")
def pc_suggestions(ctx):
    return _plain(system_ops.suggestions())


@tool("pc_processus", "Les processus qui prennent le plus de memoire, avec les serveurs de developpement reperes.")
def pc_processus(ctx):
    return _plain(system_ops.processes())


@tool("pc_nettoyer", "Nettoie ce PC. Actions : " + " ; ".join(f"{k} = {v}" for k, v in CLEAN_ACTIONS.items()) + ".",
      risk=RISK_IRREVERSIBLE, automation=False,
      params={"action": {"type": "string", "enum": sorted(CLEAN_ACTIONS)}}, required=("action",))
def pc_nettoyer(ctx, action):
    return _plain(system_ops.clean(data={"action": action}))


@tool("projet_connexions", "Toutes les connexions d'un projet comme l'interface les montre : GitHub, hebergement, "
      "domaine, base, stockage, email, serveurs — etat verifie et prochaine action conseillee pour chacune.",
      params={"projet": PROJET})
def projet_connexions(ctx, projet=None):
    return _plain(cloud_ops.get_connections(resolve_project(ctx, projet)["id"]))


@tool("projet_statut_disque", "Ce qu'un projet occupe sur ce PC : taille, caches de build, ressources Docker, etat git.",
      params={"projet": PROJET})
def projet_statut_disque(ctx, projet=None):
    return _plain(system_ops.project_status(resolve_project(ctx, projet)["id"]))


@tool("projet_nettoyage_apercu", "Ce qui pourrait etre nettoye dans un projet (caches de build, conteneurs, volumes), "
      "sans rien supprimer.", params={"projet": PROJET})
def projet_nettoyage_apercu(ctx, projet=None):
    return _plain(system_ops.cleanup_preview(resolve_project(ctx, projet)["id"]))
