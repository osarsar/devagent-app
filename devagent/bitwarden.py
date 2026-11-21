"""Bitwarden: the keys of DevAgent, shared between your PCs.

Every access DevAgent holds (the page « Acces ») is kept in ONE secure note of your Bitwarden
vault, « DevAgent — acces ». On this PC the keys stay encrypted in the local vault as before;
Bitwarden is how they travel:

    push(password)   this PC → Bitwarden   (after you add or renew a key)
    pull(password)   Bitwarden → this PC   (new PC, or a key renewed elsewhere)

The master password is asked each time. It goes to the `bw` program through its environment,
is never written anywhere, and the Bitwarden vault is locked again when the operation ends.
The agent has no tool that reads this note: only you, with your password.

`bw` must be logged in once per PC (`devagent coffre connecter`): that step is interactive
(email, master password, two-step code).
"""
import base64
import json
import os
import shutil
import subprocess
from datetime import datetime

import db
import projects as P

ITEM = "DevAgent — acces"
EXTRA_KEYS = ("agent_model", "agent_effort")          # not secret, but part of the setup of a PC


def _bw(args, session=None, password=None, stdin=None, timeout=90):
    exe = shutil.which("bw")
    if not exe:
        raise P.ProjectError("Bitwarden n'est pas installe sur ce PC : sudo snap install bw")
    env = dict(os.environ)
    if session:
        env["BW_SESSION"] = session
    if password is not None:
        env["DEVAGENT_BW_PASSWORD"] = password
    try:
        r = subprocess.run([exe, *args, "--nointeraction"], capture_output=True, text=True, timeout=timeout,
                           env=env, input=stdin)
    except subprocess.TimeoutExpired:
        raise P.ProjectError("Bitwarden ne repond pas (delai depasse) : verifie la connexion internet")
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def status():
    """{installe, etat: absent | deconnecte | verrouille | ouvert, email, serveur}"""
    if not shutil.which("bw"):
        return {"installe": False, "etat": "absent", "email": None, "serveur": None}
    rc, out, _ = _bw(["status"], timeout=30)
    try:
        d = json.loads(out)
    except ValueError:
        d = {}
    etat = {"unauthenticated": "deconnecte", "locked": "verrouille", "unlocked": "ouvert"}.get(d.get("status"), "deconnecte")
    return {"installe": True, "etat": etat, "email": d.get("userEmail"), "serveur": d.get("serverUrl")}


def _unlock(password):
    if not (password or "").strip():
        raise P.ProjectError("Mot de passe maitre Bitwarden requis")
    st = status()
    if st["etat"] in ("absent", "deconnecte"):
        raise P.ProjectError("Bitwarden n'est pas connecte sur ce PC. Dans un terminal : devagent coffre connecter")
    rc, out, err = _bw(["unlock", "--passwordenv", "DEVAGENT_BW_PASSWORD", "--raw"], password=password)
    if rc != 0 or not out:
        raise P.ProjectError("Bitwarden refuse ce mot de passe maitre" if "nvalid" in err or "assword" in err
                             else f"Bitwarden : {err[:160] or 'deverrouillage impossible'}")
    return out.splitlines()[-1].strip()


def _lock():
    try:
        _bw(["lock"], timeout=30)
    except P.ProjectError:
        pass


def _find(session):
    rc, out, err = _bw(["list", "items", "--search", ITEM], session=session)
    if rc != 0:
        raise P.ProjectError(f"Bitwarden : {err[:160]}")
    try:
        items = [i for i in json.loads(out or "[]") if i.get("name") == ITEM]
    except ValueError:
        items = []
    return items[0] if items else None


def collect():
    """What this PC would send: every access that is saved here."""
    import hosting
    from . import access
    settings = {}
    for k in sorted(access.FIELD_KEYS | set(EXTRA_KEYS)):
        v = db.get_setting(k, "") or ""
        if v:
            settings[k] = v
    return {"version": 1, "mis_a_jour": datetime.now().isoformat(timespec="seconds"),
            "reglages": settings, "hebergeurs": hosting.accounts()}


def _summary(payload):
    return {"cles": sorted(payload.get("reglages") or {}),
            "hebergeurs": [f"{a.get('platform')} — {a.get('name')}" for a in payload.get("hebergeurs") or []],
            "mis_a_jour": payload.get("mis_a_jour")}


def push(password):
    """This PC → Bitwarden. Returns the names of what was sent (never a value)."""
    payload = collect()
    if not payload["reglages"] and not payload["hebergeurs"]:
        raise P.ProjectError("Aucune cle n'est saisie sur ce PC : rien a envoyer")
    session = _unlock(password)
    try:
        _bw(["sync"], session=session)
        existing = _find(session)
        notes = json.dumps(payload, ensure_ascii=False, indent=1)
        if existing:
            existing["notes"] = notes
            enc = base64.b64encode(json.dumps(existing).encode()).decode()
            rc, _, err = _bw(["edit", "item", existing["id"]], session=session, stdin=enc)
        else:
            rc, out, err = _bw(["get", "template", "item"], session=session)
            try:
                item = json.loads(out)
            except ValueError:
                raise P.ProjectError(f"Bitwarden : modele d'element illisible ({err[:100]})")
            item.update(type=2, name=ITEM, notes=notes, secureNote={"type": 0}, login=None, card=None,
                        identity=None, fields=[], favorite=False)
            enc = base64.b64encode(json.dumps(item).encode()).decode()
            rc, _, err = _bw(["create", "item"], session=session, stdin=enc)
        if rc != 0:
            raise P.ProjectError(f"Bitwarden : envoi refuse ({err[:160]})")
        _bw(["sync"], session=session)
    finally:
        _lock()
    db.set_setting("bitwarden_last_push", payload["mis_a_jour"])
    return {"envoye": True, "cree": not existing, **_summary(payload)}


