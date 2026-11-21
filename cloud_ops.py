"""DevAgent — the connections of a project as the interface shows them, hosting accounts, the cloud overview.

Moved out of cloud_routes.py: the routes only translate HTTP to these functions, and the agent's
tools call them too. A function returns its answer (a dict or a list), or (answer, http_status).
"""

import os
import re
import json
from pathlib import Path
import db
import github_ops
import cloudflare_r2
import cloud_sync
import hosting
import projects as P



def _j(*a, **k):
    """What jsonify() received, as plain data."""
    return a[0] if a else k


def _fmt(b):
    for u in ["B", "KB", "MB", "GB", "TB"]:
        if abs(b) < 1024:
            return f"{b:.1f} {u}"
        b /= 1024
    return f"{b:.1f} PB"


DB_LABELS = {"postgres": "PostgreSQL", "mysql": "MySQL", "mongodb": "MongoDB",
             "sqlite": "SQLite", "supabase": "Supabase", "prisma": "Prisma", "neon": "Neon", "unknown": "Database"}


_PLATFORM_ALIASES = {
    "vercel.com": "vercel", "netlify.com": "netlify", "railway.app": "railway",
    "render.com": "render", "fly.io": "fly", "cloudflare pages": "cloudflare",
    "cloudflare-pages": "cloudflare", "cloudflare_pages": "cloudflare", "pages": "cloudflare",
}


_NOT_A_PLATFORM = {"vps", "server", "serveur", "self", "docker"}


def _norm_platform(p):
    """'Vercel' / 'https://vercel.com/' -> 'vercel' (the key the DNS records use)."""
    p = re.sub(r"^https?://", "", str(p or "").strip().lower()).strip("/ ")
    p = p[4:] if p.startswith("www.") else p
    return _PLATFORM_ALIASES.get(p, p)


def _parse_cfg(comp):
    """Extract config dict from a component row."""
    if not comp:
        return {}
    cfg = comp.get("config", {})
    if isinstance(cfg, str):
        try: return json.loads(cfg)
        except: return {}
    return cfg


def _get_hosting_accounts():
    return hosting.accounts()


def _save_hosting_accounts(accounts):
    hosting.save_accounts(accounts)


def _verify_hosting_token(platform, token):
    """Verify a hosting token and return real account info from the platform API."""
    import requests
    try:
        if platform == "vercel":
            r = requests.get("https://api.vercel.com/v2/user", headers={"Authorization": f"Bearer {token}"}, timeout=10)
            if r.status_code == 200:
                u = r.json().get("user", {})
                return {"valid": True, "email": u.get("email", ""), "username": u.get("username", ""), "name": u.get("name", "")}
            return {"valid": False, "error": f"Token invalide ({r.status_code})"}

        elif platform == "netlify":
            r = requests.get("https://api.netlify.com/api/v1/user", headers={"Authorization": f"Bearer {token}"}, timeout=10)
            if r.status_code == 200:
                u = r.json()
                return {"valid": True, "email": u.get("email", ""), "username": u.get("slug", ""), "name": u.get("full_name", "")}
            return {"valid": False, "error": f"Token invalide ({r.status_code})"}

        elif platform == "railway":
            r = requests.post("https://backboard.railway.app/graphql/v2",
                              json={"query": "query { me { email name } }"},
                              headers={"Authorization": f"Bearer {token}"}, timeout=10)
            if r.status_code == 200:
                me = r.json().get("data", {}).get("me", {})
                return {"valid": True, "email": me.get("email", ""), "username": "", "name": me.get("name", "")}
            return {"valid": False, "error": f"Token invalide ({r.status_code})"}

        elif platform == "render":
            r = requests.get("https://api.render.com/v1/owners", headers={"Authorization": f"Bearer {token}"}, timeout=10)
            if r.status_code == 200:
                owners = r.json()
                if owners:
                    o = owners[0].get("owner", {})
                    return {"valid": True, "email": o.get("email", ""), "username": o.get("id", ""), "name": o.get("name", "")}
            return {"valid": False, "error": f"Token invalide ({r.status_code})"}

        # Default: accept without verification
        return {"valid": True, "email": "", "username": "", "name": ""}
    except Exception as e:
        return {"valid": False, "error": str(e)[:100]}


