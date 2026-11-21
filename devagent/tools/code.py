"""Tools — the code itself, through Claude Code (see connectors/claude_code.py)."""
import dev

from .. import RISK_WRITE
from ..connectors import claude_code
from ..registry import DEPOT, PROJET, tool
from ._common import resolve_project


@tool("claude_code", "POUR LIRE OU MODIFIER LE CODE d'un projet : confie la tache a Claude Code, qui travaille dans le "
      "depot (lire, modifier des fichiers, installer, lancer les tests ou le build). Decris la tache completement : "
      "ce qu'il faut changer, ou, et comment verifier. Il travaille toujours sur une branche de travail (creee si le "
      "depot est sur main) et ne pousse jamais : ensuite utilise git_commit / git_synchroniser, et execution_demarrer "
      "pour voir le resultat. Peut durer plusieurs minutes. Pour poursuivre le meme travail, redonne « suite ».",
      risk=RISK_WRITE, automation=False,
      params={"tache": {"type": "string"}, "projet": PROJET, "depot": DEPOT,
              "suite": {"type": "string", "description": "La « session » rendue par un appel precedent, pour continuer"}},
      required=("tache",))
def claude_code_tool(ctx, tache, projet=None, depot=".", suite=None):
    pid = resolve_project(ctx, projet)["id"]
    return claude_code.run(dev.repo_path(pid, depot or "."), tache, resume=suite or None)


@tool("outil_construire", "Fait ecrire par Claude Code un outil qui manque a DevAgent (decris le besoin, et ce qui a "
      "servi en attendant). L'outil est utilisable tout de suite, « a l'essai » : chacun de ses appels attend la "
      "confirmation de l'utilisateur tant qu'il ne l'a pas approuve. Peut durer plusieurs minutes.",
      risk=RISK_WRITE, automation=False,
      params={"besoin": {"type": "string"}, "exemple": {"type": "string"}}, required=("besoin",))
def outil_construire(ctx, besoin, exemple=""):
    return claude_code.build_tool(besoin, exemple or "")
