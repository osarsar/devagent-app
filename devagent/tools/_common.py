"""Shared helpers of the tools."""
import os
from pathlib import Path

import db
import projects as P

from ..registry import ToolError


def resolve_project(ctx, ref=None):
    """The project named by ``ref`` (name or number); without ref, the project of
    the caller (its current folder)."""
    ref = (str(ref).strip() if ref is not None else "")
    if not ref:
        pid = (ctx or {}).get("project_id")
        if pid:
            return P.get(int(pid))
        cwd = (ctx or {}).get("cwd")
        if cwd:
            here = Path(cwd).resolve()
            best = None
            for p in P.all_projects():
                if not p.get("path"):
                    continue
                root = Path(p["path"]).resolve()
                if here == root or root in here.parents:
                    if best is None or len(str(root)) > len(str(Path(best["path"]).resolve())):
                        best = p
            if best:
                return best
        raise ToolError("Quel projet ? Donne son nom (projet_lister les montre).")
    if ref.isdigit():
        return P.get(int(ref))
    allp = P.all_projects()
    exact = [p for p in allp if p["name"].lower() == ref.lower()]
    if exact:
        return exact[0]
    close = [p for p in allp if ref.lower() in p["name"].lower()]
    if len(close) == 1:
        return close[0]
    if close:
        raise ToolError("Plusieurs projets correspondent : " + ", ".join(p["name"] for p in close))
    raise ToolError(f"Projet « {ref} » introuvable. Projets : " + ", ".join(p["name"] for p in allp))


def project_dir(project):
    path = project.get("path")
    if not path or not os.path.isdir(path):
        raise P.ProjectError(f"Le dossier du projet « {project['name']} » est introuvable")
    return Path(path)


def inside(project, relative):
    """An existing path INSIDE the project folder (no '..', no symlink out)."""
    root = project_dir(project).resolve()
    p = (root / (relative or ".")).resolve()
    if p != root and root not in p.parents:
        raise ToolError("Chemin refuse : il sort du dossier du projet")
    return p


def github_token():
    return db.get_setting("github_token", "") or ""


def checked(res):
    """Older functions answer {"success": False, "message": ...} or (ok, text):
    turn a failure into a ToolError, return the rest."""
    if isinstance(res, tuple) and len(res) == 2 and isinstance(res[0], bool):
        if not res[0]:
            raise ToolError(str(res[1]).strip() or "Echec")
        return {"message": str(res[1]).strip()}
    if isinstance(res, dict) and (res.get("success") is False or res.get("connected") is False):
        raise ToolError(res.get("message") or res.get("error") or "Echec")
    if isinstance(res, dict) and res.get("error") and len(res) == 1:
        raise ToolError(res["error"])
    return res
