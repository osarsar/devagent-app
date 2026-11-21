"""The MCP server, end to end: a real client over stdio, as Claude Code does."""
import json
import os
import sys
from pathlib import Path

import anyio
import pytest

APP = Path(__file__).resolve().parent.parent


async def _session(home, cwd, fn):
    from mcp import ClientSession, StdioServerParameters, stdio_client
    env = {**os.environ, "HOME": str(home), "DEVAGENT_PROJECT_DIR": str(cwd)}
    params = StdioServerParameters(command=sys.executable, args=["-m", "devagent.mcp_server"],
                                   env=env, cwd=str(APP))
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as s:
            await s.initialize()
            return await fn(s)


def _text(res):
    return json.loads(res.content[0].text)


def test_mcp_liste_et_appelle_les_outils(home, P):
    p = P.create("mcp-demo")

    async def run(s):
        tools = (await s.list_tools()).tools
        etat = await s.call_tool("projet_etat", {})                     # no project named: the current folder
        cree = await s.call_tool("projet_etape_ajouter", {"phase": "dev", "libelle": "Via MCP"})
        suppr = await s.call_tool("projet_supprimer", {"projet": "mcp-demo"})
        faux = await s.call_tool("projet_etat", {"projet": "nexiste-pas"})
        return tools, etat, cree, suppr, faux

    tools, etat, cree, suppr, faux = anyio.run(_session, home, p["path"], run)
    names = {t.name for t in tools}
    assert {"projet_etat", "github_creer_depot", "serveur_ajouter", "domaine_verifier"} <= names
    by = {t.name: t for t in tools}
    assert by["projet_etat"].annotations.read_only_hint is True
    assert by["projet_supprimer"].annotations.destructive_hint is True
    assert by["projet_creer"].input_schema["required"] == ["nom"]
    assert _text(etat)["resultat"]["projet"]["nom"] == "mcp-demo"
    assert _text(cree)["statut"] == "ok"
    assert _text(suppr)["statut"] == "confirmation_requise"           # never done from the agent
    assert P.get(p["id"])
    assert faux.is_error and "introuvable" in _text(faux)["message"]

    # the write is in the journal of the same database, with its actor
    from devagent import journal
    journal._ready_for = None
    acts = journal.actions()
    assert any(a["tool"] == "projet_etape_ajouter" and a["actor"] == "mcp" for a in acts)
    assert journal.approvals("attente")[0]["tool"] == "projet_supprimer"
