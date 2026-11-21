"""Tools — deploy a project on one of its servers (git pull + the project's deploy command)."""
from .. import RISK_IRREVERSIBLE
from ..connectors import deploy
from ..registry import PROJET, tool
from ._common import resolve_project
from .serveur import SERVEUR, find_server


def _target(ctx, projet, serveur):
    p = resolve_project(ctx, projet)
    return p, find_server(p["id"], serveur)


@tool("deploiement_etat", "La commande de deploiement de chaque serveur du projet et les derniers deploiements "
      "(commit avant → apres, date, reussite).", params={"projet": PROJET})
def deploiement_etat(ctx, projet=None):
    import servers
    p = resolve_project(ctx, projet)
    return {"serveurs": [{"serveur": s["name"], "role": s.get("role"), "dossier_distant": s.get("remote_path"),
                          "commande": deploy.command_for(p, s)} for s in servers.list_servers(p["id"])],
            "historique": deploy.history(p)}


@tool("deploiement_configurer", "Fixe la commande lancee sur le serveur apres le git pull "
      "(ex. « docker compose up -d --build »). Cette commande tournera sur le serveur a chaque deploiement.",
      risk=RISK_IRREVERSIBLE, automation=False,
      params={"projet": PROJET, "serveur": SERVEUR, "commande": {"type": "string"}},
      required=("projet", "commande"))
def deploiement_configurer(ctx, projet, commande, serveur=None):
    p, s = _target(ctx, projet, serveur)
    return deploy.set_command(p, s, commande)


@tool("deploiement_lancer", "Deploie la derniere version sur un serveur du projet : git pull sur le serveur "
      "puis la commande de deploiement du projet. Le commit precedent est garde pour pouvoir revenir.",
      risk=RISK_IRREVERSIBLE, automation=False,
      params={"projet": PROJET, "serveur": SERVEUR}, required=("projet",))
def deploiement_lancer(ctx, projet, serveur=None):
    p, s = _target(ctx, projet, serveur)
    return deploy.deploy(p, s)


@tool("deploiement_revenir", "Remet sur le serveur le commit d'avant le dernier deploiement reussi, puis "
      "relance la commande de deploiement.", risk=RISK_IRREVERSIBLE, automation=False,
      params={"projet": PROJET, "serveur": SERVEUR}, required=("projet",))
def deploiement_revenir(ctx, projet, serveur=None):
    p, s = _target(ctx, projet, serveur)
    return deploy.rollback(p, s)
