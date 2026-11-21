"""The projects' state shared between two PCs, through a (local, bare) git repo."""
import importlib
import json
import os
from pathlib import Path

import pytest

from conftest import sh


class PC:
    """One of the user's PCs: its own HOME, database and projects."""
    def __init__(self, home, monkeypatch):
        self.home, self.mp = home, monkeypatch
        home.mkdir(exist_ok=True)

    def use(self):
        self.mp.setenv("HOME", str(self.home))
        import db, projects
        importlib.reload(db); importlib.reload(projects)
        from devagent import automations, journal
        automations._ready_for = journal._ready_for = None
        return projects


@pytest.fixture
def two(home, tmp_path, monkeypatch):
    from devagent import etat, registry
    registry.load()
    bare = tmp_path / "etat.git"
    sh("git", "init", "-q", "--bare", "-b", "main", str(bare))
    a, b = PC(tmp_path / "pc-a", monkeypatch), PC(tmp_path / "pc-b", monkeypatch)
    return type("T", (), {"a": a, "b": b, "url": f"file://{bare}", "etat": etat, "bare": bare})


def test_deux_pc(two):
    import model, phases, connections, servers
    from devagent import automations
    etat = two.etat

    # ── PC A: a project with everything DevAgent knows about it ──
    P = two.a.use()
    p = P.create("site", description="le site du client")
    model.set_model(p["id"], profile="vitrine")
    connections.set_domain(p["id"], {"domain": "exemple.ma", "registrar": "ovh"})
    servers.add_server(p["id"], {"name": "vps", "host": "1.2.3.4", "user": "ubuntu", "role": "prod"}, test=False)
    m = P.read_manifest(p["path"]); m["servers"][0]["test"] = {"ok": True, "hostname": "pc-a-voit-ca"}
    P._write_json(P.space_dir(p["path"]) / "project.json", m)
    automations.from_template(p, "sauvegarde-nuit")
    automations.set_active(p, "sauvegarde-nuit", True)
    (P.space_dir(p["path"]) / "sessions").mkdir(exist_ok=True)
    (P.space_dir(p["path"]) / "sessions" / "2026-11-20_debut.md").write_text("# Debut\n")
    (P.space_dir(p["path"]) / "deploiement.json").write_text(json.dumps({"commandes": {"x": "make"}, "token": "SECRET-A"}))
    (P.space_dir(p["path"]) / "sessions" / "2026-11-21_cles.md").write_text("le token = ghp_abcdefghijklmnopqrstuvwxyz0123\n")
    with pytest.raises(P.ProjectError):
        etat.sync()                                                       # not connected yet
    assert etat.connect(two.url)["branche"] is True
    out = etat.sync()
    assert {"site/project.json", "site/connections.json", "site/automations/sauvegarde-nuit.yml",
            "site/sessions/2026-11-20_debut.md"} <= set(out["envoyes"])
    assert out["non_envoyes"] == ["site/deploiement.json", "site/sessions/2026-11-21_cles.md"]   # they hold a secret
    assert out["recus"] == [] and out["ailleurs"] == []
    files = sh("git", "ls-tree", "-r", "--name-only", "main", cwd=two.bare).split()
    assert "projets.json" in files and "projets/site/deploiement.json" not in files
    sent = sh("git", "show", "main:projets/site/project.json", cwd=two.bare)
    assert "pc-a-voit-ca" not in sent and "1.2.3.4" in sent                # the SSH test result stays on PC A
    assert "SECRET-A" not in sh("git", "log", "-p", "main", cwd=two.bare)
    assert etat.sync()["envoyes"] == []                                    # nothing changed: nothing sent

    # ── PC B: knows nothing yet ──
    P = two.b.use()
    etat.connect(two.url)
    out = etat.sync()
    assert out["ailleurs"] == [{"projet": "site", "git": "", "profil": "vitrine", "description": "le site du client"}]
    assert out["recus"] == []
    pb = P.create("site")                                                  # the project arrives on B (cloned, in real life)
    out = etat.sync()
    assert {"site/project.json", "site/connections.json", "site/automations/sauvegarde-nuit.yml"} <= set(out["recus"])
    assert out["ailleurs"] == [] and out["conflits"] == []
    assert model.get_model(pb["id"], probe=False)["profile"] == "vitrine"
    assert connections.domain_state(pb["id"])["config"]["domain"] == "exemple.ma"
    assert [s["host"] for s in servers.list_servers(pb["id"])] == ["1.2.3.4"]
    autos = automations.load(P.get(pb["id"]))
    assert [a["nom"] for a in autos] == ["sauvegarde-nuit"] and autos[0]["actif"] is False   # active on PC A only
    # B moves the project forward
    phases.add_custom(pb["id"], "dev", "Page contact")
    (P.space_dir(pb["path"]) / "prompt.md").write_text("brief ecrit sur B\n")
    out = etat.sync()
    assert "site/project.json" in out["envoyes"] and "site/prompt.md" in out["envoyes"]

    # ── back on PC A: it receives, and keeps what is its own ──
    P = two.a.use()
    pa = P.find_by_name("site")
    out = etat.sync()
    assert "site/project.json" in out["recus"] and "site/prompt.md" in out["recus"] and out["conflits"] == []
    labels = [s["label"] for ph in phases.roadmap(pa["id"])["phases"] for s in ph["steps"]]
    assert "Page contact" in labels
    assert servers.list_servers(pa["id"])[0]["test"]["hostname"] == "pc-a-voit-ca"            # its own SSH test survived
    assert automations.get(pa, "sauvegarde-nuit")["actif"] is True

    # ── both change the same file ──
    (P.space_dir(pa["path"]) / "prompt.md").write_text("version de A\n")
    P = two.b.use()
    pb = P.find_by_name("site")
    (P.space_dir(pb["path"]) / "prompt.md").write_text("version de B\n")
    assert "site/prompt.md" in etat.sync()["envoyes"]
    P = two.a.use()
    out = etat.sync()
    assert [c["fichier"] for c in out["conflits"]] == ["site/prompt.md"] and "conflit" in out["resume"]
    assert (P.space_dir(pa["path"]) / "prompt.md").read_text() == "version de A\n"            # this PC keeps its own
    assert Path(out["conflits"][0]["autre_version"]).read_text() == "version de B\n"          # the other one is beside it
    assert etat.sync()["conflits"] == []


