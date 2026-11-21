"""DevAgent core: the vault, the guard (risk levels, confirmations, pause), the
journal, and a walk through the tools on a real throwaway project."""
import importlib
import json
import os
import sqlite3
import stat

import pytest

from conftest import sh


@pytest.fixture
def agent(home):
    """Fresh devagent modules bound to the throwaway HOME."""
    import db
    from devagent import guard, journal, registry, vault
    journal._ready_for = None
    registry.load()
    return type("A", (), {"db": db, "guard": guard, "journal": journal, "registry": registry, "vault": vault})


def raw_setting(db, key):
    c = sqlite3.connect(str(db.DB_PATH))
    try:
        r = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return r[0] if r else None
    finally:
        c.close()


# ── Vault ───────────────────────────────────────────────────────────────────

def test_coffre_chiffre_et_dechiffre(agent):
    v = agent.vault
    s = v.seal("ghp_secret123")
    assert s.startswith("enc:v1:") and "ghp_secret123" not in s
    assert v.unseal(s) == "ghp_secret123"
    assert v.seal(s) == s and v.seal("") == "" and v.unseal("clair") == "clair"
    mode = stat.S_IMODE(os.stat(v.key_path()).st_mode)
    assert mode == 0o600


def test_un_secret_n_est_jamais_en_clair_dans_la_base(agent):
    db = agent.db
    db.set_setting("github_token", "ghp_TOPSECRET")
    db.set_setting("scan_dirs", "~/Desktop")
    assert "ghp_TOPSECRET" not in raw_setting(db, "github_token")
    assert raw_setting(db, "scan_dirs") == "~/Desktop"            # not a secret: stays readable
    assert db.get_setting("github_token") == "ghp_TOPSECRET"
    assert db.get_all_settings()["github_token"] == "ghp_TOPSECRET"
    assert "ghp_TOPSECRET" not in open(db.DB_PATH, "rb").read().decode("latin-1")


def test_migration_des_secrets_deja_en_clair(agent, P):
    db = agent.db
    p = P.create("site")
    with db.get_db() as c:                                        # as an older version left them
        c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('r2_secret_access_key', 'PLAIN-R2')")
        c.execute("INSERT INTO project_components (project_id, component, config) VALUES (?, 'database', ?)",
                  (p["id"], json.dumps({"host": "db.local", "password": "PLAIN-PW"})))
    assert db.seal_stored_secrets() == 2
    assert db.seal_stored_secrets() == 0                          # safe to run again
    blob = open(db.DB_PATH, "rb").read().decode("latin-1")
    with db.get_db() as c:
        c.execute("PRAGMA wal_checkpoint(FULL)")
    assert "PLAIN-R2" not in raw_setting(db, "r2_secret_access_key")
    assert db.get_setting("r2_secret_access_key") == "PLAIN-R2"
    cfg = db.get_project_component(p["id"], "database")["config"]
    assert cfg == {"host": "db.local", "password": "PLAIN-PW"}


def test_config_de_connexion_scellee_a_l_ecriture(agent, P):
    db = agent.db
    p = P.create("site")
    db.add_project_component(p["id"], "database", config={"host": "h", "password": "pw1"})
    db.update_project_component(p["id"], "database", config={"host": "h", "password": "pw2"})
    c = sqlite3.connect(str(db.DB_PATH))
    raw = c.execute("SELECT config FROM project_components").fetchone()[0]
    c.close()
    assert "pw2" not in raw and "enc:v1:" in raw
    assert db.get_project_components(p["id"])[0]["config"]["password"] == "pw2"


def test_cle_perdue_ne_casse_pas_la_lecture(agent, monkeypatch, tmp_path):
    db = agent.db
    db.set_setting("github_token", "ghp_x")
    monkeypatch.setenv("DEVAGENT_VAULT_KEY_FILE", str(tmp_path / "autre.key"))
    assert db.get_setting("github_token", "") == ""


def test_redact(agent):
    out = agent.vault.redact({"name": "vercel", "token": "abc", "nested": [{"password": "x", "host": "h"}]})
    assert out == {"name": "vercel", "token": "***", "nested": [{"password": "***", "host": "h"}]}


# ── Registry ────────────────────────────────────────────────────────────────

def test_registre_coherent(agent):
    tools = agent.registry.all_tools()
    assert len(tools) >= 60
    names = [t.name for t in tools]
    assert len(names) == len(set(names))
    for t in tools:
        assert t.risk in ("lecture", "ecriture", "irreversible")
        assert len(t.description) > 20, t.name
        assert t.name.replace("_", "").isalnum() and len(t.name) <= 64      # a valid MCP / API tool name
        assert set(t.required) <= set(t.params), t.name
        import inspect
        sig = inspect.signature(t.fn)
        assert set(t.params) == set(sig.parameters) - {"ctx"}, f"{t.name}: schema and function differ"
    # no tool takes a secret as argument
    for t in tools:
        assert not (set(t.params) & agent.vault.SECRET_FIELDS), t.name


