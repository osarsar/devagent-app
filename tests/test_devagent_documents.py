"""Documents: a company's files listed in documents/documents.json, shown, downloaded, printed, changed by the agent."""
import json
from pathlib import Path

import pytest


@pytest.fixture
def doc(home, P):
    from PIL import Image
    from devagent import chat, documents
    chat._ready_for = None
    p = P.create("corp")
    root = Path(p["path"])
    (root / "documents/logo").mkdir(parents=True)
    (root / "plaquette").mkdir()
    Image.new("RGBA", (300, 200), (20, 90, 200, 255)).save(root / "documents/logo/logo.png")
    for lang in ("fr", "en"):
        Image.new("RGB", (595, 842), "white").save(root / f"plaquette/p-{lang}.pdf")
    (root / "secret.txt").write_text("nope")
    (root / "documents/documents.json").write_text(json.dumps({
        "entreprise": "Corp SA",
        "documents": [
            {"id": "logo", "titre": "Logo", "categorie": "Identite", "fichiers": {"": "documents/logo/logo.png"},
             "variantes": [{"label": "Absent", "chemin": "documents/logo/absent.png"}]},
            {"id": "plaquette", "titre": "Plaquette", "categorie": "Commercial", "format": "A4",
             "fichiers": {"fr": "plaquette/p-fr.pdf", "en": "plaquette/p-en.pdf"},
             "sources": ["plaquette/build.py"], "modifier": "python3 build.py"}],
        "a_creer": [{"titre": "Papier a en-tete", "pourquoi": "courriers", "demande": "Cree le papier a en-tete."}]}))
    return documents, p


def test_la_liste_verifie_chaque_fichier(doc):
    documents, p = doc
    assert documents.overview() == [{"id": p["id"], "projet": "corp", "entreprise": "Corp SA", "nb": 2, "a_creer": 1}]
    cat = documents.catalog(p["id"])
    logo, plaq = cat["documents"]
    assert logo["langues"] == [] and logo["fichiers"][""]["existe"] and logo["fichiers"][""]["type"] == "image"
    assert logo["variantes"][0]["existe"] is False
    assert plaq["langues"] == ["fr", "en"] and plaq["fichiers"]["en"]["pages"] == 1


def test_seuls_les_fichiers_de_la_liste_sont_servis(doc):
    documents, p = doc
    assert documents.path(p["id"], "plaquette/p-en.pdf").name == "p-en.pdf"
    for bad in ("secret.txt", "../secret.txt", "documents/../secret.txt", "/etc/passwd", "documents/logo/absent.png"):
        with pytest.raises(documents.DocError):
            documents.path(p["id"], bad)


def test_apercus(doc):
    documents, p = doc
    a = documents.thumbnail(p["id"], "documents/logo/logo.png")
    b = documents.thumbnail(p["id"], "plaquette/p-fr.pdf")
    assert a.suffix == b.suffix == ".jpg" and a.is_file() and b.is_file()
    assert documents.thumbnail(p["id"], "documents/logo/logo.png") == a                 # cached


def test_modifier_et_creer_passent_par_l_agent(doc, monkeypatch):
    from devagent import chat
    documents, p = doc
    sent = []
    monkeypatch.setattr(chat, "send", lambda cid, text, shown=None, **k: sent.append((cid, text, shown)) or {"ok": True})
    r = documents.ask_agent(p["id"], "change le telephone", doc_id="plaquette")
    assert chat._load(r["chat"])["project_id"] == p["id"]
    text = sent[-1][1]
    assert "« Plaquette »" in text and "plaquette/p-en.pdf" in text and "python3 build.py" in text and "change le telephone" in text
    documents.ask_agent(p["id"], "", create="Papier a en-tete")
    assert "Cree le papier a en-tete." in sent[-1][1] and "a_creer" in sent[-1][1]
    documents.ask_agent(p["id"], "fais une version anglaise de la brochure")
    assert "Plaquette (plaquette)" in sent[-1][1]
    with pytest.raises(documents.DocError):
        documents.ask_agent(p["id"], "", doc_id="plaquette")                              # nothing asked
    with pytest.raises(documents.DocError):
        documents.ask_agent(p["id"], "x", doc_id="inconnu")


def test_routes(doc, monkeypatch):
    import importlib
    import sizes, project_routes, cloud_routes, dashboard
    for m in (sizes, project_routes, cloud_routes, dashboard):
        importlib.reload(m)
    dashboard.app.config["TESTING"] = True
    dashboard.app.config["SERVER_NAME"] = "127.0.0.1:5555"
    documents, p = doc
    c = dashboard.app.test_client()
    assert c.get("/api/agent/documents").get_json()["projets"][0]["nb"] == 2
    assert c.get(f"/api/agent/documents/{p['id']}").get_json()["entreprise"] == "Corp SA"
    r = c.get(f"/api/agent/documents/{p['id']}/fichier/p-fr.pdf?f=plaquette/p-fr.pdf&dl=1")
    assert r.status_code == 200 and "attachment" in r.headers["Content-Disposition"] and r.mimetype == "application/pdf"
    assert c.get(f"/api/agent/documents/{p['id']}/fichier?f=secret.txt").status_code == 404
    assert c.get(f"/api/agent/documents/{p['id']}/apercu?f=documents/logo/logo.png").mimetype == "image/jpeg"
    assert c.post(f"/api/agent/documents/{p['id']}/agent", json={"doc": "plaquette"}).status_code == 400


def test_l_agent_a_l_outil(doc):
    from devagent import guard, registry
    registry.load()
    documents, p = doc
    out = guard.call("documents_lister", {"projet": "corp"}, actor="chat")
    assert out["statut"] == "ok" and out["resultat"]["documents"][1]["modifier"] == "python3 build.py"
