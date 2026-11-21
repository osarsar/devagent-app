"""Tools — tell the user something (Telegram, email, and always DevAgent's own log)."""
from .. import RISK_WRITE
from ..connectors import notify
from ..registry import PROJET, tool
from ._common import resolve_project


@tool("notification_canaux", "Les canaux de notification configures (Telegram, email).")
def notification_canaux(ctx):
    return notify.channels()


@tool("notifier", "Envoie un message a l'utilisateur sur ses canaux configures (Telegram, email). "
      "Toujours ecrit aussi dans le journal de DevAgent.", risk=RISK_WRITE,
      params={"message": {"type": "string"}, "titre": {"type": "string"},
              "canal": {"type": "string", "enum": ["telegram", "email"]}, "projet": PROJET},
      required=("message",))
def notifier(ctx, message, titre="DevAgent", canal=None, projet=None):
    pid = None
    if projet or ctx.get("project_id") or ctx.get("cwd"):
        try:
            p = resolve_project(ctx, projet)
            pid, titre = p["id"], (titre if titre != "DevAgent" else f"DevAgent — {p['name']}")
        except Exception:
            pass
    return notify.send(message, title=titre, channel=canal, project_id=pid)
