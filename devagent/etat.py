"""Sync of the projects' state between the user's PCs.

Git carries the CODE of each project. It does not carry what DevAgent knows about it — the
project's `.devpilot/` folder (profile, needs, roadmap, servers, connections, automations,
session notes), which is kept out of the project's repo on purpose. This module carries it,
through ONE private GitHub repo of the user (« devagent-etat »), cloned in
`<root>/.devpilot/etat/`:

    projets/<nom>/project.json, connections.json, deploiement.json, prompt.md,
                  automations/*.yml, sessions/*.md
    projets.json  the list of projects (name, git remote, profile) — so another PC knows
                  which projects exist and can clone the ones it lacks

    sync()   both ways, file by file:
               changed here only            → sent
               changed on the other PC only → received
               changed on both              → THIS PC keeps its file; the other version is saved
                                              beside it (<file>.autre-pc) and reported
               first time this PC sees a project the others already share → their version is
                                              taken; the file this PC had is kept (<file>.avant-synchro)

Never synced: secrets (keys travel through Bitwarden), which automations are ACTIVE (decided on
each PC, so a backup does not run twice), the result of the last SSH test of a server.
"""
import hashlib
import json
import shutil
import socket
import subprocess
from datetime import datetime
from pathlib import Path

import db
import paths
import projects as P

from . import vault

REPO_NAME = "devagent-etat"
FILES = ("project.json", "connections.json", "deploiement.json", "prompt.md")
GLOBS = (("automations", "*.yml"), ("sessions", "*.md"))
CONFLICT = ".autre-pc"
FIRST = ".avant-synchro"


def state_dir():
    return paths.root() / ".devpilot" / "etat"


def _index_file():
    return paths.root() / ".devpilot" / "data" / "etat-index.json"


