"""DevPilot — Cloud integration API routes (Flask Blueprint)."""

import os
import re
import json
from pathlib import Path
from flask import Blueprint, jsonify, request

import db
import github_ops
import cloudflare_r2
import cloud_sync
import hosting
import projects as P
import cloud_ops
from cloud_ops import _fmt, DB_LABELS, _PLATFORM_ALIASES, _NOT_A_PLATFORM, _norm_platform, _parse_cfg, _get_hosting_accounts, _save_hosting_accounts, _verify_hosting_token

cloud_bp = Blueprint("cloud", __name__)
HOME = Path.home()
DEVPILOT_PROJECTS = HOME / "devpilot" / "projects"




# ═══════════════════════════════════════════════════════════════════════════
# GITHUB API ROUTES
# ═══════════════════════════════════════════════════════════════════════════

@cloud_bp.route("/api/github/test")
def api_github_test():
    token = db.get_setting("github_token", "")
    if not token:
        return jsonify({"connected": False, "message": "Pas de token configure"})
    return jsonify(github_ops.github_test_connection(token))


@cloud_bp.route("/api/github/repos")
def api_github_repos():
    token = db.get_setting("github_token", "")
    if not token:
        return jsonify([])
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 50, type=int)
    sort = request.args.get("sort", "updated")
    visibility = request.args.get("visibility")
    return jsonify(github_ops.github_list_repos(token, page, per_page, sort, visibility))


@cloud_bp.route("/api/github/repos", methods=["POST"])
def api_github_create_repo():
    token = db.get_setting("github_token", "")
    if not token:
        return jsonify({"success": False, "message": "Pas de token GitHub"})
    data = request.json
    result = github_ops.github_create_repo(
        token,
        name=data.get("name", ""),
        private=data.get("private", True),
        description=data.get("description", ""),
    )
    return jsonify(result)


@cloud_bp.route("/api/github/repos/<owner>/<repo>/branches")
def api_github_branches(owner, repo):
    token = db.get_setting("github_token", "")
    if not token:
        return jsonify([])
    return jsonify(github_ops.github_list_branches(token, owner, repo))


@cloud_bp.route("/api/github/repos/<owner>/<repo>/commits")
def api_github_commits(owner, repo):
    token = db.get_setting("github_token", "")
    if not token:
        return jsonify([])
    branch = request.args.get("branch", "main")
    limit = request.args.get("limit", 20, type=int)
    return jsonify(github_ops.github_list_commits(token, owner, repo, branch, limit))


# ═══════════════════════════════════════════════════════════════════════════
# GIT OPERATIONS (per project)
# ═══════════════════════════════════════════════════════════════════════════

def _get_project_path(pid):
    """Get project path or return error response."""
    project = db.get_project(pid)
    if not project:
        return None, jsonify({"success": False, "message": "Projet introuvable"}), 404
    ppath = project.get("path", "")
    if not ppath or not os.path.isdir(ppath):
        return None, jsonify({"success": False, "message": "Dossier projet introuvable"}), 404
    return ppath, None, None


@cloud_bp.route("/api/projects/<int:pid>/git/status")
def api_git_status(pid):
    ppath, err, code = _get_project_path(pid)
    if err:
        return err, code
    status = github_ops.git_status_detailed(ppath)
    if not status:
        return jsonify({"error": "Pas un depot Git"})
    return jsonify(status)


@cloud_bp.route("/api/projects/<int:pid>/git/pull", methods=["POST"])
def api_git_pull(pid):
    ppath, err, code = _get_project_path(pid)
    if err:
        return err, code
    remote = (request.json or {}).get("remote", "origin")
    branch = (request.json or {}).get("branch", "")
    ok, output = github_ops.git_pull(ppath, remote, branch)
    if ok:
        db.log_event("synced", "github", db.get_project(pid)["name"], ppath, 0, pid, details="Git pull")
        db.update_project_activity(pid)
    return jsonify({"success": ok, "output": output})


