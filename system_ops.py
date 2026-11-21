"""DevPilot — this PC and its projects: system, disk, caches, Docker, ports, processes, cleanup.

Moved out of dashboard.py: the routes only translate HTTP to these functions, and the agent's
tools call them too. A function returns its answer (a dict or a list), or (answer, http_status).
"""

import os
import subprocess
import shutil
import json
import re
import time
import psutil
from pathlib import Path
from datetime import datetime, timedelta
import pty
import select
import struct
import fcntl
import termios
import threading
import signal
import db
import components as comp
import projects as P
import servers
import dev as dev_mod
import persist
import ports as ports_mod
import sizes
import model as M
import phases as PH
import atexit



def _j(*a, **k):
    """What jsonify() received, as plain data."""
    return a[0] if a else k


HOME = Path.home()


def run(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


def fast_size(path):
    """Display only: cached size (background du), 0 until the first computation ends."""
    v = sizes.size(path)
    return v if v is not None else 0


def dir_size(path):
    total = 0
    try:
        for entry in os.scandir(path):
            try:
                if entry.is_symlink():
                    continue
                if entry.is_file(follow_symlinks=False):
                    total += entry.stat(follow_symlinks=False).st_size
                elif entry.is_dir(follow_symlinks=False):
                    total += dir_size(entry.path)
            except (PermissionError, OSError):
                pass
    except (PermissionError, OSError):
        pass
    return total


def fmt(b):
    for u in ["B", "KB", "MB", "GB", "TB"]:
        if abs(b) < 1024:
            return f"{b:.1f} {u}"
        b /= 1024
    return f"{b:.1f} PB"


BUILD_CACHES = {
    "node_modules":       {"label": "Node modules",     "tech": "node",    "safe": True,  "heavy": True},
    ".next":              {"label": "Next.js build",     "tech": "nextjs",  "safe": True,  "heavy": False},
    ".nuxt":              {"label": "Nuxt build",        "tech": "nuxt",    "safe": True,  "heavy": False},
    ".angular":           {"label": "Angular cache",     "tech": "angular", "safe": True,  "heavy": False},
    ".vite":              {"label": "Vite cache",        "tech": "vite",    "safe": True,  "heavy": False},
    ".turbo":             {"label": "Turbo cache",       "tech": "turbo",   "safe": True,  "heavy": False},
    ".parcel-cache":      {"label": "Parcel cache",      "tech": "parcel",  "safe": True,  "heavy": False},
    ".svelte-kit":        {"label": "SvelteKit",         "tech": "svelte",  "safe": True,  "heavy": False},
    ".dart_tool":         {"label": "Dart tooling",      "tech": "dart",    "safe": True,  "heavy": False},
    "__pycache__":        {"label": "Python cache",      "tech": "python",  "safe": True,  "heavy": False},
    ".pytest_cache":      {"label": "Pytest cache",      "tech": "python",  "safe": True,  "heavy": False},
    ".mypy_cache":        {"label": "Mypy cache",        "tech": "python",  "safe": True,  "heavy": False},
    ".tox":               {"label": "Tox env",           "tech": "python",  "safe": True,  "heavy": True},
    ".gradle":            {"label": "Gradle cache",      "tech": "gradle",  "safe": True,  "heavy": True},
    ".expo":              {"label": "Expo cache",        "tech": "expo",    "safe": True,  "heavy": False},
    ".webpack":           {"label": "Webpack cache",     "tech": "webpack", "safe": True,  "heavy": False},
    "build":              {"label": "Build output",      "tech": "general", "safe": False, "heavy": False},
    "dist":               {"label": "Dist output",       "tech": "general", "safe": False, "heavy": False},
    "target":             {"label": "Rust/Maven target", "tech": "rust",    "safe": False, "heavy": True},
}


BROWSER_CACHES = {
    "google-chrome": {
        "label": "Google Chrome",
        "paths": [
            ("Cache", ".cache/google-chrome/Default/Cache"),
            ("Code Cache", ".cache/google-chrome/Default/Code Cache"),
            ("Service Worker", ".cache/google-chrome/Default/Service Worker"),
            ("GPU Cache", ".cache/google-chrome/ShaderCache"),
        ],
        "full": ".cache/google-chrome",
    },
    "chromium": {
        "label": "Chromium",
        "paths": [("Cache", ".cache/chromium/Default/Cache"), ("Code Cache", ".cache/chromium/Default/Code Cache")],
        "full": ".cache/chromium",
    },
    "firefox": {
        "label": "Firefox",
        "paths": [],
        "full": ".cache/mozilla/firefox",
    },
    "brave": {
        "label": "Brave",
        "paths": [("Cache", ".cache/BraveSoftware/Brave-Browser/Default/Cache")],
        "full": ".cache/BraveSoftware",
    },
}


GLOBAL_CACHES = [
    {"key": "npm",      "label": "npm",              "path": ".npm",             "cmd": "npm cache clean --force"},
    {"key": "pip",      "label": "pip",              "path": ".cache/pip",        "cmd": "pip cache purge"},
    {"key": "yarn",     "label": "Yarn",             "path": ".cache/yarn",       "cmd": "yarn cache clean"},
    {"key": "pnpm",     "label": "pnpm",             "path": ".cache/pnpm",       "cmd": "pnpm store prune"},
    {"key": "gradle",   "label": "Gradle",           "path": ".gradle/caches",    "cmd": None},
    {"key": "pub",      "label": "Pub/Flutter",      "path": ".pub-cache",        "cmd": None},
    {"key": "go",       "label": "Go build",         "path": ".cache/go-build",   "cmd": "go clean -cache"},
    {"key": "maven",    "label": "Maven",            "path": ".m2/repository",    "cmd": None},
    {"key": "cargo",    "label": "Cargo/Rust",       "path": ".cargo/registry",   "cmd": None},
    {"key": "composer", "label": "Composer",         "path": ".cache/composer",   "cmd": "composer clear-cache"},
]


def _docker_rm(kind, name):
    """Remove a docker container/image/volume by name — argument list, no shell."""
    if not name or name.startswith("-"):
        raise ValueError(f"nom invalide : {name!r}")
    cmd = {"container": ["docker", "rm", "-f", name], "image": ["docker", "rmi", "-f", name],
           "volume": ["docker", "volume", "rm", "-f", name]}[kind]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:200])


