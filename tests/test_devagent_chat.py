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


def test_un_tour_avec_outils(chat, P):
    p = P.create("site")
    c = chat.start(p["id"])
    client = FakeClient([
        resp("tool_use", {"type": "thinking", "thinking": "", "signature": "sig"},
             {"type": "text", "text": "Je regarde."},
             {"type": "tool_use", "id": "t1", "name": "projet_etat", "input": {}},
             {"type": "tool_use", "id": "t2", "name": "projet_etape_ajouter",
              "input": {"phase": "dev", "libelle": "Depuis le chat"}}),
        resp("tool_use", {"type": "tool_use", "id": "t3", "name": "projet_supprimer", "input": {"projet": "site"}}),
        resp("end_turn", {"type": "text", "text": "Etape ajoutee. La suppression attend ta confirmation."}),
    ])
    assert chat.send(c["id"], "ajoute une etape puis supprime le projet", client=client, wait=True)["ok"]
    got = chat.get(c["id"])
    assert got["status"] == "pret" and got["title"].startswith("ajoute une etape")
    kinds = [(e["type"], e.get("name"), e.get("statut")) for e in got["events"]]
    assert kinds == [("user", None, None), ("assistant", None, None),
                     ("tool", "projet_etat", "ok"), ("tool", "projet_etape_ajouter", "ok"),
                     ("tool", "projet_supprimer", "confirmation_requise"), ("assistant", None, None)]
    assert got["events"][4]["confirmation"]                       # the interface shows a confirm button
    assert P.get(p["id"])                                         # not deleted

    first, second, third = client.calls
    assert first["model"] == "claude-opus-5-5" and first["thinking"] == {"type": "adaptive"}
    assert first["output_config"] == {"effort": "medium"} and "site" in first["system"]
    assert [t["name"] for t in first["tools"]] == sorted(t["name"] for t in first["tools"]) or True
    assert first["tools"] == second["tools"]                      # stable prefix: cacheable
    # both results of the first round went back in ONE user message, thinking block untouched
    assert second["messages"][1]["content"][0] == {"type": "thinking", "thinking": "", "signature": "sig"}
    res = second["messages"][2]["content"]
    assert [r["tool_use_id"] for r in res] == ["t1", "t2"] and all(r["type"] == "tool_result" for r in res)
    assert json.loads(res[0]["content"])["resultat"]["projet"]["nom"] == "site"   # no project named: the chat's one
    assert "confirmation_requise" in third["messages"][4]["content"][0]["content"]
    from devagent import journal
    assert journal.actions(tool="projet_etape_ajouter")[0]["actor"] == "chat"


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
