"""Automations (file → check → activation → run → scheduler), notifications and deployment."""
import json
import os
import subprocess
from datetime import datetime, timedelta

import pytest

from conftest import sh


@pytest.fixture
def auto(home):
    from devagent import automations, guard, journal, registry
    journal._ready_for = None
    automations._ready_for = None
    automations._running.clear()
    registry.load()
    return automations


def spec(**kw):
    base = {"description": "essai", "declencheur": {"type": "manuel"},
            "etapes": [{"outil": "projet_etape_ajouter", "args": {"phase": "dev", "libelle": "auto {{projet}}"}}]}
    base.update(kw)
    return base


def test_verification_d_un_fichier(auto):
    assert auto.check(spec()) == []
    assert auto.check({"etapes": []})                                           # no trigger, no step
    assert any("HH:MM" in e for e in auto.check(spec(declencheur={"type": "horaire", "a": "25:00"})))
    assert any("30s" in e for e in auto.check(spec(declencheur={"type": "intervalle", "toutes": "5s"})))
    assert any("inconnu" in e for e in auto.check(spec(etapes=[{"outil": "nexiste_pas"}])))
    assert any("irreversible" in e for e in auto.check(spec(etapes=[{"outil": "projet_supprimer"}])))
    assert any("irreversible" in e for e in auto.check(spec(etapes=[{"outil": "deploiement_lancer"}])))
    assert any("arguments inconnus" in e for e in auto.check(spec(etapes=[{"outil": "notifier", "args": {"x": 1}}])))
    for name, t in auto.TEMPLATES.items():
        assert auto.check(t) == [], name


def test_inactive_tant_que_l_utilisateur_n_active_pas(auto, P):
    p = P.create("site")
    a = auto.save(p, "essai", spec())
    assert a["actif"] is False
    with pytest.raises(P.ProjectError):
        auto.run(p, "essai")
    assert auto.set_active(p, "essai", True)["actif"] is True
    out = auto.run(p, "essai")
    assert out["statut"] == "ok" and out["etapes"][0]["statut"] == "ok"
    import phases
    labels = [s["label"] for ph in phases.roadmap(p["id"])["phases"] for s in ph["steps"]]
    assert "auto site" in labels                                                # {{projet}} was filled
    from devagent import journal
    assert journal.actions()[0]["actor"] == "automatisation:essai"


def test_un_fichier_modifie_redevient_inactif(auto, P):
    p = P.create("site")
    a = auto.save(p, "essai", spec())
    auto.set_active(p, "essai", True)
    # someone (the agent, an editor) changes the file: the activation no longer holds
    with open(a["fichier"], "a") as fh:
        fh.write("\n# modifie\n")
    again = auto.get(p, "essai")
    assert again["actif"] is False and again["modifie_depuis_activation"] is True
    assert auto.tick() == []


def test_l_agent_propose_mais_n_active_pas(auto, P):
    from devagent import guard
    P.create("site")
    out = guard.call("automatisation_depuis_modele", {"projet": "site", "modele": "sauvegarde-nuit"}, actor="mcp")
    assert out["statut"] == "ok" and out["resultat"]["actif"] is False
    assert guard.call("automatisation_lancer", {"projet": "site", "nom": "sauvegarde-nuit"}, actor="mcp")["statut"] == "erreur"
    bad = guard.call("automatisation_proposer", {"projet": "site", "nom": "x", "declencheur": {"type": "manuel"},
                                                 "etapes": [{"outil": "projet_supprimer", "args": {"projet": "site"}}]},
                     actor="mcp")
    assert bad["statut"] == "erreur" and "irreversible" in bad["message"]
    # an automation cannot manage automations
    assert any("irreversible" in e or "ne peut pas" in e
               for e in auto.check(spec(etapes=[{"outil": "automatisation_lancer", "args": {"nom": "x"}}])))


def test_attendu_echec_et_alertes_une_seule_fois(auto, P, monkeypatch):
    from devagent import registry
    p = P.create("site")
    state = {"ok": False}
    sent = []
    monkeypatch.setattr(registry.get("site_tester"), "fn", lambda ctx, url: {"ok": state["ok"], "status": 500})
    monkeypatch.setattr(registry.get("notifier"), "fn",
                        lambda ctx, message, titre="", canal=None, projet=None: sent.append(message) or {"envoye": True})
    auto.save(p, "veille", auto.TEMPLATES["surveillance-site"])
    auto.set_active(p, "veille", True)
    r1 = auto.run(p, "veille")
    assert r1["statut"] == "echec" and "ok = False" in r1["erreur"]
    assert len(sent) == 1 and "ne repond plus" in sent[0] and "site" in sent[0]
    auto.run(p, "veille")
    assert len(sent) == 1                                                       # still down: no second alert
    state["ok"] = True
    r3 = auto.run(p, "veille")
    assert r3["statut"] == "ok" and len(sent) == 2 and "a nouveau" in sent[1]
    auto.run(p, "veille")
    assert len(sent) == 2
    assert [r["status"] for r in auto.runs(p["id"], "veille")] == ["ok", "ok", "echec", "echec"]