def _trash_resource_file(path, project):
    """A tracked file (download, asset...) of this project → trash. Only paths
    DevPilot knows about: inside the project folder or recorded as its resource."""
    p = P.resolve(path)
    inside = project.get("path") and p != P.resolve(project["path"]) and p.is_relative_to(P.resolve(project["path"]))
    res = db.get_resource_by_path(path)
    if not inside and not (res and res.get("project_id") == project["id"]):
        raise P.ProjectError(f"{path} n'appartient pas a ce projet")
    if p == P.HOME or not p.is_relative_to(P.HOME):
        raise P.ProjectError(f"{path} : refuse")
    size = p.stat().st_size if p.is_file() else fast_size(str(p))
    P.move_to_trash(p)
    return size


def _get_git_info(project_path):
    """Get git status for a project directory."""
    if not project_path or not Path(project_path).exists():
        return None
    git_dir = Path(project_path) / ".git"
    if not git_dir.exists():
        return None

    branch = run(f"git -C '{project_path}' branch --show-current 2>/dev/null")
    last_commit = run(f"git -C '{project_path}' log -1 --format='%cr' 2>/dev/null")
    status_raw = run(f"git -C '{project_path}' status --porcelain 2>/dev/null")

    untracked = 0
    modified = 0
    staged = 0
    for line in status_raw.splitlines():
        if line.startswith("??"):
            untracked += 1
        elif line[0] in ("M", "A", "D", "R"):
            staged += 1
        elif line[1] in ("M", "D"):
            modified += 1

    remote = run(f"git -C '{project_path}' remote get-url origin 2>/dev/null")
    is_clean = (untracked == 0 and modified == 0 and staged == 0)

    return {
        "branch": branch or "—",
        "last_commit": last_commit or "—",
        "untracked": untracked,
        "modified": modified,
        "staged": staged,
        "is_clean": is_clean,
        "remote": remote or "",
    }


def _get_project_caches(project_path):
    """Scan a project dir for build caches."""
    if not project_path or not Path(project_path).exists():
        return []
    caches = []
    for name, info in BUILD_CACHES.items():
        cp = Path(project_path) / name
        if cp.exists() and cp.is_dir() and not cp.is_symlink():
            try:
                s = dir_size(str(cp))
                if s > 1024:
                    caches.append({"name": name, "path": str(cp), "size": s, "size_h": fmt(s), **info})
            except (PermissionError, OSError):
                pass
    # node_modules/.cache
    nmc = Path(project_path) / "node_modules" / ".cache"
    if nmc.exists():
        try:
            s = dir_size(str(nmc))
            if s > 1024:
                caches.append({"name": "node_modules/.cache", "path": str(nmc), "size": s,
                               "size_h": fmt(s), "label": "Build cache", "tech": "node", "safe": True, "heavy": False})
        except (PermissionError, OSError):
            pass
    caches.sort(key=lambda x: x["size"], reverse=True)
    return caches


TECH_COLORS = {
    "package.json": "#fbbf24", "pubspec.yaml": "#38bdf8", "requirements.txt": "#34d399",
    "pyproject.toml": "#34d399", "build.gradle": "#06b6d4", "Cargo.toml": "#fb923c",
    "go.mod": "#60a5fa", "composer.json": "#8b5cf6", "pom.xml": "#ef4444",
    "setup.py": "#34d399", "Gemfile": "#fb7185",
}


