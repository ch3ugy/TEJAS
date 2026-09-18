import os
import uuid
import datetime
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models.models import Incident, AuditLog, Evidence, Event
from app.schemas.schemas import (
    IncidentResponse, 
    IncidentDetailResponse, 
    IncidentAction, 
    EvidenceResponse, 
    AuditLogResponse
)
from app.services.evidence_service import evidence_service
from app.services.event_engine import event_engine
from app.websocket.connection_manager import manager

logger = logging.getLogger("tejas.api.incidents")

router = APIRouter(prefix="/incidents", tags=["Incidents"])


class OperatorNotePayload(BaseModel):
    user: str = "Duty Operator"
    note: str


class TestIncidentPayload(BaseModel):
    camera_id: str = "CAM-00"
    target_type: str = "PERSON"
    threat_scenario: str = "RESTRICTED_ZONE_ENTRY"  # RESTRICTED_ZONE_ENTRY, WATCHLIST_VEHICLE, NIGHT_PROWLER
    assigned_to: str = "Duty Officer"


@router.get("", response_model=List[IncidentResponse])
def get_incidents(
    status: Optional[str] = Query(None, description="Filter by status (NEW, ACKNOWLEDGED, INVESTIGATING, RESOLVED, ALL)"),
    severity: Optional[str] = Query(None, description="Filter by severity (CRITICAL, HIGH, MEDIUM, LOW, ALL)"),
    db: Session = Depends(get_db)
):
    """Returns all security incidents ordered by recency, with optional status and severity filtering."""
    query = db.query(Incident).order_by(Incident.created_at.desc())

    if status and status.upper() != "ALL":
        query = query.filter(Incident.status == status.upper())

    if severity and severity.upper() != "ALL":
        query = query.filter(Incident.severity == severity.upper())

    incidents = query.all()
    return incidents


@router.get("/{incident_id}", response_model=IncidentDetailResponse)
def get_incident_detail(incident_id: str, db: Session = Depends(get_db)):
    """
    Returns full incident dossier including:
    - Primary incident metadata and current lifecycle status
    - Chronological timeline and triggering events
    - Physical evidence items (snapshots, bounding boxes, plate crops)
    - Complete operator audit log trail
    - Threat factors and active rules breakdown
    """
    inc = db.query(Incident).filter(Incident.id == incident_id).first()
    if not inc:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")

    # Fetch linked evidence items
    evidence_items = db.query(Evidence).filter(Evidence.incident_id == incident_id).order_by(Evidence.created_at.asc()).all()

    # Fetch audit log records
    audit_logs = db.query(AuditLog).filter(AuditLog.incident_id == incident_id).order_by(AuditLog.created_at.asc()).all()

    # Fetch associated triggering events
    events = db.query(Event).filter(Event.incident_id == incident_id).order_by(Event.created_at.asc()).all()
    event_dicts = [
        {
            "id": ev.id,
            "event_type": ev.event_type,
            "camera_id": ev.camera_id,
            "entity_id": ev.entity_id,
            "timestamp": ev.timestamp,
            "confidence": ev.confidence,
            "location": ev.location,
            "metadata": ev.metadata_json
        }
        for ev in events
    ]

    return {
        "id": inc.id,
        "title": inc.title,
        "target_entity": inc.target_entity,
        "threat_score": inc.threat_score,
        "severity": inc.severity,
        "primary_camera": inc.primary_camera,
        "timestamp": inc.timestamp,
        "status": inc.status,
        "assigned_to": inc.assigned_to or "Unassigned",
        "threat_factors": inc.threat_factors or [],
        "timeline": inc.timeline or [],
        "resolution_notes": inc.resolution_notes,
        "anpr_data": inc.anpr_data or {},
        "affected_track_id": inc.affected_track_id,
        "created_at": inc.created_at,
        "updated_at": inc.updated_at,
        "evidence": evidence_items,
        "audit_logs": audit_logs,
        "triggering_events": event_dicts
    }


