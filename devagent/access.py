"""Access: every platform DevAgent connects to, in one place.

For each platform: what it is for, which keys it needs, WHERE to create or renew them, whether
they are saved, whether they really work, and when they expire.

    status()             every platform, from what is stored (no network)
    test(key=None)       really try the access(es) — and remember the result
    for_project(pid)     what THIS project needs, and what is missing

The agent sees the state, never the keys. A key is typed by the user (Agent → Acces).
A key cannot be renewed without the user's own login on the platform: DevAgent notices an
access that stopped working or will expire, and gives the exact page where to renew it.
"""
import json
import smtplib
from datetime import datetime, timezone

import requests

import db
import projects as P

from . import vault

WARN_DAYS = 14


def _f(key, label, secret=True, optional=False):
    return {"key": key, "label": label, "secret": secret, "optional": optional}


# ── The tests: each returns {ok, detail, expires (ISO date or None), limite?} ──

def _seconds_left(iso):
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return (d - datetime.now(timezone.utc)).total_seconds()


def _days_left(iso):
    """Whole days before the expiry (negative once passed); None when there is no expiry."""
    s = _seconds_left(iso)
    return None if s is None else int(s / 86400)


def _get(url, **kw):
    return requests.get(url, timeout=15, **kw)


def _t_github(v):
    import shutil
    import subprocess
    if v.get("github_token"):
        r = _get("https://api.github.com/user", headers={"Authorization": f"Bearer {v['github_token']}",
                                                         "Accept": "application/vnd.github+json"})
        if r.status_code != 200:
            return {"ok": False, "detail": f"GitHub refuse le token ({r.status_code})"}
        exp = r.headers.get("github-authentication-token-expiration")       # « 2026-12-31 10:00:00 UTC »
        iso = exp.replace(" UTC", "+00:00").replace(" ", "T", 1) if exp else None
        return {"ok": True, "detail": f"compte {r.json().get('login')}", "expires": iso}
    if shutil.which("gh"):
        r = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True, timeout=20)
        if r.returncode == 0:
            return {"ok": True, "detail": "connecte par l'outil gh de ce PC (pas de token dans DevAgent)"}
    return {"ok": False, "detail": "ni token, ni outil gh connecte"}


def _t_r2(v):
    import cloudflare_r2
    r = cloudflare_r2.r2_test_connection(v["r2_account_id"], v["r2_access_key_id"], v["r2_secret_access_key"])
    if not r.get("connected"):
        return {"ok": False, "detail": r.get("message") or "connexion refusee"}
    n = r.get("buckets_count", len(r.get("buckets") or []))
    return {"ok": True, "detail": f"{n} bucket(s) visibles"}


def _t_cloudflare_dns(v):
    r = _get("https://api.cloudflare.com/client/v4/user/tokens/verify",
             headers={"Authorization": f"Bearer {v['dns_cloudflare_api_token']}"})
    try:
        body = r.json()
    except ValueError:
        body = {}
    res = body.get("result") or {}
    if not body.get("success") or res.get("status") != "active":
        why = "; ".join(e.get("message", "") for e in body.get("errors") or []) or res.get("status") or f"HTTP {r.status_code}"
        return {"ok": False, "detail": f"Cloudflare : {why}"}
    return {"ok": True, "detail": "token actif", "expires": res.get("expires_on")}


def _t_ovh(v):
    from .connectors import dns
    o = dns.OVH(v["dns_ovh_application_key"], v["dns_ovh_application_secret"], v["dns_ovh_consumer_key"])
    try:
        c = o._call("GET", "/auth/currentCredential")
    except Exception as e:
        return {"ok": False, "detail": getattr(e, "message", None) or str(e)}
    if c.get("status") != "validated":
        return {"ok": False, "detail": f"cles OVH : etat « {c.get('status')} »", "expires": c.get("expiration")}
    rules = c.get("rules") or []
    writes = any(r.get("method") in ("POST", "PUT") and "/domain/zone" in (r.get("path") or "") for r in rules)
    return {"ok": True, "detail": "cles valides", "expires": c.get("expiration"),
            "limite": None if writes else "lecture seule : il manque les droits POST et PUT sur /domain/zone/* pour ecrire le DNS"}