def clean(data=None):
    action = data.get("action", "")
    result = {"success": False, "message": ""}

    # ── Trash ──
    if action == "trash":
        trash = HOME / ".local" / "share" / "Trash"
        before = dir_size(str(trash)) if trash.exists() else 0
        if trash.exists():
            # Try normal rm first, then sudo for root-owned files (Docker volumes etc.)
            for sub in ["files", "info", "expunged"]:
                p = trash / sub
                if p.exists():
                    run(f"rm -rf '{p}' 2>/dev/null", timeout=30)
                    if p.exists():
                        run(f"sudo rm -rf '{p}' 2>/dev/null", timeout=60)
            for item in trash.iterdir():
                run(f"rm -rf '{item}' 2>/dev/null", timeout=30)
                if item.exists():
                    run(f"sudo rm -rf '{item}' 2>/dev/null", timeout=30)
            (trash / "files").mkdir(exist_ok=True)
            (trash / "info").mkdir(exist_ok=True)
        run("gio trash --empty 2>/dev/null", timeout=30)
        after = dir_size(str(trash)) if trash.exists() else 0
        freed = before - after
        msg = f"{fmt(freed)} liberes"
        if after > 1024 * 1024:
            msg += f" ({fmt(after)} restent — fichiers root, lancer: sudo rm -rf ~/.local/share/Trash/expunged)"
        db.log_event("cleaned", "trash", "Corbeille", "", freed)
        result = {"success": True, "message": msg}

    # ── Expired ──
    elif action == "clean_expired":
        expired = db.get_expired_resources()
        n = 0
        for r in expired:
            if r.get("path") and os.path.exists(r["path"]):
                try:
                    p = Path(r["path"])
                    shutil.rmtree(str(p)) if p.is_dir() else p.unlink()
                    n += 1
                except Exception:
                    pass
            db.update_resource(r["id"], status="deleted")
        result = {"success": True, "message": f"{n} fichiers expires supprimes"}

    # ── Docker ──
    elif action == "docker_containers":
        out = run("docker container prune -f", timeout=60)
        db.log_event("cleaned", "docker", "Containers prune", "", 0)
        result = {"success": True, "message": out or "Containers nettoyes"}

    elif action == "docker_dangling":
        out = run("docker image prune -f", timeout=60)
        db.log_event("cleaned", "docker", "Images prune", "", 0)
        result = {"success": True, "message": out or "Images nettoyees"}

    elif action == "docker_volumes":
        out = run("docker volume prune -f", timeout=60)
        db.log_event("cleaned", "docker", "Volumes prune", "", 0)
        result = {"success": True, "message": out or "Volumes nettoyes"}

    elif action == "docker_cache":
        out = run("docker builder prune -a -f", timeout=120)
        db.log_event("cleaned", "docker", "Build cache", "", 0)
        result = {"success": True, "message": out or "Build cache nettoye"}

    elif action == "docker_all":
        out = run("docker system prune -a --volumes -f", timeout=180)
        db.log_event("cleaned", "docker", "System prune all", "", 0)
        result = {"success": True, "message": out or "Docker nettoye completement"}

    elif action == "docker_rm":
        kind = data.get("kind", "")
        name = data.get("name", "")
        cmds = {"container": f"docker rm -f {name}", "image": f"docker rmi -f {name}",
                "volume": f"docker volume rm -f {name}"}
        if kind in cmds and name:
            out = run(cmds[kind], timeout=30)
            res = db.get_resource_by_path(f"docker:{kind}:{name}")
            if res:
                db.update_resource(res["id"], status="deleted")
            db.log_event("deleted", f"docker_{kind}", name, "", 0)
            result = {"success": True, "message": out or f"{kind} {name} supprime"}

    # ── Caches ──
    elif action == "pip_cache":
        run("pip cache purge", timeout=30)
        result = {"success": True, "message": "Cache pip nettoye"}

    elif action == "clear_browser":
        key = data.get("browser", "")
        if key in BROWSER_CACHES:
            info = BROWSER_CACHES[key]
            freed = 0
            for lbl, rp in info["paths"]:
                p = HOME / rp
                if p.exists():
                    try:
                        freed += dir_size(str(p))
                        shutil.rmtree(str(p), ignore_errors=True)
                    except (PermissionError, OSError):
                        pass
            if key == "firefox":
                ff = HOME / ".mozilla" / "firefox"
                if ff.exists():
                    for profile in ff.iterdir():
                        if profile.is_dir() and not profile.is_symlink():
                            for cn in ("cache2", "shader-cache", "startupCache"):
                                cp = profile / cn
                                if cp.exists():
                                    try:
                                        freed += dir_size(str(cp))
                                        shutil.rmtree(str(cp), ignore_errors=True)
                                    except (PermissionError, OSError):
                                        pass
            db.log_event("cleaned", "browser_cache", info["label"], "", freed)
            result = {"success": True, "message": f"{info['label']}: {fmt(freed)} liberes"}

    elif action == "clear_project_cache":
        path = data.get("path", "")
        if path and os.path.isdir(path) and str(HOME) in path:
            s = dir_size(path)
            shutil.rmtree(path, ignore_errors=True)
            db.log_event("cleaned", "cache", Path(path).name, path, s)
            result = {"success": True, "message": f"{Path(path).name}: {fmt(s)} liberes"}

    elif action == "clear_project_all":
        pdir = data.get("dir", "")
        if pdir and os.path.isdir(pdir):
            freed, n = 0, 0
            for cn, ci in BUILD_CACHES.items():
                cp = Path(pdir) / cn
                if cp.exists() and cp.is_dir() and ci["safe"]:
                    try:
                        freed += dir_size(str(cp))
                        shutil.rmtree(str(cp), ignore_errors=True)
                        n += 1
                    except (PermissionError, OSError):
                        pass
            nmc = Path(pdir) / "node_modules" / ".cache"
            if nmc.exists():
                try:
                    freed += dir_size(str(nmc))
                    shutil.rmtree(str(nmc), ignore_errors=True)
                    n += 1
                except (PermissionError, OSError):
                    pass
            db.log_event("cleaned", "cache", Path(pdir).name, pdir, freed)
            result = {"success": True, "message": f"{n} caches: {fmt(freed)} liberes"}

    elif action == "clear_all_pycache":
        scan = db.get_setting("scan_dirs", "~/Desktop")
        n, freed = 0, 0
        for d in scan.split(","):
            base = Path(os.path.expanduser(d.strip()))
            if not base.exists():
                continue
            for root, dirs, _ in os.walk(str(base)):
                for dn in dirs:
                    if dn == "__pycache__":
                        p = Path(root) / dn
                        try:
                            freed += dir_size(str(p))
                            shutil.rmtree(str(p), ignore_errors=True)
                            n += 1
                        except (PermissionError, OSError):
                            pass
        db.log_event("cleaned", "cache", f"__pycache__ x{n}", "", freed)
        result = {"success": True, "message": f"{n} __pycache__: {fmt(freed)} liberes"}

    elif action == "clear_global":
        key = data.get("key", "")
        found = next((g for g in GLOBAL_CACHES if g["key"] == key), None)
        if not found:
            result = {"success": False, "message": "Cache inconnu"}
        elif found.get("cmd"):
            run(found["cmd"], timeout=60)
            result = {"success": True, "message": f"{found['label']} nettoye"}
        else:
            p = HOME / found["path"]
            if p.exists():
                s = dir_size(str(p))
                shutil.rmtree(str(p), ignore_errors=True)
                result = {"success": True, "message": f"{found['label']}: {fmt(s)} liberes"}

    elif action == "delete_cache_dir":
        name = data.get("name", "")
        p = HOME / ".cache" / name
        if name and p.exists() and p.is_dir():
            s = dir_size(str(p))
            shutil.rmtree(str(p), ignore_errors=True)
            result = {"success": True, "message": f"{name}: {fmt(s)} liberes"}

    elif action == "delete_file":
        path = data.get("path", "")
        if path and path.startswith(str(HOME)):
            p = Path(path)
            try:
                s = p.stat().st_size if p.is_file() else dir_size(str(p))
                shutil.rmtree(str(p)) if p.is_dir() else p.unlink()
                res = db.get_resource_by_path(path)
                if res:
                    db.update_resource(res["id"], status="deleted")
                db.log_event("deleted", "file", p.name, path, s)
                result = {"success": True, "message": f"{p.name}: {fmt(s)} liberes"}
            except Exception as e:
                result = {"success": False, "message": str(e)}

    elif action == "kill_process":
        pid = data.get("pid", 0)
        if pid:
            try:
                psutil.Process(pid).terminate()
                result = {"success": True, "message": f"Process {pid} termine"}
            except Exception as e:
                result = {"success": False, "message": str(e)}

    elif action.startswith("nav:"):
        result = {"success": True, "message": "", "navigate": action[4:]}

    else:
        result = {"success": False, "message": f"Action inconnue: {action}"}

    return _j(result)


