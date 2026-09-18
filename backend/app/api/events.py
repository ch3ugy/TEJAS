"""
TEJAS Events API — Phase 2
Uses operational alert engine. No threat scores.
"""
import datetime
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Event, Alert
from app.schemas.schemas import EventCreate, EventResponse
from app.services.event_correlator import correlator
from app.services.operational_alert_engine import AlertLevel, should_create_alert
from app.websocket.connection_manager import manager

router = APIRouter(prefix="/events", tags=["Events"])


@router.get("", response_model=List[EventResponse])
def get_events(
    db: Session = Depends(get_db),
    limit: int = Query(default=50, le=500),
    camera_id: Optional[str] = Query(default=None),
    event_type: Optional[str] = Query(default=None),
):
    q = db.query(Event).order_by(Event.created_at.desc())
    if camera_id:
        q = q.filter(Event.camera_id == camera_id)
    if event_type:
        q = q.filter(Event.event_type == event_type)
    return q.limit(limit).all()


@router.post("", response_model=EventResponse)
async def ingest_event(payload: EventCreate, db: Session = Depends(get_db)):
    """Manual event ingestion endpoint (for external integrations)."""
    event_id = f"EVT-{uuid.uuid4().hex[:8].upper()}"
    ts = datetime.datetime.utcnow().strftime("%H:%M:%S")

    db_event = Event(
        id=event_id,
        event_type=payload.event_type,
        camera_id=payload.camera_id,
        entity_id=payload.entity_id,
        timestamp=ts,
        confidence=payload.confidence,
        location=payload.location,
        metadata_json=payload.metadata_json,
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)

    # Correlate to get operational context
    correlated = correlator.correlate_event({
        "event_type": payload.event_type,
        "camera_id": payload.camera_id,
        "entity_id": payload.entity_id,
        "timestamp": ts,
        "confidence": payload.confidence,
        "metadata_json": payload.metadata_json or {},
    })

    # Create alert if warranted by operational context
    alert_level = correlated.get("alert_level", AlertLevel.INFO)
    if should_create_alert(alert_level):
        alert_id = f"ALT-{uuid.uuid4().hex[:6].upper()}"
        db_alert = Alert(
            id=alert_id,
            camera=payload.camera_id,
            title=f"[{alert_level}] {payload.event_type.replace('_', ' ').title()}",
            severity=alert_level,
            threat_score=0,
            message=correlated.get("alert_reason", ""),
            timestamp=ts,
        )
        db.add(db_alert)
        db.commit()

    # Broadcast
    await manager.broadcast({
        "type": "OPERATIONAL_EVENT",
        "event": {
            "id": db_event.id,
            "event_type": db_event.event_type,
            "camera_id": db_event.camera_id,
            "entity_id": db_event.entity_id,
            "timestamp": db_event.timestamp,
            "confidence": db_event.confidence,
            "alert_level": alert_level,
        },
        "correlation": correlated,
    })

    return db_event
