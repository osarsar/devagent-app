"""Tools « a l'essai »: written for the agent (by Claude Code) and not yet approved by the user.

A file dropped here is loaded without restarting DevAgent, and its tools are usable at once —
but EVERY call goes through a confirmation, whatever risk level the tool declares, until the user
approves the tool (page « Outils »). Approving moves the file to devagent/tools/.

A file is loaded only if its top level holds nothing but a docstring, imports, constants and
functions: no code may run just because the file exists.
"""