@cloud_bp.route("/api/projects/<int:pid>/git/push", methods=["POST"])
def api_git_push(pid):
    ppath, err, code = _get_project_path(pid)
    if err:
        return err, code
    data = request.json or {}
    remote = data.get("remote", "origin")
    branch = data.get("branch", "")
    set_upstream = data.get("set_upstream", False)
    ok, output = github_ops.git_push(ppath, remote, branch, set_upstream)
    if ok:
        db.log_sync(pid, "push", "github", "source", status="success", details=output)
        db.log_event("synced", "github", db.get_project(pid)["name"], ppath, 0, pid, details="Git push")
        db.update_project_activity(pid)
    return jsonify({"success": ok, "output": output})


@cloud_bp.route("/api/projects/<int:pid>/git/commit", methods=["POST"])
def api_git_commit(pid):
    ppath, err, code = _get_project_path(pid)
    if err:
        return err, code
    data = request.json or {}
    message = data.get("message", "").strip()
    if not message:
        return jsonify({"success": False, "message": "Message de commit requis"})
    add_all = data.get("add_all", False)
    files = data.get("files")
    ok, output = github_ops.git_commit(ppath, message, add_all, files)
    if ok:
        db.log_event("committed", "github", db.get_project(pid)["name"], ppath, 0, pid, details=message)
        db.update_project_activity(pid)
    return jsonify({"success": ok, "output": output})


@cloud_bp.route("/api/projects/<int:pid>/git/checkout", methods=["POST"])
def api_git_checkout(pid):
    ppath, err, code = _get_project_path(pid)
    if err:
        return err, code
    data = request.json or {}
    branch = data.get("branch", "").strip()
    if not branch:
        return jsonify({"success": False, "message": "Nom de branche requis"})
    create = data.get("create", False)
    ok, output = github_ops.git_checkout(ppath, branch, create)
    return jsonify({"success": ok, "output": output})


@cloud_bp.route("/api/projects/<int:pid>/git/log")
def api_git_log(pid):
    ppath, err, code = _get_project_path(pid)
    if err:
        return err, code
    limit = request.args.get("limit", 20, type=int)
    return jsonify(github_ops.git_log(ppath, limit))


@cloud_bp.route("/api/projects/<int:pid>/git/stash", methods=["POST"])
def api_git_stash(pid):
    ppath, err, code = _get_project_path(pid)
    if err:
        return err, code
    pop = (request.json or {}).get("pop", False)
    ok, output = github_ops.git_stash(ppath, pop)
    return jsonify({"success": ok, "output": output})


# ═══════════════════════════════════════════════════════════════════════════
# CLOUDFLARE R2 ROUTES
# ═══════════════════════════════════════════════════════════════════════════

def _get_r2_client():
    """Get R2 client from stored settings."""
    account_id = db.get_setting("r2_account_id", "")
    access_key = db.get_setting("r2_access_key_id", "")
    secret_key = db.get_setting("r2_secret_access_key", "")
    if not account_id or not access_key or not secret_key:
        return None
    return cloudflare_r2.r2_get_client(account_id, access_key, secret_key)


@cloud_bp.route("/api/r2/test")
def api_r2_test():
    account_id = db.get_setting("r2_account_id", "")
    access_key = db.get_setting("r2_access_key_id", "")
    secret_key = db.get_setting("r2_secret_access_key", "")
    return jsonify(cloudflare_r2.r2_test_connection(account_id, access_key, secret_key))


@cloud_bp.route("/api/r2/buckets")
def api_r2_buckets():
    client = _get_r2_client()
    if not client:
        return jsonify([])
    return jsonify(cloudflare_r2.r2_list_buckets(client))


@cloud_bp.route("/api/r2/buckets", methods=["POST"])
def api_r2_create_bucket():
    client = _get_r2_client()
    if not client:
        return jsonify({"success": False, "message": "R2 non configure"})
    name = (request.json or {}).get("name", "").strip()
    if not name:
        return jsonify({"success": False, "message": "Nom de bucket requis"})
    return jsonify(cloudflare_r2.r2_create_bucket(client, name))


