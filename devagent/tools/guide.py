"""Tools — the guide: the agent reads the real state and writes what to do. These tools call
the Anthropic API with the user's key (a few cents each): they are for automations (a morning
summary, an explained alert). In a conversation the agent does this by itself."""
from .. import RISK_WRITE, chat
from ..registry import PROJET, tool
from ._common import resolve_project


@tool("guide_point", "Redige un point court sur tous les projets (ou sur un seul) : ce qui demande une action "
      "aujourd'hui, ou en est chaque projet, la prochaine etape. Fait pour une automatisation du matin : le texte "
      "est dans « texte » (variable {{resultat}} de l'etape suivante). Utilise la cle API Anthropic.",
      risk=RISK_WRITE, params={"projet": PROJET})
def guide_point(ctx, projet=None):
    pid = resolve_project(ctx, projet)["id"] if projet else None
    return chat.run_once(chat.GUIDE_PROJECT if pid else chat.GUIDE_ALL,
                         "Que faire maintenant ?" if pid else "Point sur tous mes projets", pid)


@tool("guide_expliquer", "Cherche la cause d'un probleme qui vient d'etre detecte (site en panne, acces refuse, "
      "deploiement en erreur) et redige quoi faire. Fait pour une automatisation : le texte est dans « texte ». "
      "Utilise la cle API Anthropic.", risk=RISK_WRITE,
      params={"probleme": {"type": "string", "description": "Ce qui a ete constate (ex. {{erreur}})"}, "projet": PROJET},
      required=("probleme",))
def guide_expliquer(ctx, probleme, projet=None):
    pid = None
    if projet or ctx.get("project_id"):
        pid = resolve_project(ctx, projet)["id"]
    return chat.run_once(chat.GUIDE_EXPLAIN.format(probleme=probleme[:1500]), "Pourquoi ce probleme ?", pid)
