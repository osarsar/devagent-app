"""What each project costs this PC: its disk always, its RAM / CPU / GPU while it runs.

    disk(pid)        the folder by kind (dependencies, builds and caches, git history, code and data)
                     plus its Docker volumes; measured in the background, kept in data/ressources.json
    live(pid)        the last sample: processes started from the folder, its Docker containers,
                     GPU memory; with a short history for the curves
    overview()       every project, for the Projets screen

Nothing here is slow for the caller: the disk is measured by one background thread (low priority),
the live figures by a sampler that runs every few seconds only while a screen is looking.
"""
import json
import os
import subprocess
import threading
import time
from collections import deque
from datetime import datetime

import psutil

import db

# ── Disk ────────────────────────────────────────────────────────────────────

KINDS = [  # fixed order: the colours of the chart follow it
    ("deps", "Dependances", {"node_modules", ".venv", "venv", "env", ".env.d", "vendor", ".pnpm-store", "bower_components"}),
    ("builds", "Builds et caches", {".next", ".nuxt", "dist", "build", "target", "out", "__pycache__", ".cache",
                                     ".turbo", ".parcel-cache", ".pytest_cache", ".mypy_cache", ".ruff_cache",
                                     "coverage", ".gradle", ".svelte-kit", ".angular", ".expo"}),
    ("git", "Historique git", {".git"}),
]
REST = ("code", "Code et donnees")
DISK_TTL = 30 * 60

_disk_lock = threading.Lock()
_disk = {}            # pid -> result
_disk_running = set()


def _file():
    return db.DB_PATH.parent / "ressources.json"


def _load_disk():
    if _disk:
        return
    try:
        _disk.update({int(k): v for k, v in json.loads(_file().read_text()).items()})
    except (OSError, ValueError):
        pass


def _save_disk():
    try:
        tmp = _file().with_suffix(".tmp")
        with _disk_lock:
            tmp.write_text(json.dumps(_disk))
        tmp.replace(_file())
    except OSError:
        pass


def _du(paths):
    """Bytes of each path, with du at low priority."""
    if not paths:
        return {}
    cmd = ["nice", "-n", "15"] + (["ionice", "-c3"] if os.path.exists("/usr/bin/ionice") else []) + ["du", "-sb", "--"] + paths
    out = {}
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        for line in r.stdout.splitlines():
            size, _, path = line.partition("\t")
            if size.isdigit():
                out[path] = int(size)
    except (subprocess.TimeoutExpired, OSError):
        pass
    return out


def _special_dirs(root):
    """The folders of each kind, found without entering them (a node_modules is never walked)."""
    found = {k: [] for k, _, _ in KINDS}
    names = {n: k for k, _, ns in KINDS for n in ns}
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        if not e.is_dir(follow_symlinks=False):
                            continue
                    except OSError:
                        continue
                    kind = names.get(e.name)
                    if kind:
                        found[kind].append(e.path)
                    else:
                        stack.append(e.path)
        except (PermissionError, OSError):
            pass
    return found


def _docker_volumes(root):
    """Docker volumes used by the project's containers, with their size."""
    try:
        conts = _containers_of(root)
        if not conts:
            return []
        names = set()
        for c in conts:
            r = subprocess.run(["docker", "inspect", "--format", "{{json .Mounts}}", c], capture_output=True, text=True, timeout=10)
            for m in json.loads(r.stdout or "[]"):
                if m.get("Type") == "volume" and m.get("Name"):
                    names.add(m["Name"])
        r = subprocess.run(["docker", "system", "df", "-v", "--format", "{{json .Volumes}}"], capture_output=True, text=True, timeout=120)
        vols = json.loads(r.stdout or "[]") or []
        out = []
        for v in vols:
            if v.get("Name") in names:
                out.append({"nom": v["Name"], "taille": _parse_size(v.get("Size", "0B"))})
        return sorted(out, key=lambda v: -v["taille"])
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return []


def _parse_size(s):
    s = (s or "0B").strip()
    units = {"B": 1, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12, "kB": 1e3, "KiB": 1024, "MiB": 1024 ** 2, "GiB": 1024 ** 3}
    for u in sorted(units, key=len, reverse=True):
        if s.endswith(u):
            try:
                return int(float(s[: -len(u)]) * units[u])
            except ValueError:
                return 0
    return 0