def scan_detect(data=None):
    """Scan project dirs and return detected projects not yet in DB."""
    scan_dirs = db.get_setting("scan_dirs", "~/Desktop")
    manifests = ["package.json", "pubspec.yaml", "requirements.txt", "setup.py",
                 "pyproject.toml", "build.gradle", "Cargo.toml", "go.mod",
                 "composer.json", "pom.xml", "Gemfile"]
    existing = {p["name"].lower() for p in db.get_projects()}
    # Also match by path
    existing_paths = {p.get("path", "") for p in db.get_projects() if p.get("path")}

    # Directories to ignore (library internals, build outputs, virtual envs)
    skip_parents = {"node_modules", ".git", "vendor", "venv", ".venv", "env",
                    "site-packages", "__pycache__", ".tox", ".eggs", "dist",
                    ".next", "build", ".dart_tool", ".gradle", "target"}

    detected = []
    seen = set()

    for d in scan_dirs.split(","):
        base = Path(os.path.expanduser(d.strip()))
        if not base.exists():
            continue
        for mf in manifests:
            try:
                for f in base.rglob(mf):
                    # Skip if inside any blacklisted parent dir
                    parts = set(f.relative_to(base).parts)
                    if parts & skip_parents:
                        continue
                    pdir = f.parent
                    pdir_str = str(pdir)
                    if pdir_str in seen:
                        continue
                    seen.add(pdir_str)
                    name = pdir.name
                    # Skip if already exists
                    if name.lower() in existing or pdir_str in existing_paths:
                        continue
                    # Must have a .git dir or be a direct child of scan dir (real project)
                    has_git = (pdir / ".git").exists()
                    depth = len(f.relative_to(base).parts) - 1  # manifest depth
                    if not has_git and depth > 2:
                        continue  # too deep = probably a sub-dependency

                    cache_size = 0
                    for cn in BUILD_CACHES:
                        cp = pdir / cn
                        if cp.exists() and cp.is_dir():
                            try:
                                cache_size += fast_size(str(cp))
                            except (PermissionError, OSError):
                                pass

                    detected.append({
                        "name": name,
                        "path": pdir_str,
                        "manifest": mf,
                        "color": TECH_COLORS.get(mf, "#8b5cf6"),
                        "cache_size": cache_size,
                        "cache_size_h": fmt(cache_size),
                        "has_git": has_git,
                        "depth": depth,
                    })
            except (PermissionError, OSError):
                pass

    # Deduplicate by name (keep the one with more caches)
    by_name = {}
    for d in detected:
        if d["name"] not in by_name or d["cache_size"] > by_name[d["name"]]["cache_size"]:
            by_name[d["name"]] = d
    result = sorted(by_name.values(), key=lambda x: x["cache_size"], reverse=True)
    return _j(result)


