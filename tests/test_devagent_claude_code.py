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
out({"type": "system", "subtype": "init", "session_id": "sess-1", "cwd": os.getcwd(),
     "model": a[a.index("--model") + 1] if "--model" in a else "claude-sonnet-5-5"})
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


def test_les_etapes_de_claude_code_se_voient_en_direct(cc):
    """What Claude Code does is reported while it runs (the chat shows it live)."""
    from devagent import guard, progress
    seen = []
    progress.set_callback(seen.append)
    try:
        out = guard.call("claude_code", {"tache": "Change le titre", "projet": "site"}, actor="chat")
    finally:
        progress.set_callback(None)
    assert out["statut"] == "ok"
    assert seen == ["modifie un fichier · en cours"]         # the fake's « assistant » line, in words


def test_lignes_de_progression():
    import json as j
    from devagent.connectors.claude_code import progress_line as p
    line = lambda *c: j.dumps({"type": "assistant", "message": {"content": list(c)}})
    assert p(line({"type": "tool_use", "name": "Read", "input": {"file_path": "/r/site/a.tsx"}}), "/r") == "lit site/a.tsx"
    assert p(line({"type": "tool_use", "name": "Edit", "input": {"file_path": "/r/b.py"}}), "/r") == "modifie b.py"
    assert p(line({"type": "tool_use", "name": "Bash", "input": {"command": "npm   run build"}}), "/r") == "lance « npm run build »"
    assert p(line({"type": "tool_use", "name": "TodoWrite", "input": {"todos": [{"status": "in_progress", "activeForm": "Corrige le menu"}]}}), "/r") == "etape : Corrige le menu"
    assert p(j.dumps({"type": "result"}), "/r") is None and p("pas du json", "/r") is None


def _arg(argv, flag):
    return argv[argv.index(flag) + 1] if flag in argv else None


def test_le_bon_modele_l_effort_et_l_objectif(cc):
    from devagent import guard
    out = guard.call("claude_code", {"tache": "Corrige le bug du panier", "projet": "site", "modele": "opus",
                                     "effort": "high", "objectif": "les tests de tests/test_panier.py passent"}, actor="chat")
    assert out["statut"] == "ok", out
    a, r = cc.log()["argv"], out["resultat"]
    assert _arg(a, "--model") == "opus" and _arg(a, "--fallback-model") == "sonnet" and _arg(a, "--effort") == "high"
    assert _arg(a, "-p").startswith("/goal les tests de tests/test_panier.py passent\n\nCorrige le bug du panier")
    assert _arg(a, "--max-turns") == "200" and "Workflow" not in a
    assert r["modele"] == "opus" and r["effort"] == "high" and r["mode"] == "objectif" and r["cout_usd"] == 0.1
    assert "refusees" in r["a_continuer"]                                              # the fake run had a denial


def test_par_defaut_claude_code_choisit_et_mauvais_mots_refuses(cc):
    from devagent import guard
    out = guard.call("claude_code", {"tache": "Lis le README", "projet": "site", "modele": "auto"}, actor="chat")
    a = cc.log()["argv"]
    assert out["statut"] == "ok" and "--model" not in a and "--effort" not in a and _arg(a, "-p") == "Lis le README"
    assert guard.call("claude_code", {"tache": "x", "projet": "site", "modele": "gpt"}, actor="chat")["statut"] == "erreur"
    assert guard.call("claude_code", {"tache": "x", "projet": "site", "effort": "enorme"}, actor="chat")["statut"] == "erreur"


def test_ultracode_attend_l_accord_de_l_utilisateur(cc):
    from devagent import guard
    out = guard.call("claude_code", {"tache": "Refais tout le front", "projet": "site", "mode": "ultracode",
                                     "modele": "fable"}, actor="chat")
    assert out["statut"] == "confirmation_requise" and "ultracode" in out["message"]
    assert not (cc.tmp / "claude.json").exists()                                     # nothing ran before the OK
    done = guard.approve(out["confirmation"])
    assert done["statut"] == "ok", done
    a = cc.log()["argv"]
    assert _arg(a, "-p").startswith("ultracode\n\nRefais tout le front") and "Workflow" in a
    assert _arg(a, "--model") == "fable" and _arg(a, "--fallback-model") == "opus"


def test_limite_de_tours_dit_de_continuer_la_meme_session(cc):
    from devagent import guard
    r = guard.call("claude_code", {"tache": "ECHEC long", "projet": "site"}, actor="chat")["resultat"]
    assert not r["reussi"] and r["session"] == "sess-1" and "suite" in r["a_continuer"]


def test_outil_construire_avec_un_modele():
    from devagent.connectors import claude_code
    assert claude_code.options("opus") == ["--model", "opus", "--fallback-model", "sonnet"]
    assert claude_code.options("haiku", "low") == ["--model", "haiku", "--effort", "low"]
    assert claude_code.prompt_for(" x ") == "x"