def _git(args, cwd=None, timeout=90):
    try:
        r = subprocess.run(["git", *args], cwd=str(cwd or state_dir()), capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "", "delai depasse"
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def connected():
    return (state_dir() / ".git").is_dir()


def info():
    rc, url, _ = _git(["remote", "get-url", "origin"]) if connected() else (1, "", "")
    return {"branche": connected(), "depot": url if rc == 0 else None, "dossier": str(state_dir()),
            "derniere_synchro": db.get_setting("etat_last_sync", "") or None,
            "auto": db.get_setting("etat_sync_auto", "1") == "1"}


def connect(url=None):
    """Clone the state repo here. Without url: the private repo « devagent-etat » of the GitHub
    account of this PC, created when it does not exist yet."""
    d = state_dir()
    if connected():
        return info()
    if not url:
        if not shutil.which("gh"):
            raise P.ProjectError("L'outil gh n'est pas installe : donne l'adresse du depot (devagent sync brancher <url>)")
        r = subprocess.run(["gh", "api", "user", "-q", ".login"], capture_output=True, text=True, timeout=30)
        login = r.stdout.strip()
        if r.returncode != 0 or not login:
            raise P.ProjectError("gh n'est pas connecte a GitHub : gh auth login")
        full = f"{login}/{REPO_NAME}"
        if subprocess.run(["gh", "repo", "view", full], capture_output=True, text=True, timeout=30).returncode != 0:
            c = subprocess.run(["gh", "repo", "create", full, "--private", "--description",
                                "DevAgent : etat des projets, synchronise entre mes PC (aucun secret)"],
                               capture_output=True, text=True, timeout=60)
            if c.returncode != 0:
                raise P.ProjectError(f"Creation du depot refusee : {c.stderr.strip()[:200]}")
        url = f"git@github.com:{full}.git"
    if d.exists() and any(d.iterdir()):
        raise P.ProjectError(f"{d} existe deja et n'est pas un depot : deplace-le d'abord")
    d.parent.mkdir(parents=True, exist_ok=True)
    rc, _, err = _git(["clone", "-q", url, str(d)], cwd=d.parent, timeout=180)
    if rc != 0:
        raise P.ProjectError(f"Clonage impossible : {err[:200]}")
    if _git(["rev-parse", "--verify", "-q", "HEAD"])[0] != 0:        # brand-new empty repo
        _git(["checkout", "-q", "-b", "main"])
    return info()


# ── What is synced ──────────────────────────────────────────────────────────

def _files(folder):
    """Relative paths of the syncable files present in a .devpilot folder (or its copy)."""
    out = [f for f in FILES if (folder / f).is_file()]
    for sub, pat in GLOBS:
        if (folder / sub).is_dir():
            out += sorted(f"{sub}/{x.name}" for x in (folder / sub).glob(pat) if x.is_file())
    return out


def _has_secret(obj):
    if isinstance(obj, dict):
        return any((k in vault.SECRET_FIELDS and isinstance(v, str) and v) or _has_secret(v) for k, v in obj.items())
    if isinstance(obj, list):
        return any(_has_secret(v) for v in obj)
    return isinstance(obj, str) and vault.is_sealed(obj)


# a note or a brief that looks like it holds a key is not sent (better one file less than a leak)
_LOOKS_SECRET = __import__("re").compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-ant-[\w-]{10,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b"
    r"|\bxox[baprs]-[\w-]{10,}|(?i:(password|mot de passe|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{8,})")


def _export(rel, text):
    """A local file as it goes to the repo: without what belongs to this PC only.
    None = not sent (it holds a secret)."""
    if not rel.endswith(".json"):
        return None if (vault.PREFIX in text or _LOOKS_SECRET.search(text)) else text
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if rel == "project.json":
        for s in data.get("servers") or []:
            s.pop("test", None)                       # the result of the last SSH test from THIS PC
        (data.get("controller") or {}).pop("status", None)
    if _has_secret(data):
        return None
    return json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def _import(rel, text, local_file):
    """A file from the repo as it is written here: what belongs to this PC is kept."""
    if rel != "project.json" or not local_file.is_file():
        return text
    try:
        new, old = json.loads(text), json.loads(local_file.read_text(encoding="utf-8"))
    except ValueError:
        return text
    tests = {s.get("id"): s.get("test") for s in old.get("servers") or [] if s.get("test")}
    for s in new.get("servers") or []:
        if s.get("id") in tests:
            s["test"] = tests[s["id"]]
    return json.dumps(new, indent=2, ensure_ascii=False) + "\n"


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _read(f):
    try:
        return f.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _load_index():
    try:
        return json.loads(_index_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _apply_to_app(project, changed):
    """Files arrived: let the application see them (connections, profile)."""
    import connections
    if "connections.json" in changed:
        try:
            data = json.loads((P.space_dir(project["path"]) / "connections.json").read_text(encoding="utf-8"))
            for key, cfg in data.items():
                if isinstance(cfg, dict):
                    comp = db.get_project_component(project["id"], key)
                    merged = {**((comp or {}).get("config") or {}), **cfg}      # local secrets stay
                    if comp:
                        db.update_project_component(project["id"], key, config=merged, enabled=True)
                    else:
                        db.add_project_component(project["id"], key, enabled=True, config=merged)
        except (OSError, ValueError):
            pass
    if "project.json" in changed:
        m = P.read_manifest(project["path"])
        if m.get("profile") is not None and m.get("profile") != (project.get("profile") or ""):
            db.set_project_profile(project["id"], m.get("profile") or "")


# ── Sync ────────────────────────────────────────────────────────────────────

def _pull():
    if _git(["rev-parse", "--verify", "-q", "HEAD"])[0] != 0 and not _git(["ls-remote", "--heads", "origin"])[1]:
        return                                              # empty repo on both sides
    rc, _, err = _git(["pull", "-q", "--rebase", "origin", "main"], timeout=120)
    if rc != 0 and "couldn't find remote ref" not in err.lower() and "no such ref" not in err.lower():
        _git(["rebase", "--abort"])
        raise P.ProjectError(f"Recuperation de l'etat impossible : {err[:200]}")


def sync():
    """Both ways. Returns {envoyes, recus, conflits, ailleurs, non_envoyes}."""
    if not connected():
        raise P.ProjectError("La synchronisation n'est pas branchee sur ce PC : devagent sync brancher")
    repo = state_dir()
    _pull()
    index = _load_index()
    sent, received, conflicts, skipped, adopted = [], [], [], [], []
    local = [p for p in P.all_projects() if p.get("path") and Path(p["path"]).is_dir()]
    for p in local:
        name, here, there = p["name"], P.space_dir(p["path"]), repo / "projets" / p["name"]
        seen = index.setdefault(name, {})
        changed_here = []
        for rel in sorted(set(_files(here)) | set(_files(there))):
            lf, rf = here / rel, there / rel
            ltext = _read(lf) if lf.is_file() else None
            lexp = _export(rel, ltext) if ltext is not None else None
            if ltext is not None and lexp is None:
                skipped.append(f"{name}/{rel}")
                continue
            rtext = _read(rf) if rf.is_file() else None
            lh, rh, base = (_sha(lexp) if lexp is not None else None), (_sha(rtext) if rtext is not None else None), seen.get(rel)
            if lh == rh:
                if lh:
                    seen[rel] = lh
                continue
            if rh is None or (base == rh and lh is not None):          # new here, or changed here only → send
                rf.parent.mkdir(parents=True, exist_ok=True)
                rf.write_text(lexp, encoding="utf-8")
                seen[rel] = lh
                sent.append(f"{name}/{rel}")
            elif lh is None or base == lh or base is None:
                # new there, changed there only — or this PC meets the project for the first time:
                # what the other PCs agreed on wins; the file this PC had is kept beside it
                if lh is not None and base is None:
                    lf.with_name(lf.name + FIRST).write_text(ltext, encoding="utf-8")
                    adopted.append(f"{name}/{rel}")
                lf.parent.mkdir(parents=True, exist_ok=True)
                lf.write_text(_import(rel, rtext, lf), encoding="utf-8")
                seen[rel] = rh
                received.append(f"{name}/{rel}")
                changed_here.append(rel)
            else:                                                       # both changed: this PC keeps its own
                side = lf.with_name(lf.name + CONFLICT)
                side.write_text(rtext, encoding="utf-8")
                rf.write_text(lexp, encoding="utf-8")
                seen[rel] = lh
                conflicts.append({"fichier": f"{name}/{rel}", "autre_version": str(side)})
                sent.append(f"{name}/{rel}")
        if changed_here:
            _apply_to_app(p, changed_here)
    # the list of projects, so another PC knows what exists
    listing_f = repo / "projets.json"
    try:
        listing = json.loads(listing_f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        listing = {}
    for p in local:
        listing[p["name"]] = {"git": p.get("git_remote") or "", "profil": p.get("profile") or "",
                              "description": p.get("description") or ""}
    new_listing = json.dumps(listing, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    if _read(listing_f) != new_listing:
        listing_f.write_text(new_listing, encoding="utf-8")
    names = {p["name"] for p in local}
    elsewhere = [{"projet": n, **v} for n, v in sorted(listing.items()) if n not in names]

    _git(["add", "-A"])
    if _git(["status", "--porcelain"])[1]:
        _git(["-c", "user.name=DevAgent", "-c", f"user.email=devagent@{socket.gethostname()}", "commit", "-q", "-m",
              f"Etat depuis {socket.gethostname()} : {len(sent)} fichier(s)"])
        rc, _, err = _git(["push", "-q", "origin", "HEAD:main"], timeout=120)
        if rc != 0:                                          # another PC pushed meanwhile: take it, try once more
            _pull()
            rc, _, err = _git(["push", "-q", "origin", "HEAD:main"], timeout=120)
            if rc != 0:
                raise P.ProjectError(f"Envoi de l'etat refuse : {err[:200]}")
    _index_file().parent.mkdir(parents=True, exist_ok=True)
    _index_file().write_text(json.dumps(index), encoding="utf-8")
    db.set_setting("etat_last_sync", datetime.now().isoformat(timespec="seconds"))
    return {"envoyes": sent, "recus": received, "conflits": conflicts, "ailleurs": elsewhere, "non_envoyes": skipped,
            "remplaces_a_la_premiere_synchro": adopted,
            "resume": f"{len(sent)} envoye(s), {len(received)} recu(s)"
                      + (f", {len(conflicts)} conflit(s) a regarder" if conflicts else "")
                      + (f", {len(elsewhere)} projet(s) existent sur un autre PC" if elsewhere else "")}


_last_auto = 0.0


def auto_tick(every=600):
    """Called by the scheduler: sync now and then when it is connected and allowed."""
    global _last_auto
    import time
    if not connected() or db.get_setting("etat_sync_auto", "1") != "1" or time.time() - _last_auto < every:
        return None
    _last_auto = time.time()
    try:
        return sync()
    except Exception as e:
        try:
            db.log_event("sync_error", "agent", "etat", "", 0, None, (getattr(e, "message", None) or str(e))[:400])
        except Exception:
            pass
        return None


def cli(argv):
    sub = argv[0] if argv else "maintenant"
    try:
        if sub == "brancher":
            out = connect(argv[1] if len(argv) > 1 else None)
        elif sub == "etat":
            out = info()
        else:
            out = sync()
    except Exception as e:
        if type(e).__name__ != "ProjectError":
            raise
        print(f"✗ {e.message}")
        return 1
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0
