"""Connector — write DNS records at the provider (today: Cloudflare).

DevPilot already knows which records a project needs (connections.expected_dns) and
verifies them with real lookups. This connector puts them in place:

    plan(domain, records)    what would change — reads only
    apply(domain, records)   creates / replaces what the plan says, nothing else

Careful by design:
  - a record that already has the right value is left alone;
  - a site record (A / CNAME) is replaced only when there is exactly one to replace;
  - existing MX, SPF or DMARC records that differ are NEVER replaced: they are reported as a
    conflict (changing them by mistake stops the client's email);
  - nothing is ever deleted.

Setting: ``dns_cloudflare_api_token`` (encrypted) — a Cloudflare API token with DNS read + write
on the zone. Adding a provider = a class with zone_id / list / create / replace, listed in PROVIDERS.
"""
import requests

import db
import projects as P

CF_API = "https://api.cloudflare.com/client/v4"
SITE_TYPES = ("A", "AAAA", "CNAME")


class Cloudflare:
    key, label, setting = "cloudflare", "Cloudflare", "dns_cloudflare_api_token"

    def __init__(self, token):
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    def _call(self, method, path, **kw):
        try:
            r = self.s.request(method, CF_API + path, timeout=20, **kw)
        except requests.RequestException as e:
            raise P.ProjectError(f"Cloudflare ne repond pas ({type(e).__name__})")
        try:
            body = r.json()
        except ValueError:
            raise P.ProjectError(f"Cloudflare : reponse illisible (HTTP {r.status_code})")
        if not body.get("success"):
            errs = "; ".join(str(e.get("message", "")) for e in body.get("errors") or []) or f"HTTP {r.status_code}"
            raise P.ProjectError(f"Cloudflare : {errs}")
        return body.get("result")

    def zone_id(self, domain):
        """The zone that holds ``domain`` (tries the domain, then its parents: a.b.example.ma → example.ma)."""
        parts = domain.split(".")
        for i in range(len(parts) - 1):
            res = self._call("GET", "/zones", params={"name": ".".join(parts[i:])})
            if res:
                return res[0]["id"], res[0]["name"]
        raise P.ProjectError(f"Le domaine {domain} n'est dans aucune zone de ce compte Cloudflare")

    def list(self, zone, name):
        """Every record at exactly this name: [{id, type, content, priority}]."""
        res = self._call("GET", f"/zones/{zone}/dns_records", params={"name.exact": name, "per_page": 100}) or []
        return [{"id": r["id"], "type": r["type"], "content": r.get("content", ""), "priority": r.get("priority")}
                for r in res]

    def _body(self, rec):
        body = {"type": rec["type"], "name": rec["fqdn"], "content": rec["content"], "ttl": 1}
        if rec["type"] in SITE_TYPES:
            body["proxied"] = False           # the name must answer with the hosting's own address
        if rec["type"] == "MX":
            body["priority"] = int(rec.get("priority") or 10)
        return body

    def create(self, zone, rec):
        return self._call("POST", f"/zones/{zone}/dns_records", json=self._body(rec))["id"]

    def replace(self, zone, record_id, rec):
        return self._call("PUT", f"/zones/{zone}/dns_records/{record_id}", json=self._body(rec))["id"]


PROVIDERS = {Cloudflare.key: Cloudflare}


def configured():
    """{provider: bool} — which providers have a token."""
    return {k: bool(db.get_setting(c.setting, "")) for k, c in PROVIDERS.items()}


def provider(name=None):
    conf = configured()
    name = name or next((k for k, ok in conf.items() if ok), None)
    if not name or name not in PROVIDERS or not conf.get(name):
        raise P.ProjectError("Aucun fournisseur DNS n'est branche : ajoute un token Cloudflare dans Agent → Reglages. "
                             "Sans cela, les enregistrements se saisissent a la main chez le registrar "
                             "(domaine_dns_attendus donne la liste).")
    cls = PROVIDERS[name]
    return cls(db.get_setting(cls.setting, ""))


def _norm(rtype, value):
    v = str(value or "").strip()
    if rtype == "TXT":
        v = v.strip('"')
    if rtype in ("CNAME", "MX"):
        v = v.rstrip(".").lower()
    return v


def _wanted(domain, records):
    """Expected records → [{type, fqdn, content, priority, why}], grouped by (type, name)."""
    out = []
    for r in records:
        name = (r.get("name") or "@").strip()
        fqdn = domain if name in ("@", "") else f"{name}.{domain}"
        content = str(r["value"]).strip()
        if r["type"] == "TXT":
            content = '"' + content.strip('"') + '"'
        out.append({"type": r["type"], "fqdn": fqdn.lower(), "content": content,
                    "priority": r.get("priority"), "why": r.get("why", "")})
    return out


