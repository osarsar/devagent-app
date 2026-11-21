"""The map of a project: what it is made of and how the parts are linked.

Built from what DevAgent already knows — nothing is drawn by hand:
    connexions   the project's needs and their real state (GitHub, hosting, domain...)
    depots       its git repos
    services     what runs: a fleet manifest (deploy/services.json, as MarocDefender
                 has) when there is one, else the services of its docker-compose files
    machines     its servers, and the roles of the fleet manifest
    automations  its automations

    build(pid) -> {project, columns: [{key, label, nodes: [...]}], edges: [{from, to, label}]}
"""
import json
import os
from pathlib import Path

import yaml

import dev
import model
import projects as P
import servers

SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".pytest_cache"}
STATE_COLOR = {"ok": "ok", "delegated": "ok", "partial": "warn", "missing": "bad"}


def _walk(root, depth):
    """Folders under root, down to ``depth`` levels, skipping heavy ones."""
    out, todo = [], [(Path(root), 0)]
    while todo:
        d, lvl = todo.pop()
        out.append(d)
        if lvl >= depth:
            continue
        try:
            for e in os.scandir(d):
                if e.is_dir(follow_symlinks=False) and e.name not in SKIP_DIRS and not e.name.startswith(".devpilot"):
                    todo.append((Path(e.path), lvl + 1))
        except OSError:
            pass
    return out


def find_manifest(root):
    """A fleet manifest: a services.json holding {"services": {...}} (depth ≤ 3)."""
    for d in _walk(root, 3):
        f = d / "services.json"
        if f.is_file():
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(data.get("services"), dict):
                return f, data
    return None, None


def find_compose(root):
    """{relative file: {service: {depends_on, ports, image, build}}} for compose files (depth ≤ 2)."""
    found = {}
    for d in _walk(root, 2):
        for f in sorted(d.glob("docker-compose*.y*ml")) + sorted(d.glob("compose*.y*ml")):
            if any(x in f.name for x in (".bak", ".example")):
                continue
            try:
                data = yaml.safe_load(f.read_text(encoding="utf-8", errors="replace"))
            except (yaml.YAMLError, OSError):
                continue
            svcs = (data or {}).get("services") if isinstance(data, dict) else None
            if isinstance(svcs, dict) and svcs:
                found[str(f.relative_to(root))] = svcs
    return found


def _deps(svc):
    d = svc.get("depends_on") or []
    return list(d.keys()) if isinstance(d, dict) else [str(x) for x in d]


def _ports(svc):
    out = []
    for p in svc.get("ports") or []:
        s = str(p.get("published") if isinstance(p, dict) else p)
        out.append(s.split(":")[0] if ":" in s else s)
    return [x for x in out if x and x != "None"]


