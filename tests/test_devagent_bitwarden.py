"""Bitwarden: send the keys of a PC, get them back on another one — with a fake `bw`."""
import json
import os
import sqlite3
import stat
import sys

import pytest

FAKE_BW = r'''#!%(python)s
import base64, json, os, sys
STATE = os.environ["FAKE_BW_STATE"]
st = json.load(open(STATE))
a = [x for x in sys.argv[1:] if x != "--nointeraction"]
st.setdefault("log", []).append(a[:3])
def save(): json.dump(st, open(STATE, "w"))
def need_session():
    if os.environ.get("BW_SESSION") != st.get("session") or not st.get("session"):
        save(); sys.stderr.write("Vault is locked."); sys.exit(1)
if a[0] == "status":
    print(json.dumps({"status": st["status"], "userEmail": "moi@exemple.ma", "serverUrl": "https://vault.bitwarden.eu"}))
elif a[0] == "unlock":
    if os.environ.get(a[a.index("--passwordenv") + 1]) != st["password"]:
        save(); sys.stderr.write("Invalid master password."); sys.exit(1)
    assert st["password"] not in " ".join(sys.argv), "the password must never be on the command line"
    st["session"] = "SESS-%%d" %% len(st["log"]); st["status"] = "unlocked"; print(st["session"])
elif a[0] == "lock":
    st["session"] = None; st["status"] = "locked"
elif a[0] == "sync":
    need_session()
elif a[:2] == ["list", "items"]:
    need_session(); print(json.dumps([i for i in st["items"] if a[a.index("--search") + 1] in i["name"]]))
elif a[:3] == ["get", "template", "item"]:
    need_session(); print(json.dumps({"organizationId": None, "folderId": None, "type": 1, "name": "Item name", "notes": "",
        "favorite": False, "fields": [], "login": {}, "secureNote": None, "card": None, "identity": None, "reprompt": 0}))
elif a[:2] == ["create", "item"]:
    need_session(); item = json.loads(base64.b64decode(sys.stdin.read())); item["id"] = "id-%%d" %% len(st["items"]); st["items"].append(item)
elif a[:2] == ["edit", "item"]:
    need_session(); item = json.loads(base64.b64decode(sys.stdin.read()))
    st["items"] = [item if i["id"] == a[2] else i for i in st["items"]]
else:
    save(); sys.stderr.write("unknown " + " ".join(a)); sys.exit(2)
save()
'''


@pytest.fixture
def bw(home, tmp_path, monkeypatch):
    from devagent import bitwarden, journal, registry
    journal._ready_for = None
    registry.load()
    bindir = tmp_path / "bin"
    bindir.mkdir()
    exe = bindir / "bw"
    exe.write_text(FAKE_BW % {"python": sys.executable})
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    state = tmp_path / "bw-state.json"
    state.write_text(json.dumps({"status": "locked", "password": "maitre-123", "session": None, "items": []}))
    monkeypatch.setenv("PATH", f"{bindir}:{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_BW_STATE", str(state))
    read = lambda: json.loads(state.read_text())
    return type("B", (), {"m": bitwarden, "state": read, "file": state})


def fresh_pc(tmp_path, monkeypatch, name):
    """Another PC: a new HOME, an empty DevAgent — the same Bitwarden."""
    import importlib
    h = tmp_path / name
    h.mkdir()
    monkeypatch.setenv("HOME", str(h))
    import db, projects
    importlib.reload(db); importlib.reload(projects)
    return h


def test_envoyer_puis_recuperer_sur_un_autre_pc(bw, tmp_path, monkeypatch):
    import db, hosting
    from devagent import access
    access.save({"dns_ovh_application_key": "AK", "dns_ovh_application_secret": "AS-SECRET", "dns_ovh_consumer_key": "CK-SECRET",
                 "anthropic_api_key": "sk-ant-SECRET", "notify_telegram_chat_id": "42"})
    hosting.save_accounts([{"id": "v1", "name": "perso", "platform": "vercel", "token": "VERCEL-SECRET", "projects": [3]}])
    out = bw.m.push("maitre-123")
    assert out["envoye"] and out["cree"] is True
    assert out["cles"] == ["anthropic_api_key", "dns_ovh_application_key", "dns_ovh_application_secret",
                           "dns_ovh_consumer_key", "notify_telegram_chat_id"]
    assert out["hebergeurs"] == ["vercel — perso"] and "SECRET" not in json.dumps(out)        # names, never values
    st = bw.state()
    assert st["status"] == "locked" and st["session"] is None                                # locked again at the end
    note = st["items"][0]
    assert note["name"] == "DevAgent — acces" and note["type"] == 2 and note["secureNote"] == {"type": 0}
    assert json.loads(note["notes"])["reglages"]["anthropic_api_key"] == "sk-ant-SECRET"
    # a second push edits the same note
    access.save({"dns_hostinger_api_token": "HOST-SECRET"})
    assert bw.m.push("maitre-123")["cree"] is False and len(bw.state()["items"]) == 1

    # ── another PC ──
    fresh_pc(tmp_path, monkeypatch, "pc-b")
    assert db.get_setting("anthropic_api_key", "") == "" and hosting.accounts() == []
    hosting.save_accounts([{"id": "loc", "name": "local", "platform": "netlify", "token": "L"}])
    got = bw.m.pull("maitre-123")
    assert got["recu"] and got["nombre"] == 6 and "SECRET" not in json.dumps(got)
    assert db.get_setting("dns_ovh_consumer_key") == "CK-SECRET" and db.get_setting("dns_hostinger_api_token") == "HOST-SECRET"
    accts = {a["id"]: a for a in hosting.accounts()}
    assert accts["v1"]["token"] == "VERCEL-SECRET" and accts["v1"]["projects"] == []         # project links are per PC
    assert "loc" in accts                                                                    # what only this PC had is kept
    raw = dict(sqlite3.connect(str(db.DB_PATH)).execute("SELECT key, value FROM settings").fetchall())
    assert raw["anthropic_api_key"].startswith("enc:v1:") and "VERCEL-SECRET" not in raw["hosting_accounts"]
    assert by_state(access)["ovh_dns"] == "a_tester" and bw.state()["status"] == "locked"


