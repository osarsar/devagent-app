"""Tools — « A faire par toi »: what the agent asks the user to do, kept until it is done."""
from .. import RISK_WRITE, todos
from ..registry import PROJET, tool
from ._common import resolve_project


def _pid(ctx, projet):
    if projet or ctx.get("project_id") or ctx.get("cwd"):
        try:
            return resolve_project(ctx, projet)["id"]
        except Exception:
            if projet:
                raise
    return None


@tool("a_faire_ajouter", "QUAND QUELQUE CHOSE DOIT ETRE FAIT PAR L'UTILISATEUR (donner un accord sur un site, creer ou "
      "renouveler une cle, prendre une decision, lancer une commande avec sudo) : note-le ici pour qu'il le voie a "
      "l'ouverture de DevAgent. Donne le lien exact ou la commande dans « comment ». Si un outil de lecture peut "
      "constater que c'est fait, donne-le : DevAgent verifiera tout seul et rayera la ligne "
      "(ex. verifier_outil « vercel_etat », verifier_attendu {\"git.relie\": true}).",
      risk=RISK_WRITE, automation=False,
      params={"titre": {"type": "string", "description": "Court : « Relier Vercel a GitHub »"},
              "comment": {"type": "string", "description": "Les etapes, la page ou la commande exacte"},
              "pourquoi": {"type": "string"}, "lien": {"type": "string", "description": "L'adresse a ouvrir (https://...)"},
              "projet": PROJET,
              "verifier_outil": {"type": "string", "description": "Un outil de lecture qui peut constater que c'est fait"},
              "verifier_args": {"type": "object"},
              "verifier_attendu": {"type": "object", "description": "chemin dans le resultat → valeur attendue"}},
      required=("titre", "comment"))
def a_faire_ajouter(ctx, titre, comment, pourquoi="", lien="", projet=None, verifier_outil="", verifier_args=None,
                    verifier_attendu=None):
    return todos.add(titre, comment, pourquoi, lien, _pid(ctx, projet), ctx.get("actor", "agent"),
                     verifier_outil, verifier_args, verifier_attendu)


@tool("a_faire_lister", "Ce que l'utilisateur doit encore faire lui-meme (la liste « A faire par toi »). Lance d'abord "
      "les verifications : ce qui a ete fait entre-temps est raye.", params={"projet": PROJET})
def a_faire_lister(ctx, projet=None):
    done = todos.check()
    return {"rayes_a_l_instant": done, "a_faire": [todos.public(t) for t in todos.items("ouverte", _pid(ctx, projet))]}


@tool("a_faire_terminer", "Raye une chose de la liste « A faire par toi » quand l'utilisateur dit l'avoir faite.",
      risk=RISK_WRITE, automation=False, params={"numero": {"type": "integer"}}, required=("numero",))
def a_faire_terminer(ctx, numero):
    return {"raye": todos.close(numero, by=ctx.get("actor", "agent"))}
