"""The `devagent` command (beside the web interface).

    devagent outils [domaine]            la liste des outils et leur niveau de risque
    devagent appeler <outil> [cle=valeur ...]   lancer un outil (comme l'agent le ferait)
    devagent journal [n]                 les dernieres actions
    devagent confirmations               les actions irreversibles en attente
    devagent approuver <n> [nom-projet]  approuver (et lancer) une action en attente
    devagent refuser <n>
    devagent pause | reprendre           l'agent et les automatisations ne font plus que lire
    devagent mcp installer|retirer|etat  brancher DevAgent dans Claude Code
    devagent coffre etat|sceller|ouvrir  les secrets chiffres de ce PC
    devagent coffre connecter            brancher Bitwarden sur ce PC (une fois)
    devagent coffre envoyer|recuperer    les cles : ce PC → Bitwarden, ou Bitwarden → ce PC
    devagent auto lister|lancer <projet> <nom>|historique   les automatisations
    devagent migrer [--appliquer|--annuler --oui]   renommer ~/devpilot en ~/devagent (simulation par defaut)
"""
import json
import os
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))


def _out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def _kv(pairs):
    args = {}
    for p in pairs:
        if "=" not in p:
            raise SystemExit(f"✗ argument attendu sous la forme cle=valeur : {p}")
        k, v = p.split("=", 1)
        try:
            args[k] = json.loads(v)
        except ValueError:
            args[k] = v
    return args


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("help", "-h", "--help"):
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "migrer":                                   # before anything opens the database
        from devagent import migrate
        return migrate.cli(rest)
    from devagent import guard, journal, registry

    if cmd == "outils":
        for t in registry.all_tools(domain=rest[0] if rest else None):
            mark = {"lecture": " ", "ecriture": "✎", "irreversible": "⚠"}[t.risk]
            print(f"{mark} {t.name:<28} {t.risk:<12} {t.description[:90]}")
        print(f"\n{len(registry.all_tools())} outils — ✎ ecriture (journalisee) · ⚠ irreversible (confirmation)")
        return 0
    if cmd == "appeler":
        if not rest:
            raise SystemExit("✗ devagent appeler <outil> [cle=valeur ...]")
        out = guard.call(rest[0], _kv(rest[1:]), actor="cli", ctx={"cwd": os.getcwd()})
        _out(out)
        return 0 if out["statut"] != "erreur" else 1
    if cmd == "journal":
        for a in reversed(journal.actions(limit=int(rest[0]) if rest else 30)):
            print(f"{a['at']}  {a['status']:<8} {a['actor']:<22} {a['tool']:<26} {json.dumps(a['args'], ensure_ascii=False)[:80]}")
        return 0
    if cmd == "confirmations":
        waiting = journal.approvals("attente")
        for a in waiting:
            print(f"n° {a['id']}  {a['created_at']}  {a['tool']}  {json.dumps(a['args'], ensure_ascii=False)}"
                  + (f"  — {a['reason']}" if a.get("reason") else ""))
        if not waiting:
            print("Aucune action en attente.")
        return 0
    if cmd in ("approuver", "refuser"):
        if not rest or not rest[0].isdigit():
            raise SystemExit(f"✗ devagent {cmd} <numero>")
        out = guard.approve(int(rest[0]), rest[1] if len(rest) > 1 else None) if cmd == "approuver" \
            else guard.refuse(int(rest[0]))
        _out(out)
        return 0 if out["statut"] == "ok" else 1
    if cmd in ("pause", "reprendre"):
        print("Agent en pause : lectures seulement." if guard.set_paused(cmd == "pause") else "Agent actif.")
        return 0
    if cmd == "mcp":
        from devagent import mcp_install
        sub = rest[0] if rest else "etat"
        out = {"installer": mcp_install.install, "retirer": mcp_install.remove}.get(sub, mcp_install.status)()
        _out(out)
        return 0 if out.get("ok", True) else 1
    if cmd == "coffre":
        import db
        from devagent import vault
        sub = rest[0] if rest else "etat"
        if sub in ("connecter", "envoyer", "recuperer", "bitwarden"):
            from devagent import bitwarden
            return bitwarden.cli(rest if sub != "bitwarden" else rest[1:])
        if sub == "sceller":
            print(f"{db.seal_stored_secrets()} secret(s) chiffres.")
        elif sub == "ouvrir":
            print(f"{_unseal_all(db, vault)} secret(s) remis en clair (pour revenir a une ancienne version).")
        else:
            _out(_vault_state(db, vault))
        return 0
    if cmd == "auto":
        from devagent import automations
        return automations.cli(rest)
    if cmd == "migrer":
        from devagent import migrate
        return migrate.cli(rest)
    raise SystemExit(f"✗ commande inconnue : devagent {cmd}\n  devagent help")


def _vault_state(db, vault):
    with db.get_db() as c:
        rows = c.execute("SELECT key, value FROM settings").fetchall()
        comps = c.execute("SELECT config FROM project_components").fetchall()
    secret = [r for r in rows if vault.is_secret_setting(r["key"]) and r["value"]]
    return {"cle": str(vault.key_path()), "cle_presente": vault.key_path().exists(),
            "reglages_secrets": len(secret),
            "reglages_encore_en_clair": [r["key"] for r in secret if not vault.is_sealed(r["value"])],
            "connexions_avec_secret_chiffre": sum(1 for r in comps if "enc:v1:" in (r["config"] or ""))}


def _unseal_all(db, vault):
    n = 0
    with db.get_db() as c:
        for r in c.execute("SELECT key, value FROM settings").fetchall():
            if vault.is_sealed(r["value"]):
                c.execute("UPDATE settings SET value = ? WHERE key = ?", (vault.unseal(r["value"]), r["key"]))
                n += 1
        for r in c.execute("SELECT project_id, component, config FROM project_components").fetchall():
            if "enc:v1:" in (r["config"] or ""):
                cfg = vault.unseal_config(json.loads(r["config"]))
                c.execute("UPDATE project_components SET config = ? WHERE project_id = ? AND component = ?",
                          (json.dumps(cfg), r["project_id"], r["component"]))
                n += 1
    return n


if __name__ == "__main__":
    raise SystemExit(main())
