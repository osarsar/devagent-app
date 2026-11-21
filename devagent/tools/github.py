"""Tools — GitHub: the repos of the account / organisation, linked to a project."""
import ghorg
import github_ops
import projects as P

from .. import RISK_WRITE
from ..registry import PROJET, ToolError, tool
from ._common import checked, github_token, resolve_project


def _token():
    t = github_token()
    if not t:
        raise ToolError("Pas de token GitHub dans DevAgent (Reglages → GitHub). C'est toi qui le saisis.")
    return t


@tool("github_compte", "Le compte GitHub connecte a DevAgent, et s'il repond.")
def github_compte(ctx):
    t = github_token()
    if not t:
        return {"connecte": False, "utilisateur_gh": P.github_user(),
                "message": "Pas de token dans DevAgent ; l'outil gh du PC peut quand meme servir."}
    return github_ops.github_test_connection(t)


@tool("github_depots", "Les depots GitHub du compte connecte.",
      params={"visibilite": {"type": "string", "enum": ["all", "public", "private"]},
              "page": {"type": "integer", "minimum": 1}})
def github_depots(ctx, visibilite="all", page=1):
    return checked(github_ops.github_list_repos(_token(), page, 50, "updated", visibilite))


@tool("github_organisation", "Pour un projet lie a une organisation GitHub : chaque depot, son role, ou il est "
      "clone sur ce PC, son etat.", params={"projet": PROJET, "actualiser": {"type": "boolean"}})
def github_organisation(ctx, projet=None, actualiser=False):
    return ghorg.overview(resolve_project(ctx, projet)["id"], fetch=bool(actualiser))


@tool("github_creer_depot", "Cree un depot sur GitHub. Avec 'projet', le lie aussitot au dossier du projet "
      "(origin), sans rien ecraser.", risk=RISK_WRITE,
      params={"nom": {"type": "string"}, "prive": {"type": "boolean", "description": "Defaut : oui"},
              "description": {"type": "string"}, "projet": PROJET}, required=("nom",))
def github_creer_depot(ctx, nom, prive=True, description="", projet=None):
    target = resolve_project(ctx, projet) if projet else None       # fail before creating anything
    repo = checked(github_ops.github_create_repo(_token(), nom, private=bool(prive), description=description or ""))
    out = {"depot": repo}
    if target:
        url = repo.get("ssh_url") or repo.get("clone_url") or repo.get("html_url")
        try:
            out["liaison"] = P.link_git(target["id"], url)
        except P.ProjectError as e:
            out["liaison"] = {"erreur": e.message, "note": "Le depot existe ; la liaison reste a faire (github_lier)."}
    return out


@tool("github_lier", "Lie le dossier d'un projet a un depot GitHub existant. Ne supprime et n'ecrase rien.",
      risk=RISK_WRITE, params={"projet": PROJET, "url": {"type": "string", "description": "URL ou owner/repo"}},
      required=("url",))
def github_lier(ctx, url, projet=None):
    return P.link_git(resolve_project(ctx, projet)["id"], url)


@tool("github_lier_organisation", "Lie un projet a plusieurs depots a son organisation GitHub.",
      risk=RISK_WRITE, params={"projet": PROJET, "organisation": {"type": "string"}},
      required=("organisation",))
def github_lier_organisation(ctx, organisation, projet=None):
    return ghorg.link_org(resolve_project(ctx, projet)["id"], organisation)


@tool("github_cloner_depot", "Clone dans le projet un depot de son organisation qui manque sur ce PC.",
      risk=RISK_WRITE, params={"projet": PROJET, "depot": {"type": "string", "description": "Nom du depot"},
                               "dossier": {"type": "string", "description": "Ou le mettre dans le projet"}},
      required=("depot",))
def github_cloner_depot(ctx, depot, projet=None, dossier=None):
    return ghorg.clone_repo(resolve_project(ctx, projet)["id"], depot, dest=dossier or None)


@tool("github_tout_mettre_a_jour", "git pull (avance rapide) dans chaque clone propre du projet. Ne touche "
      "jamais un depot qui a du travail en cours.", risk=RISK_WRITE, params={"projet": PROJET})
def github_tout_mettre_a_jour(ctx, projet=None):
    return ghorg.pull_all(resolve_project(ctx, projet)["id"])
