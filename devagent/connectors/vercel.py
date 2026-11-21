"""Connector — Vercel: projects, deployments, domains.

Uses the hosting accounts DevAgent already keeps (hosting.py): one account = one API token.
A project is tied to its Vercel project by its « deploy » connection:
    {platform: "vercel", account_id, project: "<vercel project name>", team: "<team slug>"}

Vercel deploys by itself at each git push. What this connector adds: see whether the
deployment succeeded, attach the domain to the Vercel project, read what DNS records Vercel
wants for a domain, and redeploy.
"""
import requests

import db
import hosting
import projects as P

API = "https://api.vercel.com"
TOKENS_URL = "https://vercel.com/account/tokens"


def _call(token, method, path, team=None, params=None, body=None):
    q = dict(params or {})
    if team:
        q["slug"] = team
    try:
        r = requests.request(method, API + path, params=q or None, json=body,
                             headers={"Authorization": f"Bearer {token}"}, timeout=25)
    except requests.RequestException as e:
        raise P.ProjectError(f"Vercel ne repond pas ({type(e).__name__})")
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400:
        err = (data.get("error") or {}) if isinstance(data, dict) else {}
        msg = err.get("message") or f"HTTP {r.status_code}"
        if r.status_code in (401, 403):
            msg += f" — le token est refuse ou n'a pas ce droit : renouvelle-le sur {TOKENS_URL}"
        raise P.ProjectError(f"Vercel : {msg}")
    return data


def accounts():
    return [a for a in hosting.accounts() if a.get("platform") == "vercel"]


def account(ref=None):
    """A Vercel account by name or id; without ref, the only one."""
    accts = accounts()
    if ref:
        a = next((x for x in accts if ref.lower() in (x.get("id", "").lower(), x.get("name", "").lower())), None)
        if not a:
            raise P.ProjectError(f"Compte Vercel « {ref} » introuvable. Comptes : "
                                 + (", ".join(x["name"] for x in accts) or "aucun"))
        return a
    if len(accts) == 1:
        return accts[0]
    raise P.ProjectError("Aucun compte Vercel enregistre : ajoute-le dans Agent → Acces." if not accts else
                         "Plusieurs comptes Vercel : precise lequel (" + ", ".join(x["name"] for x in accts) + ").")


def link_of(project):
    """(account, vercel project name, team slug) of a DevAgent project."""
    comp = db.get_project_component(project["id"], "deploy")
    cfg = (comp or {}).get("config") or {}
    if (cfg.get("platform") or "").lower() != "vercel":
        raise P.ProjectError(f"« {project['name']} » n'est pas heberge sur Vercel (hebergement_lier le relie a un compte).")
    acct = next((a for a in accounts() if a.get("id") == cfg.get("account_id")), None) or account()
    name = cfg.get("project") or cfg.get("project_name")
    if not name:
        raise P.ProjectError(f"Je ne sais pas quel projet Vercel correspond a « {project['name']} » : "
                             "vercel_projets les liste, vercel_lier le choisit.")
    return acct, name, cfg.get("team") or None


def set_link(project, vercel_project, team=None, account_ref=None):
    import connections
    acct = account(account_ref)
    cfg = {"platform": "vercel", "account_id": acct["id"], "account_name": acct["name"], "project": vercel_project}
    if team:
        cfg["team"] = team
    info = _project(acct, vercel_project, team)                                    # fails when it does not exist
    connections.save(project["id"], "deploy", cfg)
    return {"projet_vercel": info.get("name"), "framework": info.get("framework"), "compte": acct["name"]}


def _project(acct, name, team):
    """The Vercel project, or a clear message naming the projects that do exist."""
    try:
        return _call(acct["token"], "GET", f"/v9/projects/{name}", team)
    except P.ProjectError as e:
        if "not found" not in e.message.lower():
            raise
        try:
            names = ", ".join(p["nom"] for p in list_projects(acct, team)) or "aucun"
        except P.ProjectError:
            names = "?"
        raise P.ProjectError(f"Le projet Vercel « {name} » n'existe pas (ou plus) dans ce compte. "
                             f"Projets Vercel : {names}. Corrige le lien avec vercel_lier.")


def whoami(token):
    u = _call(token, "GET", "/v2/user").get("user") or {}
    return {"utilisateur": u.get("username"), "email": u.get("email"), "nom": u.get("name")}