def project_status(pid, data=None):
    """Complete project status: git, resources, ports, caches, disk."""
    project = db.get_project(pid)
    if not project:
        return _j({"error": "Project not found"}), 404

    ppath = project.get("path", "")

    # Git info (the folder itself) + every repo it contains
    git = _get_git_info(ppath)
    repos = P.find_repos(ppath) if ppath and os.path.isdir(ppath) else []
    for r in repos:
        r["state"] = P.git_state(r["path"])

    # Resources
    resources = db.get_resources(project_id=pid)
    for r in resources:
        r["size_h"] = fmt(r["size"]) if r["size"] else "—"

    # Ports
    ports = db.get_project_ports(pid)

    # Caches
    caches = _get_project_caches(ppath)
    total_cache = sum(c["size"] for c in caches)

    # Docker resources (filtered)
    docker = {"containers": [], "images": [], "volumes": []}
    for r in resources:
        if r["type"] == "docker_container":
            docker["containers"].append(r)
        elif r["type"] == "docker_image":
            docker["images"].append(r)
        elif r["type"] == "docker_volume":
            docker["volumes"].append(r)

    # Disk usage of project dir
    disk_total = 0
    if ppath and Path(ppath).exists():
        disk_total = sizes.size(ppath)

    # The project's own console (controller.py): declared or auto-detected, with its live status
    try:
        import controller as _CT
        ctrl = _CT.get(pid)
    except Exception:
        ctrl = None
    # Detect if project has its own console (run.sh or server.py)
    has_console = False
    if ppath and Path(ppath).is_dir():
        has_console = (Path(ppath) / "run.sh").exists() or (Path(ppath) / "server.py").exists()

    return _j({
        "project": {**project, "total_size_h": fmt(project.get("total_size", 0) or 0)},
        "git": git,
        "repos": repos,
        "github_org": (P.read_manifest(ppath).get("github") or {}).get("org") if ppath and os.path.isdir(ppath) else None,
        "state": P.state(project),
        "resources": resources,
        "ports": ports,
        "caches": caches,
        "total_cache": total_cache,
        "total_cache_h": fmt(total_cache),
        "docker": docker,
        "disk_total": disk_total or 0,
        "disk_total_h": sizes.fmt_or_pending(disk_total, fmt),
        "has_console": has_console or bool(ctrl),
        "controller": ctrl,
    })


def running(data=None):
    """Get all running projects — those with active ports, running containers, or dev processes."""
    import psutil as _ps

    projects = db.get_projects()
    projects = [p for p in projects if p.get("path")]
    running = []

    for proj in projects:
        ppath = proj["path"]
        items = {"ports": [], "containers": [], "processes": []}
        has_activity = False

        # Check ports linked to this project
        ports = db.get_project_ports(proj["id"])
        for pt in ports:
            items["ports"].append({"port": pt["port"], "process": pt.get("process_name", ""), "pid": pt.get("pid")})
            has_activity = True

        # Check running Docker containers linked to this project
        if run("docker info 2>/dev/null"):
            for line in run("docker ps --format json").splitlines():
                try:
                    c = json.loads(line)
                    cname = c.get("Names", "")
                    # Match by project name in container name
                    pname_lower = proj["name"].lower().replace("-", "").replace("_", "")
                    cname_lower = cname.lower().replace("-", "").replace("_", "")
                    if pname_lower in cname_lower or cname_lower in pname_lower:
                        items["containers"].append({
                            "name": cname, "image": c.get("Image", ""),
                            "status": c.get("Status", ""), "ports": c.get("Ports", ""),
                            "id": c.get("ID", ""),
                        })
                        has_activity = True
                except json.JSONDecodeError:
                    pass

        # Check running processes from this project dir
        try:
            for p in _ps.process_iter(["pid", "name", "cmdline", "memory_info", "cpu_percent"]):
                try:
                    cwd = p.cwd()
                    if cwd and cwd.startswith(ppath):
                        mem = p.info.get("memory_info")
                        items["processes"].append({
                            "pid": p.info["pid"], "name": p.info["name"],
                            "memory_h": fmt(mem.rss) if mem else "—",
                            "cpu": p.info.get("cpu_percent", 0),
                        })
                        has_activity = True
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    pass
        except Exception:
            pass

        if has_activity:
            running.append({
                "project": {
                    "id": proj["id"], "name": proj["name"],
                    "color": proj.get("color", "#8b5cf6"),
                    "path": ppath, "status": proj.get("status", "active"),
                },
                **items,
            })

    return _j(running)


def docker(data=None):
    if not run("docker info 2>/dev/null"):
        return _j({"available": False})

    system_df = []
    for line in run("docker system df --format json").splitlines():
        try:
            system_df.append(json.loads(line))
        except json.JSONDecodeError:
            pass

    images = []
    for line in run("docker images --format json").splitlines():
        try:
            img = json.loads(line)
            name = f"{img.get('Repository', '')}:{img.get('Tag', '')}"
            res = db.get_resource_by_path(f"docker:image:{name}")
            images.append({
                "repo": img.get("Repository", ""), "tag": img.get("Tag", ""),
                "size": img.get("Size", ""), "created": img.get("CreatedSince", ""),
                "id": img.get("ID", ""),
                "project_id": res["project_id"] if res else None,
                "project_name": res.get("project_name", "") if res else "",
                "resource_id": res["id"] if res else None,
            })
        except (json.JSONDecodeError, Exception):
            pass

    containers = []
    for line in run("docker ps -a --format json").splitlines():
        try:
            c = json.loads(line)
            name = c.get("Names", "")
            res = db.get_resource_by_path(f"docker:container:{name}")
            containers.append({
                "name": name, "status": c.get("Status", ""), "state": c.get("State", ""),
                "size": c.get("Size", ""), "ports": c.get("Ports", ""),
                "image": c.get("Image", ""), "id": c.get("ID", ""),
                "project_id": res["project_id"] if res else None,
                "project_name": res.get("project_name", "") if res else "",
                "resource_id": res["id"] if res else None,
            })
        except (json.JSONDecodeError, Exception):
            pass

    volumes = []
    for line in run("docker volume ls --format json").splitlines():
        try:
            v = json.loads(line)
            name = v.get("Name", "")
            res = db.get_resource_by_path(f"docker:volume:{name}")
            volumes.append({
                "name": name, "driver": v.get("Driver", ""),
                "project_id": res["project_id"] if res else None,
                "project_name": res.get("project_name", "") if res else "",
                "resource_id": res["id"] if res else None,
            })
        except (json.JSONDecodeError, Exception):
            pass

    return _j({
        "available": True, "system_df": system_df,
        "images": images, "containers": containers, "volumes": volumes,
    })


