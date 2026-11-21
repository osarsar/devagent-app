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

    def replace(self, zone, existing, rec):
        r = next(x for x in self.recs if x["id"] == existing["id"])
        r.update(type=rec["type"], content=rec["content"])
        self.log.append(("replace", rec["type"], rec["fqdn"], rec["content"]))
        return existing["id"]


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
    assert out["statut"] == "erreur" and "Aucun fournisseur DNS" in out["message"]                    # no provider
    assert guard.call("dns_fournisseurs", actor="mcp")["resultat"] == {"cloudflare": False, "ovh": False, "hostinger": False}
    db.set_setting("dns_cloudflare_api_token", "TOK")
    cf = FakeCF()
    monkeypatch.setattr(dns, "provider", lambda name=None, domain=None: cf)
    plan = guard.call("dns_plan", {"projet": "site"}, actor="mcp")["resultat"]
    assert plan["a_faire"] == 2 and "zone_id" not in plan and "_rec" not in str(plan)
    ask = guard.call("dns_appliquer", {"projet": "site"}, actor="mcp")
    assert ask["statut"] == "confirmation_requise" and cf.log == []                              # never from the agent
    done = guard.approve(ask["confirmation"])["resultat"]
    assert done["faits"] == 2 and ("create", "A", "www.exemple.ma", "1.2.3.4") in cf.log


# ── OVH and Hostinger: the requests, as their API descriptions say ───────────

def test_ovh_signature_et_requetes(dns, monkeypatch):
    import hashlib, json as J
    sent = []
    zone = {11: {"fieldType": "A", "subDomain": "", "target": "9.9.9.9"},
            12: {"fieldType": "MX", "subDomain": "", "target": "1 mx1.mail.ovh.net."},
            13: {"fieldType": "SPF", "subDomain": "", "target": '"v=spf1 include:mx.ovh.com ~all"'},
            14: {"fieldType": "CNAME", "subDomain": "www", "target": "ancien.host.net."},
            15: {"fieldType": "A", "subDomain": "wwwx", "target": "5.5.5.5"}}

    class R:
        def __init__(self, body, status=200): self._b, self.status_code = body, status; self.text = "" if body is None else J.dumps(body)
        def json(self): return self._b

    def http(self, method, url, headers, data):
        path = url.replace(dns.OVH.BASE, "")
        sent.append((method, path, data, dict(headers)))
        if path == "/auth/time": return R(1_800_000_000)
        if path == "/domain/zone/shop.exemple.ma": return R({"message": "not found"}, 404)
        if path == "/domain/zone/exemple.ma": return R({"name": "exemple.ma"})
        if path.startswith("/domain/zone/exemple.ma/record?subDomain="):
            sub = path.split("=", 1)[1]
            return R([i for i, r in zone.items() if sub in r["subDomain"]])     # « like », as the real filter
        if method == "GET" and "/record/" in path: return R(zone[int(path.rsplit("/", 1)[1])])
        return R({"id": 99} if method == "POST" and path.endswith("/record") else None)
    monkeypatch.setattr(dns.OVH, "_http", http)
    monkeypatch.setattr(dns.time, "time", lambda: 1_800_000_100)
    o = dns.OVH("AK", "SECRET", "CK")
    assert o.zone_id("shop.exemple.ma") == ("exemple.ma", "exemple.ma")          # found in the parent zone
    m, path, data, hd = sent[-1]
    assert hd["X-Ovh-Application"] == "AK" and hd["X-Ovh-Consumer"] == "CK" and hd["X-Ovh-Timestamp"] == "1800000000"
    want = "$1$" + hashlib.sha1("+".join(["SECRET", "CK", "GET", dns.OVH.BASE + path, "", "1800000000"]).encode()).hexdigest()
    assert hd["X-Ovh-Signature"] == want
    assert "X-Ovh-Signature" not in sent[0][3]                                     # /auth/time is not signed

    sent.clear()
    out = dns.apply("exemple.ma", WANTED, o)
    got = {(c["type"], c["name"]): c for c in out["changes"]}
    assert got[("A", "exemple.ma")]["resultat"] == "remplace"
    assert got[("A", "www.exemple.ma")]["resultat"] == "non touche (conflit)"      # a CNAME is there: type cannot change
    assert "changer le type" in got[("A", "www.exemple.ma")]["raison"]
    assert got[("MX", "exemple.ma")]["resultat"] == "inchange"                     # « 1 mx1.mail.ovh.net. » read as prio + host
    assert got[("TXT", "exemple.ma")]["resultat"] == "inchange"                    # OVH's SPF type counts as the SPF record
    assert got[("TXT", "_dmarc.exemple.ma")]["resultat"] == "cree"
    writes = [(m, p, J.loads(d)) for m, p, d, _ in sent if m in ("POST", "PUT") and d]
    assert ("PUT", "/domain/zone/exemple.ma/record/11", {"target": "1.2.3.4"}) in writes
    assert ("POST", "/domain/zone/exemple.ma/record",
            {"fieldType": "TXT", "subDomain": "_dmarc", "target": '"v=DMARC1; p=none; rua=mailto:postmaster@exemple.ma"',
             "ttl": 3600}) in writes
    assert sent[-1][:2] == ("POST", "/domain/zone/exemple.ma/refresh")             # applied at the end, once
    assert out["faits"] == 2 and out["conflits"] == 1


