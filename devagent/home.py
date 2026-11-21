"""The home screen: what matters now, across every project — real information, read from what
DevAgent already knows (no network call, so the screen opens at once).

    build() -> {
      a_faire, confirmations,          what waits for the user
      alertes,                         what is wrong or about to be: accesses, automations, sites, unsent work
      projets,                         each project: phase, next step, health
      systeme, sync, activite          the PC, the sync between PCs, the last actions
    }
"""
import shutil
from pathlib import Path

import db
import model
import phases
import projects as P

from . import access, automations, journal, todos


def _project(p):
    pid = p["id"]
    out = {"id": pid, "nom": p["name"], "profil": p.get("profile") or "", "description": p.get("description") or "",
           "dossier_present": bool(p.get("path") and Path(p["path"]).is_dir()), "phase": None, "prochaine": None,
           "fait": 0, "total": 0, "site": None, "domaine": None, "depots": 0, "non_envoye": 0, "manque": [],
           "automatisations": 0, "automatisations_en_echec": 0}
    try:
        s = phases.summary(pid) or {}
        out.update(phase=s.get("current_label"), fait=s.get("done") or 0, total=s.get("total") or 0)
        nxt = (phases.roadmap(pid) or {}).get("next") or {}
        out["prochaine"] = nxt.get("label") if isinstance(nxt, dict) else None
    except Exception:
        pass
    try:
        st = model.connections_status(pid, probe=False)
        out["manque"] = [n["label"] for n in st["needs"] if n["state"] == "missing"]
    except Exception:
        pass
    try:
        dom = (db.get_project_component(pid, "domain") or {}).get("config") or {}
        out["domaine"] = dom.get("domain") or None
        if dom.get("domain"):
            ok = dom.get("site_ok")
            out["site"] = "ok" if ok is True or ok == "True" else ("en_panne" if ok is False or ok == "False" else "inconnu")
    except Exception:
        pass
    if out["dossier_present"]:
        try:
            repos = P.find_repos(p["path"])
            out["depots"] = len(repos)
            for r in repos:
                st = P.git_state(Path(p["path"]) / r["dir"])
                if (st.get("modified") or 0) + (st.get("untracked") or 0) + (st.get("unpushed") or 0):
                    out["non_envoye"] += 1
        except Exception:
            pass
        try:
            autos = automations.load(p)
            out["automatisations"] = sum(1 for a in autos if a["actif"])
            out["automatisations_en_echec"] = sum(1 for a in autos if a["actif"] and (a.get("dernier") or {}).get("status") == "echec")
        except Exception:
            pass
    out["sante"] = ("bad" if out["site"] == "en_panne" or out["automatisations_en_echec"] or not out["dossier_present"]
                    else "warn" if out["non_envoye"] or out["manque"] else "ok")
    return out


def _alerts(projs):
    al = []
    for e in access.status():
        if e["state"] in ("en_panne", "expire", "expire_bientot"):
            al.append({"niveau": "bad" if e["state"] != "expire_bientot" else "warn", "titre": e["label"],
                       "texte": access.explain(e), "page": "agent:acces", "lien": e.get("create_url") or None})
    for p in projs:
        if not p["dossier_present"]:
            al.append({"niveau": "bad", "titre": p["nom"], "texte": "le dossier du projet est introuvable sur ce PC",
                       "projet": p["id"]})
        if p["site"] == "en_panne":
            al.append({"niveau": "bad", "titre": p["nom"], "texte": f"le site {p['domaine']} ne repondait plus a la derniere verification",
                       "projet": p["id"]})
        if p["automatisations_en_echec"]:
            al.append({"niveau": "bad", "titre": p["nom"], "texte": f"{p['automatisations_en_echec']} automatisation(s) en echec",
                       "projet": p["id"], "page": "agent:automatisations"})
        if p["non_envoye"]:
            al.append({"niveau": "warn", "titre": p["nom"],
                       "texte": f"du travail n'est pas envoye sur GitHub dans {p['non_envoye']} depot(s)", "projet": p["id"]})
    try:
        du = shutil.disk_usage("/")
        if du.free < 5 * 1024 ** 3:
            al.append({"niveau": "bad" if du.free < 2 * 1024 ** 3 else "warn", "titre": "Disque",
                       "texte": f"il reste {du.free / 1024 ** 3:.1f} Go sur le disque systeme", "page": "storage"})
    except OSError:
        pass
    order = {"bad": 0, "warn": 1}
    return sorted(al, key=lambda a: order.get(a["niveau"], 2))


def build():
    from . import etat, guard
    projs = [_project(p) for p in P.all_projects()]
    waiting = journal.approvals("attente")
    for a in waiting:
        a.pop("result", None)
    try:
        du = shutil.disk_usage(str(Path.home()))
        systeme = {"libre_go": round(du.free / 1024 ** 3, 1), "pourcent": round(du.used * 100 / du.total)}
    except OSError:
        systeme = {}
    return {"a_faire": [todos.public(t) | {"id": t["id"]} for t in todos.items("ouverte")][:8],
            "a_faire_total": todos.count(), "confirmations": waiting[:5], "confirmations_total": len(waiting),
            "alertes": _alerts(projs), "projets": projs, "systeme": systeme, "pause": guard.paused(),
            "sync": etat.info(), "activite": journal.actions(limit=8)}