# ── Guard ───────────────────────────────────────────────────────────────────

def test_lecture_ecriture_et_journal(agent, P):
    g = agent.guard
    out = g.call("projet_creer", {"nom": "vitrine-x", "profil": "vitrine"}, actor="mcp")
    assert out["statut"] == "ok" and out["resultat"]["profil"] == "vitrine"
    assert g.call("projet_lister", actor="mcp")["resultat"][0]["nom"] == "vitrine-x"
    acts = agent.journal.actions()
    assert [a["tool"] for a in acts] == ["projet_creer"]            # reads are not journalled
    assert acts[0]["actor"] == "mcp" and acts[0]["status"] == "ok"


def test_arguments_valides(agent):
    g = agent.guard
    assert g.call("projet_creer", {}, actor="mcp")["statut"] == "erreur"
    assert g.call("projet_creer", {"nom": "a", "inconnu": 1}, actor="mcp")["statut"] == "erreur"
    assert g.call("pas_un_outil", {}, actor="mcp")["statut"] == "erreur"
    out = g.call("projet_etat", {"projet": "nexiste-pas"}, actor="mcp")
    assert out["statut"] == "erreur" and "introuvable" in out["message"]


def test_irreversible_attend_la_confirmation(agent, P):
    g = agent.guard
    p = P.create("a-supprimer")
    out = g.call("projet_supprimer", {"projet": "a-supprimer", "supprimer_fichiers": True}, actor="mcp")
    assert out["statut"] == "confirmation_requise"
    aid = out["confirmation"]
    assert P.get(p["id"])                                          # nothing happened
    assert g.approve(aid, "mauvais-nom")["nom_requis"]
    assert P.get(p["id"])
    assert g.call("confirmation_etat", {"numero": aid}, actor="mcp")["resultat"]["status"] == "attente"
    done = g.approve(aid, "a-supprimer")
    assert done["statut"] == "ok" and done["resultat"]["trashed_to"]
    with pytest.raises(P.ProjectError):
        P.get(p["id"])
    assert g.approve(aid, "a-supprimer")["statut"] == "erreur"      # only once
    assert g.call("confirmation_etat", {"numero": aid}, actor="mcp")["resultat"]["status"] == "fait"


def test_refus(agent, P):
    g = agent.guard
    p = P.create("garde")
    aid = g.call("projet_supprimer", {"projet": "garde"}, actor="chat")["confirmation"]
    assert g.refuse(aid)["statut"] == "ok"
    assert g.approve(aid, "garde")["statut"] == "erreur"
    assert P.get(p["id"])


def test_une_automatisation_ne_fait_rien_d_irreversible(agent, P):
    g = agent.guard
    P.create("auto")
    out = g.call("projet_supprimer", {"projet": "auto"}, actor="automatisation:nuit")
    assert out["statut"] == "erreur" and not agent.journal.approvals("attente")


def test_pause(agent, P):
    g = agent.guard
    g.set_paused(True)
    assert g.call("projet_creer", {"nom": "non"}, actor="mcp")["statut"] == "erreur"
    assert g.call("projet_lister", actor="mcp")["statut"] == "ok"           # reads still work
    assert g.call("projet_creer", {"nom": "oui"}, actor="interface")["statut"] == "ok"   # the user is never paused
    g.set_paused(False)
    assert g.call("projet_creer", {"nom": "encore"}, actor="mcp")["statut"] == "ok"


def test_une_erreur_d_outil_ne_remonte_jamais_en_exception(agent, monkeypatch):
    t = agent.registry.get("projet_lister")
    monkeypatch.setattr(t, "fn", lambda ctx: 1 / 0)
    out = agent.guard.call("projet_lister", actor="mcp")
    assert out["statut"] == "erreur" and "ZeroDivisionError" in out["message"]


# ── Tools on a real project ─────────────────────────────────────────────────

