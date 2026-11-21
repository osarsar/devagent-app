"""Where DevAgent lives on this PC.

The folder was ``~/devpilot``; after `devagent migrer` it is ``~/devagent`` (and ``~/devpilot``
stays as a link to it, so everything that knew the old path keeps working). Until a PC is
migrated — and on a fresh install — the folder is still ``~/devpilot``.
"""
from pathlib import Path

OLD_NAME, NEW_NAME = "devpilot", "devagent"


def root(home=None):
    home = Path(home) if home else Path.home()
    new = home / NEW_NAME
    return new if new.is_dir() and not new.is_symlink() else home / OLD_NAME
