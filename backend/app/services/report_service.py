"""
Report generation service.

Generates PDF reports using WeasyPrint:
- Monthly SOC report (incidents summary for period)
- Incident detail report (single incident with timeline)
"""

import logging
from datetime import datetime, timezone
from io import BytesIO

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import PublishedIncident, Tenant, IncidentComment, IncidentStatusChange

logger = logging.getLogger(__name__)

PRIORITY_COLORS = {
    "critical": "#ef4444",
    "high": "#f97316",
    "medium": "#eab308",
    "low": "#3b82f6",
}

STATUS_LABELS = {
    "new": "Новый",
    "in_progress": "В работе",
    "awaiting_customer": "Ожидание клиента",
    "awaiting_soc": "Ожидание SOC",
    "resolved": "Решён",
    "closed": "Закрыт",
    "false_positive": "Ложное срабатывание",
}


class ReportServiceError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code


class ReportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_monthly_report(
        self, tenant_id: str, period_from: str, period_to: str
    ) -> bytes:
        """Generate monthly SOC report PDF."""
        # Parse dates
        try:
            dt_from = datetime.fromisoformat(period_from).replace(tzinfo=timezone.utc)
            dt_to = datetime.fromisoformat(period_to).replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
        except ValueError:
            raise ReportServiceError("Неверный формат даты. Используйте YYYY-MM-DD")

        # Get tenant
        result = await self.db.execute(
            select(Tenant).where(Tenant.id == tenant_id)
        )
        tenant = result.scalar_one_or_none()
        if not tenant:
            raise ReportServiceError("Клиент не найден", 404)

        # Get incidents for period
        result = await self.db.execute(
            select(PublishedIncident)
            .where(
                PublishedIncident.tenant_id == tenant_id,
                PublishedIncident.published_at >= dt_from,
                PublishedIncident.published_at <= dt_to,
            )
            .order_by(PublishedIncident.published_at.desc())
        )
        incidents = result.scalars().all()

        # Aggregate stats
        stats = {"total": len(incidents), "by_priority": {}, "by_status": {}}
        for inc in incidents:
            stats["by_priority"][inc.priority] = (
                stats["by_priority"].get(inc.priority, 0) + 1
            )
            stats["by_status"][inc.status] = (
                stats["by_status"].get(inc.status, 0) + 1
            )

        html = self._render_monthly_html(tenant, incidents, stats, dt_from, dt_to)
        return self._html_to_pdf(html)

    async def generate_incident_report(
        self, tenant_id: str, incident_id: str
    ) -> bytes:
        """Generate single incident detail PDF."""
        result = await self.db.execute(
            select(PublishedIncident).where(
                PublishedIncident.id == incident_id,
                PublishedIncident.tenant_id == tenant_id,
            )
        )
        incident = result.scalar_one_or_none()
        if not incident:
            raise ReportServiceError("Инцидент не найден", 404)

        # Get tenant
        result = await self.db.execute(
            select(Tenant).where(Tenant.id == tenant_id)
        )
        tenant = result.scalar_one_or_none()

        # Get comments
        result = await self.db.execute(
            select(IncidentComment)
            .where(IncidentComment.incident_id == incident_id)
            .order_by(IncidentComment.created_at)
        )
        comments = result.scalars().all()

        # Get status history
        result = await self.db.execute(
            select(IncidentStatusChange)
            .where(IncidentStatusChange.incident_id == incident_id)
            .order_by(IncidentStatusChange.created_at)
        )
        history = result.scalars().all()

        html = self._render_incident_html(tenant, incident, comments, history)
        return self._html_to_pdf(html)

    def _html_to_pdf(self, html_content: str) -> bytes:
        """Convert HTML to PDF bytes."""
        from weasyprint import HTML
        buf = BytesIO()
        HTML(string=html_content).write_pdf(buf)
        return buf.getvalue()

    def _base_css(self) -> str:
        return """
        @page { size: A4; margin: 2cm; }
        body {
            font-family: 'DejaVu Sans', Arial, sans-serif;
            font-size: 11px; line-height: 1.5; color: #1a1a2e;
        }
        .header {
            background: linear-gradient(135deg, #0f172a, #1e3a5f);
            color: white; padding: 25px 30px; margin: -2cm -2cm 20px -2cm;
            display: flex; justify-content: space-between; align-items: center;
        }
        .header h1 { font-size: 20px; margin: 0; }
        .header .meta { font-size: 10px; opacity: 0.8; }
        .section { margin: 20px 0; }
        .section h2 {
            font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #3b82f6;
            padding-bottom: 5px; margin-bottom: 12px;
        }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th {
            background: #f1f5f9; color: #475569; font-size: 9px;
            text-transform: uppercase; letter-spacing: 0.5px;
            padding: 8px 10px; text-align: left; border-bottom: 2px solid #e2e8f0;
        }
        td {
            padding: 8px 10px; border-bottom: 1px solid #f1f5f9;
            font-size: 10px; vertical-align: top;
        }
        tr:nth-child(even) { background: #f8fafc; }
        .badge {
            display: inline-block; padding: 2px 8px; border-radius: 10px;
            font-size: 9px; font-weight: 600; color: white;
        }
        .stats-grid {
            display: flex; gap: 15px; margin: 15px 0;
        }
        .stat-card {
            flex: 1; background: #f8fafc; border: 1px solid #e2e8f0;
            border-radius: 8px; padding: 15px; text-align: center;
        }
        .stat-card .number { font-size: 28px; font-weight: 700; color: #1e3a5f; }
        .stat-card .label { font-size: 9px; color: #64748b; text-transform: uppercase; }
        .footer {
            position: fixed; bottom: 0; left: 0; right: 0;
            text-align: center; font-size: 8px; color: #94a3b8;
            padding: 10px; border-top: 1px solid #e2e8f0;
        }
        .comment-box {
            background: #f8fafc; border-left: 3px solid #3b82f6;
            padding: 10px 15px; margin: 8px 0; border-radius: 0 6px 6px 0;
        }
        .comment-box.soc { border-left-color: #f97316; }
        .timeline-item {
            padding: 8px 0; border-left: 2px solid #e2e8f0;
            padding-left: 15px; margin-left: 5px; position: relative;
        }
        .timeline-item::before {
            content: ''; position: absolute; left: -5px; top: 12px;
            width: 8px; height: 8px; border-radius: 50%;
            background: #3b82f6; border: 2px solid white;
        }
        """

    def _render_monthly_html(self, tenant, incidents, stats, dt_from, dt_to) -> str:
        period_str = f"{dt_from.strftime('%d.%m.%Y')} — {dt_to.strftime('%d.%m.%Y')}"
        now = datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC")

        # Priority stats
        priority_html = ""
        for p in ["critical", "high", "medium", "low"]:
            count = stats["by_priority"].get(p, 0)
            color = PRIORITY_COLORS.get(p, "#6b7280")
            label = p.upper()
            priority_html += f"""
            <div class="stat-card">
                <div class="number" style="color:{color}">{count}</div>
                <div class="label">{label}</div>
            </div>"""

        # Status breakdown
        status_rows = ""
        for status, count in sorted(stats["by_status"].items(), key=lambda x: -x[1]):
            label = STATUS_LABELS.get(status, status)
            status_rows += f"<tr><td>{label}</td><td style='text-align:right;font-weight:600'>{count}</td></tr>"

        # Incidents table
        inc_rows = ""
        for inc in incidents:
            color = PRIORITY_COLORS.get(inc.priority, "#6b7280")
            status_label = STATUS_LABELS.get(inc.status, inc.status)
            pub_date = inc.published_at.strftime("%d.%m.%Y") if inc.published_at else "—"
            inc_rows += f"""
            <tr>
                <td>#{inc.rusiem_incident_id}</td>
                <td>{inc.title[:80]}</td>
                <td><span class="badge" style="background:{color}">{inc.priority}</span></td>
                <td>{status_label}</td>
                <td>{inc.event_count}</td>
                <td>{pub_date}</td>
            </tr>"""

        return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{self._base_css()}</style></head>
