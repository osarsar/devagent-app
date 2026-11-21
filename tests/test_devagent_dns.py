"""The DNS connector against a fake Cloudflare: plan, apply, and what it must never touch."""
import pytest


class FakeCF:
    """In-memory Cloudflare zone, speaking the provider interface."""
    key = "cloudflare"

    def __init__(self, records=()):
        self.recs = [dict(r, id=f"r{i}") for i, r in enumerate(records)]
        self.log = []

    def zone_id(self, domain):
        return "z1", "exemple.ma"

    def list(self, zone, name):
        return [dict(r) for r in self.recs if r["name"] == name]

    def create(self, zone, rec):
        rid = f"n{len(self.recs)}"
        self.recs.append({"id": rid, "name": rec["fqdn"], "type": rec["type"], "content": rec["content"],
                          "priority": rec.get("priority")})
        self.log.append(("create", rec["type"], rec["fqdn"], rec["content"]))
        return rid

    def replace(self, zone, rid, rec):
        r = next(x for x in self.recs if x["id"] == rid)
        r.update(type=rec["type"], content=rec["content"])
        self.log.append(("replace", rec["type"], rec["fqdn"], rec["content"]))
        return rid


WANTED = [
    {"type": "A", "name": "@", "value": "1.2.3.4"},
    {"type": "A", "name": "www", "value": "1.2.3.4"},
    {"type": "MX", "name": "@", "value": "mx1.mail.ovh.net", "priority": 1},
    {"type": "TXT", "name": "@", "value": "v=spf1 include:mx.ovh.com ~all"},
    {"type": "TXT", "name": "_dmarc", "value": "v=DMARC1; p=none; rua=mailto:postmaster@exemple.ma"},
]


@pytest.fixture
def dns(home):
    from devagent.connectors import dns
    return dns


def actions(plan):
    return [(c["action"], c["type"], c["name"]) for c in plan["changes"]]


def test_zone_vide_tout_est_cree(dns):
    cf = FakeCF()
    p = dns.plan("exemple.ma", WANTED, cf)
    assert p["a_faire"] == 5 and p["conflits"] == 0 and {a for a, _, _ in actions(p)} == {"creer"}
    assert cf.log == []                                              # the plan reads only
    out = dns.apply("exemple.ma", WANTED, cf)
    assert out["faits"] == 5 and out["echecs"] == 0
    assert ("create", "TXT", "_dmarc.exemple.ma", '"v=DMARC1; p=none; rua=mailto:postmaster@exemple.ma"') in cf.log
    # applying again changes nothing
    again = dns.apply("exemple.ma", WANTED, cf)
    assert again["faits"] == 0 and {c["resultat"] for c in again["changes"]} == {"inchange"}


def test_adresse_du_site_remplacee_le_reste_respecte(dns):
    cf = FakeCF([
        {"name": "exemple.ma", "type": "A", "content": "9.9.9.9"},                       # old server
        {"name": "www.exemple.ma", "type": "CNAME", "content": "ancien.host.net."},      # other type at the name
        {"name": "exemple.ma", "type": "MX", "content": "aspmx.l.google.com", "priority": 1},   # client's real email
        {"name": "exemple.ma", "type": "TXT", "content": '"v=spf1 include:_spf.google.com ~all"'},
        {"name": "exemple.ma", "type": "TXT", "content": '"google-site-verification=abc"'},      # unrelated TXT
    ])
    p = dns.plan("exemple.ma", WANTED, cf)
    got = {(c["type"], c["name"]): c for c in p["changes"]}
    assert got[("A", "exemple.ma")]["action"] == "remplacer" and got[("A", "exemple.ma")]["actuel"] == "A 9.9.9.9"
    assert got[("A", "www.exemple.ma")]["action"] == "remplacer"                           # one record → replaced
    assert got[("MX", "exemple.ma")]["action"] == "conflit" and "jamais remplace" in got[("MX", "exemple.ma")]["raison"]
    assert got[("TXT", "exemple.ma")]["action"] == "conflit"                               # another SPF exists
    assert got[("TXT", "_dmarc.exemple.ma")]["action"] == "creer"
    out = dns.apply("exemple.ma", WANTED, cf)
    assert out["faits"] == 3 and out["conflits"] == 2
    by = {(r["type"], r["name"]): r["content"] for r in cf.recs if r["type"] in ("A", "MX")}
    assert by[("A", "exemple.ma")] == "1.2.3.4" and by[("A", "www.exemple.ma")] == "1.2.3.4"
    assert by[("MX", "exemple.ma")] == "aspmx.l.google.com"                               # email untouched
    assert sum(1 for r in cf.recs if r["type"] == "TXT" and r["name"] == "exemple.ma") == 2   # nothing deleted, nothing added


