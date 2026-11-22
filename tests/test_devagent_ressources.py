"""What a project costs this PC: the disk by kind, the live figures, the routes and the agent tool."""
import os
import time


def _write(path, n):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"x" * n)


def test_disque_par_categorie(home, P):
    from devagent import ressources as R
    R._disk.clear()
    p = P.create("site")
    root = p["path"]
    _write(os.path.join(root, "app", "node_modules", "lib", "a.js"), 300_000)
    _write(os.path.join(root, "app", ".next", "cache", "b"), 200_000)
    _write(os.path.join(root, "data", "corpus.bin"), 500_000)
    _write(os.path.join(root, "app", "node_modules", ".cache", "inside"), 50_000)   # inside a node_modules: counted once
    R.disk(p["id"], refresh=True)
    for _ in range(100):
        d = R.disk(p["id"])
        if not d["en_cours"] and d.get("total"):
            break
        time.sleep(0.1)
    parts = {x["cle"]: x["taille"] for x in d["parts"]}
    assert parts["deps"] >= 350_000 and parts["builds"] >= 200_000 and parts["builds"] < 300_000
    assert parts["code"] >= 500_000
    assert d["total"] == sum(parts.values()) or abs(d["total"] - sum(parts.values())) < 50_000
    assert d["plus_gros"][0]["chemin"] in ("app", "data") and d["age_s"] >= 0
    assert R.disk(999999) is None


def test_direct_et_routes(home, P, monkeypatch):
    from devagent import ressources as R
    monkeypatch.setattr(R, "_docker_stats", lambda names: {})
    monkeypatch.setattr(R, "_container_dirs", lambda: {})
    monkeypatch.setattr(R, "_gpu_by_pid", lambda: {})
    p = P.create("site")
    R._sample()
    l = R.live(p["id"])
    assert l["en_marche"] is False and l["ram"] == 0 and isinstance(l["historique"], list)

    import dashboard
    dashboard.app.config["SERVER_NAME"] = "127.0.0.1:5555"
    c = dashboard.app.test_client()
    r = c.get(f"/api/agent/ressources/{p['id']}").get_json()
    assert {"disque", "live", "machine"} <= set(r) and r["machine"]["coeurs"] >= 1
    o = c.get("/api/agent/ressources").get_json()["projets"]
    assert str(p["id"]) in o and {"disque", "en_marche", "cpu", "ram", "gpu"} <= set(o[str(p["id"])])


def test_outil_de_l_agent(home, P):
    from devagent import guard
    P.create("site")
    out = guard.call("projet_ressources", {"projet": "site"}, actor="mcp")
    assert out["statut"] == "ok" and out["resultat"]["projet"] == "site" and "en_marche" in out["resultat"]