def _measure(pid, path):
    try:
        root = os.path.realpath(path)
        found = _special_dirs(root)
        # two calls: du never counts a folder twice in one call, so the total must be measured apart
        sizes = _du([p for ps in found.values() for p in ps])
        total = _du([root]).get(root, 0)
        parts = []
        used = 0
        for key, label, _ in KINDS:
            n = sum(sizes.get(p, 0) for p in found[key])
            used += n
            top = sorted(((sizes.get(p, 0), p) for p in found[key]), reverse=True)[:5]
            parts.append({"cle": key, "nom": label, "taille": n, "dossiers": len(found[key]),
                          "plus_gros": [{"chemin": os.path.relpath(p, root), "taille": s} for s, p in top if s]})
        parts.append({"cle": REST[0], "nom": REST[1], "taille": max(0, total - used), "dossiers": 0, "plus_gros": []})
        # where the space goes: the biggest entries at the top of the project
        try:
            tops = [e.path for e in os.scandir(root) if not e.is_symlink()]
        except OSError:
            tops = []
        top_sizes = _du(tops)
        biggest = sorted(((n, p) for p, n in top_sizes.items()), reverse=True)[:6]
        result = {"total": total, "parts": parts, "docker": _docker_volumes(root),
                  "plus_gros": [{"chemin": os.path.relpath(p, root), "taille": n} for n, p in biggest if n],
                  "mesure_le": datetime.now().isoformat(timespec="seconds"), "at": time.time()}
        with _disk_lock:
            _disk[pid] = result
        _save_disk()
    finally:
        with _disk_lock:
            _disk_running.discard(pid)


def disk(pid, refresh=False):
    """The last measure (instant); starts a new one in the background when it is old or asked."""
    _load_disk()
    p = db.get_project(pid)
    if not p or not p.get("path") or not os.path.isdir(p["path"]):
        return None
    cur = _disk.get(pid)
    with _disk_lock:
        busy = pid in _disk_running
        if not busy and (refresh or not cur or time.time() - cur.get("at", 0) > DISK_TTL):
            _disk_running.add(pid)
            threading.Thread(target=_measure, args=(pid, p["path"]), name=f"disque-{pid}", daemon=True).start()
            busy = True
    out = dict(cur or {}, en_cours=busy)
    if cur:
        out["age_s"] = int(time.time() - cur.get("at", time.time()))     # the browser's clock or time zone may differ
    return out


# ── Live ────────────────────────────────────────────────────────────────────

INTERVAL = 3.0
IDLE_STOP = 45          # nobody looked for this long: the sampler sleeps
HISTORY = 60            # 3 minutes of points

_live_lock = threading.Lock()
_live = {}              # pid -> last sample
_hist = {}              # pid -> deque of (t, cpu, ram, gpu)
_procs = {}             # os pid -> psutil.Process (cpu_percent needs the previous call)
_seen = 0.0
_thread = None
_cmap = {"at": 0, "map": {}}


def _roots():
    out = []
    for p in db.get_projects():
        if p.get("path") and os.path.isdir(p["path"]):
            out.append((p["id"], os.path.realpath(p["path"]).rstrip("/") + "/"))
    return out


def _owner(path, roots):
    path = path.rstrip("/") + "/"
    best = None
    for pid, root in roots:
        if path.startswith(root) and (not best or len(root) > len(best[1])):
            best = (pid, root)
    return best[0] if best else None


def _containers_of(root):
    root = os.path.realpath(root).rstrip("/") + "/"
    return [name for name, wd in _container_dirs().items() if (wd.rstrip("/") + "/").startswith(root)]


def _container_dirs():
    """Running containers → the folder their compose file lives in (refreshed every 30 s)."""
    if time.time() - _cmap["at"] < 30:
        return _cmap["map"]
    m = {}
    try:
        r = subprocess.run(["docker", "ps", "--format", '{{.Names}}\t{{.Label "com.docker.compose.project.working_dir"}}'],
                           capture_output=True, text=True, timeout=10)
        for line in r.stdout.splitlines():
            name, _, wd = line.partition("\t")
            if name and wd:
                m[name] = os.path.realpath(wd)
    except (OSError, subprocess.TimeoutExpired):
        pass
    _cmap.update(at=time.time(), map=m)
    return m


def _docker_stats(names):
    if not names:
        return {}
    try:
        r = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}"] + names,
                           capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    out = {}
    for line in r.stdout.splitlines():
        try:
            s = json.loads(line)
            used = (s.get("MemUsage") or "0B / 0B").split("/")[0].strip()
            out[s["Name"]] = {"cpu": float((s.get("CPUPerc") or "0%").rstrip("%") or 0), "ram": _parse_size(used)}
        except (ValueError, KeyError):
            pass
    return out