def _t_hostinger(v):
    r = _get("https://developers.hostinger.com/api/domains/v1/portfolio",
             headers={"Authorization": f"Bearer {v['dns_hostinger_api_token']}"})
    if r.status_code != 200:
        return {"ok": False, "detail": f"Hostinger refuse le token ({r.status_code})"}
    try:
        n = len(r.json())
    except (ValueError, TypeError):
        n = 0
    return {"ok": True, "detail": f"{n} domaine(s) visibles"}


def _t_anthropic(v):
    import anthropic
    try:
        anthropic.Anthropic(api_key=v["anthropic_api_key"]).models.list(limit=1)
    except anthropic.AuthenticationError:
        return {"ok": False, "detail": "cle refusee par Anthropic"}
    except anthropic.APIStatusError as e:
        return {"ok": False, "detail": f"Anthropic : erreur {e.status_code}"}
    except anthropic.APIConnectionError:
        return {"ok": False, "detail": "impossible de joindre Anthropic"}
    return {"ok": True, "detail": "cle acceptee"}


def _t_telegram(v):
    r = _get(f"https://api.telegram.org/bot{v['notify_telegram_bot_token']}/getMe")
    try:
        body = r.json()
    except ValueError:
        body = {}
    if not body.get("ok"):
        return {"ok": False, "detail": "Telegram refuse le token du bot"}
    return {"ok": True, "detail": f"bot @{(body.get('result') or {}).get('username')}"}


def _t_smtp(v):
    host, port = v["notify_smtp_host"], int(v.get("notify_smtp_port") or 587)
    try:
        srv = smtplib.SMTP_SSL(host, port, timeout=15) if port == 465 else smtplib.SMTP(host, port, timeout=15)
        with srv:
            if port != 465:
                srv.starttls()
            if v.get("notify_smtp_user"):
                srv.login(v["notify_smtp_user"], v.get("notify_smtp_password") or "")
    except (smtplib.SMTPException, OSError) as e:
        return {"ok": False, "detail": f"{type(e).__name__} : {e}"[:160]}
    return {"ok": True, "detail": "connexion et identification reussies (aucun message envoye)"}