def get_connections(pid, data=None):
    """Get all connections for a project — verified real status + action hints."""
    project = db.get_project(pid)
    if not project:
        return _j({"connections": []})

    comps = {c["component"]: c for c in db.get_project_components(pid)}
    connections = []
    ppath = project.get("path", "")

    # Load wizard data for planned (not yet connected) services
    specs = db.get_project_specs(pid)
    wd = specs.get("wizard_data", {}) if specs else {}
    if isinstance(wd, str):
        try: wd = json.loads(wd)
        except: wd = {}

    r2_account = db.get_setting("r2_account_id", "")

    # ──── CODE SOURCE + GITHUB (unified) ────
    import subprocess as _sp
    import re as _re

    git_remote = project.get("git_remote", "")
    git_cfg = _parse_cfg(comps.get("git"))
    has_git_dir = ppath and os.path.isdir(os.path.join(ppath, ".git"))
    dir_has_files = False
    if ppath and os.path.isdir(ppath):
        contents = [f for f in os.listdir(ppath) if f not in (".devpilot", "CLAUDE.md", ".claude", ".git")]
        dir_has_files = len(contents) > 0

    # Check real git state
    real_remote = ""
    branch = ""
    if has_git_dir:
        try:
            real_remote = _sp.run(["git", "-C", ppath, "remote", "get-url", "origin"],
                                  capture_output=True, text=True, timeout=3).stdout.strip()
            branch = _sp.run(["git", "-C", ppath, "branch", "--show-current"],
                             capture_output=True, text=True, timeout=3).stdout.strip()
        except Exception:
            pass

    # Clean URL (strip token)
    clean_remote = _re.sub(r'https://[^@]+@', 'https://', git_remote or real_remote)
    github_url = clean_remote if clean_remote.startswith("http") else (f"https://github.com/{clean_remote}" if clean_remote else "")

    # Determine state and actions
    if real_remote and has_git_dir:
        # STATE: Fully connected — git + remote
        last_push = db.get_last_sync(pid, "github", "push")
        connections.append({
            "type": "github", "label": "GitHub", "status": "connected", "url": github_url,
            "details": {"branche": branch, "dernier_push": last_push.get("started_at", "") if last_push else "",
                        "dossier": ppath},
            "action": None,
        })

    elif has_git_dir and not real_remote:
        # STATE: Git init but no remote — needs to link to GitHub
        connections.append({
            "type": "github", "label": "Code source (git local)", "status": "a_configurer",
            "url": "", "details": {"branche": branch, "dossier": ppath},
            "actions": [
                {"label": "Lier a un repo existant", "action_type": "link_repo"},
                {"label": "Creer un nouveau repo", "url": "https://github.com/new", "action_type": "create_repo"},
            ],
        })

    elif not has_git_dir and dir_has_files:
        # STATE: Files exist but no git — needs init + push OR link to existing
        connections.append({
            "type": "github", "label": "Code source (pas de git)", "status": "non_connecte",
            "url": "", "details": {"dossier": ppath, "fichiers": "oui"},
            "actions": [
                {"label": "Creer un repo et pusher", "url": "https://github.com/new", "action_type": "create_and_push"},
                {"label": "Lier a un repo existant", "action_type": "link_repo"},
            ],
        })

    elif not has_git_dir and not dir_has_files:
        # STATE: Empty folder — can clone or create new
        connections.append({
            "type": "github", "label": "Code source (vide)", "status": "non_connecte",
            "url": "", "details": {"dossier": ppath},
            "actions": [
                {"label": "Cloner un repo existant", "action_type": "clone_repo"},
                {"label": "Creer un nouveau repo", "url": "https://github.com/new", "action_type": "create_repo"},
            ],
        })

    # ──── HOSTING / DEPLOIEMENT ────
    # A project is hosted either on a server (SSH, its own card) or on a
    # platform (token + site URL). Without a card there is no way into the
    # platform picker, so an empty state is offered when hosting is still open.
    srv_cfg = _parse_cfg(comps.get("server"))
    has_server = bool(srv_cfg.get("servers"))
    hosting_open = True
    try:
        import model as _M
        _m = _M.get_model(pid, probe=False)
        _needs = _m.get("needs") or []
        hosting_open = ((not _needs) or "hosting" in _needs) and \
            "hosting" not in ((_m.get("controller") or {}).get("manages") or [])
    except Exception:
        pass

    deploy_cfg = _parse_cfg(comps.get("deploy"))
    deploy_url = deploy_cfg.get("site_url", "") or deploy_cfg.get("url", "")
    platform = _norm_platform(deploy_cfg.get("platform", "") or wd.get("frontend_hosting", ""))
    if platform in _NOT_A_PLATFORM:
        platform = ""
    account_name = deploy_cfg.get("account_name", "")
    account_id = deploy_cfg.get("account_id", "")
    project_url = deploy_cfg.get("project_url", "")
    host_urls = {"vercel": "https://vercel.com/dashboard", "netlify": "https://app.netlify.com/",
                 "railway": "https://railway.app/dashboard", "render": "https://dashboard.render.com/",
                 "fly": "https://fly.io/dashboard", "cloudflare": "https://dash.cloudflare.com/"}
    token_urls = {"vercel": "https://vercel.com/account/tokens", "netlify": "https://app.netlify.com/user/applications#personal-access-tokens",
                  "railway": "https://railway.app/account/tokens", "render": "https://dashboard.render.com/settings#api-keys",
                  "fly": "https://fly.io/user/personal_access_tokens", "cloudflare": "https://dash.cloudflare.com/profile/api-tokens"}

    # Check if account has a valid token
    account_has_token = False
    account_email = ""
    if account_id:
        accts = _get_hosting_accounts()
        acct = next((a for a in accts if a["id"] == account_id), None)
        if acct:
            account_has_token = bool(acct.get("token"))
            account_email = acct.get("email", "")

    token_url = token_urls.get(platform, "")

    if deploy_url and account_id:
        # Fully connected: account + site URL + token
        connections.append({
            "type": "deploy",
            "label": f"{platform.title()} — {account_name}" if account_name else f"Deploiement ({platform})",
            "status": "connected", "url": deploy_url,
            "details": {"compte": account_name, "email": account_email, "plateforme": platform,
                        "site": deploy_url, "dashboard": project_url,
                        "token": "actif" if account_has_token else "manquant"},
            "actions": [
                {"label": "Regenerer le token", "url": token_url, "action_type": "regen_token"},
                {"label": "Changer de compte", "action_type": "change_hosting_account"},
            ] if token_url else [
                {"label": "Changer de compte", "action_type": "change_hosting_account"},
            ],
        })
    elif account_id:
        # Account linked but no site URL yet
        connections.append({
            "type": "deploy",
            "label": f"{platform.title()} — {account_name}" if account_name else f"Deploiement ({platform})",
            "status": "a_configurer", "url": project_url or host_urls.get(platform, ""),
            "details": {"compte": account_name, "email": account_email, "plateforme": platform,
                        "token": "actif" if account_has_token else "manquant"},
            "actions": [
                {"label": "Configurer le token", "url": token_url, "action_type": "regen_token"} if not account_has_token else
                {"label": f"Ouvrir {platform.title()}", "url": host_urls.get(platform, ""), "action_type": "open_hosting"},
                {"label": "Entrer l'URL du site", "action_type": "enter_site_url"},
            ],
        })
    elif deploy_url:
        # The site is declared on the platform without an API account: that is
        # already a real hosting (the domain can point to it). The token only
        # adds deploys and logs from DevAgent.
        connections.append({
            "type": "deploy",
            "label": f"Deploiement ({platform})" if platform else "Deploiement",
            "status": "configured", "url": deploy_url,
            "details": {"plateforme": platform, "site": deploy_url, "dashboard": project_url,
                        "compte": "pas de token (facultatif)"},
            "actions": [
                {"label": "Lier un compte (token)", "action_type": "pick_hosting_account"},
                {"label": "Modifier", "action_type": "setup_deploy"},
            ],
        })
    elif platform:
        # Platform chosen but no account linked
        connections.append({
            "type": "deploy",
            "label": f"Deploiement ({platform})",
            "status": "non_connecte", "url": "",
            "details": {"plateforme": platform},
            "actions": [
                {"label": "Choisir un compte", "action_type": "pick_hosting_account"},
            ],
        })
    elif hosting_open and not has_server:
        # Nothing chosen yet: the way in to the platform picker (Vercel, Netlify...)
        connections.append({
            "type": "deploy",
            "label": "Hebergement : plateforme (Vercel, Netlify...)",
            "status": "non_connecte", "url": "",
            "details": {},
            "actions": [
                {"label": "Choisir une plateforme", "action_type": "setup_deploy"},
            ],
        })

    # ──── DOMAINE ────
    domain_comp = comps.get("domain")
    domain_cfg = _parse_cfg(domain_comp)
    domain = domain_cfg.get("domain", "") or deploy_cfg.get("domain", "") or wd.get("domain_name", "")
    registrar = domain_cfg.get("registrar", "") or deploy_cfg.get("dns", "") or wd.get("dns_provider", "")
    ssl = domain_cfg.get("ssl", "") or deploy_cfg.get("ssl", "") or wd.get("ssl", "")
    registrar_dashboard = domain_cfg.get("dashboard_url", "")

    registrar_urls = {
        "cloudflare": "https://dash.cloudflare.com/",
        "namecheap": "https://ap.www.namecheap.com/domains/list",
        "ovh": "https://www.ovh.com/manager/",
        "godaddy": "https://dcc.godaddy.com/domains",
        "google": "https://domains.google.com/registrar",
        "ionos": "https://my.ionos.com/domains",
    }
    registrar_buy_urls = {
        "cloudflare": "https://dash.cloudflare.com/?to=/:account/domains/register",
        "namecheap": "https://www.namecheap.com/domains/registration/results/",
        "ovh": "https://www.ovh.com/fr/order/webcloud/",
        "godaddy": "https://www.godaddy.com/domains",
    }

    # Linked hosting info
    hosting_label = ""
    if platform and account_name:
        hosting_label = f"{platform} ({account_name})"
    elif platform:
        hosting_label = platform

    # DNS records needed based on hosting platform
    dns_records = {
        "vercel": {"type": "CNAME", "value": "cname.vercel-dns.com", "alt": "A 76.76.21.21"},
        "netlify": {"type": "CNAME", "value": "<site>.netlify.app"},
        "cloudflare": {"type": "CNAME", "value": "<site>.pages.dev"},
        "railway": {"type": "CNAME", "value": "voir dashboard Railway"},
        "render": {"type": "CNAME", "value": "voir dashboard Render"},
    }
    dns_config = domain_cfg.get("dns_configured", False)
    dns_record = dns_records.get(platform, {})

    if domain:
        dash_url = registrar_dashboard or registrar_urls.get(registrar, "")

        # Determine DNS status
        dns_status = "configure" if dns_config else "a_configurer"
        # Use the direct DNS page URL if saved, otherwise fall back to registrar homepage
        dns_page_url = domain_cfg.get("dashboard_url", "") or dash_url

        details = {
            "registrar": registrar or "non renseigne",
            "SSL": ssl or "non configure",
            "lie_a": hosting_label or "non lie",
        }
        if dns_record and not dns_config:
            details["DNS_requis"] = f"{dns_record.get('type', '')} → {dns_record.get('value', '')}"
            if dns_record.get("alt"):
                details["DNS_alt"] = dns_record["alt"]
        if dns_config:
            details["DNS"] = "configure"

        actions = []
        if dns_page_url:
            actions.append({"label": "Gerer DNS", "url": dns_page_url, "action_type": "open_hosting"})
        if dns_record and not dns_config:
            actions.append({"label": "Voir config DNS", "action_type": "show_dns"})
        actions.append({"label": "Modifier", "action_type": "edit_domain"})

        connections.append({
            "type": "domain", "label": domain,
            "status": "connected" if dns_config else "a_configurer",
            "url": f"https://{domain}",
            "details": details,
            "actions": actions,
        })
    else:
        connections.append({
            "type": "domain", "label": "Nom de domaine", "status": "non_connecte",
            "url": "", "details": {},
            "actions": [
                {"label": "Configurer un domaine", "action_type": "setup_domain"},
            ],
        })

    # ──── EMAIL ────
    email_comp = comps.get("email")
    email_cfg = _parse_cfg(email_comp)
    email_provider = email_cfg.get("provider", "") or wd.get("email_service", "")
    email_addresses = email_cfg.get("addresses", "")
    email_dashboard = email_cfg.get("dashboard_url", "")
    email_webmail = email_cfg.get("webmail_url", "")

    provider_urls = {
        "google":     {"dashboard": "https://admin.google.com/", "webmail": "https://mail.google.com/", "buy": "https://workspace.google.com/pricing"},
        "zoho":       {"dashboard": "https://mail.zoho.com/cpanel/", "webmail": "https://mail.zoho.com/", "buy": "https://www.zoho.com/mail/zohomail-pricing.html"},
        "ovh":        {"dashboard": "https://www.ovh.com/manager/", "webmail": "https://www.ovh.com/fr/mail/", "buy": "https://www.ovh.com/fr/emails/"},
        "infomaniak": {"dashboard": "https://manager.infomaniak.com/", "webmail": "https://mail.infomaniak.com/", "buy": "https://www.infomaniak.com/fr/hebergement/service-mail"},
        "protonmail": {"dashboard": "https://account.proton.me/", "webmail": "https://mail.proton.me/", "buy": "https://proton.me/business"},
        "resend":     {"dashboard": "https://resend.com/domains", "webmail": "", "buy": "https://resend.com/"},
    }

    # MX records per provider for DNS config
    email_mx = {
        "google":     [{"priority": "1", "value": "ASPMX.L.GOOGLE.COM"}, {"priority": "5", "value": "ALT1.ASPMX.L.GOOGLE.COM"}],
        "zoho":       [{"priority": "10", "value": "mx.zoho.com"}, {"priority": "20", "value": "mx2.zoho.com"}],
        "ovh":        [{"priority": "1", "value": "mx1.mail.ovh.net"}, {"priority": "5", "value": "mx2.mail.ovh.net"}],
        "infomaniak": [{"priority": "10", "value": "mta-gw.infomaniak.ch"}],
        "protonmail": [{"priority": "10", "value": "mail.protonmail.ch"}, {"priority": "20", "value": "mailsec.protonmail.ch"}],
    }

    if email_comp or email_provider:
        prov_info = provider_urls.get(email_provider, {})
        dash = email_dashboard or prov_info.get("dashboard", "")
        webmail = email_webmail or prov_info.get("webmail", "")
        mx = email_mx.get(email_provider, [])

        details = {"provider": email_provider or "non configure"}
        if email_addresses:
            details["adresses"] = email_addresses
        if mx and not email_cfg.get("mx_configured"):
            details["MX_requis"] = " / ".join(m["value"] for m in mx[:2])

        if email_provider and email_addresses:
            connections.append({
                "type": "email", "label": f"Email ({email_provider})",
                "status": "connected",
                "url": webmail or dash,
                "details": details,
                "actions": [
                    {"label": "Ouvrir webmail", "url": webmail, "action_type": "open_hosting"} if webmail else None,
                    {"label": "Dashboard", "url": dash, "action_type": "open_hosting"} if dash else None,
                    {"label": "Modifier", "action_type": "setup_email"},
                ],
            })
            connections[-1]["actions"] = [a for a in connections[-1]["actions"] if a]
        elif email_provider:
            connections.append({
                "type": "email", "label": f"Email ({email_provider})",
                "status": "a_configurer",
                "url": "", "details": details,
                "actions": [
                    {"label": "Configurer", "action_type": "setup_email"},
                    {"label": f"Ouvrir {email_provider}", "url": dash or prov_info.get("buy", ""), "action_type": "open_hosting"} if dash else None,
                ],
            })
            connections[-1]["actions"] = [a for a in connections[-1]["actions"] if a]
        else:
            connections.append({
                "type": "email", "label": "Email professionnel",
                "status": "non_connecte",
                "url": "", "details": {},
                "actions": [{"label": "Configurer email", "action_type": "setup_email"}],
            })
    elif domain:
        # Domain exists but no email configured — suggest it
        connections.append({
            "type": "email", "label": "Email professionnel",
            "status": "non_connecte",
            "url": "", "details": {"suggestion": f"contact@{domain}"},
            "actions": [{"label": "Configurer email", "action_type": "setup_email"}],
        })

    # ──── BASE DE DONNEES ────
    db_cfg = _parse_cfg(comps.get("database"))
    db_type = db_cfg.get("type", "") or wd.get("db_type", "")
    db_host = db_cfg.get("host", "")
    db_urls = {"supabase": "https://supabase.com/dashboard", "neon": "https://console.neon.tech/",
               "planetscale": "https://app.planetscale.com/"}

    if db_host:
        connections.append({
            "type": "database", "label": DB_LABELS.get(db_type, db_type.title() if db_type else "Database"),
            "status": "connected", "url": db_cfg.get("url", db_urls.get(db_type, "")),
            "details": {"type": db_type, "host": db_host, "port": db_cfg.get("port", ""), "nom": db_cfg.get("name", "")},
            "actions": [{"label": "Modifier", "action_type": "setup_database"}],
        })
    elif db_type:
        connections.append({
            "type": "database", "label": DB_LABELS.get(db_type, db_type.title()),
            "status": "a_configurer", "url": "",
            "details": {"type": db_type},
            "action": {"label": f"Creer {db_type}", "url": db_urls.get(db_type, ""), "action_type": "create_db"},
        })

    # ──── STOCKAGE R2 ────
    storage_cfg = _parse_cfg(comps.get("storage"))
    bucket = storage_cfg.get("bucket", "") or db.get_setting("r2_default_bucket", "")

    if r2_account and bucket:
        r2_stats = db.get_r2_storage_stats(pid)
        cf_url = f"https://dash.cloudflare.com/{r2_account}/r2/default/buckets/{bucket}"
        connections.append({
            "type": "storage", "label": f"R2 — {bucket}", "status": "connected", "url": cf_url,
            "details": {
                "bucket": bucket,
                "objets": r2_stats.get("count", 0) if isinstance(r2_stats, dict) else 0,
                "taille": r2_stats.get("total_size", 0) if isinstance(r2_stats, dict) else 0,
            }, "actions": [{"label": "Modifier", "action_type": "setup_storage"}],
        })
    elif comps.get("storage") or wd.get("file_upload") == "yes":
        connections.append({
            "type": "storage", "label": "Stockage cloud", "status": "non_connecte", "url": "",
            "details": {},
            "action": {"label": "Configurer stockage", "action_type": "setup_storage"},
        })

    # ──── BACKUP ────
    backup_cfg = _parse_cfg(comps.get("backup"))
    backup_bucket = backup_cfg.get("bucket", "") or wd.get("backup_bucket", "")
    backup_freq = backup_cfg.get("frequency", "") or wd.get("backup_freq", "")
    last_backup = db.get_last_sync(pid, "r2", "backup") or db.get_last_sync(pid, "r2", "push")

    if comps.get("backup") or wd.get("needs_backup") == "yes":
        if last_backup:
            connections.append({
                "type": "backup", "label": "Backup", "status": "connected",
                "url": f"https://dash.cloudflare.com/{r2_account}/r2/default/buckets/{backup_bucket}" if (r2_account and backup_bucket) else "",
                "details": {"frequence": backup_freq, "bucket": backup_bucket,
                            "dernier": last_backup.get("started_at", "")},
                "actions": [{"label": "Modifier", "action_type": "setup_backup"}],
            })
        else:
            connections.append({
                "type": "backup", "label": "Backup", "status": "a_configurer", "url": "",
                "details": {"frequence": backup_freq or "non configure"},
                "action": {"label": "Configurer backup", "url": "", "action_type": "setup_backup"},
            })

    # ──── SERVEUR ────
    server_comp = comps.get("server")
    server_cfg = _parse_cfg(server_comp)
    server_ip = server_cfg.get("ip", "") or deploy_cfg.get("server_host", "")
    server_provider = server_cfg.get("provider", "") or deploy_cfg.get("provider", "")
    server_ssh = server_cfg.get("ssh_user", "")
    server_dashboard = server_cfg.get("dashboard_url", "")
    backend_host = deploy_cfg.get("backend_hosting", "") or wd.get("backend_hosting", "")

    if server_comp or backend_host == "vps" or server_ip:
        if server_ip:
            connections.append({
                "type": "server",
                "label": f"Serveur ({server_provider})" if server_provider else "Serveur VPS",
                "status": "connected",
                "url": server_dashboard,
                "details": {
                    "IP": server_ip,
                    "provider": server_provider,
                    "SSH": f"{server_ssh}@{server_ip}" if server_ssh else "",
                },
                "actions": [
                    {"label": "Dashboard", "url": server_dashboard, "action_type": "open_hosting"} if server_dashboard else None,
                    {"label": "Modifier", "action_type": "setup_server"},
                ],
            })
            connections[-1]["actions"] = [a for a in connections[-1]["actions"] if a]
        else:
            connections.append({
                "type": "server", "label": "Serveur VPS",
                "status": "non_connecte", "url": "",
                "details": {},
                "actions": [{"label": "Configurer le serveur", "action_type": "setup_server"}],
            })

    # ──── DOCKER ────
    docker_cfg = _parse_cfg(comps.get("docker"))
    if comps.get("docker"):
        compose = docker_cfg.get("compose_file", "")
        services = docker_cfg.get("services", [])
        connections.append({
            "type": "docker", "label": "Docker",
            "status": "connected" if compose else "detecte",
            "url": "", "details": {"fichier": compose, "services": ", ".join(services) if services else ""},
            "action": None,
        })

    # ──── CI/CD ────
    ci_cfg = _parse_cfg(comps.get("ci_cd"))
    if comps.get("ci_cd"):
        provider = ci_cfg.get("provider", "")
        ci_url = ""
        if provider == "github" and real_remote:
            ci_url = (real_remote if real_remote.startswith("http") else f"https://github.com/{real_remote}") + "/actions"
        connections.append({
            "type": "ci_cd", "label": f"CI/CD ({provider})" if provider else "CI/CD",
            "status": "connected" if ci_url else "detecte",
            "url": ci_url,
            "details": {"workflows": ", ".join(ci_cfg.get("workflows", []))},
            "action": None if ci_url else {"label": "Configurer CI/CD", "url": "https://github.com/new", "action_type": "setup_ci"},
        })

    return _j({"connections": connections})