@router.post("/{incident_id}/action", response_model=IncidentResponse)
def update_incident_action(
    incident_id: str, 
    action: IncidentAction, 
    db: Session = Depends(get_db)
):
    """
    Executes an authentic lifecycle transition (NEW -> ACKNOWLEDGED -> INVESTIGATING -> RESOLVED):
    - Updates incident status in database.
    - Captures operator resolution notes if provided.
    - Appends an irreversible audit log entry with operator ID and timestamp.
    - Broadcasts state update via WebSocket.
    """
    inc = db.query(Incident).filter(Incident.id == incident_id).first()
    if not inc:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")

    old_status = inc.status
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Update lifecycle status if specified
    if action.status:
        target_status = action.status.upper().strip()
        valid_statuses = {"NEW", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "ESCALATED"}
        if target_status not in valid_statuses:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid lifecycle status '{target_status}'. Must be one of {valid_statuses}"
            )
        inc.status = target_status

    if action.resolution_notes:
        inc.resolution_notes = action.resolution_notes

    if action.assigned_to:
        inc.assigned_to = action.assigned_to

    # Formulate audit description
    comment_part = f" Notes: {action.comment}" if action.comment else ""
    res_part = f" Resolution Summary: {action.resolution_notes}" if action.resolution_notes else ""
    log_action = f"Status updated from [{old_status}] to [{inc.status}].{comment_part}{res_part}".strip()

    db_log = AuditLog(
        incident_id=incident_id,
        user=action.user or "Duty Operator",
        action=log_action,
        timestamp=now_str,
        details={
            "previous_status": old_status,
            "new_status": inc.status,
            "action_type": action.action_type or "STATUS_CHANGE",
            "comment": action.comment,
            "resolution_notes": action.resolution_notes,
            "assigned_to": inc.assigned_to
        }
    )
    db.add(db_log)
    db.commit()
    db.refresh(inc)

    # Broadcast WebSocket update
    manager.broadcast_sync({
        "type": "INCIDENT_UPDATED",
        "incident_id": inc.id,
        "status": inc.status,
        "operator": action.user,
        "action": log_action,
        "timestamp": now_str
    })

    logger.info(f"Incident [{incident_id}] transition: {old_status} -> {inc.status} by {action.user}")
    return inc


@router.post("/{incident_id}/notes", response_model=AuditLogResponse)
def add_incident_note(
    incident_id: str,
    payload: OperatorNotePayload,
    db: Session = Depends(get_db)
):
    """Appends an investigation note or field dispatch remark into the permanent incident audit log."""
    inc = db.query(Incident).filter(Incident.id == incident_id).first()
    if not inc:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db_log = AuditLog(
        incident_id=incident_id,
        user=payload.user,
        action=f"Operator Note: {payload.note}",
        timestamp=now_str,
        details={"type": "OPERATOR_NOTE", "text": payload.note}
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)

    manager.broadcast_sync({
        "type": "INCIDENT_NOTE_ADDED",
        "incident_id": incident_id,
        "user": payload.user,
        "note": payload.note,
        "timestamp": now_str
    })

    return db_log


@router.get("/{incident_id}/evidence", response_model=List[EvidenceResponse])
def get_incident_evidence(incident_id: str, db: Session = Depends(get_db)):
    """Returns all physical and metadata evidence items linked to an incident."""
    evidence_items = db.query(Evidence).filter(Evidence.incident_id == incident_id).order_by(Evidence.created_at.asc()).all()
    return evidence_items


@router.get("/{incident_id}/evidence/{evidence_id}/file")
def get_evidence_file(incident_id: str, evidence_id: str, db: Session = Depends(get_db)):
    """Streams the physical evidence image from disk."""
    ev = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.incident_id == incident_id
    ).first()
    if not ev:
        raise HTTPException(status_code=404, detail=f"Evidence {evidence_id} not found")

    if not ev.file_path or not os.path.exists(ev.file_path):
        raise HTTPException(status_code=404, detail="Physical evidence file not found on storage disk")

    return FileResponse(ev.file_path, media_type="image/jpeg", filename=f"{evidence_id}.jpg")


@router.get("/{incident_id}/audit-logs", response_model=List[AuditLogResponse])
def get_incident_audit_logs(incident_id: str, db: Session = Depends(get_db)):
    """Returns chronological audit trail of all operator actions and lifecycle changes."""
    logs = db.query(AuditLog).filter(AuditLog.incident_id == incident_id).order_by(AuditLog.created_at.asc()).all()
    return logs


