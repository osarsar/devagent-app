"""Tools — the automations of a project. The agent can PROPOSE an automation
(write its file) and run an active one; only the user activates it."""
from .. import RISK_WRITE, automations
from ..registry import PROJET, tool
from ._common import resolve_project

NOM = {"type": "string", "description": "Nom de l'automatisation : minuscules, chiffres, tirets (ex. sauvegarde-nuit)"}


def _brief(a):
    return {k: a[k] for k in ("nom", "projet", "description", "declencheur", "etapes", "actif", "erreurs",
                               "modifie_depuis_activation", "dernier")}


@tool("automatisation_lister", "Les automatisations d'un projet (ou de tous) : declencheur, etapes, active ou "
      "non, dernier lancement.", params={"projet": PROJET})
def automatisation_lister(ctx, projet=None):
    if projet or ctx.get("project_id") or ctx.get("cwd"):
        try:
            return [_brief(a) for a in automations.load(resolve_project(ctx, projet))]
        except Exception:
            if projet:
                raise
    return [_brief(a) for a in automations.all_automations()]


@tool("automatisation_modeles", "Les modeles d'automatisation prets a l'emploi (sauvegarde de nuit, surveillance "
      "du site, certificat, depots a jour), et le format d'une automatisation.")
def automatisation_modeles(ctx):
    return {"modeles": automations.TEMPLATES,
            "declencheurs": {"horaire": {"a": "HH:MM", "jours": "facultatif : lun, mar, mer, jeu, ven, sam, dim"},
                             "intervalle": {"toutes": "30s, 15m, 2h, 1j"},
                             "depot": {"depot": "dossier du depot ('.' par defaut)", "branche": "main par defaut",
                                       "toutes": "frequence de verification, 5m par defaut",
                                       "role": "se declenche quand un nouveau commit arrive sur GitHub"},
                             "webhook": {}, "manuel": {}},
            "etape": {"outil": "nom d'un outil non irreversible", "args": "ses arguments",
                      "si": "succes (defaut) | echec | toujours | echec_nouveau | retabli",
                      "attendu / minimum / maximum": "chemin dans le resultat → valeur ; sinon l'etape echoue",
                      "variables": "{{projet}} {{automatisation}} {{erreur}} {{date}}"}}


@tool("automatisation_proposer", "Ecrit une automatisation dans le projet. Elle reste INACTIVE : l'utilisateur "
      "la relit et l'active lui-meme dans DevAgent. Une etape = un outil non irreversible.",
      risk=RISK_WRITE, automation=False,
      params={"projet": PROJET, "nom": NOM, "description": {"type": "string"},
              "declencheur": {"type": "object", "description": "{type: horaire, a: '03:00'} ou "
                              "{type: intervalle, toutes: '15m'} ou {type: depot} (nouveau commit sur GitHub) ou "
                              "{type: webhook} ou {type: manuel}"},
              "etapes": {"type": "array", "items": {"type": "object"},
                         "description": "[{outil, args?, si?, attendu?, minimum?, maximum?}]"}},
      required=("nom", "declencheur", "etapes"))
def automatisation_proposer(ctx, nom, declencheur, etapes, projet=None, description=""):
    a = automations.save(resolve_project(ctx, projet), nom,
                         {"description": description or "", "declencheur": declencheur, "etapes": etapes})
    return {**_brief(a), "note": "Ecrite, inactive. L'utilisateur l'active dans DevAgent → Automatisations."}


@tool("automatisation_depuis_modele", "Cree une automatisation a partir d'un modele (sauvegarde-nuit, "
      "surveillance-site, certificat, depots-a-jour, nouveau-commit). Elle reste inactive jusqu'a ce que l'utilisateur l'active.",
      risk=RISK_WRITE, automation=False,
      params={"projet": PROJET, "modele": {"type": "string", "enum": sorted(automations.TEMPLATES)},
              "nom": NOM, "url": {"type": "string", "description": "Adresse du site a surveiller (sinon le domaine du projet)"}},
      required=("modele",))
def automatisation_depuis_modele(ctx, modele, projet=None, nom=None, url=None):
    a = automations.from_template(resolve_project(ctx, projet), modele, name=nom, url=url)
    return {**_brief(a), "note": "Ecrite, inactive. L'utilisateur l'active dans DevAgent → Automatisations."}


@tool("automatisation_lancer", "Lance maintenant une automatisation ACTIVE du projet et renvoie le detail des etapes.",
      risk=RISK_WRITE, automation=False, params={"projet": PROJET, "nom": NOM}, required=("nom",))
def automatisation_lancer(ctx, nom, projet=None):
    return automations.run(resolve_project(ctx, projet), nom, trigger="manuel")


@tool("automatisation_historique", "Les derniers lancements des automatisations : quand, declencheur, resultat, "
      "detail des etapes.", params={"projet": PROJET, "nom": NOM,
                                    "limite": {"type": "integer", "minimum": 1, "maximum": 100}})
def automatisation_historique(ctx, projet=None, nom=None, limite=15):
    pid = resolve_project(ctx, projet)["id"] if (projet or nom) else None
    return automations.runs(pid, nom, limit=limite)
