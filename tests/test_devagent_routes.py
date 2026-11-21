"""DevAgent over HTTP: the routes the interface calls, and the removed secret routes."""
import importlib
import json

import pytest


@pytest.fixture
def c(home):
    import sizes, project_routes, cloud_routes, dashboard
    from devagent import automations, chat, journal, registry
    for m in (sizes, project_routes, cloud_routes, dashboard):
        importlib.reload(m)
    journal._ready_for = automations._ready_for = chat._ready_for = None
    automations._running.clear()
    registry.load()
    dashboard.app.config["TESTING"] = True
    dashboard.app.config["SERVER_NAME"] = "127.0.0.1:5555"
    return dashboard.app.test_client()


def test_page_et_fichiers(c):
    r = c.get("/agent")
    html = r.get_data(as_text=True)
    assert r.status_code == 200 and "DA.start()" in html
    for page in ("10-chat.js", "20-confirmations.js", "30-automatisations.js", "40-carte.js", "70-reglages.js"):
        assert f"/agent/assets/pages/{page}" in html                 # found in the folder, not listed by hand
    assert c.get("/agent/assets/agent.js").status_code == 200
    assert c.get("/agent/assets/pages/10-chat.js").status_code == 200
    assert c.get("/agent/assets/../routes.py").status_code == 404
    assert c.get("/agent/assets/nope.js").status_code == 404
    # the main dashboard gets the link, its template untouched
    dash = c.get("/").get_data(as_text=True)
    assert 'id="agent-nav"' in dash and "/ui/js/80-agent-link.js" in dash        # one menu: the agent's screens are in it
    pages = c.get("/api/agent/pages").get_json()["pages"]
    assert [p["id"] for p in pages][:3] == ["afaire", "chat", "confirmations"] and pages[0]["title"] == "A faire par toi"
    assert 'id="nav-dash"' in html                                               # and the dashboard's sections are in the agent's
    # same guard as the rest of the dashboard
    assert c.get("/api/agent/tools", headers={"Host": "evil.example:5555"}).status_code == 403
    assert c.post("/api/agent/pause", json={}, headers={"Origin": "https://evil.example"}).status_code == 403


def test_les_routes_qui_donnaient_un_secret_n_existent_plus(c):
    import db
    import hosting
    db.set_setting("github_token", "ghp_SECRET")
    hosting.save_accounts([{"id": "a1", "name": "v", "platform": "vercel", "token": "TOK-SECRET"}])
    assert c.get("/api/settings/raw/github_token").status_code == 404
    assert c.get("/api/hosting/accounts/a1/token").status_code == 404
    for url in ("/api/settings", "/api/hosting/accounts", "/api/agent/vault", "/api/agent/chat/config", "/api/agent/notify"):
        body = c.get(url).get_data(as_text=True)
        assert "ghp_SECRET" not in body and "TOK-SECRET" not in body, url
    v = c.get("/api/agent/vault").get_json()
    assert v["reglages_encore_en_clair"] == [] and v["reglages_secrets"] >= 2
    # the hosting link still works through the extracted module
    pid = c.post("/api/projects", json={"name": "site"}).get_json()["project"]["id"]
    r = c.post(f"/api/projects/{pid}/hosting", json={"account_id": "a1", "site_url": "https://x.vercel.app"})
    assert r.get_json() == {"success": True, "account": "v", "platform": "vercel"}
    assert c.post(f"/api/projects/{pid}/hosting", json={"account_id": "zzz"}).status_code == 404


def test_outils_confirmations_et_pause(c):
    tools = c.get("/api/agent/tools").get_json()
    assert len(tools["tools"]) >= 80 and "deploiement" in tools["domains"]
    out = c.post("/api/agent/tools/projet_creer", json={"args": {"nom": "demo", "profil": "vitrine"}}).get_json()
    assert out["statut"] == "ok"
    pid = out["resultat"]["id"]
    assert c.post("/api/agent/tools/projet_etat", json={"project_id": pid, "args": {}}).get_json()["statut"] == "ok"
    # even a click in the interface goes through a confirmation for an irreversible tool
    ask = c.post("/api/agent/tools/projet_supprimer", json={"args": {"projet": "demo"}}).get_json()
    assert ask["statut"] == "confirmation_requise"
    assert c.get("/api/agent/state").get_json()["waiting"] == 1
    w = c.get("/api/agent/approvals").get_json()["approvals"][0]
    assert w["confirm_name"] is True and w["tool"] == "projet_supprimer"
    aid = ask["confirmation"]
    assert c.post(f"/api/agent/approvals/{aid}/approve", json={"confirm": "faux"}).get_json()["nom_requis"]
    assert c.post(f"/api/agent/approvals/{aid}/approve", json={"confirm": "demo"}).get_json()["statut"] == "ok"
    assert c.get("/api/agent/state").get_json()["waiting"] == 0
    j = c.get("/api/agent/journal").get_json()["actions"]
    assert {a["tool"] for a in j} >= {"projet_creer", "projet_supprimer"}
    # the classic buttons are journalled too: method and path, never the body
    c.post("/api/settings", json={"github_token": "ghp_NE-PAS-NOTER"})
    c.post("/api/projects", json={"name": "bouton"})
    j = c.get("/api/agent/journal").get_json()["actions"]
    assert {"POST /api/settings", "POST /api/projects"} <= {a["tool"] for a in j}
    assert "ghp_NE-PAS-NOTER" not in json.dumps(j)
    assert not any(a["tool"].startswith("POST /api/agent/") for a in j)       # those are journalled by the guard
    assert c.post("/api/agent/pause", json={"paused": True}).get_json() == {"paused": True}
    assert c.post("/api/agent/pause", json={"paused": False}).get_json() == {"paused": False}


