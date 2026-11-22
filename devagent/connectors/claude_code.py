"""Connector — Claude Code as the agent's hands on the code.

DevAgent's agent manages the platforms; when a task needs the CODE (read it, change it, run the
tests), it hands it to Claude Code, run without a screen (`claude -p`) in the repo, with the user's
own Claude Code login.

Limits, enforced here:
  - only in a git repo, and never on its main branch: a work branch is created first, so every
    change is visible in git and can be undone;
  - file edits are accepted inside the repo; shell commands only from a list of development
    commands (install, build, test, local git). Anything else is refused by Claude Code and comes
    back in « refuses », for the agent to propose to the user;
  - never pushes, never touches a remote: sending to GitHub stays a separate, guarded tool;
  - no MCP server inside (no recursion, none of the user's other connectors).
"""
import json
import threading
import signal
import os
import re
import shlex
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

import projects as P

TIMEOUT = 1500
MAX_TURNS = 60
ALLOWED = ["Bash(npm install:*)", "Bash(npm ci:*)", "Bash(npm run:*)", "Bash(npm test:*)", "Bash(pnpm:*)", "Bash(yarn:*)",
           "Bash(node:*)", "Bash(python:*)", "Bash(python3:*)", "Bash(pytest:*)", "Bash(make:*)", "Bash(ls:*)",
           "Bash(cat:*)", "Bash(grep:*)", "Bash(find:*)", "Bash(wc:*)", "Bash(head:*)", "Bash(tail:*)",
           "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git add:*)",
           "Bash(git commit:*)", "Bash(git restore:*)", "Bash(git stash:*)"]
DENIED = ["Bash(git push:*)", "Bash(git remote:*)", "Bash(git checkout:*)", "Bash(git switch:*)", "Bash(git reset:*)",
          "Bash(sudo:*)", "Bash(rm -rf:*)", "WebFetch", "WebSearch"]
RULES = ("Tu travailles pour DevAgent, dans ce depot, sur la branche « {branch} ». Regles : ne change pas de branche, "
         "ne pousse rien, ne touche a aucun depot distant, reste dans ce dossier. Fais la tache demandee, verifie-la "
         "quand c'est possible (tests, build), puis termine par un compte rendu court en francais : ce que tu as "
         "change (fichiers), comment le verifier, et ce qui reste a faire ou que tu n'as pas pu faire.")


def _exe():
    try:
        import dev
        cmd = shlex.split(dev.claude_cmd())[0]
    except Exception:
        cmd = "claude"
    exe = shutil.which(cmd) or shutil.which("claude")
    if not exe:
        raise P.ProjectError("Claude Code n'est pas installe sur ce PC (commande « claude »).")
    return exe


def _git(args, cwd):
    rc, out, err = P.git(args, cwd=cwd)
    return rc, out.strip(), err.strip()


def _changed(repo):
    """[(code, path)] of `git status` — read raw (-z): the first column of a line may be a space."""
    try:
        r = subprocess.run(["git", "status", "--porcelain", "-z", "--untracked-files=all"], cwd=str(repo),
                           capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return []
    res, parts, i = [], r.stdout.split("\0"), 0
    while i < len(parts):
        e = parts[i]
        i += 1
        if len(e) < 4:
            continue
        res.append((e[:2], e[3:]))
        if e[0] in "RC":                      # a rename is followed by its old name
            i += 1
    return res


def ensure_work_branch(repo, task):
    """The branch to work on: the current one, or a new one when the repo is on its main branch."""
    import dev
    rc, cur, _ = _git(["branch", "--show-current"], repo)
    if rc != 0:
        raise P.ProjectError(f"{repo} n'est pas un depot git : Claude Code ne travaille que la ou git garde la trace")
    base = dev.base_branch(repo)
    if cur and cur != base:
        return cur, False
    slug = re.sub(r"[^a-z0-9]+", "-", task.lower())[:32].strip("-") or "tache"
    name = f"agent/{datetime.now():%m%d-%H%M}-{slug}"
    rc, _, err = _git(["switch", "-c", name], repo)
    if rc != 0:
        raise P.ProjectError(f"Impossible de creer la branche de travail : {err}")
    return name, True


def _parse(stdout):
    """stream-json lines → {session, text, turns, cost, denials, is_error, tools}"""
    out = {"session": None, "text": "", "turns": None, "cost": None, "denials": [], "is_error": False, "tools": []}
    for line in stdout.splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        t = d.get("type")
        if d.get("session_id"):
            out["session"] = d["session_id"]
        if t == "assistant":
            for b in (d.get("message") or {}).get("content") or []:
                if b.get("type") == "tool_use":
                    out["tools"].append(b.get("name"))
                elif b.get("type") == "text" and b.get("text"):
                    out["text"] = b["text"]
        elif t == "result":
            out.update(text=d.get("result") or out["text"], turns=d.get("num_turns"), cost=d.get("total_cost_usd"),
                       is_error=bool(d.get("is_error")) or d.get("subtype") not in (None, "success"),
                       subtype=d.get("subtype"))
            for x in d.get("permission_denials") or []:
                inp = x.get("tool_input") or {}
                out["denials"].append(inp.get("command") or f"{x.get('tool_name')} {json.dumps(inp)[:120]}")
    return out


# ── A run that can be stopped from outside (the chat's « Arreter ») ─────────

_running = {}                 # thread ident → Popen of the Claude Code started by that thread
_running_lock = threading.Lock()


def _launch(argv, cwd, timeout, on_line=None):
    """subprocess.run, but registered so that stop_for(thread) can kill it (and its children),
    and read line by line so that its progress can be shown while it runs (on_line)."""
    proc = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, bufsize=1, start_new_session=True)
    me = threading.get_ident()
    with _running_lock:
        _running[me] = proc
    err, out, late = [], [], []
    reader = threading.Thread(target=lambda: err.append(proc.stderr.read()), daemon=True)
    reader.start()
    timer = threading.Timer(timeout, lambda: (late.append(1), _kill(proc)))
    timer.daemon = True
    timer.start()
    try:
        for line in proc.stdout:
            out.append(line)
            if on_line:
                try:
                    on_line(line)
                except Exception:
                    pass
        proc.wait()
    finally:
        timer.cancel()
        reader.join(5)
        with _running_lock:
            _running.pop(me, None)
    if late:
        raise subprocess.TimeoutExpired(argv, timeout, output="".join(out), stderr="".join(err))
    return subprocess.CompletedProcess(argv, proc.returncode, "".join(out), "".join(err))