def test_plusieurs_adresses_au_meme_nom_conflit(dns):
    cf = FakeCF([{"name": "exemple.ma", "type": "A", "content": "9.9.9.9"},
                 {"name": "exemple.ma", "type": "A", "content": "8.8.8.8"}])
    p = dns.plan("exemple.ma", WANTED[:1], cf)
    assert actions(p) == [("conflit", "A", "exemple.ma")]
    assert dns.apply("exemple.ma", WANTED[:1], cf)["faits"] == 0 and cf.log == []


def test_requetes_cloudflare(dns, monkeypatch):
    calls = []

    class R:
        status_code = 200
        def __init__(self, result): self._r = result
        def json(self): return {"success": True, "errors": [], "result": self._r}

    def fake(self, method, url, timeout=0, **kw):
        calls.append((method, url.replace(dns.CF_API, ""), kw.get("params"), kw.get("json")))
        if url.endswith("/zones"):
            return R([{"id": "Z", "name": "exemple.ma"}] if kw["params"]["name"] == "exemple.ma" else [])
        if method == "GET":
            return R([{"id": "old", "type": "A", "content": "9.9.9.9"}] if kw["params"]["name.exact"] == "exemple.ma" else [])
        return R({"id": "x"})
    monkeypatch.setattr(dns.requests.Session, "request", fake)
    cf = dns.Cloudflare("TOKEN")
    assert cf.s.headers["Authorization"] == "Bearer TOKEN"
    out = dns.apply("boutique.exemple.ma".replace("boutique.", ""), WANTED[:3], cf)
    assert out["faits"] == 3
    assert ("GET", "/zones", {"name": "exemple.ma"}, None) in calls
    assert ("GET", "/zones/Z/dns_records", {"name.exact": "www.exemple.ma", "per_page": 100}, None) in calls
    assert ("PUT", "/zones/Z/dns_records/old", None,
            {"type": "A", "name": "exemple.ma", "content": "1.2.3.4", "ttl": 1, "proxied": False}) in calls
    assert ("POST", "/zones/Z/dns_records", None,
            {"type": "MX", "name": "exemple.ma", "content": "mx1.mail.ovh.net", "ttl": 1, "priority": 1}) in calls
    # a sub-domain is found in its parent zone
    assert cf.zone_id("shop.exemple.ma") == ("Z", "exemple.ma")


def test_erreur_cloudflare_dite_clairement(dns, monkeypatch, P):
    class R:
        status_code = 403
        def json(self): return {"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]}
    monkeypatch.setattr(dns.requests.Session, "request", lambda self, m, u, timeout=0, **kw: R())
    with pytest.raises(P.ProjectError) as e:
        dns.Cloudflare("BAD").zone_id("exemple.ma")
    assert "Authentication error" in e.value.message


def test_outils_dns(dns, P, monkeypatch):
    import db, model, connections, servers
    from devagent import guard, journal, registry
    journal._ready_for = None
    registry.load()
    p = P.create("site")
    model.set_model(p["id"], profile="vitrine")
    assert guard.call("dns_plan", {"projet": "site"}, actor="mcp")["statut"] == "erreur"          # no domain yet
    connections.set_domain(p["id"], {"domain": "exemple.ma"})
    servers.add_server(p["id"], {"name": "vps", "host": "1.2.3.4", "user": "ubuntu", "role": "prod"}, test=False)
    out = guard.call("dns_plan", {"projet": "site"}, actor="mcp")
    assert out["statut"] == "erreur" and "token Cloudflare" in out["message"]                    # no provider
    assert guard.call("dns_fournisseurs", actor="mcp")["resultat"] == {"cloudflare": False}
    db.set_setting("dns_cloudflare_api_token", "TOK")
    cf = FakeCF()
    monkeypatch.setattr(dns, "provider", lambda name=None: cf)
    plan = guard.call("dns_plan", {"projet": "site"}, actor="mcp")["resultat"]
    assert plan["a_faire"] == 2 and "zone_id" not in plan and "_rec" not in str(plan)
    ask = guard.call("dns_appliquer", {"projet": "site"}, actor="mcp")
    assert ask["statut"] == "confirmation_requise" and cf.log == []                              # never from the agent
    done = guard.approve(ask["confirmation"])["resultat"]
    assert done["faits"] == 2 and ("create", "A", "www.exemple.ma", "1.2.3.4") in cf.log
