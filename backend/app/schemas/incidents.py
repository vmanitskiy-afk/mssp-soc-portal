"""
Pydantic schemas for incident-related API responses.
"""

from datetime import datetime
from pydantic import BaseModel


# ── Incident card (client view) ───────────────────────────────────

class IncidentCommentOut(BaseModel):
    id: str
    user_name: str
    text: str
    is_soc: bool
    created_at: datetime


class StatusChangeOut(BaseModel):
    old_status: str
    new_status: str
    user_name: str
    comment: str | None
    created_at: datetime


class IncidentListItem(BaseModel):
    id: str
    rusiem_incident_id: int
    title: str
    priority: str
    status: str
    category: str | None
    published_at: datetime
    updated_at: datetime
    comments_count: int = 0


class IncidentDetail(BaseModel):
    """Full incident card visible to client."""
    id: str
    rusiem_incident_id: int

    # From RuSIEM
    title: str
    description: str | None
    priority: str
    category: str | None
    mitre_id: str | None
    source_ips: list[str]
    source_hostnames: list[str]
    event_source_ips: list[str]
    event_count: int
    symptoms: list[str]
    rusiem_created_at: datetime | None

    # SOC analyst
    status: str
    recommendations: str | None
    soc_actions: str | None
    published_by_name: str
    published_at: datetime

    # Client
    client_response: str | None

    # Closing
    closed_by_name: str | None
    closed_at: datetime | None

    # Thread
    comments: list[IncidentCommentOut]
    status_history: list[StatusChangeOut]


class IncidentListResponse(BaseModel):
    items: list[IncidentListItem]
    total: int
    page: int
    pages: int
