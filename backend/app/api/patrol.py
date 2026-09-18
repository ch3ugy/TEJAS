"""
TEJAS Patrol Sessions API — Phase 2 (Step 10)
Authorized patrol context prevents false positives.

A patrol session declares:
- authorized personnel (face IDs) and/or vehicles (plate IDs)
- expected cameras and zone types
- time window

When entities in active patrol sessions enter zones,
the event_engine treats them as authorized activity (logged, not alerted).
"""
import time
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/patrol", tags=["Patrol Sessions"])


class PatrolSessionCreate(BaseModel):
    unit: str = Field(..., description="Unit or team identifier")
    authorized_face_ids: List[str] = Field(default_factory=list, description="Enrolled face IDs")
    authorized_plate_ids: List[str] = Field(default_factory=list, description="Known vehicle plates")
    expected_cameras: List[str] = Field(default_factory=list, description="Camera IDs covered by this patrol")
    expected_zone_types: List[str] = Field(
        default_factory=lambda: ["RESTRICTED", "BORDER", "SENSITIVE"],
        description="Zone types this patrol is authorized to enter",
    )
    duration_minutes: int = Field(default=60, ge=1, le=480, description="Patrol validity window in minutes")


class PatrolSessionResponse(BaseModel):
    session_id: str
    unit: str
    authorized_face_ids: List[str]
    authorized_plate_ids: List[str]
    expected_cameras: List[str]
    expected_zone_types: List[str]
    start_time: float
    expiry_time: float
    is_active: bool


@router.post("", response_model=PatrolSessionResponse)
def create_patrol_session(payload: PatrolSessionCreate):
    """Registers an active patrol session with the event engine."""
    from app.services.event_engine import event_engine, PatrolSession

    session_id = f"PATROL-{uuid.uuid4().hex[:6].upper()}"
    now = time.time()
    expiry = now + payload.duration_minutes * 60

    session = PatrolSession(
        session_id=session_id,
        unit=payload.unit,
        authorized_face_ids=payload.authorized_face_ids,
        authorized_plate_ids=payload.authorized_plate_ids,
        expected_cameras=payload.expected_cameras,
        expected_zone_types=payload.expected_zone_types,
        start_time=now,
        expiry_time=expiry,
    )
    event_engine.register_patrol_session(session)

    return PatrolSessionResponse(
        session_id=session_id,
        unit=payload.unit,
        authorized_face_ids=payload.authorized_face_ids,
        authorized_plate_ids=payload.authorized_plate_ids,
        expected_cameras=payload.expected_cameras,
        expected_zone_types=payload.expected_zone_types,
        start_time=now,
        expiry_time=expiry,
        is_active=True,
    )


@router.get("", response_model=List[PatrolSessionResponse])
def list_patrol_sessions():
    """Returns all registered patrol sessions (active and expired)."""
    from app.services.event_engine import event_engine

    sessions = []
    for s in event_engine.patrol_sessions.values():
        sessions.append(PatrolSessionResponse(
            session_id=s.session_id,
            unit=s.unit,
            authorized_face_ids=list(s.authorized_face_ids),
            authorized_plate_ids=list(s.authorized_plate_ids),
            expected_cameras=list(s.expected_cameras),
            expected_zone_types=list(s.expected_zone_types),
            start_time=s.start_time,
            expiry_time=s.expiry_time,
            is_active=s.is_active(),
        ))
    return sessions


@router.delete("/{session_id}")
def end_patrol_session(session_id: str):
    """Immediately expires a patrol session."""
    from app.services.event_engine import event_engine

    session = event_engine.patrol_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Patrol session not found")
    # Expire it immediately
    session.expiry_time = time.time() - 1
    return {"message": f"Patrol session {session_id} ended", "session_id": session_id}
