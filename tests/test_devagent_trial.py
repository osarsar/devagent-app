"""Tools « a l'essai »: usable at once, every call confirmed, approved by the user — and a file
that would run code when loaded is refused."""
import importlib
import sys

import pytest

GOOD = '''"""Essai."""
from devagent import RISK_WRITE
from devagent.registry import tool

SALUT = "bonjour"


@tool("essai_saluer", "Dit bonjour a quelqu'un, pour les tests de l'essai.", params={"nom": {"type": "string"}})
def essai_saluer(ctx, nom="toi"):
    return {"message": f"{SALUT} {nom}"}
'''


@pytest.fixture
def trial(home, tmp_path, monkeypatch):
    from devagent import guard, journal, registry
    journal._ready_for = None
    registry.load()
    d = tmp_path / "tools_essai"
    d.mkdir()
    (d / "__init__.py").write_text("")
    import devagent.tools_essai as pkg
    monkeypatch.setattr(pkg, "__path__", [str(d)])
    monkeypatch.setattr(registry, "trial_dir", lambda: d)
    yield type("T", (), {"d": d, "registry": registry, "guard": guard, "journal": journal})
    for f in list(d.glob("*.py")):
        f.unlink()
    registry.load_trial()
    for m in [m for m in sys.modules if m.startswith("devagent.tools_essai.") or m == "devagent.tools.essai_ok"]:
        sys.modules.pop(m, None)
    registry._TOOLS.pop("essai_saluer", None)


def test_actif_tout_de_suite_mais_chaque_appel_est_confirme(trial):
    r, g = trial.registry, trial.guard
    assert g.call("essai_saluer", {}, actor="chat")["statut"] == "erreur"           # does not exist yet
    (trial.d / "essai_ok.py").write_text(GOOD)
    t = r.get("essai_saluer")                                                        # loaded without a restart
    assert t.trial is True and t.risk == "lecture" and t.public()["automation"] is False
    ask = g.call("essai_saluer", {"nom": "Soufiane"}, actor="chat")
    assert ask["statut"] == "confirmation_requise" and "a l'essai" in ask["message"]   # even though it says « lecture »
    assert g.call("essai_saluer", {}, actor="interface")["statut"] == "confirmation_requise"
    assert g.call("essai_saluer", {}, actor="automatisation:x")["statut"] == "erreur"
    assert g.approve(ask["confirmation"])["resultat"] == {"message": "bonjour Soufiane"}
    # the file changes: the new version is the one used
    import os, time
    (trial.d / "essai_ok.py").write_text(GOOD.replace('"bonjour"', '"salut"'))
    os.utime(trial.d / "essai_ok.py", (time.time() + 5, time.time() + 5))
    assert g.approve(g.call("essai_saluer", {}, actor="chat")["confirmation"])["resultat"] == {"message": "salut toi"}
    # removed: gone
    (trial.d / "essai_ok.py").unlink()
    assert g.call("essai_saluer", {}, actor="chat")["statut"] == "erreur"


@pytest.mark.parametrize("bad,why", [
    ('import os\nos.system("touch /tmp/x")\n', "du code qui s'execute"),
    ('from devagent.registry import tool\nprint("chargement")\n', "du code qui s'execute"),
    ('X = open("/etc/passwd").read()\n', "du code qui s'execute"),
    ('import atexit\n@atexit.register\ndef f():\n    pass\n', "seul le decorateur @tool"),
    ('def f(:\n', "syntaxe"),
])
def test_un_fichier_qui_agirait_au_chargement_est_refuse(trial, bad, why):
    (trial.d / "mauvais.py").write_text(bad)
    errs = trial.registry.trial_errors()
    assert why in errs["mauvais.py"]
    assert "devagent.tools_essai.mauvais" not in sys.modules                        # never imported


def test_approuver_le_rend_normal(trial, tmp_path, monkeypatch):
    r, g = trial.registry, trial.guard
    (trial.d / "essai_ok.py").write_text(GOOD)
    assert r.get("essai_saluer").trial
    from pathlib import Path
    dst = Path(r.__file__).resolve().parent / "tools" / "essai_ok.py"
    try:
        out = r.approve_trial("essai_ok.py")
        assert out == {"approuve": "essai_ok.py", "outils": ["essai_saluer"]} and dst.is_file()
        assert not (trial.d / "essai_ok.py").exists()
        t = r.get("essai_saluer")
        assert t.trial is False
        assert g.call("essai_saluer", {"nom": "x"}, actor="chat") == {"statut": "ok", "resultat": {"message": "bonjour x"}}
        with pytest.raises(r.ToolError):
            r.approve_trial("essai_ok.py")
        with pytest.raises(r.ToolError):
            r.approve_trial("../guard.py")
    finally:
        dst.unlink(missing_ok=True)
