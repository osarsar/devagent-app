"""Tools — the accesses to outside platforms, and Vercel."""
from .. import RISK_IRREVERSIBLE, RISK_WRITE, access
from ..connectors import vercel
from ..registry import PROJET, tool
from ._common import resolve_project


@tool("acces_etat", "Tous les acces de DevAgent aux plateformes (GitHub, Cloudflare R2, DNS Cloudflare / OVH / "
      "Hostinger, Vercel et autres hebergeurs, Anthropic, Telegram, email) : a quoi sert chacun, s'il est saisi, "
      "s'il fonctionne, quand il expire, et la page ou le creer ou le renouveler. Ne montre jamais une cle.")
def acces_etat(ctx):
    return [access.public(e) for e in access.status()]


@tool("acces_tester", "Essaie pour de vrai un acces (ou tous ceux qui sont saisis) et note le resultat : "
      "fonctionne, en panne, expire, expire bientot. Sans argument : tous.",
      params={"acces": {"type": "string", "description": "ex. github, cloudflare_r2, ovh_dns, anthropic, telegram"}})
def acces_tester(ctx, acces=None):
    return access.test(acces or None)


@tool("projet_acces", "Ce dont un projet a besoin comme acces aux plateformes, lequel manque ou ne fonctionne "
      "plus, et ou le regler.", params={"projet": PROJET})
def projet_acces(ctx, projet=None):
    return access.for_project(resolve_project(ctx, projet)["id"])


# ── Vercel ──────────────────────────────────────────────────────────────────

@tool("vercel_projets", "Les projets du compte Vercel (nom, framework, depot Git relie).",
      params={"compte": {"type": "string", "description": "Nom du compte Vercel, s'il y en a plusieurs"},
              "equipe": {"type": "string", "description": "Identifiant (slug) de l'equipe Vercel"}})
def vercel_projets(ctx, compte=None, equipe=None):
    return vercel.list_projects(vercel.account(compte), equipe or None)


@tool("vercel_lier", "Dit a DevAgent quel projet Vercel correspond a un projet (verifie qu'il existe).",
      risk=RISK_WRITE,
      params={"projet": PROJET, "projet_vercel": {"type": "string"}, "equipe": {"type": "string"},
              "compte": {"type": "string"}}, required=("projet_vercel",))
def vercel_lier(ctx, projet_vercel, projet=None, equipe=None, compte=None):
    return vercel.set_link(resolve_project(ctx, projet), projet_vercel, equipe or None, compte or None)


@tool("vercel_etat", "Le projet sur Vercel : ses derniers deploiements (reussi, en cours, en erreur, avec le "
      "message d'erreur) et ses domaines, avec les enregistrements DNS que Vercel attend pour chacun.",
      params={"projet": PROJET})
def vercel_etat(ctx, projet=None):
    p = resolve_project(ctx, projet)
    return {"deploiements": vercel.deployments(p), "domaines": vercel.domains(p)}


@tool("vercel_ajouter_domaine", "Attache un nom de domaine au projet Vercel et renvoie les enregistrements DNS a "
      "mettre chez le registrar. Ne touche pas au DNS.", risk=RISK_WRITE,
      params={"projet": PROJET, "domaine": {"type": "string", "description": "ex. monsite.ma ou www.monsite.ma"}},
      required=("domaine",))
def vercel_ajouter_domaine(ctx, domaine, projet=None):
    return vercel.add_domain(resolve_project(ctx, projet), domaine.strip().lower())


@tool("vercel_redeployer", "Relance en production le dernier deploiement du projet sur Vercel, avec le dernier commit.",
      risk=RISK_IRREVERSIBLE, automation=False, params={"projet": PROJET}, required=("projet",))
def vercel_redeployer(ctx, projet):
    return vercel.redeploy(resolve_project(ctx, projet))
