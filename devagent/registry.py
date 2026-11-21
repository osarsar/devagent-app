"""The tools of DevAgent: one registry, used by every caller.

    @tool("projet_etat", "Ou en est un projet ...", risk=RISK_READ,
          params={"projet": PROJET})
    def projet_etat(ctx, projet=None): ...

A tool function receives ``ctx`` (who calls, the default project) and its
arguments. It returns JSON-serialisable data and raises ProjectError (or
ToolError) with a French message when the action is refused.
"""
import ast
import importlib
import pkgutil
import sys
from pathlib import Path
from dataclasses import dataclass, field

from . import RISKS, RISK_READ

# Reusable parameter schemas
PROJET = {"type": "string",
          "description": "Nom (ou numero) du projet. Vide = le projet du dossier courant."}
DEPOT = {"type": "string",
         "description": "Dossier du depot dans le projet (ex. 'md_infra'). '.' = la racine."}


class ToolError(Exception):
    """A refused tool call, with a message for the user."""


class NeedsConfirmation(Exception):
    """Raised by a tool when THIS call cannot be undone (ex. push on main):
    the guard turns it into a confirmation request."""


@dataclass
class Tool:
    name: str
    description: str
    risk: str
    fn: object
    params: dict = field(default_factory=dict)
    required: tuple = ()
    domain: str = ""
    confirm_name: bool = False      # the user types the project name to approve
    automation: bool = True         # may an automation call it?
    precheck: object = None         # fn(args) raising ToolError: refuses a call before it is even asked
    trial: bool = False             # « a l'essai » : every call asks the user, until the tool is approved
    source: str = ""                # the file that defines it

    @property
    def input_schema(self):
        return {"type": "object", "properties": self.params,
                "required": list(self.required), "additionalProperties": False}

    def public(self):
        return {"name": self.name, "description": self.description, "risk": self.risk,
                "domain": self.domain, "input_schema": self.input_schema, "trial": self.trial,
                "automation": self.automation and self.risk != "irreversible"}


_TOOLS = {}
_loaded = False


def tool(name, description, risk=RISK_READ, params=None, required=(), confirm_name=False,
         automation=True, precheck=None):
    if risk not in RISKS:
        raise ValueError(f"niveau de risque inconnu : {risk}")

    def deco(fn):
        if name in _TOOLS and _TOOLS[name].fn.__module__ != fn.__module__:
            raise ValueError(f"outil deja declare : {name}")
        trial = ".tools_essai." in f".{fn.__module__}."
        _TOOLS[name] = Tool(name=name, description=description, risk=risk, fn=fn,
                            params=dict(params or {}), required=tuple(required),
                            domain=fn.__module__.rsplit(".", 1)[-1],
                            confirm_name=confirm_name, automation=automation and not trial, precheck=precheck,
                            trial=trial, source=getattr(sys.modules.get(fn.__module__), "__file__", "") or "")
        return fn
    return deco


def load():
    """Import every module of tools/ (each one registers its tools). Idempotent."""
    global _loaded
    if _loaded:
        return
    from . import tools as pkg
    for m in pkgutil.iter_modules(pkg.__path__):
        importlib.import_module(f"{pkg.__name__}.{m.name}")
    _loaded = True


# ── Tools « a l'essai » : loaded from devagent/tools_essai/ without a restart ──

_trial_seen = {}          # file → mtime already handled
_trial_errors = {}        # file name → why it was not loaded


def trial_dir():
    return Path(__file__).resolve().parent / "tools_essai"


