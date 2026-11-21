"""Access to the outside platforms: state, real tests (faked network), expiry, what a
project needs — and the Vercel connector."""
import json
from datetime import datetime, timedelta, timezone

import pytest


@pytest.fixture
def acc(home):
    from devagent import access, automations, journal, registry
    journal._ready_for = automations._ready_for = None
    registry.load()
    return access


def by(entries):
    return {e["key"]: e for e in entries}


def test_rien_de_saisi(acc):
    st = by(acc.status())
    assert {"github", "cloudflare_r2", "cloudflare_dns", "ovh_dns", "hostinger_dns", "anthropic", "telegram", "smtp"} <= set(st)
    assert st["cloudflare_r2"]["state"] == "absent" and "Access Key ID" in st["cloudflare_r2"]["missing"]
    assert "dash.cloudflare.com" in st["cloudflare_r2"]["create_url"]
    assert "pas encore saisi" in acc.explain(st["ovh_dns"]) and "createToken/" in acc.explain(st["ovh_dns"])
    pub = acc.public(st["ovh_dns"])
    assert pub["ou_creer_ou_renouveler"] == "https://eu.api.ovh.com/createToken/" and pub["etat"] == "absent"


def test_saisie_chiffree_et_jamais_montree(acc):
    import db, sqlite3
    n = acc.save({"r2_account_id": "ACC", "r2_access_key_id": "AKID-SECRET", "r2_secret_access_key": "SK-SECRET",
                  "pas_un_champ": "x", "notify_telegram_bot_token": "****"})
    assert n == 3 and db.get_setting("pas_un_champ") is None
    st = by(acc.status())["cloudflare_r2"]
    assert st["configured"] and st["state"] == "a_tester"
    dump = json.dumps(acc.status()) + json.dumps([acc.public(e) for e in acc.status()])
    assert "AKID-SECRET" not in dump and "SK-SECRET" not in dump and '"value": "ACC"' in dump     # the id is not a secret
    raw = dict(sqlite3.connect(str(db.DB_PATH)).execute("SELECT key, value FROM settings").fetchall())
    assert raw["r2_secret_access_key"].startswith("enc:v1:") and raw["r2_access_key_id"].startswith("enc:v1:")


def test_test_reel_et_expiration(acc, monkeypatch):
    acc.save({"dns_cloudflare_api_token": "T", "anthropic_api_key": "K", "dns_hostinger_api_token": "H"})
    soon = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    monkeypatch.setitem(acc.BY_KEY["cloudflare_dns"], "test", lambda v: {"ok": True, "detail": "token actif", "expires": soon})
    monkeypatch.setitem(acc.BY_KEY["anthropic"], "test", lambda v: {"ok": False, "detail": "cle refusee par Anthropic"})
    monkeypatch.setitem(acc.BY_KEY["hostinger_dns"], "test", lambda v: {"ok": True, "detail": "2 domaines", "expires": past})
    monkeypatch.setitem(acc.BY_KEY["github"], "test", lambda v: {"ok": True, "detail": "connecte par gh"})
    out = acc.test()
    st = by(acc.status())
    assert st["cloudflare_dns"]["state"] == "expire_bientot" and st["cloudflare_dns"]["days_left"] in (4, 5)
    assert st["anthropic"]["state"] == "en_panne" and st["hostinger_dns"]["state"] == "expire" and st["github"]["state"] == "ok"
    assert out["tout_ok"] is False
    assert "Anthropic" in out["resume"] and "console.anthropic.com" in out["resume"]       # where to renew, in the message
    assert "expire dans" in out["resume"] and "expire depuis 2 jour" in out["resume"]
    assert "T" not in [e.get("value") for x in acc.status() for e in x["fields"]]
    # one access only; an unknown one is refused
    assert [a["acces"] for a in acc.test("github")["acces"]] == ["github"]
    import projects as P
    with pytest.raises(P.ProjectError):
        acc.test("ovh_dns")                                                              # not entered yet
    # a platform that does not answer is a failure, not a crash
    import requests
    def boom(v): raise requests.ConnectionError("x")
    monkeypatch.setitem(acc.BY_KEY["github"], "test", boom)
    assert acc.test("github")["tout_ok"] is False


