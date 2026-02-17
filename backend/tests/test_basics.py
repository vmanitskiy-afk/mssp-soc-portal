"""
Basic tests to verify the application bootstraps correctly.
"""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.security import hash_password, verify_password, create_access_token, decode_token


# ── App health ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


# ── Security utils ────────────────────────────────────────────────

def test_password_hash_and_verify():
    pw = "test_password_12345"
    hashed = hash_password(pw)
    assert hashed != pw
    assert verify_password(pw, hashed)
    assert not verify_password("wrong_password", hashed)


def test_jwt_create_and_decode():
    payload = {"sub": "user-123", "role": "soc_admin", "email": "test@test.com"}
    token = create_access_token(payload)
    decoded = decode_token(token)
    assert decoded["sub"] == "user-123"
    assert decoded["role"] == "soc_admin"


# ── Model imports ─────────────────────────────────────────────────

def test_models_import():
    from app.models.models import (  # noqa: F401
        Tenant, User, PublishedIncident, IncidentComment,
        IncidentStatusChange, SlaSnapshot, LogSource,
        AuditLog, Notification,
    )
    # Verify table names are set
    assert Tenant.__tablename__ == "tenants"
    assert PublishedIncident.__tablename__ == "published_incidents"
    assert IncidentComment.__tablename__ == "incident_comments"


# ── Incident status transitions ───────────────────────────────────

def test_client_status_transitions():
    from app.services.incident_service import CLIENT_TRANSITIONS
    assert "in_progress" in CLIENT_TRANSITIONS["new"]
    assert "resolved" in CLIENT_TRANSITIONS["in_progress"]
    assert "closed" in CLIENT_TRANSITIONS["resolved"]
    assert "closed" not in CLIENT_TRANSITIONS.get("new", [])


def test_soc_status_transitions():
    from app.services.incident_service import SOC_TRANSITIONS
    assert "false_positive" in SOC_TRANSITIONS["new"]
    assert "awaiting_customer" in SOC_TRANSITIONS["in_progress"]


# ── RuSIEM client mapping ────────────────────────────────────────

def test_rusiem_priority_mapping():
    from app.integrations.rusiem.client import RuSIEMClient
    mapped = RuSIEMClient.map_incident({"id": 1, "priority": 1, "status": "assigned"})
    assert mapped["priority"] == "critical"
    assert mapped["status"] == "new"


def test_rusiem_preview_mapping():
    from app.integrations.rusiem.client import RuSIEMClient
    incident = {"id": 42, "name": "Test Incident", "priority": 2, "status": "processing", "count_events": 15}
    fullinfo = {"meta_values": {
        "src_ip": [{"value": "10.0.0.1"}],
        "event_source_hostname": [{"value": "dc01.corp.local"}],
        "event_source_ip": [{"value": "192.168.1.1"}],
        "symptom_name": [{"value": "Brute Force"}],
    }}
    preview = RuSIEMClient.map_incident_preview(incident, fullinfo)
    assert preview["rusiem_incident_id"] == 42
    assert preview["title"] == "Test Incident"
    assert preview["priority"] == "high"
    assert "10.0.0.1" in preview["source_ips"]
    assert "dc01.corp.local" in preview["source_hostnames"]
    assert "192.168.1.1" in preview["event_source_ips"]
    assert "Brute Force" in preview["symptoms"]
