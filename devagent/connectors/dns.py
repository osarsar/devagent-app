"""Connector — write DNS records at the provider: Cloudflare, OVH, Hostinger.

DevAgent already knows which records a project needs (connections.expected_dns) and
verifies them with real lookups. This connector puts them in place:

    plan(domain, records)    what would change — reads only
    apply(domain, records)   creates / replaces what the plan says, nothing else

Careful by design:
  - a record that already has the right value is left alone;
  - a site record (A / CNAME) is replaced only when there is exactly one to replace (and, at OVH
    and Hostinger, only when it has the same type: their API cannot change a record's type);
  - existing MX, SPF or DMARC records that differ are NEVER replaced: they are reported as a
    conflict (changing them by mistake stops the client's email);
  - nothing is ever deleted.

Settings (encrypted): ``dns_cloudflare_api_token`` · ``dns_ovh_application_key``,
``dns_ovh_application_secret``, ``dns_ovh_consumer_key`` · ``dns_hostinger_api_token``.
The provider used for a domain is the configured one that holds its zone.

Adding a provider = a class with zone_id / list / create / replace (and commit when changes
must be applied in one go), listed in PROVIDERS.
"""
import hashlib
import json
import time

import requests

import db
import projects as P

CF_API = "https://api.cloudflare.com/client/v4"
SITE_TYPES = ("A", "AAAA", "CNAME")


class Cloudflare:
    key, label, settings = "cloudflare", "Cloudflare", ("dns_cloudflare_api_token",)
    can_change_type = True

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

    def replace(self, zone, existing, rec):
        return self._call("PUT", f"/zones/{zone}/dns_records/{existing['id']}", json=self._body(rec))["id"]

    def commit(self, zone):
        pass


def _split_mx(content):
    """'10 mx1.host.' → (10, 'mx1.host.') ; a bare host → (None, host)."""
    parts = str(content or "").split()
    if len(parts) == 2 and parts[0].isdigit():
        return int(parts[0]), parts[1]
    return None, str(content or "")


def _relative(fqdn, zone_name):
    """'www.exemple.ma' in zone 'exemple.ma' → 'www' ; the zone itself → ''."""
    return "" if fqdn == zone_name else fqdn[:-(len(zone_name) + 1)]


class OVH:
    """OVHcloud API (EU). Records are changed one by one, then applied with a zone refresh."""
    key, label = "ovh", "OVH"
    settings = ("dns_ovh_application_key", "dns_ovh_application_secret", "dns_ovh_consumer_key")
    can_change_type = False                       # the API cannot change the type of a record
    BASE = "https://eu.api.ovh.com/1.0"
    AS_TXT = ("TXT", "SPF", "DMARC", "DKIM")      # OVH stores these text records under their own types

    def __init__(self, app_key, app_secret, consumer_key):
        self.ak, self.secret, self.ck = app_key, app_secret, consumer_key
        self._delta = None
        self._zone_name = {}

    def _http(self, method, url, headers, data):
        return requests.request(method, url, headers=headers, data=data or None, timeout=20)

    def _call(self, method, path, body=None, params=None, auth=True):
        url = self.BASE + path
        if params:
            url += "?" + "&".join(f"{k}={requests.utils.quote(str(v), safe='')}" for k, v in params.items())
        data = json.dumps(body, separators=(",", ":")) if body is not None else ""
        headers = {"X-Ovh-Application": self.ak}
        if data:
            headers["Content-type"] = "application/json"
        if auth:
            if self._delta is None:
                self._delta = int(self._call("GET", "/auth/time", auth=False)) - int(time.time())
            now = str(int(time.time()) + self._delta)
            sig = hashlib.sha1("+".join([self.secret, self.ck, method.upper(), url, data, now]).encode()).hexdigest()
            headers.update({"X-Ovh-Consumer": self.ck, "X-Ovh-Timestamp": now, "X-Ovh-Signature": "$1$" + sig})
        try:
            r = self._http(method, url, headers, data)
        except requests.RequestException as e:
            raise P.ProjectError(f"OVH ne repond pas ({type(e).__name__})")
        if r.status_code >= 400:
            try:
                why = r.json().get("message", "")
            except ValueError:
                why = ""
            raise _Http(r.status_code, f"OVH : {why or 'HTTP ' + str(r.status_code)}")
        try:
            return r.json() if r.text.strip() else None
        except ValueError:
            return None

    def zone_id(self, domain):
        parts = domain.split(".")
        for i in range(len(parts) - 1):
            name = ".".join(parts[i:])
            try:
                self._call("GET", f"/domain/zone/{name}")
            except _Http as e:
                if e.status in (403, 404):
                    continue
                raise
            self._zone_name[name] = name
            return name, name
        raise P.ProjectError(f"Le domaine {domain} n'est dans aucune zone DNS de ce compte OVH")

    def list(self, zone, name):
        sub = _relative(name, zone)
        out = []
        for rid in self._call("GET", f"/domain/zone/{zone}/record", params={"subDomain": sub}) or []:
            r = self._call("GET", f"/domain/zone/{zone}/record/{rid}")
            if (r.get("subDomain") or "") != sub:              # the filter is a « like »: keep exact matches
                continue
            rtype, content, prio = r["fieldType"], r.get("target", ""), None
            if rtype == "MX":
                prio, content = _split_mx(content)
            if rtype in self.AS_TXT:
                rtype = "TXT"
            out.append({"id": rid, "type": rtype, "content": content, "priority": prio})
        return out

    def _target(self, rec):
        if rec["type"] == "MX":
            return f"{int(rec.get('priority') or 10)} {rec['content'].rstrip('.')}."
        if rec["type"] == "CNAME":
            return rec["content"].rstrip(".") + "."
        return rec["content"]

    def create(self, zone, rec):
        r = self._call("POST", f"/domain/zone/{zone}/record",
                       {"fieldType": rec["type"], "subDomain": _relative(rec["fqdn"], zone),
                        "target": self._target(rec), "ttl": 3600})
        return (r or {}).get("id")

    def replace(self, zone, existing, rec):
        self._call("PUT", f"/domain/zone/{zone}/record/{existing['id']}", {"target": self._target(rec)})
        return existing["id"]

    def commit(self, zone):
        self._call("POST", f"/domain/zone/{zone}/refresh")


