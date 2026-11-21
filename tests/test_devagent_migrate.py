"""`devagent migrer`: ~/devpilot → ~/devagent on a throwaway HOME, and back."""
import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest


@pytest.fixture
def world(home, P, monkeypatch):
    from devagent import migrate
    monkeypatch.setattr(migrate, "_running", lambda port=5555: False)
    monkeypatch.setattr(migrate, "_crontab_lines", lambda src: [f"0 3 * * * {src}/projects/site/job.sh"])
    p = P.create("site")
    P.create("autre")
    (Path(p["path"]) / ".devpilot" / "deploiement.json").write_text(json.dumps({"dossier": p["path"] + "/dist"}))
    old = home / "devpilot"
    (home / ".local/bin").mkdir(parents=True)
    (home / ".local/bin/devpilot").write_text('#!/bin/bash\nAPP_DIR="$HOME/devpilot/.devpilot/app"\n')
    os.chmod(home / ".local/bin/devpilot", 0o755)
    (home / ".config/systemd/user").mkdir(parents=True)
    (home / ".config/systemd/user/devpilot-watcher.service").write_text(f"ExecStart={old}/.devpilot/app/watcher.py\n")
    vbin = old / ".devpilot/app/.venv/bin"
    vbin.mkdir(parents=True)
    (vbin / "pip").write_text(f"#!{old}/.devpilot/app/.venv/bin/python\n")
    key = str(old).replace("/", "-").replace(".", "-")
    mem = home / ".claude/projects" / f"{key}-projects-site" / "memory"
    mem.mkdir(parents=True)
    (mem / "MEMORY.md").write_text("- note\n")
    return type("W", (), {"home": home, "old": old, "new": home / "devagent", "migrate": migrate, "pid": p["id"]})


def paths_in_db(root):
    c = sqlite3.connect(str(root / ".devpilot/data/devpilot.db"))
    try:
        return [r[0] for r in c.execute("SELECT path FROM projects ORDER BY id")]
    finally:
        c.close()


def test_simulation_ne_change_rien(world):
    p = world.migrate.plan(world.home)
    assert p["bloquants"] == [] and p["de"].endswith("/devpilot") and p["vers"].endswith("/devagent")
    assert len(p["projets"]) == 2 and len(p["fichiers"]) == 2 and len(p["claude"]) == 1
    assert "job.sh" in p["a_mettre_a_jour_a_la_main"]["crontab"][0]
    assert world.old.is_dir() and not world.old.is_symlink() and not world.new.exists()


def test_refus_si_devagent_tourne_ou_si_la_cible_existe(world, monkeypatch):
    monkeypatch.setattr(world.migrate, "_running", lambda port=5555: True)
    out = world.migrate.apply(world.home, mcp=False)
    assert out["ok"] is False and "lance" in out["bloquants"][0] and not world.new.exists()
    monkeypatch.setattr(world.migrate, "_running", lambda port=5555: False)
    world.new.mkdir()
    assert "existe deja" in " ".join(world.migrate.apply(world.home, mcp=False)["bloquants"])


def test_migration_puis_annulation(world):
    m, home, old, new = world.migrate, world.home, world.old, world.new
    out = m.apply(home, mcp=False)
    assert out["ok"], out
    assert new.is_dir() and not new.is_symlink() and old.is_symlink() and old.resolve() == new.resolve()
    assert paths_in_db(new) == [f"{new}/projects/site", f"{new}/projects/autre"]
    assert (new / ".devpilot/data/devpilot.db.avant-migration").is_file()
    assert json.loads((new / "projects/site/.devpilot/deploiement.json").read_text())["dossier"] == f"{new}/projects/site/dist"
    assert "$HOME/devagent/.devpilot/app" in (home / ".local/bin/devpilot").read_text()
    assert os.access(home / ".local/bin/devpilot", os.X_OK)                       # still executable
    assert f"{new}/.devpilot/app/watcher.py" in (home / ".config/systemd/user/devpilot-watcher.service").read_text()
    assert (new / ".devpilot/app/.venv/bin/pip").read_text().startswith(f"#!{new}/")
    key = str(new).replace("/", "-").replace(".", "-")
    assert (home / ".claude/projects" / f"{key}-projects-site" / "memory/MEMORY.md").read_text() == "- note\n"
    assert Path(f"{old}/projects/site").is_dir()                                  # the old path still works (link)

    # the application now sees its folder at the new place
    import importlib, paths, db, projects
    assert paths.root(home) == new
    importlib.reload(db); importlib.reload(projects)
    assert str(db.DB_PATH).startswith(str(new)) and projects.get(world.pid)["path"] == f"{new}/projects/site"
    assert projects.is_managed(Path(f"{new}/projects/site"))

    # a second run refuses; undo puts everything back
    assert m.apply(home, mcp=False)["ok"] is False
    back = m.apply(home, undo=True, mcp=False)
    assert back["ok"], back
    assert old.is_dir() and not old.is_symlink() and not new.exists()
    assert paths_in_db(old) == [f"{old}/projects/site", f"{old}/projects/autre"]
    assert "$HOME/devpilot/.devpilot/app" in (home / ".local/bin/devpilot").read_text()
    assert (old / ".devpilot/app/.venv/bin/pip").read_text().startswith(f"#!{old}/")
    assert paths.root(home) == old