def pull(password):
    """Bitwarden → this PC. Keys present in Bitwarden replace the local ones; a key that only
    exists here is kept. Returns the names of what was received."""
    import hosting
    from . import access
    session = _unlock(password)
    try:
        _bw(["sync"], session=session)
        item = _find(session)
    finally:
        _lock()
    if not item:
        raise P.ProjectError(f"La note « {ITEM} » n'existe pas dans ce Bitwarden : envoie d'abord les cles depuis "
                             "un PC qui les a (Agent → Acces → Envoyer vers Bitwarden)")
    try:
        payload = json.loads(item.get("notes") or "")
    except ValueError:
        raise P.ProjectError(f"La note « {ITEM} » est illisible : elle a ete modifiee a la main ?")
    if not isinstance(payload, dict):
        raise P.ProjectError(f"La note « {ITEM} » est illisible : elle a ete modifiee a la main ?")
    allowed = access.FIELD_KEYS | set(EXTRA_KEYS)
    taken = {}                                   # only known keys: a note cannot change other settings
    for k, v in (payload.get("reglages") or {}).items() if isinstance(payload.get("reglages"), dict) else []:
        if k in allowed and isinstance(v, str) and v:
            db.set_setting(k, v)
            taken[k] = v
    n = len(taken)
    theirs = [a for a in payload.get("hebergeurs") or [] if isinstance(a, dict) and a.get("id") and a.get("platform")]
    if theirs:
        ids = {a["id"] for a in theirs}
        # the projects linked to an account are local to each PC: keep ours
        mine = {a["id"]: a for a in hosting.accounts()}
        merged = [{**a, "projects": (mine.get(a["id"]) or {}).get("projects", [])} for a in theirs]
        hosting.save_accounts(merged + [a for a in mine.values() if a["id"] not in ids])
    db.set_setting("bitwarden_last_pull", datetime.now().isoformat(timespec="seconds"))
    return {"recu": True, "nombre": n,
            **_summary({"reglages": taken, "hebergeurs": theirs, "mis_a_jour": payload.get("mis_a_jour")})}


def info():
    return {**status(), "note": ITEM, "dernier_envoi": db.get_setting("bitwarden_last_push", "") or None,
            "derniere_recuperation": db.get_setting("bitwarden_last_pull", "") or None}


# ── CLI ─────────────────────────────────────────────────────────────────────

def cli(argv):
    import getpass
    sub = argv[0] if argv else "etat"
    if sub == "connecter":
        if not shutil.which("bw"):
            print("✗ Bitwarden n'est pas installe : sudo snap install bw")
            return 1
        st = status()
        if st["etat"] != "deconnecte":
            print(f"Deja connecte ({st['email']}, {st['serveur']}).")
            return 0
        choix = input("Ton compte Bitwarden est sur : 1) bitwarden.com   2) bitwarden.eu   [1] : ").strip()
        subprocess.run(["bw", "config", "server", "https://vault.bitwarden.eu" if choix == "2" else "https://vault.bitwarden.com"],
                       capture_output=True)
        email = input("Email du compte Bitwarden : ").strip()
        print("Tape ton mot de passe maitre, puis le code a deux facteurs si Bitwarden le demande :")
        rc = subprocess.run(["bw", "login", email]).returncode
        _lock()
        print("\nConnecte. Ensuite : devagent coffre recuperer   (ou : devagent coffre envoyer)" if rc == 0 else "\n✗ Connexion refusee.")
        return rc
    if sub in ("envoyer", "recuperer"):
        try:
            pw = getpass.getpass("Mot de passe maitre Bitwarden : ")
            out = push(pw) if sub == "envoyer" else pull(pw)
        except Exception as e:
            if type(e).__name__ != "ProjectError":
                raise
            print(f"✗ {e.message}")
            return 1
        verb = "envoyees vers Bitwarden" if sub == "envoyer" else "recuperees de Bitwarden"
        print(f"✓ {len(out['cles'])} cle(s) et {len(out['hebergeurs'])} compte(s) d'hebergement {verb}.")
        for k in out["cles"]:
            print(f"   {k}")
        for h in out["hebergeurs"]:
            print(f"   {h}")
        if sub == "recuperer":
            print("\nVerifie qu'elles marchent : devagent appeler acces_tester")
        return 0
    print(json.dumps(info(), ensure_ascii=False, indent=2))
    return 0
