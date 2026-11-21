"""Proniver — the document generator of the Proniver project (company documents,
client files, mock-ups). It needs the ``~/proniver-docs`` folder."""
from pathlib import Path

LABEL = "Proniver — documents"


def enabled():
    return (Path.home() / "proniver-docs").is_dir()


def register(app):
    from .routes import docgen_bp
    if "docgen" not in app.blueprints:
        app.register_blueprint(docgen_bp)