def test_hostinger_requetes(dns, monkeypatch):
    calls = []
    zone = [{"name": "@", "type": "A", "ttl": 14400, "records": [{"content": "9.9.9.9"}]},
            {"name": "@", "type": "MX", "ttl": 14400, "records": [{"content": "5 mx1.hostinger.com."}, {"content": "10 mx2.hostinger.com."}]},
            {"name": "www", "type": "CNAME", "ttl": 14400, "records": [{"content": "exemple.ma."}]}]

    class R:
        def __init__(self, body, status=200): self._b, self.status_code = body, status
        def json(self): return self._b

    def fake(self, method, url, timeout=0, **kw):
        calls.append((method, url.replace(dns.Hostinger.BASE, ""), kw.get("json")))
        return R(zone) if method == "GET" else R({"message": "ok"})
    monkeypatch.setattr(dns.requests.Session, "request", fake)
    h = dns.Hostinger("TOK")
    assert h.s.headers["Authorization"] == "Bearer TOK"
    out = dns.apply("exemple.ma", WANTED, h)
    got = {(c["type"], c["name"]): c for c in out["changes"]}
    assert got[("A", "exemple.ma")]["resultat"] == "remplace"
    assert got[("A", "www.exemple.ma")]["resultat"] == "non touche (conflit)"       # CNAME there
    assert got[("MX", "exemple.ma")]["resultat"] == "non touche (conflit)"          # Hostinger's own mail: never replaced
    assert got[("TXT", "exemple.ma")]["resultat"] == "cree"
    puts = [(u, b) for m, u, b in calls if m == "PUT"]
    assert ("exemple.ma", {"overwrite": True, "zone": [{"name": "@", "type": "A", "ttl": 14400,
                                                        "records": [{"content": "1.2.3.4"}]}]}) in puts
    assert ("exemple.ma", {"overwrite": False, "zone": [{"name": "_dmarc", "type": "TXT", "ttl": 14400, "records": [
        {"content": '"v=DMARC1; p=none; rua=mailto:postmaster@exemple.ma"'}]}]}) in puts
    assert not any(m == "DELETE" for m, _, _ in calls)                               # nothing is ever deleted


def test_le_fournisseur_est_celui_qui_a_la_zone(dns, monkeypatch, P):
    import db
    assert dns.configured() == {"cloudflare": False, "ovh": False, "hostinger": False}
    with pytest.raises(P.ProjectError):
        dns.provider()
    db.set_setting("dns_cloudflare_api_token", "T")
    db.set_setting("dns_hostinger_api_token", "H")
    for k in ("dns_ovh_application_key", "dns_ovh_application_secret"):
        db.set_setting(k, "x")
    assert dns.configured() == {"cloudflare": True, "ovh": False, "hostinger": True}   # OVH needs its three keys
    monkeypatch.setattr(dns.Cloudflare, "zone_id", lambda self, d: (_ for _ in ()).throw(P.ProjectError("pas ici")))
    monkeypatch.setattr(dns.Hostinger, "zone_id", lambda self, d: ("exemple.ma", "exemple.ma"))
    assert dns.provider(domain="exemple.ma").key == "hostinger"
    assert dns.provider("cloudflare").key == "cloudflare"
    with pytest.raises(P.ProjectError):
        dns.provider("ovh")
    import sqlite3
    raw = dict(sqlite3.connect(str(db.DB_PATH)).execute("SELECT key, value FROM settings WHERE key LIKE 'dns_%'").fetchall())
    assert all(v.startswith("enc:v1:") for k, v in raw.items() if k != "dns_ovh_application_key"), raw


def test_une_zone_deja_bonne_n_est_pas_un_conflit(dns):
    """The provider's own mail has more MX than we ask, SPF is there twice, www is an A to the site:
    everything wanted is already served."""
    cf = FakeCF([
        {"name": "exemple.ma", "type": "A", "content": "1.2.3.4"},
        {"name": "www.exemple.ma", "type": "A", "content": "1.2.3.4"},
        {"name": "exemple.ma", "type": "MX", "content": "mx0.mail.ovh.net.", "priority": 1},
        {"name": "exemple.ma", "type": "MX", "content": "mx1.mail.ovh.net.", "priority": 5},
        {"name": "exemple.ma", "type": "TXT", "content": "v=spf1 include:mx.ovh.com ~all"},
        {"name": "exemple.ma", "type": "TXT", "content": '"v=spf1 include:mx.ovh.com ~all"'},
        {"name": "_dmarc.exemple.ma", "type": "TXT", "content": '"v=DMARC1; p=quarantine"'},
        {"name": "_dmarc.exemple.ma", "type": "TXT", "content": '"v=DMARC1; p=none; rua=mailto:postmaster@exemple.ma"'},
    ])
    wanted = [{"type": "A", "name": "@", "value": "1.2.3.4"}, {"type": "CNAME", "name": "www", "value": "abc.vercel-dns-017.com"},
              {"type": "MX", "name": "@", "value": "mx1.mail.ovh.net", "priority": 1}] + WANTED[3:]
    p = dns.plan("exemple.ma", wanted, cf)
    assert {c["action"] for c in p["changes"]} == {"identique"} and p["a_faire"] == 0 and p["conflits"] == 0
    assert dns.apply("exemple.ma", wanted, cf)["faits"] == 0 and cf.log == []
