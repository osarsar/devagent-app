"""The project map: built from the fleet manifest, docker-compose and the project's data."""
import json
import os

import pytest

from conftest import sh


@pytest.fixture
def carte(home):
    from devagent import automations, carte, registry
    automations._ready_for = None
    registry.load()
    return carte


def ids(m, col):
    return [n["id"] for c in m["columns"] if c["key"] == col for n in c["nodes"]]


def test_carte_depuis_docker_compose(carte, P):
    import model
    p = P.create("app", git_init=True)
    model.set_model(p["id"], profile="webapp_saas")
    root = p["path"]
    os.makedirs(os.path.join(root, "api"))
    sh("git", "init", "-q", cwd=os.path.join(root, "api"))
    open(os.path.join(root, "docker-compose.yml"), "w").write(
        "services:\n  api:\n    build: ./api\n    ports: ['8000:8000']\n    depends_on: [db]\n"
        "  db:\n    image: postgres:16\n  web:\n    image: nginx\n    depends_on:\n      api: {condition: service_started}\n")
    open(os.path.join(root, "docker-compose.yml.bak"), "w").write("services: {vieux: {image: x}}")
    m = carte.build(p["id"])
    assert set(ids(m, "services")) == {"svc:api", "svc:db", "svc:web"}
    assert {"need:github", "need:hosting", "need:database"} <= set(ids(m, "connexions"))
    assert "repo:api" in ids(m, "depots")
    e = {(x["from"], x["to"]) for x in m["edges"]}
    assert {("svc:api", "svc:db"), ("svc:web", "svc:api"), ("repo:api", "svc:api")} <= e
    api = next(n for c in m["columns"] for n in c["nodes"] if n["id"] == "svc:api")
    assert api["sub"] == ":8000" and m["services_source"] == "docker-compose.yml"


def test_carte_depuis_un_manifeste_de_flotte(carte, P):
    p = P.create("grand")
    root = p["path"]
    os.makedirs(os.path.join(root, "infra", "deploy"))
    os.makedirs(os.path.join(root, "infra", "svc", "back"))
    sh("git", "init", "-q", cwd=os.path.join(root, "infra", "svc", "back"))
    json.dump({"roles": {"pile": {"label": "Pile produit"}, "gpu": {"label": "Modeles"}},
               "services": {
                   "backend": {"label": "Backend", "role": "pile", "kind": "docker", "dir": "svc/back",
                               "needs": [{"service": "postgres", "via": "DATABASE_URL"},
                                         {"service": "modele", "via": "EXPERT_URL", "facultatif": True}]},
                   "postgres": {"label": "Base", "role": "pile", "kind": "docker"},
                   "modele": {"label": "Modele expert", "role": "gpu", "kind": "docker"}}},
              open(os.path.join(root, "infra", "deploy", "services.json"), "w"))
    # compose files are ignored when a manifest exists
    open(os.path.join(root, "infra", "docker-compose.dev.yml"), "w").write("services: {autre: {image: x}}")
    m = carte.build(p["id"])
    assert set(ids(m, "services")) == {"svc:backend", "svc:postgres", "svc:modele"}
    assert set(ids(m, "machines")) == {"role:pile", "role:gpu"}
    edges = {(x["from"], x["to"]): x for x in m["edges"]}
    assert edges[("svc:backend", "svc:postgres")]["label"] == "DATABASE_URL"
    assert edges[("svc:backend", "svc:modele")]["dashed"] is True
    assert ("svc:backend", "role:pile") in edges and ("repo:infra/svc/back", "svc:backend") in edges
    assert m["services_source"] == "infra/deploy/services.json"


def test_carte_avec_automatisation_et_dossier_absent(carte, P):
    from devagent import automations
    p = P.create("petit")
    automations.from_template(p, "sauvegarde-nuit")
    m = carte.build(p["id"])
    assert ids(m, "automatisations") == ["auto:sauvegarde-nuit"]
    import shutil
    shutil.rmtree(p["path"])
    assert "introuvable" in carte.build(p["id"])["note"]