# ── What Claude Code is doing, in words, while it runs ──────────────────────

def _short(path, repo):
    try:
        return os.path.relpath(path, repo) if os.path.isabs(path) else path
    except ValueError:
        return path


def progress_line(line, repo):
    """One line of Claude Code's stream-json output → what to show (or None)."""
    try:
        d = json.loads(line)
    except ValueError:
        return None
    if d.get("type") != "assistant":
        return None
    out = []
    for b in (d.get("message") or {}).get("content") or []:
        if b.get("type") == "tool_use":
            name, inp = b.get("name", ""), b.get("input") or {}
            f = _short(inp.get("file_path") or inp.get("path") or inp.get("notebook_path") or "", str(repo)) or "un fichier"
            if name == "Read":
                out.append(f"lit {f}")
            elif name in ("Edit", "MultiEdit", "NotebookEdit"):
                out.append(f"modifie {f}")
            elif name == "Write":
                out.append(f"ecrit {f}")
            elif name == "Bash":
                cmd = " ".join((inp.get("command") or "").split())
                out.append(f"lance « {cmd[:90]}{'…' if len(cmd) > 90 else ''} »")
            elif name in ("Grep", "Glob"):
                out.append(f"cherche « {(inp.get('pattern') or '')[:60]} »")
            elif name == "TodoWrite":
                todo = next((t for t in inp.get("todos") or [] if t.get("status") == "in_progress"), None)
                if todo:
                    out.append(f"etape : {(todo.get('activeForm') or todo.get('content') or '')[:90]}")
            elif name:
                out.append(name)
        elif b.get("type") == "text" and (b.get("text") or "").strip():
            t = " ".join(b["text"].split())
            out.append(t[:140] + ("…" if len(t) > 140 else ""))
    return " · ".join(out) if out else None


def _reporter(repo):
    from .. import progress

    def on_line(line):
        text = progress_line(line, repo)
        if text:
            progress.emit(text)
    return on_line


def _kill(proc):
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=5)
    except (ProcessLookupError, PermissionError, OSError):
        pass
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass


def stop_for(thread_ident):
    """Stop the Claude Code run started by this thread, if any. True when one was stopped."""
    with _running_lock:
        proc = _running.get(thread_ident)
    if not proc or proc.poll() is not None:
        return False
    _kill(proc)
    return True


