"""Tools — when the agent lacks a tool: it is never stuck.

    commande_proposer   the agent writes the exact command that would do the job; it waits for the
                        user's confirmation (who sees the command), runs, and its output comes back
    outil_demander      the agent notes the missing tool, so that it gets built (page « Outils »)

A proposed command can never run without the user. A command that would read the keys is refused
before it is even proposed, and anything that looks like a key is masked in the output.
"""
import re
import subprocess
from datetime import datetime
from pathlib import Path

import db

from .. import RISK_IRREVERSIBLE, RISK_WRITE
from ..registry import PROJET, ToolError, tool
from ._common import project_dir, resolve_project

TIMEOUT = 180
MAX_OUT = 6000
# what a proposed command may not touch: the keys, the vault, the password managers
_FORBIDDEN = re.compile(
    r"vault\.key|devpilot\.db|\.config/devagent|(^|[\s;|&])bw(\s|$)|\.ssh/(id_|[^\s]*_key)|/etc/shadow|"
    r"\bprintenv\b|(^|[\s;|&])env(\s|$)|BW_SESSION|\.aws/credentials|\.netrc|gh\s+auth\s+token|"
    r"security\s+find-|secret-tool|\.git-credentials", re.I)
_LOOKS_SECRET = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|\bsk-ant-[\w-]{10,}|"
    r"\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[\w-]{10,}|enc:v1:[\w=-]+")


def check_command(cmd):
    cmd = (cmd or "").strip()
    if not cmd or len(cmd) > 1500 or "\n" in cmd:
        raise ToolError("Une commande d'une seule ligne, 1500 caracteres au plus")
    if re.search(r"(^|[\s;|&])sudo(\s|$)", cmd):
        raise ToolError("Une commande avec sudo demande ton mot de passe : a lancer par toi, dans un terminal")
    if _FORBIDDEN.search(cmd):
        raise ToolError("Cette commande toucherait aux cles ou au coffre : je ne la propose pas")
    return cmd


def _where(ctx, projet, dossier):
    if projet or ctx.get("project_id") or ctx.get("cwd"):
        try:
            root = project_dir(resolve_project(ctx, projet)).resolve()
            p = (root / (dossier or ".")).resolve()
            if p != root and root not in p.parents:
                raise ToolError("Dossier refuse : il sort du projet")
            return p
        except ToolError:
            if projet:
                raise
    return Path.home()


@tool("commande_proposer", "QUAND IL TE MANQUE UN OUTIL : propose la commande exacte qui ferait le travail (gh, git, "
      "npm, docker, curl...). Elle n'est PAS lancee : l'utilisateur la voit et la confirme, puis elle tourne dans le "
      "dossier du projet et sa sortie te revient (lis-la avec confirmation_etat). Une seule ligne, sans sudo, et "
      "jamais pour lire une cle. Explique dans « pourquoi » ce qu'elle fait, en une phrase simple.",
      risk=RISK_IRREVERSIBLE, automation=False, precheck=lambda a: check_command(a.get("commande")),
      params={"commande": {"type": "string"}, "pourquoi": {"type": "string"}, "projet": PROJET,
              "dossier": {"type": "string", "description": "Sous-dossier du projet ou la lancer ('.' par defaut)"}},
      required=("commande", "pourquoi"))
def commande_proposer(ctx, commande, pourquoi, projet=None, dossier=None):
    cmd = check_command(commande)
    cwd = _where(ctx, projet, dossier)
    try:
        r = subprocess.run(["bash", "-lc", cmd], cwd=str(cwd), capture_output=True, text=True, timeout=TIMEOUT,
                           stdin=subprocess.DEVNULL)
        rc, out, err = r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        rc, out, err = 124, "", f"delai depasse ({TIMEOUT} s)"
    clean = lambda t: _LOOKS_SECRET.sub("[cle masquee]", t or "")[-MAX_OUT:]
    return {"commande": cmd, "dossier": str(cwd), "code_retour": rc, "reussi": rc == 0,
            "sortie": clean(out), "erreurs": clean(err)}


