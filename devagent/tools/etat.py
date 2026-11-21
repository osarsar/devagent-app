"""Tools — the projects' state shared between the user's PCs."""
from .. import RISK_WRITE, etat
from ..registry import tool


@tool("sync_etat", "La synchronisation de l'etat des projets entre les PC de l'utilisateur : branchee ou non, "
      "depot utilise, derniere synchronisation.")
def sync_etat(ctx):
    return etat.info()


@tool("sync_maintenant", "Synchronise maintenant l'etat des projets (profil, feuille de route, serveurs, connexions, "
      "automatisations, notes de session) avec les autres PC : envoie ce qui a change ici, recoit ce qui a change "
      "ailleurs, signale les conflits et les projets qui existent sur un autre PC. Aucun secret ne part.",
      risk=RISK_WRITE)
def sync_maintenant(ctx):
    return etat.sync()