def by_state(access):
    return {e["key"]: e["state"] for e in access.status()}


def test_mauvais_mot_de_passe_et_cas_limites(bw, P):
    from devagent import access
    with pytest.raises(P.ProjectError) as e:
        bw.m.push("x")
    assert "rien a envoyer" in e.value.message                                               # nothing saved yet
    access.save({"anthropic_api_key": "K"})
    for bad in ("faux", "", "   "):
        with pytest.raises(P.ProjectError):
            bw.m.push(bad)
    assert bw.state()["items"] == []
    with pytest.raises(P.ProjectError) as e:
        bw.m.pull("maitre-123")
    assert "n'existe pas" in e.value.message and bw.state()["status"] == "locked"
    # a note edited by hand is refused, nothing is changed here
    st = bw.state(); st["items"] = [{"id": "x", "name": "DevAgent — acces", "notes": "pas du json"}]
    bw.file.write_text(json.dumps(st))
    with pytest.raises(P.ProjectError) as e:
        bw.m.pull("maitre-123")
    assert "illisible" in e.value.message
    # not logged in on this PC
    st = bw.state(); st["status"] = "unauthenticated"; bw.file.write_text(json.dumps(st))
    assert bw.m.status()["etat"] == "deconnecte"
    with pytest.raises(P.ProjectError) as e:
        bw.m.push("maitre-123")
    assert "devagent coffre connecter" in e.value.message


def test_seules_les_cles_connues_sont_prises(bw, P):
    import db
    st = bw.state()
    st["items"] = [{"id": "x", "name": "DevAgent — acces", "notes": json.dumps(
        {"reglages": {"anthropic_api_key": "K", "scan_dirs": "/", "agent_pause": "1", "n_importe": "x"}, "hebergeurs": ["pas un compte"]})}]
    bw.file.write_text(json.dumps(st))
    out = bw.m.pull("maitre-123")
    assert out["nombre"] == 1 and db.get_setting("anthropic_api_key") == "K"
    assert db.get_setting("n_importe") is None and db.get_setting("agent_pause", "0") == "0"   # a note cannot change other settings


def test_par_http_et_jamais_dans_le_journal(bw):
    import importlib
    import sizes, project_routes, cloud_routes, dashboard
    for m in (sizes, project_routes, cloud_routes, dashboard):
        importlib.reload(m)
    dashboard.app.config.update(TESTING=True, SERVER_NAME="127.0.0.1:5555")
    c = dashboard.app.test_client()
    info = c.get("/api/agent/bitwarden").get_json()
    assert info["etat"] == "verrouille" and info["email"] == "moi@exemple.ma" and info["dernier_envoi"] is None
    c.post("/api/agent/access", json={"anthropic_api_key": "sk-ant-SECRET"})
    assert c.post("/api/agent/bitwarden/push", json={"password": "faux"}).status_code == 400
    r = c.post("/api/agent/bitwarden/push", json={"password": "maitre-123"}).get_json()
    assert r["ok"] and r["result"]["cles"] == ["anthropic_api_key"]
    assert c.post("/api/agent/bitwarden/pull", json={"password": "maitre-123"}).get_json()["ok"]
    assert c.post("/api/agent/bitwarden/autre", json={}).status_code == 404
    assert c.get("/api/agent/bitwarden").get_json()["dernier_envoi"]
    j = c.get("/api/agent/journal").get_json()["actions"]
    assert [a["status"] for a in j if a["tool"] == "bitwarden_push"] == ["ok", "erreur"]
    dump = json.dumps(j)
    assert "maitre-123" not in dump and "sk-ant-SECRET" not in dump
    # no tool lets the agent read the note or trigger a transfer
    from devagent import registry
    assert not [t.name for t in registry.all_tools() if "bitwarden" in t.name]
