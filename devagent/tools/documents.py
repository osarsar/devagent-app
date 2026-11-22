"""Tools — the documents of a project's company (logo, business card, brochures...)."""
from .. import documents
from ..registry import PROJET, tool
from ._common import resolve_project


@tool("documents_lister", "Les documents de l'entreprise d'un projet (logo, carte de visite, plaquettes, brochures, "
      "modeles) : fichiers par langue, sources a modifier, comment les regenerer, et ceux qui restent a creer. "
      "La liste est dans documents/documents.json du projet : mets-la a jour quand tu ajoutes ou regeneres un document.",
      params={"projet": PROJET})
def documents_lister(ctx, projet=None):
    return documents.catalog(resolve_project(ctx, projet)["id"])