PLATFORMS = [
    {"key": "github", "label": "GitHub", "role": "Sauvegarder et partager le code, creer des depots",
     "needs": ["github"], "create_url": "https://github.com/settings/tokens",
     "how": "Un token avec le droit « repo ». Facultatif si l'outil gh de ce PC est deja connecte (gh auth login).",
     "fields": [_f("github_token", "Token GitHub", optional=True)], "test": _t_github, "always": True},
    {"key": "cloudflare_r2", "label": "Cloudflare R2 (stockage)", "role": "Stocker les fichiers et les sauvegardes des projets",
     "needs": ["storage", "backup"], "create_url": "https://dash.cloudflare.com/?to=/:account/r2/api-tokens",
     "how": "Dans R2 → « Manage R2 API Tokens » : un token « Object Read & Write ». Cloudflare affiche alors "
            "l'Access Key ID et le Secret Access Key. L'Account ID est en haut a droite de la page R2.",
     "fields": [_f("r2_account_id", "Account ID", secret=False), _f("r2_access_key_id", "Access Key ID"),
                _f("r2_secret_access_key", "Secret Access Key"),
                _f("r2_default_bucket", "Bucket par defaut", secret=False, optional=True)], "test": _t_r2},
    {"key": "cloudflare_dns", "label": "Cloudflare (DNS)", "role": "Ecrire les enregistrements DNS des domaines geres chez Cloudflare",
     "needs": ["domain"], "create_url": "https://dash.cloudflare.com/profile/api-tokens",
     "how": "« Create Token » → modele « Edit zone DNS », limite aux zones voulues.",
     "fields": [_f("dns_cloudflare_api_token", "Token API")], "test": _t_cloudflare_dns},
    {"key": "ovh_dns", "label": "OVH (DNS)", "role": "Lire et ecrire les enregistrements DNS des domaines geres chez OVH",
     "needs": ["domain"], "create_url": "https://eu.api.ovh.com/createToken/",
     "how": "Droits GET, POST et PUT sur /domain/zone/* (GET seul = lecture seule). Validite : Unlimited, "
            "sinon les cles expirent et il faut en recreer.",
     "fields": [_f("dns_ovh_application_key", "Application key"), _f("dns_ovh_application_secret", "Application secret"),
                _f("dns_ovh_consumer_key", "Consumer key")], "test": _t_ovh},
    {"key": "hostinger_dns", "label": "Hostinger (DNS)", "role": "Lire et ecrire les enregistrements DNS des domaines geres chez Hostinger",
     "needs": ["domain"], "create_url": "https://hpanel.hostinger.com/profile/api",
     "how": "hPanel → Profil → API → « Nouveau token ». Choisis une date d'expiration lointaine.",
     "fields": [_f("dns_hostinger_api_token", "Token API")], "test": _t_hostinger},
    {"key": "anthropic", "label": "Anthropic (chat de l'agent)", "role": "Faire fonctionner le chat integre",
     "needs": [], "create_url": "https://console.anthropic.com/settings/keys",
     "how": "« Create Key ». Facture a l'usage. Inutile pour se servir de l'agent depuis Claude Code.",
     "fields": [_f("anthropic_api_key", "Cle API")], "test": _t_anthropic},
    {"key": "telegram", "label": "Telegram (alertes)", "role": "Recevoir les alertes de l'agent et des automatisations",
     "needs": ["monitoring"], "create_url": "https://t.me/BotFather",
     "how": "Parle a @BotFather : /newbot te donne le token. Ecris ensuite un message a ton bot, puis ouvre "
            "https://api.telegram.org/bot<token>/getUpdates : « chat.id » est l'identifiant du chat.",
     "fields": [_f("notify_telegram_bot_token", "Token du bot"), _f("notify_telegram_chat_id", "Identifiant du chat", secret=False)],
     "test": _t_telegram},
    {"key": "smtp", "label": "Email (alertes)", "role": "Recevoir les alertes par email",
     "needs": ["monitoring"], "create_url": "",
     "how": "Les reglages SMTP de ta boite (chez Google : un « mot de passe d'application », pas ton mot de passe).",
     "fields": [_f("notify_smtp_host", "Serveur SMTP", secret=False), _f("notify_smtp_port", "Port (587 ou 465)", secret=False, optional=True),
                _f("notify_smtp_user", "Utilisateur", secret=False, optional=True), _f("notify_smtp_password", "Mot de passe", optional=True),
                _f("notify_email_from", "Expediteur", secret=False, optional=True), _f("notify_email_to", "Destinataire", secret=False)],
     "test": _t_smtp},
]
BY_KEY = {p["key"]: p for p in PLATFORMS}
FIELD_KEYS = {f["key"] for p in PLATFORMS for f in p["fields"]}
HOSTING_URLS = {"vercel": "https://vercel.com/account/tokens",
                "netlify": "https://app.netlify.com/user/applications#personal-access-tokens",
                "railway": "https://railway.app/account/tokens", "render": "https://dashboard.render.com/settings#api-keys",
                "fly": "https://fly.io/user/personal_access_tokens", "cloudflare": "https://dash.cloudflare.com/profile/api-tokens"}


# ── Stored results of the last tests (no secret in them) ─────────────────────

def _results():
    try:
        return json.loads(db.get_setting("access_tests", "{}") or "{}")
    except ValueError:
        return {}


def _remember(key, res):
    all_ = _results()
    all_[key] = {**res, "at": datetime.now().isoformat(timespec="seconds")}
    db.set_setting("access_tests", json.dumps(all_))
    return all_[key]


def _values(p):
    return {f["key"]: db.get_setting(f["key"], "") or "" for f in p["fields"]}


def _state(configured, last):
    """ok | a_tester | en_panne | expire_bientot | expire | absent"""
    if not configured:
        return "absent"
    if not last:
        return "a_tester"
    left = _seconds_left(last.get("expires"))
    if left is not None and left < 0:
        return "expire"
    if not last.get("ok"):
        return "en_panne"
    if left is not None and left <= WARN_DAYS * 86400:
        return "expire_bientot"
    return "ok"


def _entry(p, last):
    vals = _values(p)
    missing = [f["label"] for f in p["fields"] if not f["optional"] and not vals[f["key"]]]
    configured = not missing and (any(vals.values()) or p.get("always", False))
    days = _days_left((last or {}).get("expires"))
    return {"key": p["key"], "label": p["label"], "role": p["role"], "needs": p["needs"],
            "configured": configured, "missing": missing if any(vals.values()) or not p.get("always") else [],
            "state": _state(configured, last), "last": last, "days_left": days,
            "create_url": p["create_url"], "how": p["how"],
            "fields": [{**f, "set": bool(vals[f["key"]]),
                        "value": "" if f["secret"] else vals[f["key"]]} for f in p["fields"]]}