def token_info(token):
    """{expires_ms, revoked, leaked, name} of the token itself."""
    t = _call(token, "GET", "/v5/user/tokens/current").get("token") or {}
    return {"name": t.get("name"), "expires_ms": t.get("expiresAt"), "revoked": bool(t.get("revokedAt")),
            "leaked": bool(t.get("leakedAt"))}


def list_projects(acct, team=None):
    res = _call(acct["token"], "GET", "/v10/projects", team, {"limit": 100})
    return [{"nom": p.get("name"), "id": p.get("id"), "framework": p.get("framework"),
             "depot": ((p.get("link") or {}).get("repo"))} for p in res.get("projects") or []]


def _when(ms):
    from datetime import datetime
    return datetime.fromtimestamp(ms / 1000).isoformat(timespec="seconds") if ms else None


def deployments(project, limit=5):
    acct, name, team = link_of(project)
    pid = _project(acct, name, team).get("id")
    res = _call(acct["token"], "GET", "/v7/deployments", team, {"projectId": pid, "limit": limit})
    return [{"id": d.get("uid"), "etat": d.get("readyState") or d.get("state"), "cible": d.get("target") or "preview",
             "url": ("https://" + d["url"]) if d.get("url") else None, "quand": _when(d.get("created")),
             "commit": ((d.get("meta") or {}).get("githubCommitMessage") or "")[:90],
             "erreur": d.get("errorMessage"), "inspecter": d.get("inspectorUrl")} for d in res.get("deployments") or []]


def domain_config(acct, domain, team=None):
    """What Vercel wants in the DNS for this domain: {mal_configure, a, cname}."""
    c = _call(acct["token"], "GET", f"/v6/domains/{domain}/config", team)
    best = lambda items: next((i.get("value") for i in sorted(items or [], key=lambda i: i.get("rank", 9))), None)
    ips = best(c.get("recommendedIPv4"))
    return {"mal_configure": bool(c.get("misconfigured")), "configure_par": c.get("configuredBy"),
            "a": (ips or [None])[0] if isinstance(ips, list) else ips, "cname": best(c.get("recommendedCNAME"))}


def domains(project):
    acct, name, team = link_of(project)
    _project(acct, name, team)
    res = _call(acct["token"], "GET", f"/v9/projects/{name}/domains", team)
    out = []
    for d in res.get("domains") or []:
        entry = {"domaine": d.get("name"), "verifie": d.get("verified", True), "redirige_vers": d.get("redirect"),
                 "a_verifier": [{"type": v.get("type"), "nom": v.get("domain"), "valeur": v.get("value")}
                                for v in d.get("verification") or []]}
        try:
            entry["dns"] = domain_config(acct, d["name"], team)
        except P.ProjectError as e:
            entry["dns"] = {"erreur": e.message}
        out.append(entry)
    return out


def add_domain(project, domain):
    acct, name, team = link_of(project)
    d = _call(acct["token"], "POST", f"/v10/projects/{name}/domains", team, body={"name": domain})
    return {"domaine": d.get("name"), "verifie": d.get("verified", True),
            "a_verifier": d.get("verification") or [], "dns": domain_config(acct, domain, team)}


def redeploy(project):
    """Redeploy the latest production deployment, with the latest commit."""
    acct, name, team = link_of(project)
    last = next((d for d in deployments(project, 20) if d["cible"] == "production"), None)
    if not last:
        raise P.ProjectError("Aucun deploiement de production a relancer : pousse d'abord sur la branche de production.")
    d = _call(acct["token"], "POST", "/v13/deployments", team,
              body={"name": name, "deploymentId": last["id"], "target": "production", "withLatestCommit": True})
    return {"id": d.get("id"), "etat": d.get("readyState") or d.get("status"),
            "url": ("https://" + d["url"]) if d.get("url") else None, "inspecter": d.get("inspectorUrl"),
            "relance_de": last["id"]}


def dns_records(project):
    """The site records Vercel recommends for the project's domain (apex + www), or None
    when the project is not on Vercel or the API cannot say."""
    import connections
    try:
        acct, _, team = link_of(project)
        domain = connections.domain_state(project["id"])["config"].get("domain")
        if not domain:
            return None
        apex, www = domain_config(acct, domain, team), domain_config(acct, "www." + domain, team)
    except P.ProjectError:
        return None
    recs = []
    if apex.get("a"):
        recs.append({"type": "A", "name": "@", "value": apex["a"], "why": "le site (adresse donnee par Vercel)"})
    if www.get("cname"):
        recs.append({"type": "CNAME", "name": "www", "value": www["cname"].rstrip("."), "why": "www (cible donnee par Vercel)"})
    return recs or None
