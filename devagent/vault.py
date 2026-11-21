"""The vault: secrets encrypted at rest.

Secrets (GitHub token, R2 keys, hosting tokens, passwords of a connection) are
stored encrypted, in place, in the database (``enc:v1:...``). The key is NOT in the
database: it is a file readable only by you, ``~/.config/devagent/vault.key``.

What it protects: a copy, a backup or a leak of devpilot.db shows no secret.
What it does not protect: someone who can read your whole home folder.

Keep a copy of vault.key with your other keys: without it the stored secrets
cannot be read any more (they have to be entered again).
"""
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

PREFIX = "enc:v1:"

# Field names that hold a secret inside a connection / component config
SECRET_FIELDS = {"password", "token", "secret", "secret_key", "access_key", "api_key",
                 "connection_string", "private_key", "deploy_hook", "bot_token", "smtp_password"}
# A setting whose name contains one of these is a secret
_SECRET_WORDS = ("token", "secret", "password", "passphrase", "access_key", "api_key", "consumer_key")
_SECRET_SETTINGS = {"hosting_accounts"}

_fernet = None
_fernet_path = None


def key_path():
    env = os.environ.get("DEVAGENT_VAULT_KEY_FILE")
    return Path(env) if env else Path.home() / ".config" / "devagent" / "vault.key"


def _f():
    """The Fernet of the current key file (created on first use, mode 600)."""
    global _fernet, _fernet_path
    p = key_path()
    if _fernet is not None and _fernet_path == p and p.exists():
        return _fernet
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(p.parent, 0o700)
        except OSError:
            pass
        fd = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(Fernet.generate_key())
    _fernet, _fernet_path = Fernet(p.read_bytes().strip()), p
    return _fernet


def is_secret_setting(key):
    k = (key or "").lower()
    return k in _SECRET_SETTINGS or any(w in k for w in _SECRET_WORDS)


def is_sealed(value):
    return isinstance(value, str) and value.startswith(PREFIX)


def seal(value):
    """Plain text → encrypted text (already encrypted or empty: unchanged)."""
    if value is None or value == "" or is_sealed(value):
        return value
    return PREFIX + _f().encrypt(str(value).encode()).decode()


def unseal(value, default=""):
    """Encrypted text → plain text. A value that cannot be read (key lost) → default."""
    if not is_sealed(value):
        return value
    try:
        return _f().decrypt(value[len(PREFIX):].encode()).decode()
    except (InvalidToken, ValueError):
        return default


def seal_config(cfg):
    """A connection config with its secret fields encrypted."""
    if not isinstance(cfg, dict):
        return cfg
    return {k: (seal(v) if k in SECRET_FIELDS and isinstance(v, str) else v) for k, v in cfg.items()}


def unseal_config(cfg):
    if not isinstance(cfg, dict):
        return cfg
    return {k: (unseal(v) if is_sealed(v) else v) for k, v in cfg.items()}


def redact(obj, _depth=0):
    """A copy safe to log or to show to the agent: secret fields become '***'."""
    if _depth > 8:
        return "…"
    if isinstance(obj, dict):
        return {k: ("***" if (k in SECRET_FIELDS or is_secret_setting(k)) and isinstance(v, str) and v
                    else redact(v, _depth + 1)) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [redact(v, _depth + 1) for v in obj]
    if is_sealed(obj):
        return "***"
    return obj
