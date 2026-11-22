"""The chat loop with a scripted model: tool calls go through the guard, the
conversation stays valid, errors are explained."""
import json
from types import SimpleNamespace

import pytest


class Block(dict):
    """A response block: dict content + model_dump like the SDK objects."""
    def model_dump(self, **kw):
        return dict(self)


def resp(stop, *blocks):
    return SimpleNamespace(stop_reason=stop, content=[Block(b) for b in blocks])


class FakeClient:
    def __init__(self, script):
        self.script, self.calls = list(script), []
        self.messages = SimpleNamespace(create=self._create)
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._beta))

    def _beta(self, betas=None, fallbacks=None, **params):
        assert betas == ["server-side-fallback-2026-07-01"] and fallbacks == "default"
        return self._create(**params)

    def _create(self, **params):
        self.calls.append(json.loads(json.dumps(params, default=str)))
        nxt = self.script.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


@pytest.fixture
def chat(home):
    from devagent import chat, journal, registry
    journal._ready_for = None
    chat._ready_for = None
    chat._use_fallbacks = True
    registry.load()
    return chat


def _waiting_turn(chat, P):
    """A turn that adds a step, then asks to delete the project: it stops and waits."""
    p = P.create("site")
    c = chat.start(p["id"])
    client = FakeClient([
        resp("tool_use", {"type": "thinking", "thinking": "", "signature": "sig"},
             {"type": "text", "text": "Je regarde."},
             {"type": "tool_use", "id": "t1", "name": "projet_etat", "input": {}},
             {"type": "tool_use", "id": "t2", "name": "projet_etape_ajouter",
              "input": {"phase": "dev", "libelle": "Depuis le chat"}}),
        resp("tool_use", {"type": "tool_use", "id": "t3", "name": "projet_supprimer", "input": {"projet": "site"}}),
    ])
    assert chat.send(c["id"], "ajoute une etape puis supprime le projet", client=client, wait=True)["ok"]
    return p, c, client


def test_un_tour_avec_outils(chat, P):
    p, c, client = _waiting_turn(chat, P)
    got = chat.get(c["id"])
    assert got["status"] == "attente" and got["title"].startswith("ajoute une etape")
    kinds = [(e["type"], e.get("name"), e.get("statut")) for e in got["events"]]
    assert kinds == [("user", None, None), ("assistant", None, None),
                     ("tool", "projet_etat", "ok"), ("tool", "projet_etape_ajouter", "ok"),
                     ("tool", "projet_supprimer", "confirmation_requise")]
    aid = got["events"][4]["confirmation"]
    assert got["waiting"] == [{"confirmation": aid, "tool": "projet_supprimer"}]   # shown at the bottom of the chat
    assert P.get(p["id"]) and len(client.calls) == 2                               # not deleted, the model waits

    first, second = client.calls
    assert first["model"] == "claude-opus-5-5" and first["thinking"] == {"type": "adaptive"}
    assert first["output_config"] == {"effort": "medium"} and "site" in first["system"]
    assert first["tools"] == second["tools"]                      # stable prefix: cacheable
    # both results of the first round went back in ONE user message, thinking block untouched
    assert second["messages"][1]["content"][0] == {"type": "thinking", "thinking": "", "signature": "sig"}
    res = second["messages"][2]["content"]
    assert [r["tool_use_id"] for r in res] == ["t1", "t2"] and all(r["type"] == "tool_result" for r in res)
    assert json.loads(res[0]["content"])["resultat"]["projet"]["nom"] == "site"   # no project named: the chat's one
    from devagent import journal
    assert journal.actions(tool="projet_etape_ajouter")[0]["actor"] == "chat"


def test_confirmation_refusee_puis_le_tour_continue(chat, P):
    from devagent import guard
    p, c, client = _waiting_turn(chat, P)
    aid = chat.get(c["id"])["waiting"][0]["confirmation"]
    assert chat.resume(c["id"], client=client, wait=True) is False                 # not decided yet
    guard.refuse(aid)
    client.script.append(resp("end_turn", {"type": "text", "text": "D'accord, je ne supprime rien."}))
    assert chat.resume(c["id"], client=client, wait=True) is True
    got = chat.get(c["id"])
    assert got["status"] == "pret" and got["waiting"] == []
    assert [(e["type"], e.get("statut")) for e in got["events"][-2:]] == [("decision", "refuse"), ("assistant", None)]
    r = client.calls[2]["messages"][-1]["content"][0]
    assert r["tool_use_id"] == "t3" and r["is_error"] is True and "refuse" in r["content"]
    assert P.get(p["id"])
    assert chat.resume(c["id"], client=client, wait=True) is False                 # once only