def update_connection(pid, data=None):
    """Add or update a connection for a project."""
    data = data or {}
    conn_type = data.get("type", "")
    config = data.get("config", {})

    if not conn_type:
        return _j({"success": False, "message": "Type requis"}), 400

    project = db.get_project(pid)
    if not project:
        return _j({"success": False, "message": "Projet introuvable"}), 404

    # Masked secrets ("****") are never written back; False / "" are kept: they clear a value
    config = {k: v for k, v in config.items() if not (isinstance(v, str) and v.startswith("****"))}

    if conn_type == "deploy" and config.get("platform"):
        config["platform"] = _norm_platform(config["platform"])

    # Map connection type to component key
    comp_key = conn_type
    git_result = None
    if conn_type == "github":
        comp_key = "git"
        repo_url = config.get("url", "")
        if repo_url:
            try:
                token = db.get_setting("github_token", "") if repo_url.startswith("https://github.com/") else ""
                git_result = P.link_git(pid, repo_url, token=token)
            except P.ProjectError as e:
                db.update_project(pid, git_remote=repo_url)
                git_result = {"action": "link_failed", "message": e.message}

    # Merge into existing component config
    existing = db.get_project_component(pid, comp_key)
    if existing:
        merged = existing.get("config", {})
        if isinstance(merged, str):
            try: merged = json.loads(merged)
            except: merged = {}
        merged.update(config)
        db.update_project_component(pid, comp_key, config=merged, enabled=True)
    else:
        db.add_project_component(pid, comp_key, enabled=True, config=config)

    try:
        import connections as _C
        _C.mirror(pid)
    except Exception:
        pass

    # Regenerate CLAUDE.md so Claude sees the new connection
    ppath = project.get("path", "")
    if ppath and os.path.isdir(ppath):
        from dashboard import _write_claude_md
        project = db.get_project(pid)  # re-read updated data
        specs = db.get_project_specs(pid)
        _write_claude_md(ppath, project, specs)

    result = {"success": True}
    if git_result:
        result["git"] = git_result
    return _j(result)