def test_outils_et_routes(two):
    from devagent import guard
    P = two.a.use()
    assert guard.call("sync_etat", actor="mcp")["resultat"]["branche"] is False
    assert guard.call("sync_maintenant", actor="mcp")["statut"] == "erreur"
    import sizes, project_routes, cloud_routes, dashboard
    for m in (sizes, project_routes, cloud_routes, dashboard):
        importlib.reload(m)
    dashboard.app.config.update(TESTING=True, SERVER_NAME="127.0.0.1:5555")
    c = dashboard.app.test_client()
    assert c.get("/api/agent/sync").get_json()["branche"] is False
    assert c.post("/api/agent/sync", json={}).status_code == 400
    assert c.post("/api/agent/sync", json={"connect": True, "url": two.url}).get_json()["result"]["branche"] is True
    c.post("/api/projects", json={"name": "site"})
    r = c.post("/api/agent/sync", json={}).get_json()
    assert r["ok"] and "site/project.json" in r["result"]["envoyes"]
    assert c.post("/api/agent/sync", json={"auto": False}).get_json()["result"]["auto"] is False
    assert two.etat.auto_tick(every=0) is None                              # automatic sync switched off
    c.post("/api/agent/sync", json={"auto": True})
    assert guard.call("sync_maintenant", actor="automatisation:x")["statut"] == "ok"


def test_un_projet_supprime_quitte_l_etat_partage(two):
    etat = two.etat
    P = two.a.use()
    P.create("garde"); p = P.create("a-jeter")
    etat.connect(two.url); etat.sync()
    assert "projets/a-jeter/project.json" in sh("git", "ls-tree", "-r", "--name-only", "main", cwd=two.bare)
    P.on_removed.append(etat.on_project_removed)
    P.remove(p["id"])
    files = sh("git", "ls-tree", "-r", "--name-only", "main", cwd=two.bare)
    assert "a-jeter" not in files and "projets/garde/project.json" in files
    assert "a-jeter" not in sh("git", "show", "main:projets.json", cwd=two.bare)
    P = two.b.use()
    etat.connect(two.url)
    assert [x["projet"] for x in etat.sync()["ailleurs"]] == ["garde"]            # the removed one is not offered any more