<body>
    <div class="header">
        <div>
            <h1>Отчёт SOC — {tenant.name}</h1>
            <div class="meta">Период: {period_str}</div>
        </div>
        <div style="text-align:right">
            <div style="font-size:12px;font-weight:600">MSSP SOC Portal</div>
            <div class="meta">Сформирован: {now}</div>
        </div>
    </div>

    <div class="section">
        <h2>Сводка по приоритетам</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="number">{stats['total']}</div>
                <div class="label">Всего инцидентов</div>
            </div>
            {priority_html}
        </div>
    </div>

    <div class="section">
        <h2>По статусу</h2>
        <table style="width:50%">
            <tr><th>Статус</th><th style="text-align:right">Количество</th></tr>
            {status_rows}
        </table>
    </div>

    <div class="section">
        <h2>Инциденты за период</h2>
        <table>
            <tr>
                <th>RuSIEM ID</th><th>Название</th><th>Приоритет</th>
                <th>Статус</th><th>События</th><th>Дата</th>
            </tr>
            {inc_rows}
        </table>
    </div>

    <div class="footer">
        MSSP SOC Portal • {tenant.name} • Конфиденциально • {now}
    </div>
</body></html>"""

    def _render_incident_html(self, tenant, incident, comments, history) -> str:
        now = datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC")
        color = PRIORITY_COLORS.get(incident.priority, "#6b7280")
        status_label = STATUS_LABELS.get(incident.status, incident.status)
        pub_date = incident.published_at.strftime("%d.%m.%Y %H:%M") if incident.published_at else "—"

        # IPs
        ips_html = ""
        for ip in (incident.source_ips or []):
            ips_html += f"<span class='badge' style='background:#475569;margin:2px'>{ip}</span> "

        # Comments
        comments_html = ""
        for c in comments:
            cls = "soc" if getattr(c, "is_soc", False) else ""
            who = getattr(c, "user_name", "Пользователь")
            dt = c.created_at.strftime("%d.%m.%Y %H:%M") if c.created_at else ""
            comments_html += f"""
            <div class="comment-box {cls}">
                <div style="font-size:9px;color:#64748b">{who} • {dt}</div>
                <div style="margin-top:4px">{c.text}</div>
            </div>"""

        # Timeline
        timeline_html = ""
        for h in history:
            old_label = STATUS_LABELS.get(h.old_status, h.old_status)
            new_label = STATUS_LABELS.get(h.new_status, h.new_status)
            dt = h.created_at.strftime("%d.%m.%Y %H:%M") if h.created_at else ""
            timeline_html += f"""
            <div class="timeline-item">
                <div style="font-size:9px;color:#64748b">{dt}</div>
                <div>{old_label} → {new_label}</div>
            </div>"""

        return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{self._base_css()}</style></head>
<body>
    <div class="header">
        <div>
            <h1>Инцидент #{incident.rusiem_incident_id}</h1>
            <div class="meta">{tenant.name if tenant else ''}</div>
        </div>
        <div style="text-align:right">
            <div><span class="badge" style="background:{color};font-size:12px">{incident.priority.upper()}</span></div>
            <div class="meta" style="margin-top:5px">{status_label}</div>
        </div>
    </div>

    <div class="section">
        <h2>Общая информация</h2>
        <table>
            <tr><td style="width:150px;font-weight:600">Название</td><td>{incident.title}</td></tr>
            <tr><td style="font-weight:600">Приоритет</td><td><span class="badge" style="background:{color}">{incident.priority}</span></td></tr>
            <tr><td style="font-weight:600">Статус</td><td>{status_label}</td></tr>
            <tr><td style="font-weight:600">Категория</td><td>{incident.category or '—'}</td></tr>
            <tr><td style="font-weight:600">Количество событий</td><td>{incident.event_count}</td></tr>
            <tr><td style="font-weight:600">IP адреса</td><td>{ips_html or '—'}</td></tr>
            <tr><td style="font-weight:600">Дата публикации</td><td>{pub_date}</td></tr>
        </table>
    </div>

    {"<div class='section'><h2>Описание</h2><p>" + (incident.description or '') + "</p></div>" if incident.description else ""}

    {"<div class='section'><h2>Рекомендации SOC</h2><p>" + (incident.recommendations or '') + "</p></div>" if incident.recommendations else ""}

    {"<div class='section'><h2>Действия SOC</h2><p>" + (incident.soc_actions or '') + "</p></div>" if incident.soc_actions else ""}

    {"<div class='section'><h2>История статусов</h2>" + timeline_html + "</div>" if timeline_html else ""}

    {"<div class='section'><h2>Комментарии</h2>" + comments_html + "</div>" if comments_html else ""}

    <div class="footer">
        MSSP SOC Portal • {tenant.name if tenant else ''} • Конфиденциально • {now}
    </div>
</body></html>"""