def test_ssh(data=None):
    """Test SSH connection to a server."""
    import subprocess
    data = data or {}
    ip = data.get("ip", "").strip()
    user = data.get("ssh_user", "root").strip()
    ssh_key = data.get("ssh_key", "").strip()

    if not ip:
        return _j({"success": False, "status": "error", "message": "IP requise"})

    # Build SSH command
    cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5",
           "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes"]
    if ssh_key:
        cmd.extend(["-i", os.path.expanduser(ssh_key)])
    else:
        # Try common key paths
        for key_path in ["~/.ssh/id_ed25519", "~/.ssh/id_rsa", "~/.ssh/id_vps"]:
            expanded = os.path.expanduser(key_path)
            if os.path.isfile(expanded):
                cmd.extend(["-i", expanded])
                break

    cmd.append(f"{user}@{ip}")
    cmd.append("echo SSH_OK && hostname && uptime -p")

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if r.returncode == 0 and "SSH_OK" in r.stdout:
            lines = r.stdout.strip().split("\n")
            hostname = lines[1] if len(lines) > 1 else ""
            uptime = lines[2] if len(lines) > 2 else ""
            return _j({
                "success": True, "status": "connected",
                "message": f"Connecte a {hostname}",
                "hostname": hostname, "uptime": uptime,
            })
        else:
            return _j({
                "success": False, "status": "failed",
                "message": r.stderr.strip()[:200] or "Connexion refusee",
            })
    except subprocess.TimeoutExpired:
        return _j({"success": False, "status": "timeout", "message": "Timeout — serveur injoignable"})
    except Exception as e:
        return _j({"success": False, "status": "error", "message": str(e)[:200]})