def test_confirmation_approuvee_puis_le_tour_continue(chat, P):
    from devagent import guard
    p, c, client = _waiting_turn(chat, P)
    aid = chat.get(c["id"])["waiting"][0]["confirmation"]
    assert guard.approve(aid, "site")["statut"] == "ok"
    client.script.append(resp("end_turn", {"type": "text", "text": "Projet supprime."}))
    assert chat.resume(c["id"], client=client, wait=True) is True
    r = client.calls[2]["messages"][-1]["content"][0]
    assert "is_error" not in r and json.loads(r["content"])["confirme_par_utilisateur"] is True
    assert chat.get(c["id"])["events"][-2]["statut"] == "fait"


def test_ecrire_pendant_l_attente_vaut_refus(chat, P):
    from devagent import journal
    p, c, client = _waiting_turn(chat, P)
    aid = chat.get(c["id"])["waiting"][0]["confirmation"]
    client.script.append(resp("end_turn", {"type": "text", "text": "Compris, je garde le projet."}))
    assert chat.send(c["id"], "non, garde-le", client=client, wait=True)["ok"]
    assert journal.approval(aid)["status"] == "refuse"
    content = client.calls[2]["messages"][-1]["content"]
    assert content[0]["type"] == "tool_result" and content[0]["is_error"] is True and "a la place" in content[0]["content"]
    assert content[1] == {"type": "text", "text": "non, garde-le"}
    assert chat.get(c["id"])["status"] == "pret" and P.get(p["id"])


def test_erreur_d_outil_marquee(chat, P):
    c = chat.start()
    client = FakeClient([
        resp("tool_use", {"type": "tool_use", "id": "t1", "name": "projet_etat", "input": {"projet": "inconnu"}}),
        resp("end_turn", {"type": "text", "text": "Ce projet n'existe pas."})])
    chat.send(c["id"], "etat de inconnu", client=client, wait=True)
    r = client.calls[1]["messages"][2]["content"][0]
    assert r["is_error"] is True and "introuvable" in r["content"]


def test_panne_de_l_api_laisse_une_conversation_valide(chat, P):
    import anthropic
    c = chat.start()
    boom = anthropic.APIConnectionError(request=None) if False else RuntimeError("reseau coupe")
    client = FakeClient([resp("tool_use", {"type": "tool_use", "id": "t1", "name": "projet_lister", "input": {}}), boom])
    chat.send(c["id"], "liste", client=client, wait=True)
    got = chat.get(c["id"])
    assert got["status"] == "pret" and "reseau coupe" in got["error"]
    assert got["events"][-1]["type"] == "error"
    # nothing dangling: the next message starts from a clean history
    ok = FakeClient([resp("end_turn", {"type": "text", "text": "Bonjour"})])
    assert chat.send(c["id"], "bonjour", client=ok, wait=True)["ok"]
    msgs = ok.calls[0]["messages"]
    assert [m["role"] for m in msgs] == ["user"] and msgs[0]["content"] == "bonjour"


def test_sans_cle_et_garde_fous(chat, monkeypatch):
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    c = chat.start()
    out = chat.send(c["id"], "bonjour")
    assert out["ok"] is False and "cle API" in out["message"]
    assert chat.send(c["id"], "   ", client=FakeClient([]))["ok"] is False
    assert chat.send(999, "x", client=FakeClient([]))["ok"] is False
    import db
    db.set_setting("anthropic_api_key", "sk-ant-TEST")
    assert chat.configured() is True


def test_repli_sans_fallbacks(chat):
    import anthropic

    class Old(FakeClient):
        def _beta(self, **kw):
            raise TypeError("create() got an unexpected keyword argument 'fallbacks'")
    c = chat.start()
    client = Old([resp("end_turn", {"type": "text", "text": "ok"})])
    chat.send(c["id"], "salut", client=client, wait=True)
    assert chat.get(c["id"])["events"][-1]["text"] == "ok" and chat._use_fallbacks is False


