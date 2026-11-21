"""Tools — GitHub: the repos of the account / organisation, linked to a project."""
import ghorg
import github_ops
import projects as P

from .. import RISK_IRREVERSIBLE, RISK_WRITE
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


def _gh(args):
    """Run the gh tool of this PC (the user's own GitHub login). Returns its output."""
    import shutil
    import subprocess
    if not shutil.which("gh"):
        raise ToolError("L'outil gh n'est pas installe sur ce PC")
    r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise ToolError(f"GitHub : {(r.stderr or r.stdout).strip()[:300]}")
    return r.stdout.strip()


def _full(depot):
    depot = depot.strip().removesuffix(".git")
    for prefix in ("https://github.com/", "git@github.com:"):
        depot = depot.removeprefix(prefix)
    if "/" not in depot:
        depot = f"{_gh(['api', 'user', '-q', '.login'])}/{depot}"
    return depot


@tool("github_depot", "Un depot GitHub : visibilite, archive ou non, branche principale, dernier envoi.",
      params={"depot": {"type": "string", "description": "nom, ou proprietaire/nom"}}, required=("depot",))
def github_depot(ctx, depot):
    import json
    return json.loads(_gh(["repo", "view", _full(depot), "--json",
                           "nameWithOwner,isPrivate,isArchived,defaultBranchRef,pushedAt,url,description"]))


@tool("github_renommer_depot", "Renomme un depot sur GitHub. GitHub redirige l'ancienne adresse ; les clones "
      "existants continuent de marcher. Avec 'projet', met aussi a jour l'adresse (origin) du clone de ce depot "
      "dans le projet.", risk=RISK_IRREVERSIBLE, automation=False,
      params={"depot": {"type": "string", "description": "nom actuel, ou proprietaire/nom"},
              "nouveau_nom": {"type": "string"}, "projet": PROJET}, required=("depot", "nouveau_nom"))
def github_renommer_depot(ctx, depot, nouveau_nom, projet=None):
    full = _full(depot)
    owner, old = full.split("/", 1)
    _gh(["api", "-X", "PATCH", f"repos/{full}", "-f", f"name={nouveau_nom}", "-q", ".full_name"])
    out = {"ancien": full, "nouveau": f"{owner}/{nouveau_nom}", "clones_mis_a_jour": []}
    if projet:
        p = resolve_project(ctx, projet)
        for r in P.find_repos(p["path"]):
            path = P.resolve(p["path"]) / r["dir"]
            rc, url, _ = P.git(["remote", "get-url", "origin"], cwd=path)
            if rc == 0 and url.strip().removesuffix(".git").lower().endswith(f"{owner}/{old}".lower()):
                new_url = url.strip().removesuffix(".git")[: -len(old)] + nouveau_nom + ".git"
                P.git(["remote", "set-url", "origin", new_url], cwd=path)
                out["clones_mis_a_jour"].append({"dossier": r["dir"], "origin": new_url})
    return out


@tool("github_archiver_depot", "Archive un depot sur GitHub : il devient en lecture seule et n'apparait plus "
      "comme actif. Rien n'est supprime ; il se desarchive depuis ses reglages.", risk=RISK_IRREVERSIBLE,
      automation=False, params={"depot": {"type": "string"}}, required=("depot",))
def github_archiver_depot(ctx, depot):
    full = _full(depot)
    _gh(["repo", "archive", full, "--yes"])
    return {"archive": full}
