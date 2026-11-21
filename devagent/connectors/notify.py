"""Connector — notifications to the user: Telegram and email.

Settings (the secret ones are encrypted by the vault):
    notify_telegram_bot_token, notify_telegram_chat_id
    notify_smtp_host, notify_smtp_port, notify_smtp_user, notify_smtp_password,
    notify_email_from, notify_email_to

Every notification is also written in DevAgent's events, so nothing is lost
when no channel is configured or when a channel fails.
"""
import smtplib
from email.message import EmailMessage

import requests

import db

TELEGRAM_API = "https://api.telegram.org"


def channels():
    """{telegram: bool, email: bool} — what is configured."""
    g = db.get_setting
    return {"telegram": bool(g("notify_telegram_bot_token", "") and g("notify_telegram_chat_id", "")),
            "email": bool(g("notify_smtp_host", "") and g("notify_email_to", ""))}


def _telegram(text):
    token, chat = db.get_setting("notify_telegram_bot_token", ""), db.get_setting("notify_telegram_chat_id", "")
    try:
        r = requests.post(f"{TELEGRAM_API}/bot{token}/sendMessage",
                          json={"chat_id": chat, "text": text[:4000], "disable_web_page_preview": True}, timeout=15)
        if r.status_code == 200 and r.json().get("ok"):
            return {"ok": True}
        try:
            why = r.json().get("description") or f"HTTP {r.status_code}"
        except ValueError:
            why = f"HTTP {r.status_code}"
        return {"ok": False, "erreur": why}
    except requests.RequestException as e:
        return {"ok": False, "erreur": type(e).__name__}      # never the URL: it holds the token


def _email(subject, text):
    g = db.get_setting
    host, port = g("notify_smtp_host", ""), int(g("notify_smtp_port", "587") or 587)
    user, pw = g("notify_smtp_user", ""), g("notify_smtp_password", "")
    msg = EmailMessage()
    msg["Subject"] = subject[:150]
    msg["From"] = g("notify_email_from", "") or user
    msg["To"] = g("notify_email_to", "")
    msg.set_content(text)
    try:
        if port == 465:
            srv = smtplib.SMTP_SSL(host, port, timeout=20)
        else:
            srv = smtplib.SMTP(host, port, timeout=20)
            srv.starttls()
        with srv:
            if user:
                srv.login(user, pw)
            srv.send_message(msg)
        return {"ok": True}
    except (smtplib.SMTPException, OSError) as e:
        return {"ok": False, "erreur": f"{type(e).__name__} : {e}"[:200]}


def send(message, title="DevAgent", channel=None, project_id=None):
    """Send to every configured channel (or only ``channel``). Returns
    {envoye: bool, canaux: {name: {ok, erreur?}}, note?}."""
    conf = channels()
    wanted = [c for c in ("telegram", "email") if conf[c] and (not channel or channel == c)]
    out = {}
    for c in wanted:
        out[c] = _telegram(f"{title}\n\n{message}") if c == "telegram" else _email(title, message)
    try:
        db.log_event("notification", "agent", title[:120], "", 0, project_id, message[:1000])
    except Exception:
        pass
    res = {"envoye": any(v["ok"] for v in out.values()), "canaux": out}
    if not wanted:
        res["note"] = ("Aucun canal configure : la notification est seulement dans le journal de DevAgent "
                       "(Agent → Notifications pour brancher Telegram ou l'email).")
    return res