def test_automatisations_par_http(c):
    pid = c.post("/api/projects", json={"name": "site"}).get_json()["project"]["id"]
    r = c.post(f"/api/agent/automations/{pid}/template", json={"template": "depots-a-jour"}).get_json()
    assert r["ok"] and r["result"]["actif"] is False
    assert c.post(f"/api/agent/automations/{pid}/template", json={"template": "inconnu"}).status_code == 400
    one = c.get(f"/api/agent/automations/{pid}/depots-a-jour").get_json()["result"]
    assert "github_tout_mettre_a_jour" in one["yaml"]
    bad = c.put(f"/api/agent/automations/{pid}/depots-a-jour", json={"yaml": "etapes: [{outil: projet_supprimer}]"})
    assert bad.status_code == 400 and "irreversible" in bad.get_json()["message"]
    assert c.put(f"/api/agent/automations/{pid}/depots-a-jour", json={"yaml": "a: [b"}).status_code == 400
    ok = c.put(f"/api/agent/automations/{pid}/essai", json={
        "yaml": "declencheur: {type: webhook}\netapes:\n  - outil: projet_etape_ajouter\n    args: {phase: dev, libelle: Par webhook}\n"})
    assert ok.get_json()["ok"]
    assert c.post(f"/api/agent/automations/{pid}/essai/active", json={"active": True}).get_json()["result"]["actif"]
    run = c.post(f"/api/agent/automations/{pid}/essai/run", json={}).get_json()["result"]
    assert run["statut"] == "ok"
    tok = c.post(f"/api/agent/automations/{pid}/essai/hook", json={}).get_json()["result"]["token"]
    assert c.post(f"/api/agent/hooks/{tok}").get_json() == {"ok": True, "started": "essai"}
    assert c.post("/api/agent/hooks/mauvais-jeton-xxxxxxxx").status_code == 404
    lst = c.get(f"/api/agent/automations?project_id={pid}").get_json()
    assert {a["nom"] for a in lst["automations"]} == {"depots-a-jour", "essai"} and "sauvegarde-nuit" in lst["templates"]
    assert c.get(f"/api/agent/automations/runs?project_id={pid}").get_json()["runs"]
    assert c.delete(f"/api/agent/automations/{pid}/essai").get_json()["ok"]


def test_carte_chat_et_reglages_par_http(c, monkeypatch):
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    pid = c.post("/api/projects", json={"name": "site"}).get_json()["project"]["id"]
    m = c.get(f"/api/agent/map/{pid}").get_json()
    assert m["ok"] and m["result"]["project"] == "site"
    assert c.get("/api/agent/map/9999").status_code == 400
    assert c.get("/api/agent/projects").get_json()["projects"][0]["name"] == "site"
    assert c.get("/api/agent/chat/config").get_json()["configured"] is False
    chat_id = c.post("/api/agent/chats", json={"project_id": pid}).get_json()["id"]
    r = c.post(f"/api/agent/chats/{chat_id}/send", json={"text": "bonjour"})
    assert r.status_code == 400 and "cle API" in r.get_json()["message"]
    cfg = c.post("/api/agent/chat/config", json={"api_key": "sk-ant-XYZ", "model": "claude-opus-5-5", "effort": "high"}).get_json()
    assert cfg == {"configured": True, "model": "claude-opus-5-5", "effort": "high", "key_saved": True}
    assert c.get(f"/api/agent/chats/{chat_id}").get_json()["status"] == "pret"
    assert c.get("/api/agent/chats/9999").status_code == 404
    n = c.post("/api/agent/notify", json={"notify_telegram_bot_token": "1:ABC", "notify_telegram_chat_id": "7",
                                          "pas_un_reglage": "x"}).get_json()
    assert n["channels"]["telegram"] is True and n["settings"]["notify_telegram_bot_token"] == "****"
    import db
    assert db.get_setting("pas_un_reglage") is None
    # saving the form again with the masked value must not erase the token
    c.post("/api/agent/notify", json={"notify_telegram_bot_token": "****"})
    assert db.get_setting("notify_telegram_bot_token") == "1:ABC"
