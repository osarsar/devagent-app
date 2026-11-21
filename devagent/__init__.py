"""DevAgent — the agent layer of DevPilot.

One list of tools (registry), one way to run them (guard), and several users of
that list: the web interface, Claude Code through MCP, the chat, the automations.

    registry   the tools: name, description, input schema, risk level, function
    guard      runs a tool: validates, asks for a confirmation when the action
               cannot be undone, writes the journal
    vault      secrets, encrypted; a tool gets a secret by name, the agent never sees it
    journal    who did what, when, with which result
    tools/     one file per domain (projet, git, github, stockage, serveur...)
    connectors/ one file per outside platform (notification, deploiement...)

Adding a platform = one connector file + its tools. Nothing else changes.
"""

RISK_READ = "lecture"            # reads only: always allowed
RISK_WRITE = "ecriture"          # changes something that can be undone: journalled
RISK_IRREVERSIBLE = "irreversible"  # cannot be undone: the user confirms each time
RISKS = (RISK_READ, RISK_WRITE, RISK_IRREVERSIBLE)