def test_les_vraies_requetes_de_test(acc, monkeypatch):
    calls = []

    class R:
        def __init__(self, body, status=200, headers=None): self._b, self.status_code, self.headers = body, status, headers or {}
        def json(self): return self._b
    def get(url, **kw):
        calls.append((url, kw.get("headers")))
        if "tokens/verify" in url: return R({"success": True, "result": {"status": "active", "expires_on": "2027-01-01T00:00:00Z"}})
        if "api.github.com" in url: return R({"login": "moi"}, headers={"github-authentication-token-expiration": "2027-02-01 10:00:00 UTC"})
        if "getMe" in url: return R({"ok": True, "result": {"username": "mon_bot"}})
        if "hostinger" in url: return R([{}, {}])
    monkeypatch.setattr(acc, "_get", get)
    assert acc._t_cloudflare_dns({"dns_cloudflare_api_token": "T"}) == {"ok": True, "detail": "token actif", "expires": "2027-01-01T00:00:00Z"}
    assert calls[-1] == ("https://api.cloudflare.com/client/v4/user/tokens/verify", {"Authorization": "Bearer T"})
    g = acc._t_github({"github_token": "G"})
    assert g["ok"] and g["detail"] == "compte moi" and acc._days_left(g["expires"]) > 0
    assert acc._t_telegram({"notify_telegram_bot_token": "1:A"})["detail"] == "bot @mon_bot"
    assert acc._t_hostinger({"dns_hostinger_api_token": "H"})["detail"] == "2 domaine(s) visibles"
    # OVH: validated, read-only rights are said
    from devagent.connectors import dns
    monkeypatch.setattr(dns.OVH, "_call", lambda self, m, p, **kw: {"status": "validated", "expiration": None,
                                                                    "rules": [{"method": "GET", "path": "/domain/zone/*"}]})
    o = acc._t_ovh({"dns_ovh_application_key": "a", "dns_ovh_application_secret": "b", "dns_ovh_consumer_key": "c"})
    assert o["ok"] and "lecture seule" in o["limite"]
    monkeypatch.setattr(dns.OVH, "_call", lambda self, m, p, **kw: {"status": "expired", "expiration": "2026-01-01T00:00:00+00:00"})
    assert acc._t_ovh({"dns_ovh_application_key": "a", "dns_ovh_application_secret": "b", "dns_ovh_consumer_key": "c"})["ok"] is False


def test_ce_dont_un_projet_a_besoin(acc, P, monkeypatch):
    import connections, hosting, model
    p = P.create("site")
    model.set_model(p["id"], profile="site_complet")        # github, hosting, domain, email, database, storage, backup
    out = acc.for_project(p["id"])
    rows = {(r["besoin"], r["acces"]): r for r in out["besoins"]}
    assert rows[("Stockage", "Cloudflare R2 (stockage)")]["etat"] == "absent"
    assert "pas encore d'hebergement" in rows[("Hebergement", None)]["explication"]
    assert "pas encore de nom de domaine" in rows[("Nom de domaine", None)]["explication"]
    assert out["a_regler"] >= 2 and "Cloudflare R2" in out["resume"]
    # things get connected: the list follows
    acc.save({"r2_account_id": "A", "r2_access_key_id": "K", "r2_secret_access_key": "S"})
    monkeypatch.setitem(acc.BY_KEY["cloudflare_r2"], "test", lambda v: {"ok": True, "detail": "1 bucket(s) visibles"})
    monkeypatch.setitem(acc.BY_KEY["github"], "test", lambda v: {"ok": True, "detail": "gh"})
    acc.test()
    hosting.save_accounts([{"id": "v1", "name": "perso", "platform": "vercel", "token": "TOK"}])
    hosting.link_project(p["id"], "v1", "https://site.vercel.app")
    connections.set_domain(p["id"], {"domain": "exemple.ma"})
    out = acc.for_project(p["id"])
    rows = {(r["besoin"], r["acces"]): r for r in out["besoins"]}
    assert rows[("Stockage", "Cloudflare R2 (stockage)")]["etat"] == "ok"
    assert rows[("Hebergement", "Vercel — perso")]["etat"] == "a_tester"
    assert "aucun fournisseur DNS branche pour exemple.ma" in rows[("Nom de domaine", None)]["explication"]
    assert "TOK" not in json.dumps(out)


