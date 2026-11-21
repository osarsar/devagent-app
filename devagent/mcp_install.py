"""Register DevAgent's MCP server in Claude Code (user scope: every project gets it)."""
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

NAME = "devagent"
APP = Path(__file__).resolve().parent.parent


def _claude():
    try:
        import dev
        cmd = shlex.split(dev.claude_cmd())[0]
    except Exception:
        cmd = "claude"
    return shutil.which(cmd) or shutil.which("claude")


def server_command():
    py = APP / ".venv" / "bin" / "python"
    return [str(py if py.exists() else Path(sys.executable)), str(APP / "devagent" / "mcp_server.py")]


def _run(args, timeout=60):
    exe = _claude()
    if not exe:
        return 127, "", "Claude Code introuvable sur ce PC (commande « claude »)."
    try:
        r = subprocess.run([exe, *args], capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, "", str(e)


def status():
    """{installed, command, detail}"""
    rc, out, err = _run(["mcp", "get", NAME])
    installed = rc == 0
    return {"installed": installed, "claude": bool(_claude()), "command": " ".join(server_command()),
            "detail": (out or err)[:600]}


def install():
    if status()["installed"]:
        _run(["mcp", "remove", "--scope", "user", NAME])
    rc, out, err = _run(["mcp", "add", "--scope", "user", NAME, "--", *server_command()])
    return {"ok": rc == 0, "message": out or err, **status()}


def remove():
    rc, out, err = _run(["mcp", "remove", "--scope", "user", NAME])
    return {"ok": rc == 0, "message": out or err}
