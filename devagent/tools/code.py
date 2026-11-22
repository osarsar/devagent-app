"""Tools — the code itself, through Claude Code (see connectors/claude_code.py)."""
import dev

from .. import RISK_WRITE
from ..connectors import claude_code
from ..registry import NeedsConfirmation, ToolError, DEPOT, PROJET, tool
from ._common import resolve_project


MODELE = {"type": "string", "enum": ["auto", "haiku", "sonnet", "opus", "fable"],
          "description": "Le modele de Claude Code selon la tache : " + " ; ".join(f"{k} = {v}" for k, v in claude_code.MODELS.items())
          + ". auto = sonnet."}
EFFORT = {"type": "string", "enum": list(claude_code.EFFORTS),
          "description": "Combien il reflechit : low (simple) … max (tres difficile). Vide = le reglage de Claude Code."}


@tool("claude_code", "POUR LIRE OU MODIFIER LE CODE d'un projet : confie la tache a Claude Code, qui travaille dans le "
      "depot (lire, modifier des fichiers, installer, lancer les tests ou le build). Ecris une consigne COMPLETE et "
      "autonome : contexte, objectif, fichiers concernes, contraintes, et comment verifier. Choisis « modele » et "
      "« effort » selon la difficulte (pas fable/max pour une petite chose). « objectif » : une condition verifiable "
      "de fin (ex. « les tests de tests/test_x.py passent et le build reussit ») ; Claude Code continue jusqu'a ce "
      "qu'elle soit vraie (son /goal). « mode » = ultracode pour un tres gros travail en plusieurs parties "
      "independantes (plusieurs agents en parallele, couteux : l'utilisateur confirme). Il travaille toujours sur "
      "une branche de travail (creee si le depot est sur main) et ne pousse jamais. Le resultat donne « session » : "
      "pour corriger ou poursuivre LE MEME travail, rappelle claude_code avec « suite » = cette session et une "
      "consigne precise (ne recommence pas de zero). Peut durer plusieurs minutes.",
      risk=RISK_WRITE, automation=False,
      params={"tache": {"type": "string"}, "projet": PROJET, "depot": DEPOT,
              "suite": {"type": "string", "description": "La « session » rendue par un appel precedent, pour continuer"},
              "modele": MODELE, "effort": EFFORT,
              "objectif": {"type": "string", "description": "Condition de fin verifiable : Claude Code travaille jusqu'a "
                           "ce qu'elle soit vraie"},
              "mode": {"type": "string", "enum": ["normal", "ultracode"],
                       "description": "ultracode : plusieurs agents en parallele pour un tres gros travail (confirme par "
                                      "l'utilisateur)"}},
      required=("tache",))
def claude_code_tool(ctx, tache, projet=None, depot=".", suite=None, modele=None, effort=None, objectif=None, mode=None):
    claude_code.options(modele, effort)                # a wrong model or effort is refused before anything else
    if mode == "ultracode" and not ctx.get("approved"):
        raise NeedsConfirmation("lancer Claude Code en mode ultracode (plusieurs agents en parallele : long et couteux)"
                                + (f", modele {modele}" if modele and modele != "auto" else ""))
    proj = resolve_project(ctx, projet)
    depot = depot or "."
    if depot == ".":                                   # no repository named: the only one, or say which exist
        import projects as P
        dirs = [r["dir"] for r in P.find_repos(proj["path"])]
        if dirs and "." not in dirs:
            if len(dirs) > 1:
                raise ToolError(f"Ce projet a plusieurs depots : precise « depot » ({', '.join(dirs)}).")
            depot = dirs[0]
    return claude_code.run(dev.repo_path(proj["id"], depot), tache, resume=suite or None,
                           model=None if modele in (None, "", "auto") else modele, effort=effort or None,
                           goal=objectif or None, ultracode=mode == "ultracode")


@tool("outil_construire", "Fait ecrire par Claude Code un outil qui manque a DevAgent (decris le besoin, et ce qui a "
      "servi en attendant). L'outil est utilisable tout de suite, « a l'essai » : chacun de ses appels attend la "
      "confirmation de l'utilisateur tant qu'il ne l'a pas approuve. Peut durer plusieurs minutes.",
      risk=RISK_WRITE, automation=False,
      params={"besoin": {"type": "string"}, "exemple": {"type": "string"},
              "modele": {**MODELE, "description": "Modele de Claude Code pour ecrire l'outil (par defaut opus)"},
              "effort": EFFORT}, required=("besoin",))
def outil_construire(ctx, besoin, exemple="", modele=None, effort=None):
    return claude_code.build_tool(besoin, exemple or "", model=None if modele in (None, "", "auto") else modele,
                                  effort=effort or None)