def _hosting_entries(results):
    import hosting
    out = []
    for a in hosting.accounts():
        key = f"hosting:{a['id']}"
        last = results.get(key)
        out.append({"key": key, "label": f"{a.get('platform', '').capitalize()} — {a.get('name')}",
                    "role": "Heberger les sites (deploiements, domaines)", "needs": ["hosting"],
                    "configured": bool(a.get("token")), "missing": [] if a.get("token") else ["Token"],
                    "state": _state(bool(a.get("token")), last), "last": last,
                    "days_left": _days_left((last or {}).get("expires")),
                    "create_url": HOSTING_URLS.get(a.get("platform"), ""), "platform": a.get("platform"),
                    "how": "Un token du compte. Choisis une expiration lointaine, ou « No expiration ».",
                    "fields": [], "account_id": a["id"], "email": a.get("email", "")})
    return out


def status():
    """Every platform and hosting account, from what is stored. No network."""
    results = _results()
    return [_entry(p, results.get(p["key"])) for p in PLATFORMS] + _hosting_entries(results)


def _test_hosting(account):
    from .connectors import vercel
    if account.get("platform") == "vercel":
        try:
            who = vercel.whoami(account["token"])
            info = vercel.token_info(account["token"])
        except Exception as e:
            return {"ok": False, "detail": getattr(e, "message", None) or str(e)}
        if info.get("revoked") or info.get("leaked"):
            return {"ok": False, "detail": "token revoque" if info["revoked"] else "token signale comme fuite : remplace-le"}
        exp = info.get("expires_ms")
        iso = datetime.fromtimestamp(exp / 1000, timezone.utc).isoformat() if exp else None
        return {"ok": True, "detail": f"compte {who.get('utilisateur') or who.get('email')}", "expires": iso}
    import cloud_ops
    r = cloud_ops._verify_hosting_token(account.get("platform"), account.get("token", ""))
    return {"ok": bool(r.get("valid")), "detail": r.get("email") or r.get("username") or r.get("error") or ""}


def test(key=None):
    """Really try one access (or all the configured ones) and remember the result.
    Returns {tout_ok, resume, acces: [...]}"""
    import hosting
    done = []
    for p in PLATFORMS:
        if key and p["key"] != key:
            continue
        e = _entry(p, None)
        if not e["configured"]:
            continue
        try:
            res = p["test"](_values(p))
        except requests.RequestException as ex:
            res = {"ok": False, "detail": f"la plateforme ne repond pas ({type(ex).__name__})"}
        except Exception as ex:
            res = {"ok": False, "detail": f"{type(ex).__name__} : {ex}"[:160]}
        _remember(p["key"], res)
        done.append(p["key"])
    for a in hosting.accounts():
        k = f"hosting:{a['id']}"
        if (key and k != key) or not a.get("token"):
            continue
        _remember(k, _test_hosting(a))
        done.append(k)
    if key and not done:
        raise P.ProjectError(f"Acces « {key} » inconnu ou pas encore saisi. Acces : " + ", ".join(e["key"] for e in status()))
    entries = [e for e in status() if e["key"] in done]
    bad = [e for e in entries if e["state"] in ("en_panne", "expire", "expire_bientot")]
    return {"tout_ok": not bad, "acces": [public(e) for e in entries],
            "resume": "; ".join(f"{e['label']} : {explain(e)}" for e in bad) or "tous les acces testes fonctionnent"}


def explain(e):
    """One sentence on the state of an access, and what to do."""
    last = e.get("last") or {}
    renew = f" Renouvelle-le ici : {e['create_url']}" if e.get("create_url") else ""
    s = e["state"]
    if s == "absent":
        return ("pas encore saisi" + (f" (il manque : {', '.join(e['missing'])})" if e.get("missing") else "")
                + (f". A creer ici : {e['create_url']}" if e.get("create_url") else ""))
    if s == "a_tester":
        return "saisi, jamais teste"
    if s == "expire":
        return (f"expire depuis {-e['days_left']} jour(s)." if e["days_left"] else "expire aujourd'hui.") + renew
    if s == "en_panne":
        return f"ne fonctionne plus ({last.get('detail', '')}).{renew}"
    if s == "expire_bientot":
        return f"expire dans {e['days_left']} jour(s).{renew}"
    extra = f" — {last['limite']}" if last.get("limite") else ""
    return (f"fonctionne ({last.get('detail', '')})" + (f", expire dans {e['days_left']} jours" if e.get("days_left") is not None else "") + extra)