def cleanup_preview(pid, data=None):
    """Preview everything linked to a project, grouped for selective cleanup."""
    project = db.get_project(pid)
    if not project:
        return _j({"error": "Project not found"}), 404

    ppath = project.get("path", "")
    items = []
    total_reclaimable = 0

    # Caches in project dir
    caches = _get_project_caches(ppath)
    for c in caches:
        items.append({
            "category": "cache", "name": c["name"], "path": c["path"],
            "size": c["size"], "size_h": c["size_h"],
            "safe": c.get("safe", True), "detail": c.get("label", c["name"]),
        })
        if c.get("safe", True):
            total_reclaimable += c["size"]

    # Docker resources
    resources = db.get_resources(project_id=pid)
    for r in resources:
        if r["type"].startswith("docker_"):
            items.append({
                "category": "docker", "name": r["name"], "path": r.get("path", ""),
                "size": r.get("size", 0), "size_h": fmt(r.get("size", 0)),
                "safe": True, "detail": r["type"].replace("docker_", ""),
            })

    # Files/directories linked
    for r in resources:
        if r["type"] in ("file", "directory"):
            exists = Path(r["path"]).exists() if r.get("path") else False
            items.append({
                "category": "file", "name": r["name"], "path": r.get("path", ""),
                "size": r.get("size", 0), "size_h": fmt(r.get("size", 0)),
                "safe": True, "detail": r["type"], "exists": exists,
            })
            total_reclaimable += r.get("size", 0)

    # Ports
    ports = db.get_project_ports(pid)
    for p in ports:
        items.append({
            "category": "port", "name": f"Port {p['port']}", "path": "",
            "size": 0, "size_h": "—",
            "safe": True, "detail": p.get("process_name", ""),
        })

    return _j({
        "project": project,
        "items": items,
        "total_reclaimable": total_reclaimable,
        "total_reclaimable_h": fmt(total_reclaimable),
    })


def selective_cleanup(pid, data=None):
    """Selective cleanup of what the preview listed. Caches are deleted only
    inside the project folder, files go to the trash. The project folder
    itself is never deleted here: that is DELETE /api/projects/<id>."""
    project = P.get(pid)
    data = data or {}
    if data.get("delete_project_dir"):
        return _j({"success": False, "message":
                        "Pour supprimer le dossier du projet, utilise « Supprimer » (inspection + corbeille)."}), 409
    root = project.get("path", "")
    cleaned, errors = [], []

    for item in data.get("items", []):
        cat, path, name = item.get("category", ""), item.get("path", ""), item.get("name", "")
        try:
            if cat == "cache" and path and os.path.isdir(path):
                if not root:
                    raise P.ProjectError("projet sans dossier")
                s = dir_size(path)
                P.safe_rmtree(path, root)
                cleaned.append(f"Cache {name}: {fmt(s)}")
                db.log_event("cleaned", "cache", name, path, s, pid)

            elif cat == "docker":
                detail = item.get("detail", "")
                _docker_rm(detail, name)
                res = db.get_resource_by_path(path)
                if res:
                    db.update_resource(res["id"], status="deleted")
                cleaned.append(f"Docker {detail}: {name}")
                db.log_event("cleaned", f"docker_{detail}", name, "", 0, pid)

            elif cat == "file" and path:
                if Path(path).exists():
                    s = _trash_resource_file(path, project)
                    cleaned.append(f"{name}: {fmt(s)} (corbeille)")
                res = db.get_resource_by_path(path)
                if res:
                    db.update_resource(res["id"], status="deleted")
                db.log_event("cleaned", "file", name, path, 0, pid)

            elif cat == "port":
                cleaned.append(f"Port {name} (le process doit etre arrete)")

        except Exception as e:
            errors.append(f"{name}: {getattr(e, 'message', e)}")

    if data.get("set_done"):
        db.set_project_status(pid, "done")

    return _j({
        "success": True,
        "cleaned": cleaned,
        "errors": errors,
        "message": f"{len(cleaned)} elements nettoyes" + (f", {len(errors)} erreurs" if errors else ""),
    })


def downloads(data=None):
    dl = HOME / "Downloads"
    if not dl.exists():
        return _j({"files": [], "duplicates": []})

    files = []
    for item in dl.iterdir():
        try:
            if item.is_symlink():
                continue
            size = item.stat().st_size if item.is_file() else fast_size(str(item))
            mtime = datetime.fromtimestamp(item.stat().st_mtime).strftime("%Y-%m-%d")
            res = db.get_resource_by_path(str(item))
            files.append({
                "name": item.name, "size": size, "size_h": fmt(size),
                "is_dir": item.is_dir(), "ext": item.suffix or ("dir" if item.is_dir() else "—"),
                "mtime": mtime, "path": str(item),
                "is_temporary": res["is_temporary"] if res else False,
                "expires_at": res["expires_at"] if res else None,
                "project_name": res.get("project_name", "") if res else "",
                "resource_id": res["id"] if res else None,
            })
        except (PermissionError, OSError):
            pass

    files.sort(key=lambda x: x["size"], reverse=True)
    names = {f["name"] for f in files}
    name_to_info = {f["name"]: f for f in files}

    duplicates = []
    seen = set()
    for f in files:
        if f["name"] in seen:
            continue
        p = Path(f["path"])
        if p.is_file() and p.suffix == ".zip":
            folder = p.stem
            if folder in names and name_to_info[folder]["is_dir"]:
                duplicates.append({**f, "reason": f"Archive de '{folder}/'"})
                seen.add(f["name"])
        elif p.is_file() and f["name"].endswith(".tar.gz"):
            folder = f["name"].replace(".tar.gz", "")
            if folder in names and name_to_info[folder]["is_dir"]:
                duplicates.append({**f, "reason": f"Archive de '{folder}/'"})
                seen.add(f["name"])
        elif f["name"].endswith(")") and " (" in f["name"]:
            if p.is_file() and p.suffix:
                base = p.stem.rsplit(" (", 1)[0] + p.suffix
            else:
                base = f["name"].rsplit(" (", 1)[0]
            if base in names:
                duplicates.append({**f, "reason": f"Copie de '{base}'"})
                seen.add(f["name"])

    return _j({"files": files[:40], "duplicates": duplicates})