@cloud_bp.route("/api/r2/buckets/<name>/objects")
def api_r2_objects(name):
    client = _get_r2_client()
    if not client:
        return jsonify([])
    prefix = request.args.get("prefix", "")
    max_keys = request.args.get("max_keys", 200, type=int)
    return jsonify(cloudflare_r2.r2_list_objects(client, name, prefix, max_keys))


@cloud_bp.route("/api/r2/upload", methods=["POST"])
def api_r2_upload():
    client = _get_r2_client()
    if not client:
        return jsonify({"success": False, "message": "R2 non configure"})
    data = request.json or {}
    bucket = data.get("bucket", "").strip()
    local_path = data.get("local_path", "").strip()
    remote_key = data.get("remote_key", "").strip()

    if not all([bucket, local_path, remote_key]):
        return jsonify({"success": False, "message": "bucket, local_path et remote_key requis"})

    # Security: only allow uploads from home directory
    if not local_path.startswith(str(HOME)):
        return jsonify({"success": False, "message": "Chemin non autorise"})

    result = cloudflare_r2.r2_upload_file(client, bucket, local_path, remote_key)
    return jsonify(result)


@cloud_bp.route("/api/r2/download", methods=["POST"])
def api_r2_download():
    client = _get_r2_client()
    if not client:
        return jsonify({"success": False, "message": "R2 non configure"})
    data = request.json or {}
    bucket = data.get("bucket", "").strip()
    remote_key = data.get("remote_key", "").strip()
    local_path = data.get("local_path", "").strip()

    if not all([bucket, remote_key, local_path]):
        return jsonify({"success": False, "message": "bucket, remote_key et local_path requis"})

    if not local_path.startswith(str(HOME)):
        return jsonify({"success": False, "message": "Chemin non autorise"})

    result = cloudflare_r2.r2_download_file(client, bucket, remote_key, local_path)
    return jsonify(result)


@cloud_bp.route("/api/r2/objects", methods=["DELETE"])
def api_r2_delete_object():
    client = _get_r2_client()
    if not client:
        return jsonify({"success": False, "message": "R2 non configure"})
    data = request.json or {}
    bucket = data.get("bucket", "").strip()
    key = data.get("key", "").strip()
    if not bucket or not key:
        return jsonify({"success": False, "message": "bucket et key requis"})
    return jsonify(cloudflare_r2.r2_delete_object(client, bucket, key))


@cloud_bp.route("/api/r2/presign")
def api_r2_presign():
    client = _get_r2_client()
    if not client:
        return jsonify({"success": False, "message": "R2 non configure"})
    bucket = request.args.get("bucket", "")
    key = request.args.get("key", "")
    expires = request.args.get("expires", 3600, type=int)
    if not bucket or not key:
        return jsonify({"success": False, "message": "bucket et key requis"})
    return jsonify(cloudflare_r2.r2_get_presigned_url(client, bucket, key, expires))


# ═══════════════════════════════════════════════════════════════════════════
# CLOUD SYNC ROUTES
# ═══════════════════════════════════════════════════════════════════════════

@cloud_bp.route("/api/projects/<int:pid>/cloud/summary")
def api_cloud_summary(pid):
    return jsonify(cloud_sync.get_project_cloud_summary(pid))


@cloud_bp.route("/api/projects/<int:pid>/cloud/sync-status")
def api_cloud_sync_status(pid):
    return jsonify(cloud_sync.get_sync_status(pid))


@cloud_bp.route("/api/projects/<int:pid>/cloud/sync", methods=["POST"])
def api_cloud_sync(pid):
    data = request.json or {}
    backend = data.get("backend", "github")
    message = data.get("message", "")

    if backend == "github":
        return jsonify(cloud_sync.sync_project_to_github(pid, message=message, add_all=data.get("add_all", True)))
    elif backend == "r2":
        asset_type = data.get("asset_type")
        return jsonify(cloud_sync.sync_project_to_r2(pid, asset_type=asset_type))
    else:
        return jsonify({"success": False, "message": f"Backend inconnu: {backend}"})


@cloud_bp.route("/api/projects/<int:pid>/cloud/backup", methods=["POST"])
def api_cloud_backup(pid):
    data = request.json or {}
    asset_type = data.get("asset_type")
    return jsonify(cloud_sync.sync_project_to_r2(pid, asset_type=asset_type))