def run(repo, task, resume=None, rules=None, allowed=None, timeout=TIMEOUT):
    """Run Claude Code in ``repo`` on ``task``. Returns what it did (never raises on a failed task)."""
    repo = Path(repo)
    branch, created = ensure_work_branch(repo, task)
    argv = [_exe(), "-p", task, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
            "--max-turns", str(MAX_TURNS), "--strict-mcp-config",
            "--append-system-prompt", (rules or RULES).format(branch=branch),
            "--allowedTools", *(allowed or ALLOWED), "--disallowedTools", *DENIED]
    if resume:
        argv += ["--resume", resume]
    try:
        r = _launch(argv, str(repo), timeout, on_line=_reporter(repo))
        parsed, err = _parse(r.stdout), (r.stderr or "").strip()
        if r.returncode in (-signal.SIGTERM, -signal.SIGKILL) and not parsed["text"]:
            parsed["is_error"] = True
            parsed["text"] = "Arrete par l'utilisateur."
        if r.returncode != 0 and not parsed["text"]:
            parsed["is_error"] = True
            parsed["text"] = (err or "Claude Code s'est arrete sans reponse")[-600:]
    except subprocess.TimeoutExpired as e:
        parsed = _parse((e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or ""))
        parsed["is_error"] = True
        parsed["text"] = f"Arrete apres {timeout // 60} minutes. " + parsed["text"]
    _, stat, _ = _git(["diff", "--stat", "HEAD"], repo)
    _, now, _ = _git(["branch", "--show-current"], repo)
    return {"reussi": not parsed["is_error"], "compte_rendu": parsed["text"][-6000:], "branche": now or branch,
            "branche_creee": created, "fichiers_modifies": [p_ for _, p_ in _changed(repo)][:60],
            "resume_des_changements": stat[-1500:], "refuses": parsed["denials"][:20],
            "session": parsed["session"], "tours": parsed["turns"], "outils_utilises": len(parsed["tools"]),
            "note": ("Rien n'est envoye sur GitHub : utilise git_commit puis git_synchroniser. "
                     + ("Des commandes ont ete refusees a Claude Code (voir « refuses ») : propose-les avec "
                        "commande_proposer si elles sont necessaires." if parsed["denials"] else ""))}


# ── Building a missing tool, in DevAgent's own code ─────────────────────────

APP = Path(__file__).resolve().parent.parent.parent
TOOL_RULES = ("Tu ajoutes un outil a DevAgent (ce depot). Tu n'ecris QUE dans devagent/tools_essai/ (un fichier .py par "
              "outil ou groupe d'outils) et dans tests/. Ne modifie aucun autre fichier, ne change pas de branche, ne "
              "pousse rien. Le fichier de l'outil ne doit contenir, au premier niveau, que sa docstring, des imports, "
              "des constantes et des fonctions decorees par @tool (aucun code execute au chargement). Lis "
              "devagent/registry.py, devagent/guard.py et devagent/tools/github.py pour le style. Choisis le niveau de "
              "risque honnetement (lecture, ecriture, irreversible) ; aucun argument ne doit etre un secret. Ecris un "
              "test avec le reseau simule et lance-le. Termine par un compte rendu : le nom de l'outil, ce qu'il "
              "fait, son niveau de risque.")


def build_tool(need, example=""):
    """Have Claude Code write a missing tool in tools_essai/. Whatever it changed elsewhere is undone."""
    from .. import registry
    before = {f.name for f in registry.trial_dir().glob("*.py")}
    task = f"Outil manquant a ajouter : {need}" + (f"\nCe qui a servi en attendant : {example}" if example else "")
    _exe()
    argv_allowed = ALLOWED + ["Bash(.venv/bin/python -m pytest:*)", "Bash(.venv/bin/python:*)"]
    # DevAgent's own repo: stay on the current branch (the trial folder is not tied to a branch)
    argv = [_exe(), "-p", task, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
            "--max-turns", str(MAX_TURNS), "--strict-mcp-config", "--append-system-prompt", TOOL_RULES,
            "--allowedTools", *argv_allowed, "--disallowedTools", *DENIED]
    try:
        r = _launch(argv, str(APP), TIMEOUT, on_line=_reporter(APP))
        parsed = _parse(r.stdout)
    except subprocess.TimeoutExpired:
        parsed = {"text": "Arrete : trop long.", "is_error": True, "denials": [], "session": None}
    # enforce the rule: nothing outside tools_essai/ and tests/ may have changed
    undone = []
    for code, path in _changed(APP):
        if path.startswith(("devagent/tools_essai/", "tests/")):
            continue
        if code == "??":
            target = APP / path
            if target.exists():
                P.move_to_trash(str(target))
        else:
            _git(["checkout", "--", path], APP)
        undone.append(path)
    registry.load_trial()
    new = sorted({f.name for f in registry.trial_dir().glob("*.py")} - before - {"__init__.py"})
    tools = [{"nom": t.name, "risque": t.risk, "description": t.description}
             for t in registry.all_tools() if t.trial and Path(t.source).name in new]
    return {"reussi": bool(tools) and not parsed.get("is_error"), "fichiers": new, "outils_a_l_essai": tools,
            "non_charges": {k: v for k, v in registry.trial_errors().items() if k in new},
            "compte_rendu": (parsed.get("text") or "")[-3000:], "annule_hors_du_dossier_d_essai": undone,
            "note": "Ces outils sont utilisables tout de suite ; chaque appel attend la confirmation de l'utilisateur "
                    "tant qu'il ne les a pas approuves (DevAgent → Outils)."}
