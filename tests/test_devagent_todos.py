"""« A faire par toi »: noted by the agent, shown to the user, closed by itself when it is done."""
import importlib
import json

import pytest


@pytest.fixture
def t(home):
    from devagent import automations, chat, journal, registry, todos
    journal._ready_for = automations._ready_for = chat._ready_for = todos._ready_for = None
    registry.load()
    return todos


def test_note_par_l_agent_puis_raye_tout_seul(t, P, monkeypatch):
    from devagent import guard, registry
    p = P.create("site")
    state = {"relie": False}
    monkeypatch.setattr(registry.get("vercel_etat"), "fn", lambda ctx, projet=None: {"git": {"relie": state["relie"]}})
    out = guard.call("a_faire_ajouter", {
        "titre": "Relier Vercel a GitHub", "comment": "Connect Git Repository, puis choisis le depot",
        "pourquoi": "chaque push mettra le site en ligne", "lien": "https://vercel.com/x/y/settings/git", "projet": "site",
        "verifier_outil": "vercel_etat", "verifier_attendu": {"git.relie": True}}, actor="chat")
    assert out["statut"] == "ok"
    n = out["resultat"]["numero"]
    again = guard.call("a_faire_ajouter", {"titre": "relier vercel a github", "comment": "x", "projet": "site"}, actor="chat")
    assert again["resultat"] == {"numero": n, "deja_notee": True}                    # not twice
    lst = guard.call("a_faire_lister", {"projet": "site"}, actor="chat")["resultat"]
    assert lst["rayes_a_l_instant"] == [] and lst["a_faire"][0]["titre"] == "Relier Vercel a GitHub"
    assert lst["a_faire"][0]["verifie_tout_seul"] is True and t.count() == 1
    state["relie"] = True                                                             # the user did it on the site
    assert t.check() == [{"numero": n, "titre": "Relier Vercel a GitHub"}]
    assert t.count() == 0 and t.items("faite")[0]["done_by"] == "verification"
    assert t.check() == []


def test_garde_fous(t, P):
    from devagent import guard
    bad = lambda **a: guard.call("a_faire_ajouter", {"titre": "x", "comment": "y", **a}, actor="chat")
    assert bad(verifier_outil="projet_creer", verifier_attendu={"a": 1})["statut"] == "erreur"     # a check only looks
    assert bad(verifier_outil="projet_lister")["statut"] == "erreur"                             # what must it be?
    assert bad(verifier_outil="nexiste_pas", verifier_attendu={"a": 1})["statut"] == "erreur"
    assert bad(lien="javascript:alert(1)")["statut"] == "erreur"
    assert guard.call("a_faire_ajouter", {"titre": "x", "comment": "y"}, actor="automatisation:z")["statut"] == "erreur"
    n = bad()["resultat"]["numero"]
    assert guard.call("a_faire_terminer", {"numero": n}, actor="chat")["resultat"] == {"raye": True}
    assert t.count() == 0 and t.reopen(n) and t.count() == 1


def test_le_guide_peut_noter_mais_rien_changer_d_autre(t, P):
    from devagent import chat
    from test_devagent_chat import FakeClient, resp
    p = P.create("site")
    client = FakeClient([
        resp("tool_use", {"type": "tool_use", "id": "a", "name": "a_faire_ajouter",
                          "input": {"titre": "Creer le token Vercel", "comment": "sur vercel.com/account/tokens",
                                    "lien": "https://vercel.com/account/tokens"}},
             {"type": "tool_use", "id": "b", "name": "projet_etape_ajouter", "input": {"phase": "dev", "libelle": "non"}}),
        resp("end_turn", {"type": "text", "text": "Une chose a faire par toi, notee."})])
    out = chat.guide(p["id"], client=client, wait=True)
    tools = {e["name"]: e["statut"] for e in out["chat"]["events"] if e["type"] == "tool"}
    assert tools == {"a_faire_ajouter": "ok", "projet_etape_ajouter": "erreur"}
    names = {x["name"] for x in client.calls[0]["tools"]}
    assert "a_faire_ajouter" in names and "outil_demander" in names and "projet_creer" not in names
    assert t.items("ouverte")[0]["title"] == "Creer le token Vercel" and t.items("ouverte")[0]["project_id"] == p["id"]