def test_outils_et_automatisation(acc, P):
    from devagent import automations, guard
    etat = guard.call("acces_etat", actor="mcp")["resultat"]
    assert {"acces", "etat", "explication", "ou_creer_ou_renouveler"} <= set(etat[0])
    assert guard.call("acces_tester", {"acces": "inconnu"}, actor="mcp")["statut"] == "erreur"
    P.create("site")
    assert guard.call("projet_acces", {"projet": "site"}, actor="mcp")["statut"] == "ok"
    assert automations.check(automations.TEMPLATES["verifier-acces"]) == []


def test_alerte_quand_un_acces_tombe(acc, P, monkeypatch):
    from devagent import automations, registry
    p = P.create("site")
    sent = []
    state = {"ok": False}
    monkeypatch.setattr(registry.get("acces_tester"), "fn", lambda ctx, acces=None: {
        "tout_ok": state["ok"], "resume": "OVH (DNS) : expire dans 3 jour(s). Renouvelle-le ici : https://eu.api.ovh.com/createToken/"})
    monkeypatch.setattr(registry.get("notifier"), "fn",
                        lambda ctx, message, titre="", canal=None, projet=None: sent.append(message) or {"envoye": True})
    automations.from_template(p, "verifier-acces")
    automations.set_active(p, "verifier-acces", True)
    automations.run(p, "verifier-acces")
    automations.run(p, "verifier-acces")
    assert len(sent) == 1 and "OVH (DNS) : expire dans 3 jour(s)" in sent[0] and "createToken/" in sent[0]   # said once, with the link
    state["ok"] = True
    automations.run(p, "verifier-acces")
    assert len(sent) == 2 and "fonctionnent a nouveau" in sent[1]


# ── Vercel ──────────────────────────────────────────────────────────────────

@pytest.fixture
def vercel(acc, P, monkeypatch):
    import hosting
    from devagent.connectors import vercel
    p = P.create("site")
    hosting.save_accounts([{"id": "v1", "name": "perso", "platform": "vercel", "token": "TOK"}])
    hosting.link_project(p["id"], "v1", "https://site.vercel.app")
    calls = []

    class R:
        def __init__(self, body, status=200): self._b, self.status_code = body, status
        def json(self): return self._b
    state = {"domains": [{"name": "exemple.ma", "verified": True}]}

    def request(method, url, params=None, json=None, headers=None, timeout=0):
        path = url.replace(vercel.API, "")
        calls.append((method, path, params, json, headers["Authorization"]))
        if path == "/v2/user": return R({"user": {"username": "moi", "email": "m@x"}})
        if path == "/v5/user/tokens/current":
            return R({"token": {"name": "devagent", "expiresAt": (datetime.now().timestamp() + 3 * 86400) * 1000}})
        if path == "/v10/projects": return R({"projects": [{"name": "site-prod", "id": "prj_1", "framework": "nextjs", "link": {"repo": "site"}}]})
        if path == "/v9/projects/site-prod": return R({"id": "prj_1", "name": "site-prod", "framework": "nextjs"})
        if path == "/v9/projects/nexiste-pas": return R({"error": {"message": "Project not found"}}, 404)
        if path == "/v7/deployments": return R({"deployments": [
            {"uid": "d2", "readyState": "ERROR", "target": "production", "url": "x2.vercel.app", "created": 1790000000000,
             "errorMessage": "Build failed", "meta": {"githubCommitMessage": "casse le build"}},
            {"uid": "d1", "readyState": "READY", "target": "production", "url": "x1.vercel.app", "created": 1789000000000}]})
        if path == "/v9/projects/site-prod/domains": return R({"domains": state["domains"]})
        if path.startswith("/v6/domains/"):
            return R({"misconfigured": True, "configuredBy": None,
                      "recommendedIPv4": [{"rank": 2, "value": ["76.76.21.21"]}, {"rank": 1, "value": ["216.198.79.1"]}],
                      "recommendedCNAME": [{"rank": 1, "value": "abc.vercel-dns-017.com."}]})
        if method == "POST" and path == "/v10/projects/site-prod/domains":
            state["domains"].append({"name": json["name"], "verified": False}); return R({"name": json["name"], "verified": False})
        if method == "POST" and path == "/v13/deployments": return R({"id": "d3", "readyState": "QUEUED", "url": "x3.vercel.app"})
        return R({"error": {"message": "forbidden"}}, 403)
    monkeypatch.setattr(vercel.requests, "request", request)
    return type("V", (), {"v": vercel, "p": p, "calls": calls})


