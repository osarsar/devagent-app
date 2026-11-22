"""What a running action reports while it works (« lit site/page.tsx », « lance npm run build »).

The chat sets a callback for the thread that runs a tool; any code in that thread (a connector
reading Claude Code's output, for instance) calls emit(text). Without a callback, emit does nothing:
the same tools run unchanged from the MCP server, the command line or an automation.
"""
import threading

_local = threading.local()


def set_callback(fn):
    _local.cb = fn


def emit(text):
    cb = getattr(_local, "cb", None)
    if cb and text:
        try:
            cb(str(text)[:200])
        except Exception:
            pass
