"""Tools — the domain name, the professional email and the public site of a project.

DevAgent VERIFIES the DNS (real lookups). Writing the records at the registrar
is still done by the user (or by a DNS connector, when one exists).
"""
import connections
import dnscheck

from .. import RISK_WRITE
from ..registry import PROJET, tool
from ._common import resolve_project


def _pid(ctx, projet):
    return resolve_project(ctx, projet)["id"]


@tool("domaine_etat", "Le nom de domaine d'un projet : registrar, derniere verification DNS et HTTPS.",
      params={"projet": PROJET})
def domaine_etat(ctx, projet=None):
    return connections.domain_state(_pid(ctx, projet))


@tool("domaine_dns_attendus", "Les enregistrements DNS exacts a mettre chez le registrar pour que le domaine "
      "vise l'hebergement du projet (site, www, email).", params={"projet": PROJET})
def domaine_dns_attendus(ctx, projet=None):
    return connections.expected_dns(_pid(ctx, projet))


@tool("domaine_enregistrer", "Enregistre (ou change) le nom de domaine d'un projet et son registrar.",
      risk=RISK_WRITE,
      params={"projet": PROJET, "domaine": {"type": "string", "description": "ex. monsite.ma"},
              "registrar": {"type": "string", "description": "ovh, namecheap, cloudflare, hostinger..."},
              "notes": {"type": "string"}}, required=("domaine",))
def domaine_enregistrer(ctx, domaine, projet=None, registrar=None, notes=None):
    cfg = {"domain": domaine}
    if registrar is not None:
        cfg["registrar"] = registrar
    if notes is not None:
        cfg["notes"] = notes
    return connections.set_domain(_pid(ctx, projet), cfg)


@tool("domaine_verifier", "Verifie pour de vrai le DNS du domaine du projet contre son hebergement, et note le "
      "resultat avec sa date.", params={"projet": PROJET})
def domaine_verifier(ctx, projet=None):
    return connections.verify_domain(_pid(ctx, projet))


@tool("site_verifier", "Verifie que le site du projet repond en HTTPS sur son domaine (certificat, redirections).",
      params={"projet": PROJET})
def site_verifier(ctx, projet=None):
    return connections.verify_site(_pid(ctx, projet))


@tool("email_etat", "L'email professionnel d'un projet : fournisseur, adresses, derniere verification MX.",
      params={"projet": PROJET})
def email_etat(ctx, projet=None):
    return connections.email_state(_pid(ctx, projet))


@tool("email_definir", "Enregistre le fournisseur d'email pro d'un projet et ses adresses.", risk=RISK_WRITE,
      params={"projet": PROJET, "fournisseur": {"type": "string", "description": "google, zoho, ovh, infomaniak..."},
              "adresses": {"type": "array", "items": {"type": "string"}}})
def email_definir(ctx, projet=None, fournisseur=None, adresses=None):
    cfg = {}
    if fournisseur is not None:
        cfg["provider"] = fournisseur
    if adresses is not None:
        cfg["addresses"] = adresses
    return connections.set_email(_pid(ctx, projet), cfg)


@tool("email_verifier", "Verifie pour de vrai les enregistrements MX, SPF et DMARC du domaine du projet.",
      params={"projet": PROJET})
def email_verifier(ctx, projet=None):
    return connections.verify_email(_pid(ctx, projet))


@tool("dns_resoudre", "Interroge le DNS : les enregistrements d'un type pour un domaine quelconque.",
      params={"domaine": {"type": "string"},
              "type": {"type": "string", "enum": ["A", "AAAA", "CNAME", "MX", "NS", "TXT"]}},
      required=("domaine",))
def dns_resoudre(ctx, domaine, type="A"):
    return {"domaine": domaine, "type": type, "valeurs": dnscheck.resolve(connections.clean_domain(domaine), type)}


@tool("site_tester", "Teste une adresse web quelconque : repond-elle, quel code HTTP, combien de jours avant "
      "la fin du certificat.", params={"url": {"type": "string"}}, required=("url",))
def site_tester(ctx, url):
    if "://" not in url:
        url = "https://" + url
    res = dict(dnscheck.check_http(url))
    host = url.split("://", 1)[1].split("/", 1)[0].split(":")[0]
    if url.startswith("https://"):
        res["certificat_jours_restants"] = dnscheck.cert_days_left(host)
    return res


# ── Writing the DNS at the provider (connector: devagent/connectors/dns.py) ──

def _dns_inputs(ctx, projet):
    from ..registry import ToolError
    exp = connections.expected_dns(_pid(ctx, projet))
    if not exp.get("domain"):
        raise ToolError("Ce projet n'a pas encore de nom de domaine (domaine_enregistrer).")
    if not exp.get("records"):
        raise ToolError("Rien a mettre dans le DNS : le projet n'a pas encore d'hebergement (ni d'email) defini.")
    records = exp["records"]
    try:                                   # on Vercel, the right site records are the ones Vercel gives for THIS domain
        from ..connectors import vercel
        from ._common import resolve_project as _rp
        site = vercel.dns_records(_rp(ctx, projet))
        if site:
            records = site + [r for r in records if r["type"] not in ("A", "AAAA", "CNAME")]
    except Exception:
        pass
    return exp["domain"], records


@tool("dns_fournisseurs", "Les fournisseurs DNS branches a DevAgent (ceux chez qui il peut ecrire les enregistrements).")
def dns_fournisseurs(ctx):
    from ..connectors import dns
    return dns.configured()


@tool("dns_plan", "Compare le DNS actuel du domaine du projet (chez le fournisseur) a ce qu'il doit etre, et dit "
      "ce qui serait cree, remplace, laisse tel quel, ou en conflit. Ne change rien.", params={"projet": PROJET})
def dns_plan(ctx, projet=None):
    from ..connectors import dns
    domain, records = _dns_inputs(ctx, projet)
    return dns.public(dns.plan(domain, records))


@tool("dns_appliquer", "Ecrit chez le fournisseur DNS les enregistrements que le projet doit avoir (site, www, "
      "email). Cree ce qui manque, remplace l'adresse du site si elle est fausse ; ne supprime rien et ne "
      "remplace jamais des MX / SPF / DMARC existants. Lance dns_plan avant pour voir ce qui changera.",
      risk="irreversible", automation=False, params={"projet": PROJET}, required=("projet",))
def dns_appliquer(ctx, projet):
    from ..connectors import dns
    domain, records = _dns_inputs(ctx, projet)
    return dns.apply(domain, records)
