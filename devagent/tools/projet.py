"""Tools — the project itself: where it is, what it needs, its roadmap."""
import re
from datetime import datetime

import model
import phases
import ports
import projects as P
import purge

from .. import RISK_IRREVERSIBLE, RISK_READ, RISK_WRITE
from ..registry import PROJET, ToolError, tool
from ._common import project_dir, resolve_project


def _brief(p):
    s = phases.summary(p["id"]) or {}
    return {"id": p["id"], "nom": p["name"], "profil": p.get("profile") or "", "statut": p.get("status"),
            "dossier": p.get("path"), "description": p.get("description") or "",
            "phase": s.get("current_label"), "etapes_faites": s.get("done"), "etapes_total": s.get("total")}


@tool("projet_lister", "Liste tous les projets : nom, profil, phase en cours, dossier.")
def projet_lister(ctx):
    return [_brief(p) for p in P.all_projects()]


@tool("projet_etat", "Ou en est un projet : profil, besoins et leur etat (GitHub, hebergement, domaine...), "
      "phase et prochaine etape, depots git, ports ouverts. A appeler en premier pour comprendre un projet.",
      params={"projet": PROJET})
def projet_etat(ctx, projet=None):
    p = resolve_project(ctx, projet)
    pid = p["id"]
    out = {"projet": _brief(p)}
    for key, fn in (("modele", lambda: model.get_model(pid, probe=False)),
                    ("besoins", lambda: model.connections_status(pid, probe=False)),
                    ("feuille_de_route", lambda: _roadmap_short(pid)),
                    ("ports", lambda: ports.project_ports(pid).get("ports", []))):
        try:
            out[key] = fn()
        except Exception as e:                    # one broken part never hides the rest
            out[key] = {"erreur": str(e)}
    return out


def _roadmap_short(pid):
    r = phases.roadmap(pid)
    todo = [{"phase": ph["key"], "etape": st["key"], "libelle": st["label"], "etat": st.get("state")}
            for ph in r["phases"] for st in ph.get("steps", []) if st.get("state") not in ("done", "skipped")]
    return {"phase_en_cours": r.get("current"), "prochaine_etape": r.get("next"),
            "reste_a_faire": todo}


@tool("projet_feuille_de_route", "La feuille de route complete d'un projet : phases, etapes, etat de chacune.",
      params={"projet": PROJET})
def projet_feuille_de_route(ctx, projet=None):
    return phases.roadmap(resolve_project(ctx, projet)["id"])


@tool("projet_besoins", "Les besoins d'un projet (GitHub, hebergement, domaine, email, base, stockage...) "
      "verifies pour de vrai : ok, partiel ou manquant.", params={"projet": PROJET})
def projet_besoins(ctx, projet=None):
    return model.connections_status(resolve_project(ctx, projet)["id"], probe=True)


@tool("projet_inspecter", "Ce que contient le dossier d'un projet : depots git, travail non sauvegarde, "
      "Docker, processus. A lire avant de deplacer ou supprimer.", params={"projet": PROJET})
def projet_inspecter(ctx, projet=None):
    return P.inspect(project_dir(resolve_project(ctx, projet)), with_size=False)


@tool("projet_profils", "Les types de projet possibles et les besoins que chacun active.")
def projet_profils(ctx):
    return {"profils": {k: {"label": v["label"], "desc": v["desc"], "besoins": v["needs"]}
                        for k, v in model.PROFILES.items()},
            "besoins": {k: v["label"] for k, v in model.NEEDS.items()}}


@tool("projet_creer", "Cree un nouveau projet : son dossier dans ~/devpilot/projects, son espace .devpilot/, "
      "et son profil. Ne cree PAS le depot GitHub (voir github_creer_depot).", risk=RISK_WRITE,
      params={"nom": {"type": "string", "description": "Nom du projet (lettres, chiffres, tirets)"},
              "description": {"type": "string"},
              "profil": {"type": "string", "description": "vitrine, site_backend, blog_cms, site_complet, "
                         "webapp_saas, api_backend, mobile, enterprise ou custom"},
              "git_init": {"type": "boolean", "description": "Faire git init dans le dossier (defaut : oui)"}},
      required=("nom",))
def projet_creer(ctx, nom, description="", profil=None, git_init=True):
    p = P.create(nom, git_init=git_init, description=description or "")
    if profil:
        model.set_model(p["id"], profile=profil)
    return _brief(P.get(p["id"]))


@tool("projet_definir_profil", "Change le type d'un projet et/ou la liste de ses besoins.", risk=RISK_WRITE,
      params={"projet": PROJET, "profil": {"type": "string"},
              "besoins": {"type": "array", "items": {"type": "string"},
                          "description": "Liste complete des besoins (remplace l'ancienne)"}})
def projet_definir_profil(ctx, projet=None, profil=None, besoins=None):
    if profil is None and besoins is None:
        raise ToolError("Donne un profil ou une liste de besoins")
    return model.set_model(resolve_project(ctx, projet)["id"], profile=profil, needs=besoins)