def add_hosting_account(data=None):
    """Add a new hosting account — verifies token with the platform API."""
    data = data or {}
    platform = data.get("platform", "vercel").strip().lower()
    token = data.get("token", "").strip()

    if not token:
        return _j({"success": False, "message": "Token requis — genere-le sur la plateforme"}), 400

    # Verify token and get real account info
    info = _verify_hosting_token(platform, token)
    if not info.get("valid"):
        return _j({"success": False, "message": f"Token invalide: {info.get('error', 'erreur inconnue')}"}), 400

    # Use the real info from the platform
    name = data.get("name", "").strip() or info.get("name") or info.get("username") or info.get("email", "").split("@")[0]
    email = info.get("email", "")
    username = info.get("username", "")

    accounts = _get_hosting_accounts()

    # Check if account with same email already exists
    existing = next((a for a in accounts if a.get("email") == email and a.get("platform") == platform and email), None)
    if existing:
        # Update token on existing account
        existing["token"] = token
        existing["username"] = username
        existing["name"] = name or existing["name"]
        _save_hosting_accounts(accounts)
        return _j({"success": True, "id": existing["id"], "name": existing["name"], "email": email,
                        "message": f"Token mis a jour pour {email}"})

    # Generate unique ID
    import hashlib, time
    aid = hashlib.md5(f"{email}{time.time()}".encode()).hexdigest()[:8]

    accounts.append({
        "id": aid,
        "name": name,
        "platform": platform,
        "email": email,
        "username": username,
        "token": token,
        "projects": [],
    })
    _save_hosting_accounts(accounts)
    return _j({"success": True, "id": aid, "name": name, "email": email, "username": username})


