"""Tools — the agent about itself: its tools, its journal, the confirmations."""
from .. import guard, journal, registry
from ..registry import PROJET, tool
from ._common import resolve_project


@tool("agent_outils", "La liste des outils de DevAgent par domaine, avec leur niveau de risque.",
      params={"domaine": {"type": "string"}})
def agent_outils(ctx, domaine=None):
    return [{"nom": t.name, "domaine": t.domain, "risque": t.risk, "description": t.description}
            for t in registry.all_tools(domain=domaine or None)]


@tool("agent_journal", "Les dernieres actions faites par l'agent, les automatisations ou l'interface.",
      params={"projet": PROJET, "limite": {"type": "integer", "minimum": 1, "maximum": 200}})
def agent_journal(ctx, projet=None, limite=30):
    pid = resolve_project(ctx, projet)["id"] if projet else None
    return journal.actions(limit=limite, project_id=pid)


@tool("confirmation_etat", "Ou en est une action irreversible en attente de confirmation : attente, fait, "
      "refuse ou echec, avec son resultat.", params={"numero": {"type": "integer"}}, required=("numero",))
def confirmation_etat(ctx, numero):
    out = guard.approval_state(numero)
    if out["statut"] != "ok":
        from ..registry import ToolError
        raise ToolError(out["message"])
    return out["resultat"]


@tool("confirmations_en_attente", "Les actions irreversibles qui attendent la confirmation de l'utilisateur.")
def confirmations_en_attente(ctx):
    return [{k: a[k] for k in ("id", "tool", "args", "reason", "actor", "created_at")}
            for a in journal.approvals("attente")]
