"""Extensions: a part of the application that belongs to ONE project.

The core knows nothing about them. An extension is a folder here:

    extensions/<nom>/
        extension.py     LABEL, enabled() -> bool, register(app)  (its Flask routes)
        nav.html         its entry in the sidebar            (optional)
        page.html        its page(s)                          (optional)
        modals.html      its dialogs                          (optional)
        *.js             its scripts, loaded after the core   (optional)

It is loaded only when enabled() says so. Setting ``ext_<nom>`` = "1" / "0"
forces it on / off.
"""
import importlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
_active = []


def _read(d, name):
    f = d / name
    return f.read_text(encoding="utf-8") if f.is_file() else ""


def _enabled(name, mod):
    try:
        import db
        forced = db.get_setting(f"ext_{name}", "")
    except Exception:
        forced = ""
    if forced in ("0", "1"):
        return forced == "1"
    try:
        return bool(mod.enabled())
    except Exception:
        return False


def load(app):
    """Register every enabled extension on the Flask app. Returns their names."""
    _active.clear()
    for d in sorted(p for p in ROOT.iterdir() if (p / "extension.py").is_file()):
        try:
            mod = importlib.import_module(f"extensions.{d.name}.extension")
            if not _enabled(d.name, mod):
                continue
            mod.register(app)
            _active.append(d)
        except Exception as e:                    # a broken extension never stops the application
            print(f"  extension {d.name} : {type(e).__name__} : {e}")
    return [d.name for d in _active]


def context():
    """What the dashboard template needs: [{name, nav, page, modals}] and the script URLs."""
    return [{"name": d.name, "nav": _read(d, "nav.html"), "page": _read(d, "page.html"),
             "modals": _read(d, "modals.html")} for d in _active]


def scripts():
    return [f"/ext/{d.name}/{f.name}" for d in _active for f in sorted(d.glob("*.js"))]


def asset(name, filename):
    d = next((x for x in _active if x.name == name), None)
    f = (d / filename) if d else None
    return f if f and f.is_file() and f.suffix in (".js", ".css") and f.parent == d else None