class Hostinger:
    """Hostinger API. A zone is read whole; records are sent per (name, type)."""
    key, label, settings = "hostinger", "Hostinger", ("dns_hostinger_api_token",)
    can_change_type = False                       # « overwrite » only replaces records of the same type
    BASE = "https://developers.hostinger.com/api/dns/v1/zones/"

    def __init__(self, token):
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        self._zones = {}

    def _call(self, method, domain, **kw):
        try:
            r = self.s.request(method, self.BASE + domain, timeout=20, **kw)
        except requests.RequestException as e:
            raise P.ProjectError(f"Hostinger ne repond pas ({type(e).__name__})")
        if r.status_code >= 400:
            try:
                why = r.json().get("message", "")
            except ValueError:
                why = ""
            raise _Http(r.status_code, f"Hostinger : {why or 'HTTP ' + str(r.status_code)}")
        try:
            return r.json()
        except ValueError:
            return None

    def zone_id(self, domain):
        parts = domain.split(".")
        for i in range(len(parts) - 1):
            name = ".".join(parts[i:])
            try:
                self._zones[name] = self._call("GET", name) or []
            except _Http as e:
                if e.status in (403, 404, 422):
                    continue
                raise
            return name, name
        raise P.ProjectError(f"Le domaine {domain} n'est dans aucune zone DNS de ce compte Hostinger")

    def _name(self, fqdn, zone):
        return _relative(fqdn, zone) or "@"

    def list(self, zone, name):
        rel, out = self._name(name, zone), []
        for rr in self._zones.get(zone) or []:
            if (rr.get("name") or "@") != rel:
                continue
            for i, rec in enumerate(rr.get("records") or []):
                if rec.get("is_disabled"):
                    continue
                content, prio = rec.get("content", ""), None
                if rr["type"] == "MX":
                    prio, content = _split_mx(content)
                out.append({"id": f"{rel}/{rr['type']}/{i}", "type": rr["type"], "content": content, "priority": prio})
        return out

    def _content(self, rec):
        if rec["type"] == "MX":
            return f"{int(rec.get('priority') or 10)} {rec['content'].rstrip('.')}."
        if rec["type"] == "CNAME":
            return rec["content"].rstrip(".") + "."
        return rec["content"]

    def _put(self, zone, rec, overwrite):
        self._call("PUT", zone, json={"overwrite": overwrite, "zone": [
            {"name": self._name(rec["fqdn"], zone), "type": rec["type"], "ttl": 14400,
             "records": [{"content": self._content(rec)}]}]})

    def create(self, zone, rec):
        self._put(zone, rec, overwrite=False)          # appended: nothing existing is removed

    def replace(self, zone, existing, rec):
        self._put(zone, rec, overwrite=True)           # replaces the records of this name AND type only

    def commit(self, zone):
        pass


class _Http(Exception):
    """An HTTP error of a provider: looks like a ProjectError to the guard (message), with its status."""
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


_Http.__name__ = "ProjectError"                    # refused operation, shown as a message
PROVIDERS = {c.key: c for c in (Cloudflare, OVH, Hostinger)}


def configured():
    """{provider: bool} — which providers have their credentials."""
    return {k: all(db.get_setting(s_, "") for s_ in c.settings) for k, c in PROVIDERS.items()}