def cloud_overview(data=None):
    """Global cloud overview: all projects' sync status."""
    projects = db.get_projects()
    projects = [p for p in projects if p.get("path")]

    github_token = db.get_setting("github_token", "")
    r2_account = db.get_setting("r2_account_id", "")

    overview = []
    for p in projects:
        last_push = db.get_last_sync(p["id"], "github", "push")
        last_backup = db.get_last_sync(p["id"], "r2", "backup")
        r2_stats = db.get_r2_storage_stats(p["id"])
        rules_count = len(db.get_asset_rules(p["id"]))

        # Quick git status
        git_clean = None
        pending = 0
        if p.get("path") and (Path(p["path"]) / ".git").exists():
            status = github_ops.git_status_detailed(p["path"])
            if status:
                git_clean = status["is_clean"]
                pending = status["modified"] + status["untracked"] + status["staged"]

        overview.append({
            "id": p["id"],
            "name": p["name"],
            "color": p.get("color", "#8b5cf6"),
            "status": p.get("status", "active"),
            "git_remote": p.get("git_remote", ""),
            "git_clean": git_clean,
            "pending_changes": pending,
            "last_push": last_push["started_at"] if last_push else None,
            "last_backup": last_backup["started_at"] if last_backup else None,
            "r2_objects": r2_stats.get("count", 0) if isinstance(r2_stats, dict) else 0,
            "r2_size": r2_stats.get("total_size", 0) if isinstance(r2_stats, dict) else 0,
            "r2_size_h": _fmt(r2_stats.get("total_size", 0) if isinstance(r2_stats, dict) else 0),
            "rules_count": rules_count,
        })

    return _j({
        "projects": overview,
        "github_connected": bool(github_token),
        "r2_configured": bool(r2_account),
    })


