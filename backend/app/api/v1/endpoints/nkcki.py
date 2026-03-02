"""
НКЦКИ (ГосСОПКА) API endpoints.

/api/nkcki/send               — send incident to НКЦКИ
/api/nkcki/notifications       — list sent notifications
/api/nkcki/notifications/{id}  — notification detail
/api/nkcki/notifications/{id}/sync — sync status from НКЦКИ
/api/nkcki/companies           — list organizations from ГосСОПКА
/api/nkcki/dictionaries        — enum values for forms
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.dependencies import get_db
from app.core.security import CurrentUser, RoleRequired
from app.integrations.nkcki.client import NKCKIClient, NKCKIClientError
from app.services.nkcki_service import NKCKIService, NKCKIServiceError

router = APIRouter()
settings = get_settings()
logger = logging.getLogger(__name__)

soc_only = RoleRequired("soc_admin", "soc_analyst")
admin_only = RoleRequired("soc_admin")
all_authenticated = RoleRequired("soc_admin", "soc_analyst", "client_admin", "client_security", "client_auditor", "client_readonly")


# ── Schemas ──────────────────────────────────────────────────────

class SendToNKCKIRequest(BaseModel):
    """Payload for sending an incident to НКЦКИ."""
    incident_id: str | None = None  # portal incident UUID (optional)
    tenant_id: str

    # Classification
    category: str
    type: str
    tlp: str

    # Organization
    company: str
    owner_name: str

    # Description
    event_description: str
    detection_tool: str | None = None
    detect_time: str
    end_time: str | None = None
    activity_status: str

    # Affected system
    affected_system_name: str
    affected_system_category: str
    affected_system_function: str
    affected_system_connection: bool = False
    location: str
    city: str | None = None

    # Impact (КИ only)
    integrity_impact: str | None = None
    availability_impact: str | None = None
    confidentiality_impact: str | None = None
    custom_impact: str | None = None

    # Assistance
    assistance: bool = False

    # Technical data (observables, indicators)
    technical_data: dict[str, Any] | None = None

    # RKN personal data leak
    rkn_data: dict[str, Any] | None = None


# ── Send to НКЦКИ ───────────────────────────────────────────────

@router.post("/send")
async def send_to_nkcki(
    body: SendToNKCKIRequest,
    user: CurrentUser = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    """Send an incident as a notification to НКЦКИ."""
    service = NKCKIService(db)

    try:
        notification = await service.send_notification(
            incident_id=body.incident_id,
            tenant_id=body.tenant_id,
            sent_by=user.user_id,
            nkcki_url=settings.NKCKI_API_URL,
            nkcki_token=settings.NKCKI_API_TOKEN,
            payload=body.model_dump(),
        )
    except NKCKIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return {
        "id": str(notification.id),
        "nkcki_uuid": notification.nkcki_uuid,
        "nkcki_identifier": notification.nkcki_identifier,
        "nkcki_status": notification.nkcki_status,
    }


# ── List notifications ───────────────────────────────────────────

@router.get("/notifications")
async def list_notifications(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    tenant_id: str | None = None,
    status: str | None = None,
    category: str | None = None,
    user: CurrentUser = Depends(all_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """List НКЦКИ notifications. SOC sees all, clients see only their tenant."""
    # Clients can only see their own tenant's notifications
    effective_tenant_id = tenant_id
    if not user.is_soc_staff:
        effective_tenant_id = user.tenant_id

    service = NKCKIService(db)
    return await service.list_notifications(
        page=page, per_page=per_page,
        tenant_id=effective_tenant_id, status=status, category=category,
    )


# ── Notification detail ─────────────────────────────────────────

@router.get("/notifications/{notification_id}")
async def get_notification(
    notification_id: str,
    user: CurrentUser = Depends(all_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Get single НКЦКИ notification details."""
    service = NKCKIService(db)
    result = await service.get_notification(notification_id)
    if not result:
        raise HTTPException(status_code=404, detail="Уведомление не найдено")
    # Clients can only see their own tenant's notifications
    if not user.is_soc_staff and result.get("tenant_id") != user.tenant_id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    return result


# ── Sync status ──────────────────────────────────────────────────