# ── Missing tools, noted so that they get built ─────────────────────────────

_ready_for = None


def _ensure():
    global _ready_for
    if _ready_for == str(db.DB_PATH):
        return
    with db.get_db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS agent_tool_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
            need TEXT NOT NULL, example TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'ouverte')""")
    _ready_for = str(db.DB_PATH)


def requests(status="ouverte"):
    _ensure()
    with db.get_db() as c:
        q = "SELECT * FROM agent_tool_requests" + (" WHERE status = ?" if status else "") + " ORDER BY id DESC"
        return [dict(r) for r in c.execute(q, (status,) if status else ()).fetchall()]


def set_status(rid, status):
    _ensure()
    with db.get_db() as c:
        return c.execute("UPDATE agent_tool_requests SET status = ? WHERE id = ?", (status, rid)).rowcount == 1


def brief(rid):
    """The instruction given to Claude Code to build the missing tool."""
    r = next((x for x in requests(None) if x["id"] == rid), None)
    if not r:
        raise ToolError(f"Demande d'outil n° {rid} introuvable")
    return (f"Ajoute un outil a DevAgent (ce depot). Besoin, note par l'agent le {r['at'][:10]} :\n\n"
            f"« {r['need']} »\n"
            + (f"\nCe qui a servi en attendant : {r['example']}\n" if r["example"] else "")
            + "\nComment faire :\n"
              "- Lis devagent/registry.py, devagent/guard.py et un fichier de devagent/tools/ (ex. github.py) pour le style.\n"
              "- Ecris l'outil dans le fichier de devagent/tools/ qui correspond a son domaine (ou un nouveau fichier : "
              "il est charge tout seul). Nom en francais, description claire, schema des arguments.\n"
              "- Choisis son niveau de risque honnetement : lecture, ecriture, ou irreversible (alors il attend une "
              "confirmation). Aucun argument ne doit etre un secret.\n"
              "- Ajoute un test dans tests/ (reseau simule), puis lance : .venv/bin/python -m pytest -q -p no:cacheprovider\n"
              "- Travaille sur une nouvelle branche, ne pousse pas sur main. Termine en disant ce que fait l'outil et "
              "son niveau de risque : l'utilisateur relit avant de redemarrer DevAgent.\n")


@tool("outil_demander", "Note qu'il te manque un outil, pour qu'il soit construit : decris le besoin en une phrase "
      "(« renommer un depot GitHub ») et, si tu en as propose une, la commande qui a servi en attendant. A appeler "
      "chaque fois que tu as du passer par commande_proposer ou renvoyer l'utilisateur vers un site.",
      risk=RISK_WRITE, automation=False,
      params={"besoin": {"type": "string"}, "exemple": {"type": "string", "description": "La commande ou la page utilisee en attendant"}},
      required=("besoin",))
def outil_demander(ctx, besoin, exemple=""):
    _ensure()
    besoin = besoin.strip()[:400]
    same = [r for r in requests("ouverte") if r["need"].lower() == besoin.lower()]
    if same:
        return {"demande": same[0]["id"], "deja_notee": True}
    with db.get_db() as c:
        rid = c.execute("INSERT INTO agent_tool_requests (at, actor, need, example) VALUES (?,?,?,?)",
                        (datetime.now().isoformat(timespec="seconds"), ctx.get("actor", "agent"), besoin,
                         _LOOKS_SECRET.sub("[cle masquee]", exemple or "")[:600])).lastrowid
    return {"demande": rid, "note": "Notee. L'utilisateur la voit dans DevAgent → Outils et peut la faire construire."}


@tool("outils_demandes", "Les outils qui manquent, notes pour etre construits.")
def outils_demandes(ctx):
    return requests("ouverte")