def update_hosting_account(aid, data=None):
    """Update a hosting account — re-verifies token if changed."""
    data = data or {}
    accounts = _get_hosting_accounts()
    for a in accounts:
        if a["id"] == aid:
            new_token = data.get("token", "")
            if new_token and not new_token.startswith("****"):
                # Verify the new token
                info = _verify_hosting_token(a["platform"], new_token)
                if not info.get("valid"):
                    return _j({"success": False, "message": f"Token invalide: {info.get('error', '')}"}), 400
                a["token"] = new_token
                if info.get("email"): a["email"] = info["email"]
                if info.get("username"): a["username"] = info["username"]
                if info.get("name"): a["name"] = info["name"]
            if "name" in data and data["name"]: a["name"] = data["name"]
            _save_hosting_accounts(accounts)
            return _j({"success": True, "email": a.get("email", ""), "name": a.get("name", "")})
    return _j({"success": False, "message": "Compte introuvable"}), 404


def hosting_accounts(data=None):
    """List all hosting accounts (tokens masked)."""
    accounts = _get_hosting_accounts()
    # Mask tokens for API response
    result = []
    for a in accounts:
        masked = {k: v for k, v in a.items() if k != "token"}
        masked["token_set"] = bool(a.get("token"))
        masked["token_preview"] = "****" + a["token"][-4:] if a.get("token") else ""
        result.append(masked)
    return _j(result)


def delete_hosting_account(aid, data=None):
    """Delete a hosting account."""
    accounts = _get_hosting_accounts()
    accounts = [a for a in accounts if a["id"] != aid]
    _save_hosting_accounts(accounts)
    return _j({"success": True})