def test_routes(t, P):
    import sizes, project_routes, cloud_routes, dashboard
    for m in (sizes, project_routes, cloud_routes, dashboard):
        importlib.reload(m)
    dashboard.app.config.update(TESTING=True, SERVER_NAME="127.0.0.1:5555")
    c = dashboard.app.test_client()
    n = t.add("Archiver l'ancien depot", "decide si on le garde", actor="chat")["numero"]
    assert c.get("/api/agent/state").get_json()["todos"] == 1
    assert [x["title"] for x in c.get("/api/agent/todos").get_json()["open"]] == ["Archiver l'ancien depot"]
    assert c.post(f"/api/agent/todos/{n}", json={"action": "done"}).get_json() == {"ok": True}
    data = c.get("/api/agent/todos").get_json()
    assert data["open"] == [] and data["done"][0]["done_by"] == "utilisateur"
    assert c.post(f"/api/agent/todos/{n}", json={"action": "autre"}).status_code == 400
    assert "/agent/assets/pages/05-afaire.js" in c.get("/").get_data(as_text=True)


# ── Questions answered in the task, checks done by DevAgent or the agent ────

def _fake_send(monkeypatch):
    from devagent import chat
    sent = []

    def send(cid, text, client=None, wait=False, read_only=False, shown=None):
        sent.append({"cid": cid, "text": text, "read_only": read_only, "shown": shown})
        return {"ok": True}
    monkeypatch.setattr(chat, "send", send)
    return sent


def test_une_question_se_repond_dans_la_tache_et_revient_a_l_agent(t, P, monkeypatch):
    from devagent import chat, guard
    p = P.create("site")
    c = chat.start(p["id"])
    out = guard.call("a_faire_ajouter", {"titre": "Decider quelle IA utiliser", "comment": "Claude ou OpenAI",
                                         "question": "Quelle IA veux-tu pour le chat : Claude ou OpenAI ?", "projet": "site"},
                     actor="chat", ctx={"project_id": p["id"], "chat_id": c["id"]})
    n = out["resultat"]["numero"]
    item = t.get(n)
    assert item["est_question"] and item["chat_id"] == c["id"]
    sent = _fake_send(monkeypatch)
    r = t.answer(n, "Claude, avec ma cle")
    assert r == {"chat": c["id"]}                                            # the conversation that asked
    assert "Quelle IA veux-tu" in sent[0]["text"] and "Claude, avec ma cle" in sent[0]["text"]
    assert sent[0]["shown"].startswith("Reponse a « Decider")
    done = t.get(n)
    assert done["status"] == "faite" and done["done_by"] == "reponse" and done["answer"] == "Claude, avec ma cle"
    with pytest.raises(Exception):
        t.answer(n, "   ")


def test_la_reponse_va_dans_une_nouvelle_conversation_si_l_autre_travaille(t, P, monkeypatch):
    from devagent import chat
    p = P.create("site")
    c = chat.start(p["id"])
    chat._save(c["id"], status="en_cours")
    n = t.add("Choisir le nom de domaine ?", "", project_id=p["id"], chat_id=c["id"])["numero"]
    assert t.get(n)["est_question"]                                         # a « ? » makes it a question
    _fake_send(monkeypatch)
    r = t.answer(n, "monsite.ma")
    assert r["chat"] != c["id"] and chat._load(r["chat"])["project_id"] == p["id"]


def test_verifier_automatique_ou_par_l_agent(t, P, monkeypatch):
    from devagent import registry
    p = P.create("site")
    monkeypatch.setattr(registry.get("vercel_etat"), "fn", lambda ctx, projet=None: {"git": {"relie": True}})
    auto = t.add("Relier Vercel a GitHub", "x", project_id=p["id"], check_tool="vercel_etat",
                 check_expect={"git.relie": True})["numero"]
    r = t.verify(auto)
    assert r["auto"] and r["closed"][0]["numero"] == auto and t.get(auto)["status"] == "faite"
    sent = _fake_send(monkeypatch)
    manual = t.add("Renouveler le token Vercel", "Sur vercel.com/account/tokens", project_id=p["id"])["numero"]
    assert not t.get(manual)["est_question"]
    r = t.verify(manual)
    assert not r["auto"] and r["chat"] and sent[0]["read_only"] is True          # the agent looks, changes nothing
    assert f"a_faire_terminer (numero {manual})" in sent[0]["text"] and t.get(manual)["last_check"]


def test_l_agent_peut_rayer_pendant_une_verification(t):
    from devagent import chat
    assert "a_faire_terminer" in chat.NOTE_TOOLS                              # allowed in a read-only turn