@tool("projet_etape_marquer", "Coche (ou decoche) une etape manuelle de la feuille de route.", risk=RISK_WRITE,
      params={"projet": PROJET, "etape": {"type": "string", "description": "Cle de l'etape (ex. dev_done)"},
              "fait": {"type": "boolean"}}, required=("etape",))
def projet_etape_marquer(ctx, etape, projet=None, fait=True):
    return phases.mark(resolve_project(ctx, projet)["id"], etape, done=fait)


@tool("projet_etape_reporter", "Reporte une etape a plus tard (elle ne bloque plus la phase).", risk=RISK_WRITE,
      params={"projet": PROJET, "etape": {"type": "string"}}, required=("etape",))
def projet_etape_reporter(ctx, etape, projet=None):
    return phases.skip(resolve_project(ctx, projet)["id"], etape, later=True)


@tool("projet_etape_ajouter", "Ajoute une etape personnalisee dans une phase de la feuille de route.",
      risk=RISK_WRITE,
      params={"projet": PROJET,
              "phase": {"type": "string", "enum": ["prepare", "dev", "hosting", "golive", "prod"]},
              "libelle": {"type": "string"}, "aide": {"type": "string"}}, required=("phase", "libelle"))
def projet_etape_ajouter(ctx, phase, libelle, projet=None, aide=""):
    return phases.add_custom(resolve_project(ctx, projet)["id"], phase, libelle, hint=aide or "")


@tool("projet_note_session", "Enregistre une note de session dans .devpilot/sessions/ du projet : ce qui a ete "
      "fait, ce qui reste, les problemes.", risk=RISK_WRITE,
      params={"projet": PROJET, "titre": {"type": "string"},
              "contenu": {"type": "string", "description": "Texte en Markdown"}},
      required=("titre", "contenu"))
def projet_note_session(ctx, titre, contenu, projet=None):
    d = P.space_dir(project_dir(resolve_project(ctx, projet))) / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", titre).strip("-").lower()[:60] or "session"
    f = d / f"{datetime.now():%Y-%m-%d}_{slug}.md"
    n = 2
    while f.exists():
        f = d / f"{datetime.now():%Y-%m-%d}_{slug}-{n}.md"
        n += 1
    f.write_text(contenu if contenu.lstrip().startswith("#") else f"# {titre}\n\n{contenu}\n")
    return {"fichier": str(f)}


@tool("projet_sessions", "Les notes de session d'un projet (les plus recentes d'abord). Avec 'nom', le texte d'une note.",
      params={"projet": PROJET, "nom": {"type": "string", "description": "Nom du fichier a lire"}})
def projet_sessions(ctx, projet=None, nom=None):
    d = P.space_dir(project_dir(resolve_project(ctx, projet))) / "sessions"
    files = sorted(d.glob("*.md"), reverse=True) if d.is_dir() else []
    if nom:
        f = next((x for x in files if x.name == nom or x.stem == nom), None)
        if not f:
            raise ToolError(f"Note « {nom} » introuvable")
        return {"nom": f.name, "contenu": f.read_text(errors="replace")[:15000]}
    return [{"nom": f.name, "taille": f.stat().st_size} for f in files[:30]]


@tool("projet_renommer", "Change le nom affiche d'un projet. Le dossier n'est pas touche.", risk=RISK_WRITE,
      params={"projet": PROJET, "nouveau_nom": {"type": "string"}}, required=("nouveau_nom",))
def projet_renommer(ctx, nouveau_nom, projet=None):
    return P.rename(resolve_project(ctx, projet)["id"], nouveau_nom)


@tool("projet_fermer", "Ferme un projet : arrete sa console, ses terminaux et les processus lances depuis son "
      "dossier, et libere leurs ports.", risk=RISK_WRITE, params={"projet": PROJET})
def projet_fermer(ctx, projet=None):
    return ports.close_project(resolve_project(ctx, projet)["id"])


@tool("projet_plan_suppression", "Ce qui serait touche si le projet etait supprime (fichiers, Docker, processus, "
      "travail non sauvegarde). Ne supprime rien.", params={"projet": PROJET})
def projet_plan_suppression(ctx, projet=None):
    pid = resolve_project(ctx, projet)["id"]
    return {"suppression": P.removal_report(pid), "docker_et_processus": purge.plan(pid)}


@tool("projet_supprimer", "Retire un projet de DevAgent. Avec supprimer_fichiers, son dossier part a la corbeille. "
      "Refuse s'il reste du travail non sauvegarde.", risk=RISK_IRREVERSIBLE, confirm_name=True,
      params={"projet": PROJET, "supprimer_fichiers": {"type": "boolean"}}, required=("projet",))
def projet_supprimer(ctx, projet, supprimer_fichiers=False):
    p = resolve_project(ctx, projet)
    return P.remove(p["id"], delete_files=bool(supprimer_fichiers), confirm_name=p["name"])