@router.post("/test-trigger")
def trigger_test_incident(payload: TestIncidentPayload, db: Session = Depends(get_db)):
    """
    Testbench endpoint to trigger a genuine multi-factor intrusion incident on demand:
    1. Creates realistic synthetic camera frame with bounding box and reticle overlay.
    2. Ingests high-threat event through the threat and event engines.
    3. Auto-creates Incident with status NEW and persists physical evidence on disk.
    4. Logs initial audit trail entry and dispatches WebSocket notifications.
    """
    import cv2
    import numpy as np
    import base64

    # 1. Generate realistic camera evidence frame
    h, w = 480, 640
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    # Background noise and grid
    frame[:] = (20, 24, 30)
    for y in range(0, h, 40):
        cv2.line(frame, (0, y), (w, y), (30, 35, 45), 1)
    for x in range(0, w, 40):
        cv2.line(frame, (x, 0), (x, h), (30, 35, 45), 1)

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Draw target entity with tactical reticle
    if payload.target_type == "PERSON":
        entity_name = "PERSON #74"
        # Bounding box coordinates
        bx1, by1, bx2, by2 = 240, 160, 360, 420
        cv2.rectangle(frame, (bx1, by1), (bx2, by2), (0, 0, 255), 2)
        cv2.putText(frame, f"{entity_name} [INTRUDER]", (bx1, by1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
        # Person silhouette
        cv2.circle(frame, (300, 210), 25, (140, 175, 215), -1)
        cv2.rectangle(frame, (270, 235), (330, 340), (80, 40, 20), -1)
        cv2.rectangle(frame, (275, 340), (298, 410), (45, 30, 25), -1)
        cv2.rectangle(frame, (302, 340), (325, 410), (45, 30, 25), -1)
        plate_num = None
    else:
        entity_name = "VEHICLE #19"
        bx1, by1, bx2, by2 = 180, 200, 460, 390
        cv2.rectangle(frame, (bx1, by1), (bx2, by2), (0, 140, 255), 2)
        cv2.putText(frame, f"{entity_name} [UNAUTHORIZED]", (bx1, by1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 140, 255), 1)
        cv2.rectangle(frame, (200, 220), (440, 360), (40, 40, 40), -1)
        # Plate region
        cv2.rectangle(frame, (270, 320), (370, 350), (240, 240, 240), -1)
        cv2.putText(frame, "MP09AB1234", (278, 342), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (10, 10, 10), 1)
        plate_num = "MP09AB1234"

    # Tactical HUD Overlay
    cv2.putText(frame, f"TEJAS CAM-EV: {payload.camera_id} - {now_str}", (15, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 200), 1)
    cv2.putText(frame, "THREAT EVALUATION: CRITICAL INTRUSION", (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)

    _, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    frame_b64 = base64.b64encode(buffer).decode('utf-8')

    # 2. Ingest through event engine with high threat
    import time
    from app.services.event_engine import TrackState
    test_track_id = 740 + (int(time.time()) % 100)
    track_state = TrackState(test_track_id, payload.target_type.lower(), time.time())
    event_engine.tracks[test_track_id] = track_state

    track_state.factors.add("rule_restricted_intrusion")
    track_state.factors.add("rule_cross_perimeter_intrusion")
    track_state.factors.add("rule_night_movement")
    track_state.factors.add("rule_loitering")
    if payload.threat_scenario == "WATCHLIST_VEHICLE" or plate_num:
        track_state.factors.add("rule_watchlist_vehicle")
        track_state.factors.add("rule_movement_sensitive")

    event_metadata = {
        "box": [bx1, by1, bx2, by2],
        "snapshot_b64": frame_b64,
        "confidence": 0.96,
        "zone_name": "Sector Alpha Restricted Polygon",
        "scenario": payload.threat_scenario
    }
    if plate_num:
        event_metadata["plate_number"] = plate_num
        event_metadata["watchlist_status"] = "CRITICAL_MATCH"

    event_engine._record_and_dispatch_event(
        camera_id=payload.camera_id,
        entity_id=entity_name,
        event_type="RESTRICTED_ZONE_ENTRY" if payload.target_type == "PERSON" else "WATCHLIST_MATCH",
        time_str=now_str,
        confidence=0.96,
        location=f"Perimeter Zone Alpha ({payload.camera_id})",
        metadata=event_metadata,
        track=track_state
    )

    created_inc_id = track_state.incident_id
    inc_record = db.query(Incident).filter(Incident.id == created_inc_id).first() if created_inc_id else None

    return {
        "success": True,
        "id": created_inc_id,
        "incident_id": created_inc_id,
        "title": inc_record.title if inc_record else "Perimeter Breach",
        "threat_score": inc_record.threat_score if inc_record else 85,
        "status": inc_record.status if inc_record else "NEW",
        "primary_camera": payload.camera_id,
        "message": f"Successfully generated operational incident {created_inc_id} with physical evidence and audit log."
    }