def public(e):
    """An access as the agent may see it: its state and what to do, no key."""
    return {"acces": e["key"], "nom": e["label"], "sert_a": e["role"], "etat": e["state"], "explication": explain(e),
            "ou_creer_ou_renouveler": e.get("create_url") or None, "comment": e.get("how"),
            "dernier_test": (e.get("last") or {}).get("at")}


def save(values):
    """Store the fields the user typed (only known keys; a masked value is ignored)."""
    n = 0
    for k, v in (values or {}).items():
        if k in FIELD_KEYS and isinstance(v, str) and "****" not in v:
            db.set_setting(k, v.strip())
            n += 1
    return n


# ── What a project needs ────────────────────────────────────────────────────

def for_project(pid):
    """For each need of the project: which access serves it, its state, what to do."""
    import connections
    import model
    project = P.get(pid)
    entries = {e["key"]: e for e in status()}
    needs = model.get_model(pid, probe=False)["needs"]
    ctrl = (model.get_model(pid, probe=False).get("controller") or {})
    managed = set(ctrl.get("manages") or [])
    out = []

    def add(need, e=None, note=None):
        row = {"besoin": model.NEEDS.get(need, {}).get("label", need)}
        if e:
            row.update(acces=e["label"], etat=e["state"], explication=explain(e),
                       ou=e.get("create_url") or None)
        else:
            row.update(acces=None, etat="info", explication=note)
        out.append(row)

    for need in needs:
        if need in managed:
            add(need, note=f"gere par {ctrl.get('name') or 'la console du projet'} : DevAgent n'a besoin d'aucun acces")
        elif need == "github":
            add(need, entries["github"])
        elif need in ("storage", "backup"):
            add(need, entries["cloudflare_r2"])
        elif need == "hosting":
            target = connections.hosting_target(pid)
            if target and target.get("kind") == "platform":
                acct = next((e for e in entries.values() if e["key"].startswith("hosting:")
                             and e.get("platform") == target.get("platform")), None)
                add(need, acct, None if acct else f"aucun compte {target.get('platform')} enregistre : ajoute-le dans Agent → Acces")
            elif target and target.get("kind") == "server":
                add(need, note=f"serveur {target.get('name')} : acces par cle SSH (serveur_tester le verifie)")
            else:
                add(need, note="pas encore d'hebergement choisi (un serveur, ou un compte Vercel / Netlify)")
        elif need == "domain":
            domain = connections.domain_state(pid)["config"].get("domain")
            dns_keys = ("cloudflare_dns", "ovh_dns", "hostinger_dns")
            ready = [entries[k] for k in dns_keys if entries[k]["configured"]]
            if not domain:
                add(need, note="pas encore de nom de domaine enregistre pour ce projet")
            elif ready:
                for e in ready:
                    add(need, e)
            else:
                add(need, note=f"aucun fournisseur DNS branche pour {domain} : sans acces, l'agent verifie le DNS mais "
                               "ne peut pas l'ecrire (Cloudflare, OVH ou Hostinger dans Agent → Acces)")
        elif need == "monitoring":
            chans = [entries[k] for k in ("telegram", "smtp") if entries[k]["configured"]]
            if chans:
                for e in chans:
                    add(need, e)
            else:
                add(need, note="aucun canal d'alerte : branche Telegram ou l'email pour etre prevenu quand le site tombe")
        else:
            add(need, note="aucun acces a une plateforme n'est necessaire")
    blocking = [r for r in out if r["etat"] in ("absent", "en_panne", "expire")]
    return {"projet": project["name"], "besoins": out, "a_regler": len(blocking),
            "resume": (f"{len(blocking)} acces a regler : " + "; ".join(f"{r['acces']} ({r['explication']})" for r in blocking))
            if blocking else "aucun acces ne bloque ce projet"}