@router.get("/incident/{incident_id}/status")
async def get_incident_nkcki_status(
    incident_id: str,
    user: CurrentUser = Depends(all_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Check if an incident was sent to НКЦКИ. Returns status or null."""
    service = NKCKIService(db)
    result = await service.get_by_incident_id(incident_id)
    if not result:
        return {"sent": False}
    # Clients can only see their own tenant's data
    if not user.is_soc_staff and result.get("tenant_id") != user.tenant_id:
        return {"sent": False}
    return {
        "sent": True,
        "nkcki_identifier": result.get("nkcki_identifier"),
        "nkcki_status": result.get("nkcki_status"),
        "sent_at": result.get("sent_at"),
    }


# ── Sync status from НКЦКИ API ──────────────────────────────────

@router.post("/notifications/{notification_id}/sync")
async def sync_notification_status(
    notification_id: str,
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Manually sync notification status from НКЦКИ API."""
    service = NKCKIService(db)
    try:
        result = await service.sync_status(
            notification_id,
            nkcki_url=settings.NKCKI_API_URL,
            nkcki_token=settings.NKCKI_API_TOKEN,
        )
    except NKCKIServiceError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not result:
        raise HTTPException(status_code=404, detail="Уведомление не найдено или не имеет UUID НКЦКИ")
    return result


# ── Companies from ГосСОПКА ─────────────────────────────────────

@router.get("/companies")
async def get_nkcki_companies(
    user: CurrentUser = Depends(soc_only),
):
    """List organizations available in ГосСОПКА personal account."""
    client = NKCKIClient(
        base_url=settings.NKCKI_API_URL,
        token=settings.NKCKI_API_TOKEN,
        verify_ssl=False,
    )
    try:
        companies = await client.get_companies()
    except NKCKIClientError as e:
        raise HTTPException(status_code=502, detail=f"Ошибка получения организаций из НКЦКИ: {e}")

    return [
        {
            "uuid": c.get("uuid"),
            "name": c.get("settings_sname") or c.get("name"),
            "full_name": c.get("settings_name"),
            "inn": c.get("settings_inn_of_subject"),
        }
        for c in companies
    ]


# ── Dictionaries (enum values for forms) ────────────────────────

@router.get("/dictionaries")
async def get_dictionaries(
    user: CurrentUser = Depends(soc_only),
):
    """Return all enum values needed for НКЦКИ notification forms."""
    return {
        "categories": [
            {"value": "Уведомление о компьютерном инциденте", "label": "Компьютерный инцидент (КИ)"},
            {"value": "Уведомление о компьютерной атаке", "label": "Компьютерная атака (КА)"},
        ],
        "types_ki": [
            "Заражение ВПО",
            "Замедление работы ресурса в результате DDoS-атаки",
            "Захват сетевого трафика",
            "Компрометация учетной записи",
            "Несанкционированное изменение информации",
            "Несанкционированное разглашение информации",
            "Публикация на ресурсе запрещенной законодательством РФ информации",
            "Успешная эксплуатация уязвимости",
            "Использование контролируемого ресурса для проведения атак",
            "Событие не связано с компьютерной атакой",
        ],
        "types_ka": [
            "DDoS-атака",
            "Перебор паролей",
            "Сетевое сканирование",
            "Социальная инженерия",
            "Внедрение модулей",
            "Использование контролируемого ресурса для проведения атак",
            "Участник DDoS-атаки",
        ],
        "tlp": ["TLP:WHITE", "TLP:GREEN", "TLP:AMBER", "TLP:RED"],
        "activity_statuses": [
            "Меры приняты",
            "Проводятся мероприятия по реагированию",
            "Возобновлены мероприятия по реагированию",
            "Инцидент не подтвержден",
        ],
        "affected_system_categories": [
            "Информационный ресурс не является объектом КИИ",
            "Объект КИИ без категории значимости",
            "Объект КИИ третьей категории значимости",
            "Объект КИИ второй категории значимости",
            "Объект КИИ первой категории значимости",
        ],
        "affected_system_functions": [
            "Атомная энергетика",
            "Банковская сфера и иные сферы финансового рынка",
            "Горнодобывающая промышленность",
            "Государственная/муниципальная власть",
            "Здравоохранение",
            "Металлургическая промышленность",
            "Наука",
            "Оборонная промышленность",
            "Образование",
            "Ракетно-космическая промышленность",
            "Связь",
            "СМИ",
            "Топливно-энергетический комплекс",
            "Транспорт",
            "Химическая промышленность",
            "Иная",
        ],
        "impacts": ["Высокое", "Низкое", "Отсутствует"],
        "indicator_functions": [
            "Центр управления ВПО",
            "Источник распространения ВПО",
        ],
    }