def check_trial_source(text):
    """Why a trial file must not be loaded ('' = it may). Its top level may only hold a
    docstring, imports, constants and functions: nothing runs just because the file exists."""
    try:
        tree = ast.parse(text)
    except SyntaxError as e:
        return f"erreur de syntaxe ligne {e.lineno} : {e.msg}"
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef)):
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            value = node.value
            if value is None or all(isinstance(n, (ast.Constant, ast.Tuple, ast.List, ast.Dict, ast.Set, ast.Name,
                                                   ast.Load, ast.UnaryOp, ast.USub, ast.Store))
                                    for n in ast.walk(value)):
                continue
        return (f"ligne {node.lineno} : le fichier ne doit contenir que des imports, des constantes et des fonctions "
                "(du code qui s'execute au chargement est refuse)")
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            for d in node.decorator_list:
                call = d if isinstance(d, ast.Call) else None
                fn = call.func if call else d
                if not (isinstance(fn, ast.Name) and fn.id == "tool"):
                    return f"ligne {node.lineno} : seul le decorateur @tool est accepte"
    return ""


def load_trial():
    """Import new or changed files of tools_essai/ (cheap: one stat per file). Idempotent."""
    d = trial_dir()
    if not d.is_dir():
        return
    present = set()
    for f in sorted(d.glob("*.py")):
        if f.name.startswith("_"):
            continue
        present.add(str(f))
        try:
            mtime = f.stat().st_mtime
        except OSError:
            continue
        if _trial_seen.get(str(f)) == mtime:
            continue
        _trial_seen[str(f)] = mtime
        mod = f"devagent.tools_essai.{f.stem}"
        for name in [n for n, t in _TOOLS.items() if t.fn.__module__ == mod]:
            del _TOOLS[name]                                    # the file changed: its tools are redefined
        why = check_trial_source(f.read_text(encoding="utf-8", errors="replace"))
        if not why:
            try:
                if mod in sys.modules:
                    importlib.reload(sys.modules[mod])
                else:
                    importlib.import_module(mod)
            except Exception as e:
                why = f"{type(e).__name__} : {e}"
                for name in [n for n, t in _TOOLS.items() if t.fn.__module__ == mod]:
                    del _TOOLS[name]
        if why:
            _trial_errors[f.name] = why
        else:
            _trial_errors.pop(f.name, None)
    for gone in [p for p in _trial_seen if p not in present]:    # a file was removed (or approved)
        del _trial_seen[gone]
        mod = f"devagent.tools_essai.{Path(gone).stem}"
        for name in [n for n, t in _TOOLS.items() if t.fn.__module__ == mod]:
            del _TOOLS[name]
        sys.modules.pop(mod, None)
        _trial_errors.pop(Path(gone).name, None)


def trial_errors():
    load_trial()
    return dict(_trial_errors)


def approve_trial(filename):
    """The user approves a trial file: it moves to tools/ and its tools become normal ones."""
    load()
    src = trial_dir() / filename
    if not src.is_file() or src.parent != trial_dir() or filename.startswith("_") or not filename.endswith(".py"):
        raise ToolError(f"Fichier a l'essai introuvable : {filename}")
    why = check_trial_source(src.read_text(encoding="utf-8", errors="replace"))
    if why:
        raise ToolError(f"Ce fichier n'est pas chargeable : {why}")
    dst = Path(__file__).resolve().parent / "tools" / filename
    if dst.exists():
        raise ToolError(f"devagent/tools/{filename} existe deja : renomme le fichier a l'essai")
    names = [n for n, t in _TOOLS.items() if t.fn.__module__ == f"devagent.tools_essai.{src.stem}"]
    import shutil
    shutil.move(str(src), str(dst))
    load_trial()                                                # forgets the trial module and its tools
    importlib.invalidate_caches()
    importlib.import_module(f"devagent.tools.{dst.stem}")
    return {"approuve": filename, "outils": names}


def get(name):
    load()
    load_trial()
    t = _TOOLS.get(name)
    if not t:
        raise ToolError(f"Outil inconnu : {name}")
    return t


def all_tools(domain=None, max_risk=None):
    load()
    load_trial()
    out = sorted(_TOOLS.values(), key=lambda t: (t.domain, t.name))
    if domain:
        out = [t for t in out if t.domain == domain]
    if max_risk:
        out = [t for t in out if RISKS.index(t.risk) <= RISKS.index(max_risk)]
    return out


def domains():
    load()
    load_trial()
    return sorted({t.domain for t in _TOOLS.values()})