def suggestions(data=None):
    sug = []

    # Trash
    trash = HOME / ".local" / "share" / "Trash"
    if trash.exists():
        s = fast_size(str(trash))
        if s > 100 * 1024 * 1024:
            sug.append({"priority": "critical", "msg": f"Corbeille = {fmt(s)}", "action": "trash", "size": s})

    # Expired
    expired = db.get_expired_resources()
    if expired:
        total = sum(r.get("size", 0) for r in expired)
        sug.append({"priority": "critical", "msg": f"{len(expired)} fichiers expires ({fmt(total)})",
                     "action": "clean_expired", "size": total})

    # Docker
    if run("docker info 2>/dev/null"):
        stopped = run("docker ps -a --filter 'status=exited' -q")
        if stopped:
            n = len(stopped.splitlines())
            sug.append({"priority": "medium", "msg": f"{n} containers arretes", "action": "docker_containers", "size": 0})
        dangling = run("docker images -f 'dangling=true' -q")
        if dangling:
            n = len(dangling.splitlines())
            sug.append({"priority": "medium", "msg": f"{n} images orphelines", "action": "docker_dangling", "size": 0})
        unused_vols = run("docker volume ls -q --filter 'dangling=true'")
        if unused_vols:
            n = len(unused_vols.splitlines())
            sug.append({"priority": "medium", "msg": f"{n} volumes inutilises", "action": "docker_volumes", "size": 0})

    # Unlinked
    stats = db.get_stats()
    if stats["unlinked_resources"] > 5:
        sug.append({"priority": "low", "msg": f"{stats['unlinked_resources']} ressources non liees",
                     "action": "nav:projects", "size": 0})

    # Downloads
    dl = HOME / "Downloads"
    if dl.exists():
        s = fast_size(str(dl))
        if s > 2 * 1024 * 1024 * 1024:
            sug.append({"priority": "medium", "msg": f"Downloads = {fmt(s)}", "action": "nav:storage", "size": s})

    # pip cache
    pip_cache = HOME / ".cache" / "pip"
    if pip_cache.exists():
        s = fast_size(str(pip_cache))
        if s > 500 * 1024 * 1024:
            sug.append({"priority": "low", "msg": f"Cache pip = {fmt(s)}", "action": "pip_cache", "size": s})

    return _j(sug)


def ports(data=None):
    ports = []
    seen = set()
    output = run("ss -tlnp 2>/dev/null")
    system_ports = {22: "SSH", 53: "DNS", 631: "CUPS", 5900: "VNC", 5432: "PostgreSQL",
                    3306: "MySQL", 6379: "Redis", 27017: "MongoDB", 9200: "Elasticsearch"}

    for line in output.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4:
            continue
        addr = parts[3]
        if ":" not in addr:
            continue
        port_str = addr.rsplit(":", 1)[-1]
        try:
            port = int(port_str)
        except ValueError:
            continue
        if port in seen:
            continue
        seen.add(port)

        bind = addr.rsplit(":", 1)[0]
        process = ""
        if "users:" in line:
            try:
                process = line.split("users:")[1].split('"')[1]
            except (IndexError, ValueError):
                pass
        if not process:
            dp = run(f"docker ps --filter 'publish={port}' --format '{{{{.Names}}}}' 2>/dev/null")
            if dp:
                process = f"docker:{dp}"

        ptype = "system" if port in system_ports else ("docker" if "docker" in process.lower() else "dev")
        label = system_ports.get(port, "")

        # Try to link port to project via tracked ports
        tracked = db.get_all_active_ports()
        project_name = ""
        project_id = None
        for tp in tracked:
            if tp["port"] == port and tp.get("project_id"):
                project_name = tp.get("project_name", "")
                project_id = tp["project_id"]
                break

        ports.append({"port": port, "bind": bind, "process": process or "—", "type": ptype,
                      "label": label, "project_name": project_name, "project_id": project_id})

    ports.sort(key=lambda x: x["port"])
    return _j(ports)


