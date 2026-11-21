"""claude_code: the agent hands code work to Claude Code — with a fake `claude` program."""
import json
import os
import stat
import sys

import pytest

from conftest import sh

FAKE = r'''#!%(python)s
import json, os, sys
a = sys.argv[1:]
log = os.environ["FAKE_CLAUDE_LOG"]
json.dump({"argv": a, "cwd": os.getcwd()}, open(log, "w"))
task = a[a.index("-p") + 1]
out = lambda d: print(json.dumps(d))
out({"type": "system", "subtype": "init", "session_id": "sess-1", "cwd": os.getcwd()})
if "ECHEC" in task:
    out({"type": "result", "subtype": "error_max_turns", "is_error": True, "result": "pas fini", "session_id": "sess-1", "num_turns": 60})
    sys.exit(1)
for spec in os.environ.get("FAKE_CLAUDE_WRITES", "page.txt=nouveau").split(";"):
    path, _, text = spec.partition("=")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    open(path, "w").write(text.replace("\\n", "\n"))
out({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Edit", "input": {}}, {"type": "text", "text": "en cours"}]}})
out({"type": "result", "subtype": "success", "is_error": False, "result": "J'ai change page.txt. Verifie avec npm run dev.",
     "session_id": "sess-1", "num_turns": 4, "total_cost_usd": 0.1,
     "permission_denials": [{"tool_name": "Bash", "tool_input": {"command": "curl https://x"}}]})
'''


@pytest.fixture
def cc(home, tmp_path, monkeypatch, P, remote):
    from devagent import journal, registry
    from devagent.connectors import claude_code
    journal._ready_for = None
    registry.load()
    bindir = tmp_path / "bin"
    bindir.mkdir()
    exe = bindir / "claude"
    exe.write_text(FAKE % {"python": sys.executable})
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "claude.json"
    monkeypatch.setenv("PATH", f"{bindir}:{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    p = P.clone(remote, name="site")
    return type("C", (), {"m": claude_code, "p": p, "log": lambda: json.loads(log.read_text()), "tmp": tmp_path})


def test_travaille_sur_une_branche_et_ne_pousse_pas(cc):
    from devagent import guard
    path = cc.p["path"]
    assert sh("git", "branch", "--show-current", cwd=path) == "main"
    out = guard.call("claude_code", {"tache": "Change le titre de la page", "projet": "site"}, actor="chat")
    assert out["statut"] == "ok", out
    r = out["resultat"]
    assert r["reussi"] and r["branche_creee"] and r["branche"].startswith("agent/") and "change-le-titre" in r["branche"]
    assert sh("git", "branch", "--show-current", cwd=path) == r["branche"]            # never on main
    assert r["fichiers_modifies"] == ["page.txt"] and "J'ai change page.txt" in r["compte_rendu"]
    assert r["refuses"] == ["curl https://x"] and "commande_proposer" in r["note"] and r["session"] == "sess-1"
    assert "page.txt" not in sh("git", "ls-tree", "-r", "--name-only", "origin/main", cwd=path)   # nothing left the PC
    call = cc.log()
    a = call["argv"]
    assert call["cwd"] == os.path.realpath(path)
    assert a[a.index("--permission-mode") + 1] == "acceptEdits" and "--strict-mcp-config" in a
    denied = a[a.index("--disallowedTools") + 1:]
    assert "Bash(git push:*)" in denied and "Bash(sudo:*)" in denied
    assert "Bash(git push:*)" not in a[a.index("--allowedTools") + 1:a.index("--disallowedTools")]
    assert r["branche"] in a[a.index("--append-system-prompt") + 1]
    # a second call continues on the same branch and session
    out2 = guard.call("claude_code", {"tache": "Continue", "projet": "site", "suite": "sess-1"}, actor="chat")["resultat"]
    assert out2["branche"] == r["branche"] and out2["branche_creee"] is False
    assert cc.log()["argv"][-2:] == ["--resume", "sess-1"]
    from devagent import journal
    assert journal.actions(tool="claude_code")[0]["actor"] == "chat"


def test_echec_dit_et_pas_dans_un_dossier_sans_git(cc, P):
    from devagent import guard
    out = guard.call("claude_code", {"tache": "ECHEC volontaire", "projet": "site"}, actor="chat")["resultat"]
    assert out["reussi"] is False and "pas fini" in out["compte_rendu"]
    P.create("sans-git")
    bad = guard.call("claude_code", {"tache": "x", "projet": "sans-git"}, actor="chat")
    assert bad["statut"] == "erreur" and "git" in bad["message"]
    assert guard.call("claude_code", {"tache": "x", "projet": "site"}, actor="automatisation:z")["statut"] == "erreur"


def test_construire_un_outil_reste_dans_le_dossier_d_essai(cc, tmp_path, monkeypatch):
    """Claude Code is asked to write a tool; whatever it changed elsewhere in DevAgent is undone."""
    from devagent import guard, registry
    app = tmp_path / "app"
    (app / "devagent" / "tools_essai").mkdir(parents=True)
    (app / "devagent" / "tools_essai" / "__init__.py").write_text("")
    (app / "devagent" / "guard.py").write_text("ORIGINAL = 1\n")
    (app / "tests").mkdir()
    sh("git", "init", "-q", "-b", "main", cwd=app)
    sh("git", "add", "-A", cwd=app); sh("git", "commit", "-qm", "init", cwd=app)
    import devagent.tools_essai as pkg
    monkeypatch.setattr(pkg, "__path__", [str(app / "devagent" / "tools_essai")])
    monkeypatch.setattr(registry, "trial_dir", lambda: app / "devagent" / "tools_essai")
    monkeypatch.setattr(cc.m, "APP", app)
    tool_src = ('"""Essai."""\\nfrom devagent.registry import tool\\n\\n\\n@tool("essai_bonjour", "Repond bonjour, pour les tests.")\\n'
                'def essai_bonjour(ctx):\\n    return {"ok": True}\\n')
    monkeypatch.setenv("FAKE_CLAUDE_WRITES", f"devagent/tools_essai/bonjour.py={tool_src};devagent/guard.py=PIRATE = 1;"
                                             "tests/test_bonjour.py=def test_x(): pass;ailleurs.txt=x")
    try:
        out = guard.call("outil_construire", {"besoin": "dire bonjour"}, actor="chat")["resultat"]
        assert out["reussi"] and out["fichiers"] == ["bonjour.py"] and out["outils_a_l_essai"][0]["nom"] == "essai_bonjour"
        assert sorted(out["annule_hors_du_dossier_d_essai"]) == ["ailleurs.txt", "devagent/guard.py"]
        assert (app / "devagent" / "guard.py").read_text() == "ORIGINAL = 1\n" and not (app / "ailleurs.txt").exists()
        assert (app / "tests" / "test_bonjour.py").exists()
        assert cc.log()["cwd"] == str(app) and "tools_essai" in cc.log()["argv"][cc.log()["argv"].index("--append-system-prompt") + 1]
        # usable at once, but each call is confirmed
        ask = guard.call("essai_bonjour", {}, actor="chat")
        assert ask["statut"] == "confirmation_requise"
        assert guard.approve(ask["confirmation"])["resultat"] == {"ok": True}
    finally:
        (app / "devagent" / "tools_essai" / "bonjour.py").unlink(missing_ok=True)
        registry.load_trial()
        sys.modules.pop("devagent.tools_essai.bonjour", None)
