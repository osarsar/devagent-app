"""Tools — git inside a project (a project may hold several repos)."""
import dev
import github_ops
import gitsync

from .. import RISK_READ, RISK_WRITE
from ..registry import DEPOT, PROJET, NeedsConfirmation, ToolError, tool
from ._common import checked, resolve_project


def _pid(ctx, projet):
    return resolve_project(ctx, projet)["id"]


def _on_base_branch(pid, depot):
    """(branch, base) of a repo: the agent never writes on the base branch without a yes."""
    path = dev.repo_path(pid, depot or ".")
    st = gitsync.status(pid, depot or None, fetch=False)
    return st.get("branch") or "", dev.base_branch(path)


@tool("git_depots", "Les depots git d'un projet : dossier, branche, modifications, avance/retard sur GitHub.",
      params={"projet": PROJET, "actualiser": {"type": "boolean", "description": "Interroger GitHub (plus lent)"}})
def git_depots(ctx, projet=None, actualiser=False):
    return dev.repos(_pid(ctx, projet), fetch=bool(actualiser))


@tool("git_statut", "Etat d'un depot : branche, fichiers modifies, commits en avance ou en retard, conflits.",
      params={"projet": PROJET, "depot": DEPOT, "actualiser": {"type": "boolean"}})
def git_statut(ctx, projet=None, depot=None, actualiser=False):
    return gitsync.status(_pid(ctx, projet), depot or None, fetch=bool(actualiser))


@tool("git_branches", "Les branches d'un depot, locales et sur GitHub.",
      params={"projet": PROJET, "depot": DEPOT})
def git_branches(ctx, projet=None, depot="."):
    return dev.branches(_pid(ctx, projet), depot or ".")


@tool("git_journal", "Les derniers commits d'un depot.",
      params={"projet": PROJET, "depot": DEPOT, "limite": {"type": "integer", "minimum": 1, "maximum": 100}})
def git_journal(ctx, projet=None, depot=".", limite=20):
    return github_ops.git_log(str(dev.repo_path(_pid(ctx, projet), depot or ".")), limit=limite)


@tool("git_prs", "Les pull requests ouvertes des branches de travail du projet.", params={"projet": PROJET})
def git_prs(ctx, projet=None):
    return dev.prs(_pid(ctx, projet))


@tool("git_nouvelle_branche", "Cree une branche de travail. Elle part TOUJOURS du dernier main de GitHub.",
      risk=RISK_WRITE,
      params={"projet": PROJET, "depot": DEPOT, "nom": {"type": "string", "description": "ex. feat/page-contact"},
              "emporter_modifs": {"type": "boolean",
                                  "description": "Emporter les modifications en cours sur la nouvelle branche"}},
      required=("nom",))
def git_nouvelle_branche(ctx, nom, projet=None, depot=".", emporter_modifs=False):
    return dev.new_branch(_pid(ctx, projet), depot or ".", nom, carry=bool(emporter_modifs))


@tool("git_changer_branche", "Passe un depot sur une autre branche. Refuse s'il y a du travail non commite.",
      risk=RISK_WRITE, params={"projet": PROJET, "depot": DEPOT, "branche": {"type": "string"}},
      required=("branche",))
def git_changer_branche(ctx, branche, projet=None, depot="."):
    return dev.switch(_pid(ctx, projet), depot or ".", branche)


@tool("git_mettre_a_jour_main", "Met le main local a jour avec GitHub (avance rapide seulement).",
      risk=RISK_WRITE, params={"projet": PROJET, "depot": DEPOT})
def git_mettre_a_jour_main(ctx, projet=None, depot="."):
    return dev.update_main(_pid(ctx, projet), depot or ".")


@tool("git_commit", "Commite toutes les modifications d'un depot, sur la branche en cours. Ne pousse pas.",
      risk=RISK_WRITE, params={"projet": PROJET, "depot": DEPOT, "message": {"type": "string"}},
      required=("message",))
def git_commit(ctx, message, projet=None, depot="."):
    pid = _pid(ctx, projet)
    return checked(github_ops.git_commit(str(dev.repo_path(pid, depot or ".")), message, add_all=True))


@tool("git_synchroniser", "Commite (si un message est donne), recupere GitHub (pull --rebase) puis pousse. "
      "S'arrete sur un conflit. Sur la branche principale (main), demande ta confirmation.",
      risk=RISK_WRITE, params={"projet": PROJET, "depot": DEPOT, "message": {"type": "string"}})
def git_synchroniser(ctx, projet=None, depot=None, message=None):
    pid = _pid(ctx, projet)
    branch, base = _on_base_branch(pid, depot)
    if branch and branch == base and not ctx.get("approved"):
        raise NeedsConfirmation(f"pousser directement sur « {base} » (pas de branche de travail, pas de PR)")
    return gitsync.sync(pid, depot or None, commit_message=message)


@tool("git_comparer", "Compare le dossier du projet et son depot GitHub quand ils different (apres une liaison).",
      params={"projet": PROJET, "depot": DEPOT})
def git_comparer(ctx, projet=None, depot=None):
    return gitsync.compare(_pid(ctx, projet), depot or None)