def _gpu_by_pid():
    try:
        r = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=10)
        out = {}
        for line in r.stdout.splitlines():
            a, _, b = line.partition(",")
            if a.strip().isdigit() and b.strip().isdigit():
                out[int(a)] = int(b) * 1024 * 1024
        return out
    except (OSError, subprocess.TimeoutExpired):
        return {}


def _sample():
    roots = _roots()
    ncpu = psutil.cpu_count() or 1
    gpu = _gpu_by_pid()
    agg = {pid: {"cpu": 0.0, "ram": 0, "gpu": 0, "processus": [], "conteneurs": []} for pid, _ in roots}
    alive = set()
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            cwd = proc.cwd()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, OSError):
            continue
        if not cwd:
            continue
        owner = _owner(os.path.realpath(cwd), roots)
        if owner is None:
            continue
        opid = proc.info["pid"]
        alive.add(opid)
        p = _procs.get(opid)
        if p is None or p.pid != opid:
            p = _procs[opid] = proc
        try:
            cpu = p.cpu_percent(None) / ncpu
            ram = p.memory_info().rss
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        g = gpu.get(opid, 0)
        a = agg[owner]
        a["cpu"] += cpu
        a["ram"] += ram
        a["gpu"] += g
        a["processus"].append({"pid": opid, "nom": proc.info["name"], "cpu": round(cpu, 1), "ram": ram, "gpu": g})
    for gone in [k for k in _procs if k not in alive]:
        del _procs[gone]
    dirs = _container_dirs()
    owners = {name: _owner(wd, roots) for name, wd in dirs.items()}
    stats = _docker_stats([n for n, o in owners.items() if o is not None])
    for name, s in stats.items():
        o = owners.get(name)
        if o is None:
            continue
        cpu = s["cpu"] / ncpu
        agg[o]["cpu"] += cpu
        agg[o]["ram"] += s["ram"]
        agg[o]["conteneurs"].append({"nom": name, "cpu": round(cpu, 1), "ram": s["ram"]})
    now = time.time()
    with _live_lock:
        for pid, a in agg.items():
            a["processus"].sort(key=lambda x: -x["ram"])
            a["conteneurs"].sort(key=lambda x: -x["ram"])
            a.update(en_marche=bool(a["processus"] or a["conteneurs"]), cpu=round(a["cpu"], 1), at=now)
            _live[pid] = a
            h = _hist.setdefault(pid, deque(maxlen=HISTORY))
            h.append((round(now), a["cpu"], a["ram"], a["gpu"]))


def _loop():
    global _thread
    while time.time() - _seen < IDLE_STOP:
        t0 = time.time()
        try:
            _sample()
        except Exception:
            pass
        time.sleep(max(0.5, INTERVAL - (time.time() - t0)))
    with _live_lock:
        _thread = None


def _wake(wait_first=True):
    global _seen, _thread
    _seen = time.time()
    with _live_lock:
        if _thread is None:
            _thread = threading.Thread(target=_loop, name="ressources-live", daemon=True)
            _thread.start()
            first = True
        else:
            first = False
    if first and not _live and wait_first:
        _sample()                       # the first answer is not empty


def machine():
    gpu = None
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.used,utilization.gpu",
                            "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
        n, tot, used, util = [x.strip() for x in r.stdout.splitlines()[0].split(",")]
        gpu = {"nom": n, "memoire": int(tot) * 1024 * 1024, "utilisee": int(used) * 1024 * 1024, "util": int(util)}
    except (OSError, IndexError, ValueError, subprocess.TimeoutExpired):
        pass
    vm = psutil.virtual_memory()
    return {"coeurs": psutil.cpu_count() or 1, "ram": vm.total, "ram_utilisee": vm.total - vm.available,
            "cpu": psutil.cpu_percent(None), "gpu": gpu}


def live(pid):
    _wake()
    with _live_lock:
        cur = dict(_live.get(pid) or {"en_marche": False, "cpu": 0, "ram": 0, "gpu": 0, "processus": [], "conteneurs": []})
        cur["historique"] = list(_hist.get(pid, []))
    return cur


def project(pid, refresh_disk=False):
    return {"disque": disk(pid, refresh_disk), "live": live(pid), "machine": machine()}


def overview():
    _wake(wait_first=False)             # the list answers at once; the figures come with the next poll
    out = {}
    for p in db.get_projects():
        d = disk(p["id"])
        with _live_lock:
            l = _live.get(p["id"]) or {}
        out[p["id"]] = {"disque": (d or {}).get("total"), "disque_en_cours": bool(d and d.get("en_cours") and not d.get("total")),
                        "en_marche": bool(l.get("en_marche")), "cpu": l.get("cpu", 0), "ram": l.get("ram", 0), "gpu": l.get("gpu", 0)}
    return out