@cloud_bp.route("/api/projects/<int:pid>/cloud/restore", methods=["POST"])
def api_cloud_restore(pid):
    data = request.json or {}
    asset_type = data.get("asset_type")
    return jsonify(cloud_sync.restore_from_r2(pid, asset_type=asset_type))


@cloud_bp.route("/api/projects/<int:pid>/cloud/history")
def api_cloud_history(pid):
    limit = request.args.get("limit", 50, type=int)
    return jsonify(db.get_sync_history(pid, limit))


@cloud_bp.route("/api/cloud/history")
def api_cloud_history_global():
    """Global sync history across all projects."""
    limit = request.args.get("limit", 50, type=int)
    return jsonify(db.get_sync_history(limit=limit))


@cloud_bp.route("/api/cloud/overview")
def api_cloud_overview():
    return _reply(cloud_ops.cloud_overview(data=request.get_json(silent=True)))


# ═══════════════════════════════════════════════════════════════════════════
# ASSET RULES ROUTES
# ═══════════════════════════════════════════════════════════════════════════

@cloud_bp.route("/api/projects/<int:pid>/assets/rules")
def api_asset_rules(pid):
    return jsonify(db.get_asset_rules(pid))


@cloud_bp.route("/api/projects/<int:pid>/assets/rules", methods=["POST"])
def api_add_asset_rule(pid):
    data = request.json or {}
    required = ["asset_type", "storage_backend", "glob_pattern"]
    if not all(data.get(k) for k in required):
        return jsonify({"success": False, "message": "asset_type, storage_backend et glob_pattern requis"})
    try:
        rid = db.add_asset_rule(
            project_id=pid,
            asset_type=data["asset_type"],
            storage_backend=data["storage_backend"],
            glob_pattern=data["glob_pattern"],
            r2_bucket=data.get("r2_bucket", ""),
            r2_prefix=data.get("r2_prefix", ""),
            is_public=data.get("is_public", False),
            auto_sync=data.get("auto_sync", False),
        )
        return jsonify({"success": True, "id": rid})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


@cloud_bp.route("/api/projects/<int:pid>/assets/rules/<int:rid>", methods=["PUT"])
def api_update_asset_rule(pid, rid):
    data = request.json or {}
    db.update_asset_rule(rid, **data)
    return jsonify({"success": True})


@cloud_bp.route("/api/projects/<int:pid>/assets/rules/<int:rid>", methods=["DELETE"])
def api_delete_asset_rule(pid, rid):
    db.delete_asset_rule(rid)
    return jsonify({"success": True})


@cloud_bp.route("/api/projects/<int:pid>/assets/scan")
def api_scan_assets(pid):
    return jsonify(cloud_sync.scan_project_assets(pid))


@cloud_bp.route("/api/projects/<int:pid>/assets/apply-defaults", methods=["POST"])
def api_apply_default_rules(pid):
    r2_bucket = (request.json or {}).get("r2_bucket", db.get_setting("r2_default_bucket", ""))
    # Filter rules by active components if any are configured
    active = [c["component"] for c in db.get_project_components(pid) if c["enabled"]]
    applied = cloud_sync.apply_default_rules(pid, r2_bucket, components=active if active else None)
    return jsonify({"success": True, "applied": applied, "message": f"{applied} regles appliquees"})


# ═══════════════════════════════════════════════════════════════════════════
# CONNECTIONS — unified view of all linked services
# ═══════════════════════════════════════════════════════════════════════════