def build(pid):
    project = P.get(pid)
    root = project.get("path")
    cols = {k: {"key": k, "label": l, "nodes": []} for k, l in (
        ("connexions", "Connexions"), ("depots", "Depots"), ("services", "Services"),
        ("machines", "Machines"), ("automatisations", "Automatisations"))}
    edges = []

    def node(col, nid, label, sub="", state="", detail="", kind=""):
        cols[col]["nodes"].append({"id": nid, "label": label, "sub": sub, "state": state,
                                   "detail": detail, "kind": kind})
        return nid

    # connections (needs)
    try:
        st = model.connections_status(pid, probe=False)
        for n in st["needs"]:
            node("connexions", f"need:{n['need']}", n["label"], n.get("detail") or "",
                 STATE_COLOR.get(n["state"], ""), n["state"], "connexion")
    except Exception:
        st = {"needs": []}

    if not root or not os.path.isdir(root):
        return {"project": project["name"], "columns": list(cols.values()), "edges": edges,
                "note": "Le dossier du projet est introuvable."}

    # repos
    repo_dirs = {}
    try:
        for r in dev.repos(pid, fetch=False)["repos"]:
            d = r.get("dir", ".")
            dirty = (r.get("modified") or 0) + (r.get("untracked") or 0)
            sub = (r.get("branch") or "") + (f" · {dirty} modif." if dirty else "")
            repo_dirs[d] = node("depots", f"repo:{d}", "racine" if d == "." else os.path.basename(d), sub,
                                "warn" if dirty else "ok", "" if d == "." else f"dossier {d}", "depot")
            if any(n["need"] == "github" for n in st["needs"]):
                edges.append({"from": "need:github", "to": f"repo:{d}"})
    except Exception:
        pass

    def repo_of(path):
        """The repo node whose folder contains ``path`` (longest match)."""
        best = None
        for d, nid in repo_dirs.items():
            if d != "." and (path == d or path.startswith(d.rstrip("/") + "/")):
                if best is None or len(d) > len(best[0]):
                    best = (d, nid)
        return best[1] if best else repo_dirs.get(".")

    # services: the fleet manifest when there is one, else docker-compose
    mfile, manifest = find_manifest(root)
    source = None
    if manifest:
        source = str(mfile.relative_to(root))
        base = str(mfile.parent.parent.relative_to(root)) if mfile.parent.parent != Path(root) else ""
        for role, r in (manifest.get("roles") or {}).items():
            node("machines", f"role:{role}", r.get("label", role), (r.get("desc") or "")[:90], "", "", "role")
        for key, s in manifest["services"].items():
            node("services", f"svc:{key}", s.get("label", key), s.get("kind", ""), "", (s.get("desc") or "")[:300],
                 "service")
            if s.get("role"):
                edges.append({"from": f"svc:{key}", "to": f"role:{s['role']}"})
            if s.get("dir"):
                rn = repo_of(os.path.join(base, s["dir"]) if base else s["dir"])
                if rn:
                    edges.append({"from": rn, "to": f"svc:{key}"})
            for need in s.get("needs") or []:
                if need.get("service") in manifest["services"]:
                    edges.append({"from": f"svc:{key}", "to": f"svc:{need['service']}",
                                  "label": need.get("via", ""), "dashed": bool(need.get("facultatif"))})
    else:
        seen = set()
        for rel, svcs in find_compose(root).items():
            source = source or rel
            for name, s in svcs.items():
                if name in seen or not isinstance(s, dict):
                    continue
                seen.add(name)
                ports = _ports(s)
                node("services", f"svc:{name}", name, (":" + ", :".join(ports)) if ports else (s.get("image") or ""),
                     "", f"defini dans {rel}", "service")
                build_ctx = s.get("build")
                ctx = build_ctx.get("context") if isinstance(build_ctx, dict) else build_ctx
                if isinstance(ctx, str):
                    rn = repo_of(os.path.normpath(os.path.join(os.path.dirname(rel), ctx)))
                    if rn:
                        edges.append({"from": rn, "to": f"svc:{name}"})
            for name, s in svcs.items():
                if isinstance(s, dict):
                    for d in _deps(s):
                        if d in seen:
                            edges.append({"from": f"svc:{name}", "to": f"svc:{d}"})

    # servers
    try:
        for s in servers.list_servers(pid):
            t = s.get("test") or {}
            node("machines", f"srv:{s['id']}", s["name"], f"{s.get('role', '')} · {s.get('host', '')}",
                 "ok" if t.get("ok") else ("bad" if t else ""), t.get("error", ""), "serveur")
            if any(n["need"] == "hosting" for n in st["needs"]):
                edges.append({"from": "need:hosting", "to": f"srv:{s['id']}"})
    except Exception:
        pass

    # automations
    try:
        from . import automations
        for a in automations.load(project):
            t = a["declencheur"]
            when = t.get("a") or t.get("toutes") or t.get("type", "")
            last = (a.get("dernier") or {}).get("status")
            node("automatisations", f"auto:{a['nom']}", a["nom"],
                 f"{t.get('type', '')} {when}".strip() + ("" if a["actif"] else " · inactive"),
                 "bad" if last == "echec" else ("ok" if a["actif"] else ""), a.get("description", ""), "automatisation")
    except Exception:
        pass

    return {"project": project["name"], "columns": [c for c in cols.values() if c["nodes"]],
            "edges": edges, "services_source": source}