def _make(name):
    cls = PROVIDERS[name]
    return cls(*[db.get_setting(s_, "") for s_ in cls.settings])


def provider(name=None, domain=None):
    """The provider to use: ``name``, else the configured one that holds the zone of ``domain``."""
    ready = [k for k, ok in configured().items() if ok]
    if name:
        if name not in ready:
            raise P.ProjectError(f"Le fournisseur DNS « {name} » n'est pas branche (Agent → Reglages).")
        return _make(name)
    if not ready:
        raise P.ProjectError("Aucun fournisseur DNS n'est branche : ajoute tes acces Cloudflare, OVH ou Hostinger dans "
                             "Agent → Reglages. Sans cela, les enregistrements se saisissent a la main chez le "
                             "registrar (domaine_dns_attendus donne la liste).")
    if domain and len(ready) > 1:
        for k in ready:
            p = _make(k)
            try:
                p.zone_id(domain)
                return p
            except Exception:
                continue
        raise P.ProjectError(f"Le domaine {domain} n'est dans aucune zone des fournisseurs branches ({', '.join(ready)}).")
    return _make(ready[0])


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
    prov = prov or provider(domain=domain)
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
            site_ips = {_norm("A", w["content"]) for w in wanted if w["type"] == "A"}
            same_site = bool(cur) and all(e["type"] == "A" and _norm("A", e["content"]) in site_ips for e in cur)
            if same or same_site:           # same_site: www answers with the site's own address instead of a CNAME
                changes += [_ch("identique", w) for w in items]
            elif not cur:
                changes += [_ch("creer", w) for w in items]
            elif len(cur) == 1 and len(items) == 1 and (
                    cur[0]["type"] == items[0]["type"] or getattr(prov, "can_change_type", True)):
                changes.append(_ch("remplacer", items[0], actuel=f"{cur[0]['type']} {cur[0]['content']}", _cur=cur[0]))
            elif len(cur) == 1 and len(items) == 1:
                changes.append(_ch("conflit", items[0], actuel=f"{cur[0]['type']} {cur[0]['content']}",
                                   raison=f"un {cur[0]['type']} existe a ce nom et ce fournisseur ne sait pas changer "
                                          f"le type d'un enregistrement : supprime-le a la main, puis relance"))
            else:
                now = ", ".join(f"{e['type']} {e['content']}" for e in cur)
                changes += [_ch("conflit", w, actuel=now, raison="plusieurs enregistrements a ce nom : a regler a la main")
                            for w in items]
        else:
            cur = [e for e in here if e["type"] == gtype and (kind is None or _kind_of(e) == kind)]
            same = sorted((_norm(gtype, e["content"]), e.get("priority") if gtype == "MX" else None) for e in cur) == \
                sorted((_norm(gtype, w["content"]), w.get("priority") if gtype == "MX" else None) for w in items)
            have = {(_norm(gtype, e["content"]), e.get("priority") if gtype == "MX" else None) for e in cur}
            hosts = {_norm(gtype, e["content"]) for e in cur}
            covered = all((_norm(gtype, w["content"]), w.get("priority") if gtype == "MX" else None) in have
                          or (gtype == "MX" and _norm(gtype, w["content"]) in hosts) for w in items)
            if same or (cur and covered):   # everything wanted is already there (the zone may hold more)
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
    prov = prov or provider(domain=domain)
    p = plan(domain, records, prov)
    done = []
    for c in p["changes"]:
        entry = {k: v for k, v in c.items() if not k.startswith("_")}
        try:
            if c["action"] == "creer":
                prov.create(p["zone_id"], c["_rec"])
                entry["resultat"] = "cree"
            elif c["action"] == "remplacer":
                prov.replace(p["zone_id"], c["_cur"], c["_rec"])
                entry["resultat"] = "remplace"
            else:
                entry["resultat"] = "inchange" if c["action"] == "identique" else "non touche (conflit)"
        except Exception as e:
            entry["resultat"] = "echec"
            entry["erreur"] = getattr(e, "message", None) or str(e)
        done.append(entry)
    if any(d["resultat"] in ("cree", "remplace") for d in done) and hasattr(prov, "commit"):
        try:
            prov.commit(p["zone_id"])                  # OVH: the changes apply when the zone is refreshed
        except Exception as e:
            return {"provider": p["provider"], "zone": p["zone"], "changes": done, "faits": 0, "echecs": len(done),
                    "conflits": p["conflits"],
                    "erreur": "Les enregistrements sont ecrits mais la zone n'a pas ete rechargee : "
                              + (getattr(e, "message", None) or str(e))}
    return {"provider": p["provider"], "zone": p["zone"], "changes": done,
            "faits": sum(1 for d in done if d["resultat"] in ("cree", "remplace")),
            "echecs": sum(1 for d in done if d["resultat"] == "echec"),
            "conflits": p["conflits"]}
