"""`devagent migrer` — rename the folder ~/devpilot to ~/devagent, safely.

    devagent migrer               shows what would be done (changes nothing)
    devagent migrer --appliquer   does it
    devagent migrer --annuler     puts everything back

What it does:
  1. refuses while DevAgent is running (it holds the database and its paths in memory)
  2. copies the database (devpilot.db.avant-migration)
  3. renames ~/devpilot → ~/devagent, and leaves ~/devpilot as a LINK to it: cron jobs,
     running servers, Docker mounts and scripts that know the old path keep working
  4. rewrites the old path where it is stored: the projects in the database, each project's
     .devpilot/*.json, the commands (~/.local/bin), the menu entry, the watcher service, the
     virtual environment's scripts
  5. registers the MCP server of Claude Code at its new place
  6. copies Claude Code's memory of each project to the new path (the old one is kept)

Not touched: your crontab and the scripts inside your projects (they work through the link);
the simulation lists them so you can update them when you want.
"""
import json
import os
import shutil
import sqlite3
import subprocess
from pathlib import Path

import paths

MARK = "devpilot.db.avant-migration"
TEXT_SUFFIXES = {".json", ".desktop", ".service", ".cfg", ""}


def _names(home, undo=False):
    old, new = home / paths.OLD_NAME, home / paths.NEW_NAME
    return (new, old) if undo else (old, new)


def _running(port=5555):
    """Is DevAgent's server running on this PC? (its port answers, or its process exists)"""
    import socket
    with socket.socket() as s:
        s.settimeout(0.4)
        if s.connect_ex(("127.0.0.1", int(os.environ.get("DEVPILOT_PORT") or port))) == 0:
            return True
    return False


def _others(src):
    """Processes (not ours) working inside the folder: they keep working through the link."""
    out = []
    try:
        import psutil
        me = os.getpid()
        for p in psutil.process_iter(["pid", "cwd", "cmdline"]):
            try:
                cwd, cmd = p.info.get("cwd") or "", " ".join(p.info.get("cmdline") or [])
                if p.info["pid"] != me and (cwd.startswith(str(src) + "/") or f"{src}/" in cmd) and "migrer" not in cmd:
                    out.append({"pid": p.info["pid"], "quoi": (cmd or cwd)[:110]})
            except Exception:
                pass
    except Exception:
        pass
    return out


def _files_outside(home):
    """Small text files outside the folder that hold its path."""
    c = [home / ".local/bin/devpilot", home / ".local/bin/devagent", home / ".local/bin/devpilot-watcher",
         home / ".local/share/applications/devpilot.desktop",
         home / ".config/systemd/user/devpilot-watcher.service"]
    return [f for f in c if f.is_file() and not f.is_symlink()]


def _crontab_lines(src):
    try:
        r = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=10)
        return [l for l in r.stdout.splitlines() if str(src) in l and not l.lstrip().startswith("#")]
    except (OSError, subprocess.TimeoutExpired):
        return []


def _claude_dirs(home, src, dst):
    """Claude Code keeps a folder per project path (memory, history): old → new names."""
    base = home / ".claude" / "projects"
    key = lambda p: str(p).replace("/", "-").replace(".", "-")
    pairs = []
    if base.is_dir():
        for d in sorted(base.iterdir()):
            if d.is_dir() and (d.name == key(src) or d.name.startswith(key(src) + "-")):
                pairs.append((d, base / (key(dst) + d.name[len(key(src)):])))
    return pairs


def _db_file(root):
    return root / ".devpilot" / "data" / "devpilot.db"


def _project_paths(dbf, src):
    if not dbf.is_file():
        return []
    c = sqlite3.connect(f"file:{dbf}?mode=ro", uri=True)
    try:
        return [r[0] for r in c.execute("SELECT path FROM projects WHERE path = ? OR path LIKE ?",
                                        (str(src), str(src) + "/%"))]
    except sqlite3.Error:
        return []
    finally:
        c.close()


def plan(home=None, undo=False):
    """What the migration would do, and what stops it. Reads only."""
    home = Path(home) if home else Path.home()
    src, dst = _names(home, undo)
    blockers = []
    if not src.is_dir() or src.is_symlink():
        blockers.append(f"{src} n'est pas un vrai dossier" + (" : deja migre ?" if (dst.is_dir() and not undo) else ""))
    if dst.exists() and not (dst.is_symlink() and undo is True and dst.resolve() == src.resolve()) \
            and not (dst.is_symlink() and dst.resolve() == src.resolve()):
        blockers.append(f"{dst} existe deja")
    if _running():
        blockers.append("DevAgent est lance : ferme-le d'abord (il garde la base et ses chemins en memoire)")
    try:
        same_fs = os.stat(src).st_dev == os.stat(home).st_dev
    except OSError:
        same_fs = True
    if not same_fs:
        blockers.append(f"{src} est sur un autre disque que {home} : renommage impossible en une fois")
    dbf = _db_file(src)
    return {"de": str(src), "vers": str(dst), "annulation": undo, "bloquants": blockers,
            "base": str(dbf) if dbf.is_file() else None,
            "projets": _project_paths(dbf, src),
            "fichiers": [str(f) for f in _files_outside(home)],
            "claude": [(str(a), str(b)) for a, b in _claude_dirs(home, src, dst) if not b.exists()],
            "lien": None if undo else f"{src} → {dst}",
            "a_mettre_a_jour_a_la_main": {"crontab": _crontab_lines(src)},
            "processus_dans_le_dossier": _others(src)}


