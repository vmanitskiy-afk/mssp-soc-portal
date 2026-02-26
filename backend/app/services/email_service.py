"""
Email sending service.

Sends email notifications via SMTP (Mail.ru, Yandex, Gmail, etc).
"""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def send_email(to: str, subject: str, html_body: str) -> bool:
    """Send an email via SMTP. Returns True on success."""
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.warning("SMTP not configured, skipping email")
        return False

    msg = MIMEMultipart("alternative")
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        if settings.SMTP_PORT == 465:
            # SSL
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)
        else:
            # STARTTLS
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                if settings.SMTP_TLS:
                    server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)

        logger.info(f"Email sent to {to}: {subject}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to}: {e}")
        return False


# ── Email templates ──────────────────────────────────────────────

def _base_template(content: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f1f5f9;">
<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:20px 30px;color:#fff;">
        <h1 style="margin:0;font-size:18px;">🛡️ MSSP SOC Portal</h1>
    </div>
    <div style="padding:25px 30px;color:#1a1a2e;line-height:1.6;">
        {content}
    </div>
    <div style="padding:15px 30px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:12px;">
        MSSP SOC Portal • Уведомление сгенерировано автоматически
    </div>
</div>
</body></html>"""


PRIORITY_COLORS = {
    "critical": "#ef4444", "high": "#f97316",
    "medium": "#eab308", "low": "#3b82f6",
}


def new_incident_email(
    incident_title: str,
    rusiem_id: int,
    priority: str,
    recommendations: str,
    portal_url: str = "",
) -> tuple[str, str]:
    """Returns (subject, html_body) for new incident notification."""
    color = PRIORITY_COLORS.get(priority, "#6b7280")
    subject = f"[SOC] Новый инцидент #{rusiem_id}: {incident_title[:50]}"
    content = f"""
    <h2 style="margin:0 0 15px;color:#1e3a5f;">Новый инцидент опубликован</h2>
    <table style="width:100%;border-collapse:collapse;">
        <tr>
            <td style="padding:8px 0;color:#64748b;width:140px;">RuSIEM ID</td>
            <td style="padding:8px 0;font-weight:600;">#{rusiem_id}</td>
        </tr>
        <tr>
            <td style="padding:8px 0;color:#64748b;">Название</td>
            <td style="padding:8px 0;font-weight:600;">{incident_title}</td>
        </tr>
        <tr>
            <td style="padding:8px 0;color:#64748b;">Приоритет</td>
            <td style="padding:8px 0;">
                <span style="background:{color};color:#fff;padding:3px 12px;border-radius:12px;font-size:13px;font-weight:600;">
                    {priority.upper()}
                </span>
            </td>
        </tr>
    </table>
    {"<div style='margin-top:15px;padding:12px 16px;background:#f0f9ff;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;'><strong>Рекомендации:</strong><br>" + recommendations + "</div>" if recommendations else ""}
    {f'<div style="margin-top:20px;"><a href="{portal_url}" style="background:#3b82f6;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Открыть в портале</a></div>' if portal_url else ""}
    """
    return subject, _base_template(content)


def status_change_email(
    incident_title: str,
    rusiem_id: int,
    old_status: str,
    new_status: str,
    changed_by: str,
    portal_url: str = "",
) -> tuple[str, str]:
    """Returns (subject, html_body) for status change notification."""
    status_labels = {
        "new": "Новый", "in_progress": "В работе",
        "awaiting_customer": "Ожидание клиента", "awaiting_soc": "Ожидание SOC",
        "resolved": "Решён", "closed": "Закрыт",
    }
    subject = f"[SOC] Статус изменён #{rusiem_id}: {status_labels.get(new_status, new_status)}"
    content = f"""
    <h2 style="margin:0 0 15px;color:#1e3a5f;">Статус инцидента изменён</h2>
    <p><strong>#{rusiem_id}</strong> — {incident_title}</p>
    <div style="margin:15px 0;padding:15px;background:#f8fafc;border-radius:8px;text-align:center;">
        <span style="color:#64748b;">{status_labels.get(old_status, old_status)}</span>
        <span style="margin:0 10px;font-size:18px;">→</span>
        <span style="color:#1e3a5f;font-weight:600;">{status_labels.get(new_status, new_status)}</span>
    </div>
    <p style="color:#64748b;font-size:13px;">Изменил: {changed_by}</p>
    {f'<div style="margin-top:15px;"><a href="{portal_url}" style="background:#3b82f6;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Открыть в портале</a></div>' if portal_url else ""}
    """
    return subject, _base_template(content)


def otp_email(code: str, ttl_minutes: int = 5) -> tuple[str, str]:
    """Returns (subject, html_body) for Email OTP verification."""
    subject = f"[SOC] Код подтверждения: {code}"
    content = f"""
    <h2 style="margin:0 0 15px;color:#1e3a5f;">Код подтверждения входа</h2>
    <p>Используйте этот код для входа в MSSP SOC Portal:</p>
    <div style="margin:20px 0;text-align:center;">
        <span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:0.3em;
                      padding:16px 32px;background:#f0f9ff;border:2px solid #3b82f6;
                      border-radius:12px;color:#1e3a5f;font-family:monospace;">
            {code}
        </span>
    </div>
    <p style="color:#64748b;font-size:13px;">
        Код действителен <strong>{ttl_minutes} минут</strong>.<br>
        Если вы не запрашивали вход — проигнорируйте это письмо.
    </p>
    """
    return subject, _base_template(content)


def new_comment_email(
    incident_title: str,
    rusiem_id: int,
    comment_by: str,
    comment_text: str,
    portal_url: str = "",
) -> tuple[str, str]:
    """Returns (subject, html_body) for new comment notification."""
    subject = f"[SOC] Новый комментарий #{rusiem_id}"
    content = f"""
    <h2 style="margin:0 0 15px;color:#1e3a5f;">Новый комментарий</h2>
    <p><strong>#{rusiem_id}</strong> — {incident_title}</p>
    <div style="margin:15px 0;padding:12px 16px;background:#f8fafc;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;">
        <div style="font-size:12px;color:#64748b;margin-bottom:5px;">{comment_by}</div>
        <div>{comment_text}</div>
    </div>
    {f'<div style="margin-top:15px;"><a href="{portal_url}" style="background:#3b82f6;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Ответить в портале</a></div>' if portal_url else ""}
    """
    return subject, _base_template(content)
