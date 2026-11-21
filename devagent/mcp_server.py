"""DevAgent as an MCP server (stdio): Claude Code gets the tools of DevAgent.

    python -m devagent.mcp_server

Registered once for every project with `devagent mcp installer` (user scope).
The project is found from the folder Claude was started in, so tools can be
called without naming it.

Every call goes through the guard: an irreversible action is never run from
here, it becomes a confirmation the user approves in DevAgent.
"""
import contextlib
import os
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

import anyio  # noqa: E402
import mcp.types as types  # noqa: E402
from mcp.server.lowlevel import Server  # noqa: E402
from mcp.server.stdio import stdio_server  # noqa: E402

from devagent import RISK_IRREVERSIBLE, RISK_READ, guard, registry  # noqa: E402

INSTRUCTIONS = """DevAgent gere les projets de l'utilisateur sur ce PC et leurs connexions (GitHub, \
hebergement, serveurs, domaine, email, stockage, sauvegardes).

- Commence par `projet_etat` pour comprendre le projet courant (celui du dossier ou tu travailles).
- Le parametre `projet` est facultatif : vide = le projet du dossier courant.
- Chaque reponse a un champ `statut` : `ok`, `erreur` (lis `message`), ou `confirmation_requise`.
- `confirmation_requise` : l'action est irreversible. Elle n'a PAS ete faite. Dis a l'utilisateur de la \
confirmer dans DevAgent (ou `devagent approuver <n>`), puis verifie avec `confirmation_etat`. \
Ne cherche jamais a la faire autrement.
- Tu ne recois jamais de secret (token, mot de passe) : les outils s'en servent sans te les montrer. \
Un secret manquant se saisit par l'utilisateur dans l'interface de DevAgent.
- Enregistre une connexion (domaine, serveur, depot...) avec l'outil prevu, pas en ecrivant un fichier."""


def _ctx():
    cwd = os.environ.get("DEVAGENT_PROJECT_DIR") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    return {"cwd": cwd}


def _tool(t):
    return types.Tool(
        name=t.name,
        description=f"[{t.risk}] {t.description}",
        input_schema=t.input_schema,
        annotations=types.ToolAnnotations(read_only_hint=t.risk == RISK_READ,
                                          destructive_hint=t.risk == RISK_IRREVERSIBLE))


async def _list_tools(ctx, params):
    return types.ListToolsResult(tools=[_tool(t) for t in registry.all_tools()])


def _call_sync(name, args):
    with contextlib.redirect_stdout(sys.stderr):        # stdout is the protocol: nothing else may write there
        return guard.call(name, args, actor="mcp", ctx=_ctx())


async def _call_tool(ctx, params):
    answer = await anyio.to_thread.run_sync(_call_sync, params.name, dict(params.arguments or {}))
    return types.CallToolResult(content=[types.TextContent(type="text", text=guard.compact(answer))],
                                is_error=answer.get("statut") == "erreur")


def build():
    registry.load()
    return Server("devagent", version="1.0", instructions=INSTRUCTIONS,
                  on_list_tools=_list_tools, on_call_tool=_call_tool)


async def _main():
    server = build()
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


def main():
    anyio.run(_main)


if __name__ == "__main__":
    main()
