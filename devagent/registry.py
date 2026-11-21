"""The tools of DevAgent: one registry, used by every caller.

    @tool("projet_etat", "Ou en est un projet ...", risk=RISK_READ,
          params={"projet": PROJET})
    def projet_etat(ctx, projet=None): ...

A tool function receives ``ctx`` (who calls, the default project) and its
arguments. It returns JSON-serialisable data and raises ProjectError (or
ToolError) with a French message when the action is refused.
"""
import importlib
import pkgutil
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

    @property
    def input_schema(self):
        return {"type": "object", "properties": self.params,
                "required": list(self.required), "additionalProperties": False}

    def public(self):
        return {"name": self.name, "description": self.description, "risk": self.risk,
                "domain": self.domain, "input_schema": self.input_schema,
                "automation": self.automation and self.risk != "irreversible"}


_TOOLS = {}
_loaded = False


def tool(name, description, risk=RISK_READ, params=None, required=(), confirm_name=False,
         automation=True):
    if risk not in RISKS:
        raise ValueError(f"niveau de risque inconnu : {risk}")

    def deco(fn):
        if name in _TOOLS and _TOOLS[name].fn.__module__ != fn.__module__:
            raise ValueError(f"outil deja declare : {name}")
        _TOOLS[name] = Tool(name=name, description=description, risk=risk, fn=fn,
                            params=dict(params or {}), required=tuple(required),
                            domain=fn.__module__.rsplit(".", 1)[-1],
                            confirm_name=confirm_name, automation=automation)
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


def get(name):
    load()
    t = _TOOLS.get(name)
    if not t:
        raise ToolError(f"Outil inconnu : {name}")
    return t


def all_tools(domain=None, max_risk=None):
    load()
    out = sorted(_TOOLS.values(), key=lambda t: (t.domain, t.name))
    if domain:
        out = [t for t in out if t.domain == domain]
    if max_risk:
        out = [t for t in out if RISKS.index(t.risk) <= RISKS.index(max_risk)]
    return out


def domains():
    load()
    return sorted({t.domain for t in _TOOLS.values()})