def _replace_in(f, old, new):
    try:
        t = f.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return False
    t2 = t.replace(old, new)
    if t2 == t:
        return False
    st = f.stat()
    f.write_text(t2, encoding="utf-8")
    os.chmod(f, st.st_mode)
    return True


def apply(home=None, undo=False, mcp=True):
    """Do the migration (or undo it). Returns the journal of what was done."""
    home = Path(home) if home else Path.home()
    p = plan(home, undo)
    if p["bloquants"]:
        return {"ok": False, "bloquants": p["bloquants"]}
    src, dst = _names(home, undo)
    log = []
    dbf = _db_file(src)
    if dbf.is_file() and not undo:
        shutil.copy2(dbf, dbf.with_name(MARK))
        log.append(f"base copiee : {MARK}")
    if dst.is_symlink():                               # undo: ~/devpilot is the link left by the migration
        dst.unlink()
    os.rename(src, dst)
    log.append(f"dossier renomme : {src} → {dst}")
    if not undo:
        os.symlink(dst, src)
        log.append(f"lien laisse : {src} → {dst}")
    old, new = str(src), str(dst)

    # the database: the projects' paths
    dbf = _db_file(dst)
    if dbf.is_file():
        c = sqlite3.connect(str(dbf), timeout=10)
        try:
            n = 0
            for table, col in (("projects", "path"), ("resources", "path")):
                try:
                    cur = c.execute(f"UPDATE {table} SET {col} = ? || substr({col}, ?) WHERE {col} = ? OR {col} LIKE ?",
                                    (new, len(old) + 1, old, old + "/%"))
                    n += cur.rowcount
                except sqlite3.Error:
                    pass
            c.commit()
            log.append(f"base : {n} chemin(s) mis a jour")
            projects = [r[0] for r in c.execute("SELECT path FROM projects WHERE path IS NOT NULL")]
        finally:
            c.close()
        # each project's own DevAgent files
        n = 0
        for pp in projects:
            d = Path(pp) / ".devpilot"
            if d.is_dir():
                for f in d.glob("*.json"):
                    n += _replace_in(f, old + "/", new + "/")
        log.append(f"projets : {n} fichier(s) .devpilot/*.json mis a jour")

    # commands, menu entry, service
    n = sum(_replace_in(f, old, new) for f in _files_outside(home))
    n += sum(_replace_in(f, f"$HOME/{src.name}/", f"$HOME/{dst.name}/") for f in _files_outside(home))
    log.append(f"commandes et raccourcis : {n} fichier(s) mis a jour")
    try:
        subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        pass

    # the virtual environment's scripts start with the absolute path of its python
    venv_bin = dst / ".devpilot" / "app" / ".venv" / "bin"
    n = 0
    if venv_bin.is_dir():
        for f in venv_bin.iterdir():
            if f.is_file() and not f.is_symlink() and f.stat().st_size < 200_000:
                n += _replace_in(f, old + "/", new + "/")
        n += _replace_in(venv_bin.parent / "pyvenv.cfg", old + "/", new + "/")
    log.append(f"environnement Python : {n} script(s) mis a jour")

    # Claude Code: its memory of each project, copied under the new path
    n = 0
    for a, b in _claude_dirs(home, src, dst):
        if not b.exists():
            shutil.copytree(a, b, symlinks=True)
            n += 1
    log.append(f"Claude Code : memoire de {n} projet(s) copiee sous le nouveau chemin")

    if mcp:
        try:
            from . import mcp_install
            r = mcp_install.install(app=dst / ".devpilot" / "app")
            log.append("Claude Code : serveur MCP enregistre a son nouvel emplacement" if r.get("ok")
                       else f"Claude Code : MCP non enregistre ({r.get('message', '')[:120]}) — relance « devagent mcp installer »")
        except Exception as e:
            log.append(f"Claude Code : MCP non enregistre ({e}) — relance « devagent mcp installer »")
    return {"ok": True, "de": old, "vers": new, "journal": log,
            "a_mettre_a_jour_a_la_main": p["a_mettre_a_jour_a_la_main"]}


def cli(argv):
    undo = "--annuler" in argv
    if "--appliquer" in argv and not undo:
        out = apply()
    elif undo and "--oui" in argv:
        out = apply(undo=True)
    else:
        out = plan(undo=undo)
        out["note"] = ("Simulation : rien n'a ete change. Pour le faire : devagent migrer --appliquer"
                       if not undo else "Simulation de l'annulation. Pour la faire : devagent migrer --annuler --oui")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out.get("ok", not out.get("bloquants")) else 1