def processes(data=None):
    """Top processes by memory, with dev server detection."""
    dev_keywords = {"node", "python", "python3", "flask", "gunicorn", "uvicorn", "next",
                    "vite", "webpack", "docker", "java", "gradle", "cargo", "go",
                    "ruby", "php", "nginx", "postgres", "mysql", "redis", "mongo"}
    procs = []
    for p in psutil.process_iter(["pid", "name", "cmdline", "memory_info", "cpu_percent", "create_time", "username"]):
        try:
            info = p.info
            mem = info.get("memory_info")
            if not mem or mem.rss < 20 * 1024 * 1024:
                continue
            name = info.get("name", "")
            cmd_parts = info.get("cmdline") or [name]
            cmd = " ".join(cmd_parts[:4])[:120]
            is_dev = any(k in name.lower() or k in cmd.lower() for k in dev_keywords)

            # Try to detect project from cmdline
            project_hint = ""
            for part in cmd_parts:
                if HOME.name in str(part) and "/" in part:
                    rel = part.replace(str(HOME) + "/", "").split("/")
                    if len(rel) >= 2 and rel[0] in ("Desktop", "projects", "dev"):
                        project_hint = rel[1]
                    elif len(rel) >= 1 and not rel[0].startswith("."):
                        project_hint = rel[0]
                    break

            procs.append({
                "pid": info["pid"], "name": name, "cmd": cmd,
                "memory": mem.rss, "memory_h": fmt(mem.rss),
                "cpu": info.get("cpu_percent", 0),
                "is_dev": is_dev, "project_hint": project_hint,
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass

    procs.sort(key=lambda x: x["memory"], reverse=True)
    return _j(procs[:40])


def system(data=None):
    """Real-time system stats for topbar + overview."""
    disks = []
    for part in psutil.disk_partitions():
        if part.fstype in ("squashfs", "tmpfs", "devtmpfs", "overlay"):
            continue
        try:
            u = psutil.disk_usage(part.mountpoint)
            disks.append({
                "mount": part.mountpoint, "device": part.device, "fstype": part.fstype,
                "total": u.total, "used": u.used, "free": u.free, "percent": u.percent,
                "total_h": fmt(u.total), "used_h": fmt(u.used), "free_h": fmt(u.free),
            })
        except (PermissionError, OSError):
            pass

    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    cpu = psutil.cpu_percent(interval=0.3)
    trash_path = HOME / ".local" / "share" / "Trash"
    trash_size = fast_size(str(trash_path)) if trash_path.exists() else 0
    stats = db.get_stats()

    return _j({
        "disks": disks,
        "ram": {"total": mem.total, "used": mem.used, "available": mem.available,
                "percent": mem.percent, "total_h": fmt(mem.total), "used_h": fmt(mem.used)},
        "swap": {"total": swap.total, "used": swap.used, "percent": swap.percent,
                 "total_h": fmt(swap.total), "used_h": fmt(swap.used)},
        "cpu": {"percent": cpu, "count": psutil.cpu_count()},
        "trash": {"size": trash_size, "size_h": fmt(trash_size)},
        "stats": stats,
    })


def home(data=None):
    """Home directory breakdown by folder."""
    entries = []
    categories = {
        ".local": ("system", "Cache/Corbeille"), "Downloads": ("downloads", "Telechargements"),
        ".cache": ("cache", "Cache systeme"), ".config": ("system", "Configuration"),
        "Desktop": ("projects", "Bureau/Projets"), "snap": ("system", "Snap"),
        "flutter": ("sdk", "SDK Flutter"), ".gradle": ("cache", "Cache Gradle"),
        "Android": ("sdk", "SDK Android"), ".npm": ("cache", "Cache NPM"),
        ".nvm": ("sdk", "Node versions"), ".vscode": ("system", "VS Code"),
        ".pyenv": ("sdk", "Python versions"), "Pictures": ("personal", "Images"),
        ".docker": ("system", "Docker config"), ".pub-cache": ("cache", "Cache Dart/Flutter"),
        "Documents": ("personal", "Documents"), "Videos": ("personal", "Videos"),
        "Music": ("personal", "Music"),
    }

    for item in HOME.iterdir():
        try:
            if item.is_symlink():
                continue
            size = item.stat().st_size if item.is_file() else fast_size(str(item))
            if size < 5 * 1024 * 1024:
                continue
            cat, label = categories.get(item.name, ("project" if not item.name.startswith(".") else "system", item.name))
            entries.append({"name": item.name, "size": size, "size_h": fmt(size), "category": cat, "label": label})
        except (PermissionError, OSError):
            pass

    entries.sort(key=lambda x: x["size"], reverse=True)
    return _j(entries[:30])


def projects(data=None):
    projects = db.get_projects()
    try:
        _listen = ports_mod.listening()
    except Exception:
        _listen = []
    for p in projects:
        p["state"] = P.state(p)                  # ok | missing | no_path
        p["managed"] = bool(p.get("path")) and P.is_managed(p["path"])
        try:                                     # type + needs summary (no network: fast)
            st = M.connections_status(p["id"], probe=False)
            p["needs"] = {"profile": st["profile"], "label": st["label"], "done": st["done"], "total": st["total"],
                          "items": [{"need": x["need"], "label": x["label"], "state": x["state"]} for x in st["needs"]],
                          "controller": bool(st["controller"])}
        except Exception:
            p["needs"] = None
        p["phase"] = PH.summary(p["id"])         # current phase + next step (never raises)
        try:                                      # ports held by processes running from the folder (one scan)
            root = P.resolve(p["path"]) if p.get("path") and os.path.isdir(p["path"]) else None
            p["running_ports"] = sorted({l["port"] for l in _listen if root and l["cwd"] and ports_mod._inside(l["cwd"], root)}) if root else []
        except Exception:
            p["running_ports"] = []
        # Real disk size of the project folder
        if p.get("path") and os.path.isdir(p["path"]):
            size = sizes.size(p["path"])           # cached, computed in the background
            p["disk_size"] = size or 0
            p["disk_size_h"] = sizes.fmt_or_pending(size, fmt)
        else:
            p["disk_size"] = 0
            p["disk_size_h"] = "—"
        p["total_size_h"] = fmt(p["total_size"])
        p["breakdown"] = db.get_project_resources_breakdown(p["id"])
        p["profile"] = p.get("profile", "")
        active_comps = db.get_project_components(p["id"])
        p["components"] = [c["component"] for c in active_comps if c["enabled"]]
    return _j(projects)
