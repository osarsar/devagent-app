"""Tools — the servers of a project (VPS reached over SSH) and its hosting platform.

No tool here takes a password or a token: a secret is always typed by the user
in the interface. Only the PATH of an SSH key is ever stored or shown.
"""
import connections
import hosting
import servers

from .. import RISK_IRREVERSIBLE, RISK_WRITE
from ..registry import PROJET, ToolError, tool
from ._common import resolve_project

SERVEUR = {"type": "string", "description": "Nom (ou identifiant) du serveur dans le projet"}


def find_server(pid, ref):
    lst = servers.list_servers(pid)
    ref_l = (ref or "").strip().lower()
    if not ref_l:
        prod = [s for s in lst if s.get("role") == "prod"] or lst
        if len(prod) == 1:
            return prod[0]
        raise ToolError("Quel serveur ? " + (", ".join(s["name"] for s in lst) or "aucun serveur dans ce projet"))
    for s in lst:
        if s.get("id") == ref or s.get("name", "").lower() == ref_l:
            return s
    raise ToolError(f"Serveur « {ref} » introuvable. Serveurs : " + (", ".join(s["name"] for s in lst) or "aucun"))


def _public(s):
    return {k: v for k, v in s.items() if k != "history"}


@tool("serveur_lister", "Les serveurs d'un projet : role (prod, staging...), adresse, utilisateur, dernier test.",
      params={"projet": PROJET})
def serveur_lister(ctx, projet=None):
    return [_public(s) for s in servers.list_servers(resolve_project(ctx, projet)["id"])]


@tool("serveur_tester", "Se connecte au serveur en SSH et rapporte : systeme, disque, Docker, dossier distant. "
      "Ne change rien sur le serveur.", params={"projet": PROJET, "serveur": SERVEUR})
def serveur_tester(ctx, projet=None, serveur=None):
    pid = resolve_project(ctx, projet)["id"]
    return _public(servers.retest(pid, find_server(pid, serveur)["id"]))


@tool("serveur_cles_ssh", "Les cles SSH de ce PC (leur chemin et leur partie publique, jamais la cle privee).")
def serveur_cles_ssh(ctx):
    return servers.ssh_keys()


@tool("serveur_ajouter", "Ajoute un serveur a un projet et teste la connexion SSH. Le serveur doit deja accepter "
      "la cle de ce PC (l'installation de la cle avec un mot de passe se fait dans l'interface).",
      risk=RISK_WRITE,
      params={"projet": PROJET, "nom": {"type": "string", "description": "ex. VPS prod"},
              "hote": {"type": "string", "description": "IP ou nom de domaine"},
              "utilisateur": {"type": "string", "description": "ex. ubuntu, root"},
              "port": {"type": "integer", "minimum": 1, "maximum": 65535},
              "role": {"type": "string", "enum": servers.ROLES},
              "fournisseur": {"type": "string", "description": "ovh, hetzner, digitalocean..."},
              "chemin_cle": {"type": "string", "description": "Chemin de la cle privee (ex. ~/.ssh/id_ed25519)"},
              "dossier_distant": {"type": "string", "description": "Ou vit le projet sur le serveur"}},
      required=("nom", "hote", "utilisateur"))
def serveur_ajouter(ctx, nom, hote, utilisateur, projet=None, port=22, role="prod", fournisseur="",
                    chemin_cle="", dossier_distant=""):
    cfg = {"name": nom, "host": hote, "user": utilisateur, "port": port, "role": role,
           "provider": fournisseur, "key_path": chemin_cle, "remote_path": dossier_distant}
    return _public(servers.add_server(resolve_project(ctx, projet)["id"], cfg, test=True))


@tool("serveur_generer_cle", "Cree une nouvelle cle SSH (ed25519) dediee au projet et renvoie sa partie publique.",
      risk=RISK_WRITE, params={"projet": PROJET, "libelle": {"type": "string"}}, required=("libelle",))
def serveur_generer_cle(ctx, libelle, projet=None):
    return servers.generate_key(resolve_project(ctx, projet)["id"], libelle)


@tool("serveur_retirer", "Retire un serveur de la liste du projet. Rien n'est touche sur le serveur lui-meme, "
      "mais sa configuration dans DevAgent est perdue.", risk=RISK_IRREVERSIBLE,
      params={"projet": PROJET, "serveur": SERVEUR}, required=("projet", "serveur"))
def serveur_retirer(ctx, projet, serveur):
    pid = resolve_project(ctx, projet)["id"]
    return servers.remove_server(pid, find_server(pid, serveur)["id"])


# ── Hosting platforms ───────────────────────────────────────────────────────

@tool("hebergement_comptes", "Les comptes d'hebergement connus (Vercel, Netlify, Railway...), sans leur token.")
def hebergement_comptes(ctx):
    return hosting.public_accounts()


@tool("hebergement_cible", "Ou le site d'un projet est heberge : le serveur de prod (IP) ou la plateforme. "
      "C'est la cible que le nom de domaine doit viser.", params={"projet": PROJET})
def hebergement_cible(ctx, projet=None):
    return connections.hosting_target(resolve_project(ctx, projet)["id"])


@tool("hebergement_lier", "Lie un projet a un compte d'hebergement deja enregistre, avec l'adresse du site.",
      risk=RISK_WRITE,
      params={"projet": PROJET, "compte": {"type": "string", "description": "Nom ou identifiant du compte"},
              "url_site": {"type": "string"}, "url_tableau_de_bord": {"type": "string"}},
      required=("compte",))
def hebergement_lier(ctx, compte, projet=None, url_site="", url_tableau_de_bord=""):
    acct = hosting.find(compte)
    if not acct:
        raise ToolError(f"Compte « {compte} » introuvable. Comptes : "
                        + (", ".join(a["name"] for a in hosting.accounts()) or "aucun (a ajouter dans l'interface)"))
    return hosting.link_project(resolve_project(ctx, projet)["id"], acct["id"], url_site or "",
                                url_tableau_de_bord or "")