def plan(domain, records, prov=None):
    """What applying ``records`` would do. Reads only.
    Returns {zone, provider, changes: [{action, type, name, valeur, actuel?, raison?}]}
    action: identique | creer | remplacer | conflit"""
    prov = prov or provider()
    zone, zone_name = prov.zone_id(domain)
    wanted = _wanted(domain, records)
    existing = {}
    changes = []
    groups = {}
    for w in wanted:
        groups.setdefault((w["type"] if w["type"] not in SITE_TYPES else "SITE", w["fqdn"], _kind(w)), []).append(w)
    for (gtype, fqdn, kind), items in groups.items():
        if fqdn not in existing:
            existing[fqdn] = prov.list(zone, fqdn)
        here = existing[fqdn]
        if gtype == "SITE":
            cur = [e for e in here if e["type"] in SITE_TYPES]
            same = sorted((e["type"], _norm(e["type"], e["content"])) for e in cur) == \
                sorted((w["type"], _norm(w["type"], w["content"])) for w in items)
            if same:
                changes += [_ch("identique", w) for w in items]
            elif not cur:
                changes += [_ch("creer", w) for w in items]
            elif len(cur) == 1 and len(items) == 1:
                changes.append(_ch("remplacer", items[0], actuel=f"{cur[0]['type']} {cur[0]['content']}", _id=cur[0]["id"]))
            else:
                now = ", ".join(f"{e['type']} {e['content']}" for e in cur)
                changes += [_ch("conflit", w, actuel=now, raison="plusieurs enregistrements a ce nom : a regler a la main")
                            for w in items]
        else:
            cur = [e for e in here if e["type"] == gtype and (kind is None or _kind_of(e) == kind)]
            same = sorted((_norm(gtype, e["content"]), e.get("priority") if gtype == "MX" else None) for e in cur) == \
                sorted((_norm(gtype, w["content"]), w.get("priority") if gtype == "MX" else None) for w in items)
            if same:
                changes += [_ch("identique", w) for w in items]
            elif not cur:
                changes += [_ch("creer", w) for w in items]
            else:
                now = ", ".join(e["content"] for e in cur)
                what = {"MX": "des MX existent deja (un autre fournisseur d'email ?)"}.get(
                    gtype, "un enregistrement de ce type existe deja")
                changes += [_ch("conflit", w, actuel=now, raison=what + " : jamais remplace automatiquement")
                            for w in items]
    return {"provider": prov.key, "zone": zone_name, "zone_id": zone, "changes": changes,
            "a_faire": sum(1 for c in changes if c["action"] in ("creer", "remplacer")),
            "conflits": sum(1 for c in changes if c["action"] == "conflit")}


def _kind(w):
    """TXT records at one name are independent: SPF and DMARC are compared apart."""
    if w["type"] != "TXT":
        return None
    v = _norm("TXT", w["content"]).lower()
    return "spf" if v.startswith("v=spf1") else "dmarc" if v.startswith("v=dmarc1") else "autre"


def _kind_of(e):
    return _kind({"type": e["type"], "content": e["content"]})


def _ch(action, w, **extra):
    d = {"action": action, "type": w["type"], "name": w["fqdn"], "valeur": _norm(w["type"], w["content"]),
         "pourquoi": w.get("why", ""), "_rec": w}
    if w["type"] == "MX":
        d["priorite"] = w.get("priority")
    d.update(extra)
    return d


def public(plan_):
    """The plan without its internal fields."""
    return {**{k: v for k, v in plan_.items() if k != "zone_id"},
            "changes": [{k: v for k, v in c.items() if not k.startswith("_")} for c in plan_["changes"]]}


def apply(domain, records, prov=None):
    """Create / replace what the plan says. Conflicts and identical records are left alone."""
    prov = prov or provider()
    p = plan(domain, records, prov)
    done = []
    for c in p["changes"]:
        entry = {k: v for k, v in c.items() if not k.startswith("_")}
        try:
            if c["action"] == "creer":
                prov.create(p["zone_id"], c["_rec"])
                entry["resultat"] = "cree"
            elif c["action"] == "remplacer":
                prov.replace(p["zone_id"], c["_id"], c["_rec"])
                entry["resultat"] = "remplace"
            else:
                entry["resultat"] = "inchange" if c["action"] == "identique" else "non touche (conflit)"
        except Exception as e:
            entry["resultat"] = "echec"
            entry["erreur"] = getattr(e, "message", None) or str(e)
        done.append(entry)
    return {"provider": p["provider"], "zone": p["zone"], "changes": done,
            "faits": sum(1 for d in done if d["resultat"] in ("cree", "remplace")),
            "echecs": sum(1 for d in done if d["resultat"] == "echec"),
            "conflits": p["conflits"]}