def test_planificateur(auto, P):
    p = P.create("site")
    auto.save(p, "nuit", spec(declencheur={"type": "horaire", "a": "03:00"}))
    auto.save(p, "souvent", spec(declencheur={"type": "intervalle", "toutes": "10m"}))
    auto.save(p, "main", spec())
    a = {x["nom"]: x for x in auto.load(p)}
    day = datetime(2026, 11, 20)
    assert auto.due(a["nuit"], day.replace(hour=2, minute=59)) is False    # yesterday's slot is 24 h old: skipped
    assert auto.due(a["nuit"], day.replace(hour=3, minute=0)) is True
    assert auto.due(a["nuit"], day.replace(hour=9)) is True                # PC was off at 03:00: caught up
    assert auto.due(a["nuit"], day.replace(hour=16)) is False              # more than 12 h late: skipped
    assert auto.due(a["souvent"], day) is True
    assert auto.due(a["main"], day) is False
    assert auto.tick() == []                                               # nothing active
    for n in ("nuit", "souvent", "main"):
        auto.set_active(p, n, True)
    names = sorted(r["nom"] for r in auto.tick(datetime.now().replace(hour=3, minute=5)))
    assert names == ["nuit", "souvent"]
    assert auto.tick(datetime.now().replace(hour=3, minute=6)) == []       # already done for this slot / interval
    a = {x["nom"]: x for x in auto.load(p)}
    assert auto.due(a["souvent"], datetime.now() + timedelta(minutes=11)) is True
    assert auto.due(a["nuit"], datetime.now().replace(hour=3, minute=5) + timedelta(days=1)) is True


def test_pause_arrete_les_automatisations(auto, P):
    from devagent import guard
    p = P.create("site")
    auto.save(p, "souvent", spec(declencheur={"type": "intervalle", "toutes": "1m"}))
    auto.set_active(p, "souvent", True)
    guard.set_paused(True)
    assert auto.tick() == []
    guard.set_paused(False)
    assert len(auto.tick()) == 1


def test_webhook_local(auto, P):
    p = P.create("site")
    auto.save(p, "hook", spec(declencheur={"type": "webhook"}))
    tok = auto.hook_token(p, "hook")
    assert auto.hook_token(p, "hook") == tok and auto.find_by_hook(tok) == (p["id"], "hook")
    assert auto.find_by_hook("faux") is None and auto.find_by_hook("") is None
    assert auto.hook_token(p, "hook", renew=True) != tok


# ── Notifications ───────────────────────────────────────────────────────────

def test_notification_sans_canal_reste_dans_le_journal(home):
    import db
    from devagent.connectors import notify
    out = notify.send("bonjour", title="Essai")
    assert out["envoye"] is False and "note" in out
    assert any(e["type"] == "notification" and e["details"] == "bonjour" for e in db.get_events(10))


def test_notification_telegram(home, monkeypatch):
    import db
    from devagent.connectors import notify
    db.set_setting("notify_telegram_bot_token", "123:SECRET")
    db.set_setting("notify_telegram_chat_id", "42")
    calls = []

    class R:
        status_code = 200
        def json(self):
            return {"ok": True}
    monkeypatch.setattr(notify.requests, "post", lambda url, json=None, timeout=0: calls.append((url, json)) or R())
    out = notify.send("site en panne", title="Alerte")
    assert out == {"envoye": True, "canaux": {"telegram": {"ok": True}}}
    assert calls[0][0].endswith("/bot123:SECRET/sendMessage") and calls[0][1]["chat_id"] == "42"
    assert "Alerte" in calls[0][1]["text"] and "site en panne" in calls[0][1]["text"]
    import sqlite3
    raw = sqlite3.connect(str(db.DB_PATH)).execute(
        "SELECT value FROM settings WHERE key='notify_telegram_bot_token'").fetchone()[0]
    assert "SECRET" not in raw                                               # the bot token is in the vault


# ── Deployment ──────────────────────────────────────────────────────────────