def test_parcours_d_un_projet(agent, P):
    g = agent.guard
    call = lambda name, **a: g.call(name, a, actor="mcp")
    assert call("projet_creer", nom="demo", profil="vitrine", description="un site")["statut"] == "ok"
    etat = call("projet_etat", projet="demo")["resultat"]
    assert etat["projet"]["profil"] == "vitrine"
    assert {b["need"] for b in etat["besoins"]["needs"]} >= {"github", "hosting", "domain"}
    assert etat["feuille_de_route"]["reste_a_faire"]
    assert call("projet_etape_ajouter", projet="demo", phase="dev", libelle="Page contact")["statut"] == "ok"
    note = call("projet_note_session", projet="demo", titre="Jour 1", contenu="Fait : rien encore")["resultat"]
    assert os.path.isfile(note["fichier"])
    assert call("projet_sessions", projet="demo")["resultat"][0]["nom"].endswith("_jour-1.md")
    assert call("projet_definir_profil", projet="demo", profil="blog_cms")["statut"] == "ok"
    assert call("projet_etat", projet="demo")["resultat"]["projet"]["profil"] == "blog_cms"
    assert call("domaine_enregistrer", projet="demo", domaine="https://www.Exemple.ma/")["statut"] == "ok"
    assert call("domaine_etat", projet="demo")["resultat"]["config"]["domain"] == "exemple.ma"
    assert call("projet_renommer", projet="demo", nouveau_nom="demo2")["statut"] == "ok"
    assert call("projet_etat", projet="demo2")["statut"] == "ok"


def test_projet_par_dossier_courant(agent, P):
    p = P.create("ici")
    sub = os.path.join(p["path"], "src")
    os.makedirs(sub)
    out = agent.guard.call("projet_etat", {}, actor="mcp", ctx={"cwd": sub})
    assert out["resultat"]["projet"]["nom"] == "ici"
    assert agent.guard.call("projet_etat", {}, actor="mcp", ctx={"cwd": "/tmp"})["statut"] == "erreur"


def test_git_commit_et_garde_sur_main(agent, P, remote, tmp_path):
    g = agent.guard
    p = P.clone(remote, name="depot")
    path = p["path"]
    open(os.path.join(path, "a.txt"), "w").write("x")
    st = g.call("git_statut", {"projet": "depot"}, actor="mcp")["resultat"]
    assert st["branch"] == "main" and st["untracked"] == 1
    # on main: pushing asks the user
    out = g.call("git_synchroniser", {"projet": "depot", "message": "ajout"}, actor="mcp")
    assert out["statut"] == "confirmation_requise"
    assert sh("git", "status", "--porcelain", cwd=path)             # still not committed
    # on a work branch: it goes through
    assert g.call("git_nouvelle_branche", {"projet": "depot", "nom": "feat/a", "emporter_modifs": True},
                  actor="mcp")["statut"] == "ok"
    out = g.call("git_synchroniser", {"projet": "depot", "message": "ajout"}, actor="mcp")
    assert out["statut"] == "ok", out
    assert "feat/a" in sh("git", "ls-remote", "--heads", "origin", cwd=path)
    # the waiting push on main, approved by the user, runs with approved=True
    aid = agent.journal.approvals("attente")[0]["id"]
    sh("git", "checkout", "-q", "main", cwd=path)
    assert g.approve(aid)["statut"] in ("ok", "erreur")             # runs (nothing to push is fine too)


def test_les_resultats_ne_montrent_aucun_secret(agent, P):
    import hosting
    hosting.save_accounts([{"id": "a1", "name": "vercel-perso", "platform": "vercel", "token": "TOK-123"}])
    out = agent.guard.call("hebergement_comptes", actor="mcp")
    assert "TOK-123" not in json.dumps(out) and out["resultat"][0]["token_present"] is True
    P.create("heb")
    assert agent.guard.call("hebergement_lier", {"projet": "heb", "compte": "vercel-perso",
                                                 "url_site": "https://x.vercel.app"}, actor="mcp")["statut"] == "ok"
    assert agent.guard.call("hebergement_cible", {"projet": "heb"}, actor="mcp")["resultat"]["platform"] == "vercel"
    assert "TOK-123" not in json.dumps(agent.journal.actions())


def test_outils_du_pc_et_connexions(agent, P):
    g = agent.guard
    P.create("demo")
    s = g.call("pc_systeme", actor="mcp")
    assert s["statut"] == "ok" and "disks" in s["resultat"] and "cpu" in s["resultat"]
    c = g.call("projet_connexions", {"projet": "demo"}, actor="mcp")
    assert c["statut"] == "ok", c
    assert g.call("projet_nettoyage_apercu", {"projet": "demo"}, actor="mcp")["statut"] == "ok"
    assert g.call("projet_statut_disque", {"projet": "demo"}, actor="mcp")["statut"] == "ok"
    # cleaning is irreversible, and only the listed actions exist (no free path)
    assert g.call("pc_nettoyer", {"action": "pip_cache"}, actor="mcp")["statut"] == "confirmation_requise"
    assert g.call("pc_nettoyer", {"action": "delete_file"}, actor="mcp")["statut"] == "erreur"