def test_vercel_lier_etat_domaine_redeployer(vercel, P):
    from devagent import guard
    call = lambda n, **a: guard.call(n, a, actor="mcp")
    assert call("vercel_etat", projet="site")["statut"] == "erreur"                       # which Vercel project? not known yet
    assert call("vercel_projets")["resultat"][0]["nom"] == "site-prod"
    assert call("vercel_lier", projet="site", projet_vercel="nexiste-pas")["statut"] == "erreur"
    assert call("vercel_lier", projet="site", projet_vercel="site-prod", equipe="mon-equipe")["statut"] == "ok"
    etat = call("vercel_etat", projet="site")["resultat"]
    assert [(d["etat"], d["erreur"]) for d in etat["deploiements"]] == [("ERROR", "Build failed"), ("READY", None)]
    assert etat["domaines"][0]["dns"] == {"mal_configure": True, "configure_par": None, "a": "216.198.79.1",
                                          "cname": "abc.vercel-dns-017.com."}             # rank 1, not the old address
    assert vercel.calls[-1][2] == {"slug": "mon-equipe"} and vercel.calls[-1][4] == "Bearer TOK"
    add = call("vercel_ajouter_domaine", projet="site", domaine="WWW.Exemple.ma ")
    assert add["statut"] == "ok" and add["resultat"]["domaine"] == "www.exemple.ma"
    ask = call("vercel_redeployer", projet="site")
    assert ask["statut"] == "confirmation_requise"
    out = guard.approve(ask["confirmation"])["resultat"]
    assert out["relance_de"] == "d2" and out["etat"] == "QUEUED"
    post = next(c for c in vercel.calls if c[0] == "POST" and c[1] == "/v13/deployments")
    assert post[3] == {"name": "site-prod", "deploymentId": "d2", "target": "production", "withLatestCommit": True}
    assert "TOK" not in json.dumps([etat, add, out])


def test_vercel_donne_les_bons_enregistrements_dns(vercel, P):
    import connections
    from devagent.tools import domaine
    vercel.v.set_link(vercel.p, "site-prod")
    connections.set_domain(vercel.p["id"], {"domain": "exemple.ma"})
    domain, records = domaine._dns_inputs({}, "site")
    site = {(r["type"], r["name"]): r["value"] for r in records if r["type"] in ("A", "CNAME")}
    assert site == {("A", "@"): "216.198.79.1", ("CNAME", "www"): "abc.vercel-dns-017.com"}


def test_vercel_token_expire_et_refuse(vercel, acc):
    st = acc.test("hosting:v1")
    e = by(acc.status())["hosting:v1"]
    assert e["state"] == "expire_bientot" and e["days_left"] in (2, 3) and st["tout_ok"] is False
    assert "vercel.com/account/tokens" in st["resume"]
    import projects as P
    with pytest.raises(P.ProjectError) as err:
        vercel.v._call("TOK", "GET", "/v1/inconnu")
    assert "renouvelle-le sur https://vercel.com/account/tokens" in err.value.message


def test_routes_acces(acc):
    import importlib
    import sizes, project_routes, cloud_routes, dashboard
    for m in (sizes, project_routes, cloud_routes, dashboard):
        importlib.reload(m)
    dashboard.app.config.update(TESTING=True, SERVER_NAME="127.0.0.1:5555")
    c = dashboard.app.test_client()
    pid = c.post("/api/projects", json={"name": "site"}).get_json()["project"]["id"]
    assert c.post("/api/agent/access", json={"dns_hostinger_api_token": "HOST-SECRET", "autre": "x"}).get_json() == {"saved": 1}
    data = c.get(f"/api/agent/access?project_id={pid}").get_json()
    assert "HOST-SECRET" not in json.dumps(data) and data["project"]["projet"] == "site"
    h = next(e for e in data["access"] if e["key"] == "hostinger_dns")
    assert h["state"] == "a_tester" and h["fields"][0]["set"] is True and h["explain"]
    assert c.post("/api/agent/access/test", json={"key": "nexiste"}).status_code == 400
    assert "/agent/assets/pages/25-acces.js" in c.get("/agent").get_data(as_text=True)