@pytest.fixture
def deployed(home, P, remote, tmp_path, monkeypatch):
    """A project with one « server » : a clone of the remote in a local folder; the
    connector's ssh is replaced by a local bash (the real script runs)."""
    from devagent import journal, registry
    from devagent.connectors import deploy
    journal._ready_for = None
    registry.load()
    p = P.create("app")
    live = tmp_path / "live"
    sh("git", "clone", "-q", remote, str(live))
    server = {"id": "s1", "name": "vps", "role": "prod", "host": "1.2.3.4", "user": "ubuntu", "port": 22,
              "remote_path": str(live), "key_path": "", "provider": "other", "history": []}
    m = P.read_manifest(p["path"])
    m["servers"] = [server]
    P._write_json(P.space_dir(p["path"]) / "project.json", m)
    monkeypatch.setattr(deploy, "_ssh", lambda s, script, timeout=0: (
        lambda r: (r.returncode, r.stdout, r.stderr))(subprocess.run(["bash", "-c", script], capture_output=True, text=True)))
    return p, live, remote


def push_commit(remote, tmp_path, name):
    w = tmp_path / f"w-{name}"
    sh("git", "clone", "-q", remote, str(w))
    (w / name).write_text("x")
    sh("git", "add", ".", cwd=w)
    sh("git", "commit", "-qm", name, cwd=w)
    sh("git", "push", "-q", "origin", "main", cwd=w)
    return sh("git", "rev-parse", "HEAD", cwd=w)


def test_deploiement_puis_retour(deployed, tmp_path):
    from devagent import guard
    p, live, remote = deployed
    before = sh("git", "rev-parse", "HEAD", cwd=live)
    new = push_commit(remote, tmp_path, "v2.txt")

    # every deployment tool is irreversible: asked, then approved by the user
    ask = guard.call("deploiement_configurer", {"projet": "app", "commande": "echo construit > built.txt"}, actor="mcp")
    assert ask["statut"] == "confirmation_requise"
    assert guard.approve(ask["confirmation"])["statut"] == "ok"
    ask = guard.call("deploiement_lancer", {"projet": "app"}, actor="mcp")
    assert ask["statut"] == "confirmation_requise" and sh("git", "rev-parse", "HEAD", cwd=live) == before
    out = guard.approve(ask["confirmation"])["resultat"]
    assert out["ok"] and out["avant"] == before and out["apres"] == new
    assert (live / "v2.txt").exists() and (live / "built.txt").read_text().strip() == "construit"

    etat = guard.call("deploiement_etat", {"projet": "app"}, actor="mcp")["resultat"]
    assert etat["serveurs"][0]["commande"].startswith("echo") and etat["historique"][0]["apres"] == new

    back = guard.approve(guard.call("deploiement_revenir", {"projet": "app"}, actor="mcp")["confirmation"])["resultat"]
    assert back["ok"] and back["type"] == "retour" and sh("git", "rev-parse", "HEAD", cwd=live) == before
    assert not (live / "v2.txt").exists()


def test_deploiement_qui_echoue_est_dit(deployed):
    from devagent import guard
    from devagent.connectors import deploy
    p, live, remote = deployed
    deploy.set_command(p, {"id": "s1", "name": "vps"}, "exit 3")
    out = guard.approve(guard.call("deploiement_lancer", {"projet": "app"}, actor="mcp")["confirmation"])
    assert out["statut"] == "ok" and out["resultat"]["ok"] is False and "erreur" in out["resultat"]
    assert deploy.history(p)[0]["ok"] is False


def test_declencheur_depot_nouveau_commit(auto, P, remote, tmp_path):
    """« depot » : fires when GitHub's branch moves — never for the commits already there."""
    p = P.clone(remote, name="app")
    auto.save(p, "sur-commit", spec(declencheur={"type": "depot", "toutes": "1m"},
                                    etapes=[{"outil": "projet_etape_ajouter",
                                             "args": {"phase": "dev", "libelle": "commit {{commit}}"}}]))
    assert any("60s" in e for e in auto.check(spec(declencheur={"type": "depot", "toutes": "10s"})))
    auto.set_active(p, "sur-commit", True)
    t0 = datetime(2026, 11, 20, 10, 0)
    assert auto.tick(t0) == []                                   # first look: remembers the tip, does not fire
    assert auto.tick(t0 + timedelta(seconds=30)) == []           # too soon to look again
    assert auto.tick(t0 + timedelta(minutes=2)) == []            # nothing new
    sha = push_commit(remote, tmp_path, "v2.txt")
    assert auto.tick(t0 + timedelta(minutes=2, seconds=10)) == []   # inside the 1 min window
    runs = auto.tick(t0 + timedelta(minutes=4))
    assert [r["nom"] for r in runs] == ["sur-commit"] and runs[0]["statut"] == "ok"
    import phases
    labels = [s["label"] for ph in phases.roadmap(p["id"])["phases"] for s in ph["steps"]]
    assert f"commit {sha[:10]}" in labels
    assert auto.tick(t0 + timedelta(minutes=6)) == []            # fired once for that commit
    assert auto.remote_head(p) == sha