CONNECTION_TYPES = {
    "github":     {"label": "GitHub",         "icon": "branch",   "color": "#8b5cf6"},
    "source":     {"label": "Code source",    "icon": "folder",   "color": "#62627a"},
    "storage":    {"label": "Cloudflare R2",  "icon": "cloud",    "color": "#38bdf8"},
    "database":   {"label": "Base de données","icon": "database",  "color": "#22d3a7"},
    "deploy":     {"label": "Déploiement",    "icon": "rocket",   "color": "#f59e0b"},
    "domain":     {"label": "Domaine",        "icon": "globe",    "color": "#60a5fa"},
    "server":     {"label": "Serveur",        "icon": "server",   "color": "#fbbf24"},
    "backup":     {"label": "Backup",         "icon": "shield",   "color": "#22d3a7"},
    "auth":       {"label": "Auth",           "icon": "lock",     "color": "#a78bfa"},
    "monitoring": {"label": "Monitoring",     "icon": "activity",  "color": "#f43f5e"},
    "docker":     {"label": "Docker",         "icon": "container", "color": "#38bdf8"},
    "ci_cd":      {"label": "CI/CD",          "icon": "refresh",   "color": "#f59e0b"},
    "email":      {"label": "Email",          "icon": "mail",      "color": "#60a5fa"},
}


CONNECTION_FIELDS = {
    "github": [
        {"key": "url", "label": "URL du repo", "placeholder": "https://github.com/user/repo", "required": True},
    ],
    "deploy": [
        {"key": "platform", "label": "Plateforme", "placeholder": "vercel, netlify, railway, cloudflare"},
        {"key": "site_url", "label": "URL du site", "placeholder": "https://mon-site.vercel.app"},
        {"key": "project_url", "label": "URL dashboard", "placeholder": "https://vercel.com/user/projet"},
        {"key": "deploy_hook", "label": "Deploy hook (webhook)", "placeholder": "https://api.vercel.com/v1/...", "sensitive": True},
        {"key": "domain", "label": "Domaine", "placeholder": "example.com"},
        {"key": "dns", "label": "Provider DNS", "placeholder": "cloudflare, namecheap, ovh"},
        {"key": "ssl", "label": "SSL", "placeholder": "letsencrypt, cloudflare"},
    ],
    "database": [
        {"key": "provider", "label": "Provider", "placeholder": "supabase, neon, planetscale, local"},
        {"key": "host", "label": "Host", "placeholder": "db.xyz.supabase.co"},
        {"key": "port", "label": "Port", "placeholder": "5432"},
        {"key": "name", "label": "Nom de la BDD", "placeholder": "postgres"},
        {"key": "user", "label": "Utilisateur", "placeholder": "postgres"},
        {"key": "connection_string", "label": "Connection string", "placeholder": "postgresql://user:pass@host:5432/db", "sensitive": True},
        {"key": "dashboard_url", "label": "URL dashboard", "placeholder": "https://supabase.com/dashboard/project/xyz"},
    ],
    "storage": [
        {"key": "bucket", "label": "Nom du bucket", "placeholder": "mon-projet-uploads"},
        {"key": "dashboard_url", "label": "URL dashboard", "placeholder": "https://dash.cloudflare.com/..."},
    ],
    "domain": [
        {"key": "domain", "label": "Domaine", "placeholder": "example.com", "required": True},
        {"key": "registrar", "label": "Registrar", "placeholder": "cloudflare, namecheap, ovh"},
        {"key": "dashboard_url", "label": "URL dashboard", "placeholder": "https://dash.cloudflare.com/..."},
    ],
    "server": [
        {"key": "ip", "label": "Adresse IP", "placeholder": "12.34.56.78"},
        {"key": "provider", "label": "Provider", "placeholder": "ovh, digitalocean, hetzner"},
        {"key": "ssh_user", "label": "Utilisateur SSH", "placeholder": "root"},
        {"key": "dashboard_url", "label": "URL dashboard", "placeholder": "https://cloud.digitalocean.com/..."},
    ],
    "backup": [
        {"key": "destination", "label": "Destination", "placeholder": "r2, s3, local"},
        {"key": "bucket", "label": "Bucket", "placeholder": "mon-projet-backups"},
        {"key": "frequency", "label": "Frequence", "placeholder": "daily, weekly, manual"},
    ],
    "email": [
        {"key": "provider", "label": "Provider", "placeholder": "google, zoho, ovh, infomaniak, protonmail"},
        {"key": "addresses", "label": "Adresses email", "placeholder": "contact@, info@, admin@"},
        {"key": "dashboard_url", "label": "URL dashboard", "placeholder": "https://admin.google.com/..."},
        {"key": "webmail_url", "label": "URL webmail", "placeholder": "https://mail.google.com/..."},
    ],
}