def test_limite_de_series(chat, monkeypatch):
    monkeypatch.setattr(chat, "MAX_STEPS", 3)
    c = chat.start()
    loop = [resp("tool_use", {"type": "tool_use", "id": f"t{i}", "name": "projet_lister", "input": {}}) for i in range(3)]
    chat.send(c["id"], "boucle", client=FakeClient(loop), wait=True)
    got = chat.get(c["id"])
    assert got["status"] == "pret" and "Arrete apres 3" in got["events"][-1]["text"]


def test_le_guide_ne_fait_que_regarder(chat, P):
    p = P.create("site")
    client = FakeClient([
        resp("tool_use", {"type": "tool_use", "id": "t1", "name": "projet_etat", "input": {}},
             {"type": "tool_use", "id": "t2", "name": "projet_etape_ajouter", "input": {"phase": "dev", "libelle": "interdit"}}),
        resp("end_turn", {"type": "text", "text": "1. Lier GitHub. 2. Choisir l'hebergement."})])
    out = chat.guide(p["id"], client=client, wait=True)
    assert out["ok"]
    ev = out["chat"]["events"]
    assert ev[0]["text"] == "Que faire maintenant ?"                           # the long instruction is not shown
    assert [(e["name"], e["statut"]) for e in ev if e["type"] == "tool"] == [("projet_etat", "ok"), ("projet_etape_ajouter", "erreur")]
    first = client.calls[0]
    assert "Regarde l'etat REEL" in first["messages"][0]["content"]
    names = {t["name"] for t in first["tools"]}
    assert "projet_etat" in names and "projet_creer" not in names and "projet_supprimer" not in names   # only tools that look
    import phases
    assert "interdit" not in [s["label"] for ph in phases.roadmap(p["id"])["phases"] for s in ph["steps"]]
    assert chat.last_text(out["chat"]["id"]).startswith("1. Lier GitHub")


def test_point_du_matin_et_alerte_expliquee(chat, P, monkeypatch):
    from devagent import automations, guard, registry
    automations._ready_for = None
    p = P.create("site")
    for t in ("point-du-matin", "surveillance-site-expliquee"):
        assert automations.check(automations.TEMPLATES[t]) == []
    sent = []
    monkeypatch.setattr(registry.get("notifier"), "fn",
                        lambda ctx, message, titre="", canal=None, projet=None: sent.append((titre, message)) or {"envoye": True})
    monkeypatch.setattr(chat, "_client", lambda: FakeClient([resp("end_turn", {"type": "text", "text": "Tout va bien. site : phase preparation."})]))
    monkeypatch.setattr(chat, "configured", lambda: True)
    automations.from_template(p, "point-du-matin")
    automations.set_active(p, "point-du-matin", True)
    run = automations.run(p, "point-du-matin")
    assert run["statut"] == "ok" and sent == [("DevAgent — point du matin", "Tout va bien. site : phase preparation.")]
    # the explained alert: the cause is looked for only when the site goes down, and joins the message
    sent.clear()
    monkeypatch.setattr(registry.get("site_tester"), "fn", lambda ctx, url: {"ok": False})
    monkeypatch.setattr(chat, "_client", lambda: FakeClient([resp("end_turn", {"type": "text", "text": "Cause probable : le DNS ne pointe plus vers Vercel."})]))
    automations.from_template(p, "surveillance-site-expliquee", url="https://exemple.ma")
    automations.set_active(p, "surveillance-site-expliquee", True)
    automations.run(p, "surveillance-site-expliquee")
    assert len(sent) == 1 and "ne repond plus" in sent[0][1] and "Cause probable : le DNS" in sent[0][1]
    # without an API key the alert still leaves, without the explanation
    sent.clear()
    monkeypatch.setattr(chat, "configured", lambda: False)
    monkeypatch.setattr(chat, "_client", lambda: (_ for _ in ()).throw(RuntimeError("pas de cle")))
    automations.from_template(p, "surveillance-site-expliquee", name="sans-cle", url="https://exemple.ma")
    automations.set_active(p, "sans-cle", True)
    automations.run(p, "sans-cle")
    assert len(sent) == 1 and "ne repond plus" in sent[0][1]
    assert guard.call("guide_point", actor="mcp")["statut"] == "erreur"         # no key: says so, does not crash