SENSITIVE_KEYS = {"connection_string", "deploy_hook", "access_key_id", "secret_access_key", "account_id"}


def _mask_config(cfg):
    """Return config with sensitive values masked for API response."""
    masked = {}
    for k, v in cfg.items():
        if k in SENSITIVE_KEYS and v and v != "****":
            masked[k] = "****" + str(v)[-4:] if len(str(v)) > 8 else "****"
        else:
            masked[k] = v
    return masked


# The hosting platforms DevPilot knows. The keys stay lowercase: the DNS
# records (dnscheck.EXPECTED_FOR_PLATFORM), the dashboards (host_urls /
# token_urls) and the UI are all keyed on them. The aliases cover what the
# hand-typed "Plateforme" field used to accept.
PLATFORMS = ("vercel", "netlify", "railway", "render", "cloudflare", "fly")
# a VPS is a server (its own card, over SSH), not a deployment platform






@cloud_bp.route("/api/projects/<int:pid>/connections")
def api_get_connections(pid):
    return _reply(cloud_ops.get_connections(pid, data=request.get_json(silent=True)))


@cloud_bp.route("/api/projects/<int:pid>/connections", methods=["POST"])
def api_update_connection(pid):
    return _reply(cloud_ops.update_connection(pid, data=request.get_json(silent=True)))


# ═══════════════════════════════════════════════════════════════════════════
# HOSTING ACCOUNTS — manage multiple Vercel/Netlify/etc. accounts
# ═══════════════════════════════════════════════════════════════════════════





@cloud_bp.route("/api/hosting/accounts")
def api_hosting_accounts():
    return _reply(cloud_ops.hosting_accounts(data=request.get_json(silent=True)))




@cloud_bp.route("/api/hosting/accounts", methods=["POST"])
def api_add_hosting_account():
    return _reply(cloud_ops.add_hosting_account(data=request.get_json(silent=True)))


@cloud_bp.route("/api/hosting/accounts/<aid>", methods=["PUT"])
def api_update_hosting_account(aid):
    return _reply(cloud_ops.update_hosting_account(aid, data=request.get_json(silent=True)))


@cloud_bp.route("/api/hosting/accounts/<aid>", methods=["DELETE"])
def api_delete_hosting_account(aid):
    return _reply(cloud_ops.delete_hosting_account(aid, data=request.get_json(silent=True)))


@cloud_bp.route("/api/server/test", methods=["POST"])
def api_test_ssh():
    return _reply(cloud_ops.test_ssh(data=request.get_json(silent=True)))


@cloud_bp.route("/api/server/keys")
def api_list_ssh_keys():
    """List available SSH keys."""
    keys = []
    ssh_dir = os.path.expanduser("~/.ssh")
    if os.path.isdir(ssh_dir):
        for f in sorted(os.listdir(ssh_dir)):
            path = os.path.join(ssh_dir, f)
            if os.path.isfile(path) and not f.endswith(".pub") and not f.startswith("known") and not f == "config" and not f == "authorized_keys":
                keys.append({"name": f, "path": path})
    return jsonify(keys)


@cloud_bp.route("/api/projects/<int:pid>/hosting", methods=["POST"])
def api_link_hosting(pid):
    """Link a project to a hosting account."""
    data = request.json or {}
    try:
        res = hosting.link_project(pid, data.get("account_id", ""), data.get("site_url", ""),
                                   data.get("project_url", ""))
    except P.ProjectError as e:
        return jsonify({"success": False, "message": e.message}), 404

    # Regenerate CLAUDE.md
    project = db.get_project(pid)
    ppath = project.get("path", "")
    if ppath and os.path.isdir(ppath):
        from dashboard import _write_claude_md
        _write_claude_md(ppath, project, db.get_project_specs(pid))

    return jsonify({"success": True, **res})


def _reply(res):
    """An answer of a logic function → HTTP: data, or (data, status)."""
    if isinstance(res, tuple) and len(res) == 2 and isinstance(res[1], int):
        return jsonify(res[0]), res[1]
    return jsonify(res)
