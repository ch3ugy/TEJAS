"""
TEJAS Operational Alert Engine — Phase 2
Replaces the obsolete numerical threat scoring system.

Every alert answers:
  WHAT happened | WHERE | WHEN | WHICH camera | WHICH entity |
  WHAT context existed | WHAT evidence | WHY it was surfaced

DETECTION ≠ ALERT
ZONE ENTRY ≠ INTRUSION
UNKNOWN ≠ HOSTILE
"""
from __future__ import annotations
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("tejas.alert_engine")

# ──────────────────────────────────────────────
# Entity Authorization States
# ──────────────────────────────────────────────
class AuthorizationState:
    AUTHORIZED = "AUTHORIZED"          # Confirmed authorized personnel/vehicle
    UNKNOWN = "UNKNOWN"                # Not yet identified — default, neutral
    UNVERIFIED = "UNVERIFIED"          # Quality too poor to recognize
    WATCHLIST_MATCH = "WATCHLIST_MATCH"  # Confirmed watchlist match
    NOT_APPLICABLE = "NOT_APPLICABLE"  # e.g., generic vehicle in unrestricted zone


# ──────────────────────────────────────────────
# Event Types
# ──────────────────────────────────────────────
class EventType:
    PERSON_DETECTED = "PERSON_DETECTED"
    VEHICLE_DETECTED = "VEHICLE_DETECTED"
    ZONE_ENTRY = "ZONE_ENTRY"
    ZONE_EXIT = "ZONE_EXIT"
    LOITERING = "LOITERING"
    FACE_IDENTIFIED = "FACE_IDENTIFIED"
    WATCHLIST_FACE_MATCH = "WATCHLIST_FACE_MATCH"
    AUTHORIZED_FACE_VERIFIED = "AUTHORIZED_FACE_VERIFIED"
    PLATE_DETECTED = "PLATE_DETECTED"
    WATCHLIST_PLATE_MATCH = "WATCHLIST_PLATE_MATCH"
    CAMERA_OFFLINE = "CAMERA_OFFLINE"
    CAMERA_ONLINE = "CAMERA_ONLINE"
    CROSS_CAMERA_CANDIDATE = "CROSS_CAMERA_CANDIDATE"
    PATROL_ACTIVITY = "PATROL_ACTIVITY"
    UNAUTHORIZED_ZONE_ACTIVITY = "UNAUTHORIZED_ZONE_ACTIVITY"
    NIGHT_MOVEMENT = "NIGHT_MOVEMENT"


# ──────────────────────────────────────────────
# Zone Types
# ──────────────────────────────────────────────
class ZoneType:
    BORDER = "BORDER"
    RESTRICTED = "RESTRICTED"
    SENSITIVE = "SENSITIVE"
    ENTRY = "ENTRY"
    EXIT = "EXIT"
    CUSTOM = "CUSTOM"

# Zone types that require context evaluation when entered
SENSITIVE_ZONE_TYPES = {ZoneType.BORDER, ZoneType.RESTRICTED, ZoneType.SENSITIVE}


# ──────────────────────────────────────────────
# Operational Alert Levels (contextual, not numerical)
# ──────────────────────────────────────────────
class AlertLevel:
    INFO = "INFO"           # Logged operational activity (authorized, expected)
    NOTICE = "NOTICE"       # Noteworthy but not actionable
    ALERT = "ALERT"         # Requires operator awareness
    PRIORITY = "PRIORITY"   # Requires operator response


@dataclass
class OperationalContext:
    """
    Context accumulated for a tracked entity across its lifetime.
    Replaces numerical threat state.
    """
    entity_id: str
    camera_id: str
    entity_type: str                              # person | vehicle
    authorization_state: str = AuthorizationState.UNKNOWN
    patrol_session_id: Optional[str] = None        # If part of active patrol
    face_identity: Optional[str] = None            # Resolved face identity name
    plate_identity: Optional[str] = None           # Resolved plate number
    watchlist_face_match: bool = False
    watchlist_plate_match: bool = False
    active_zones: set = field(default_factory=set)  # Zone IDs currently occupied
    zone_types_entered: set = field(default_factory=set)  # Zone types encountered
    is_night_context: bool = False
    global_person_id: Optional[str] = None          # Persistent single-camera Re-ID identity
    reid_status: Optional[str] = None                # NEW | TRACKED | REIDENTIFIED | UNCERTAIN
    first_seen: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())
    last_seen: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())


def evaluate_alert_level(
    event_type: str,
    context: OperationalContext,
    zone_type: Optional[str] = None,
) -> tuple[str, str]:
    """
    Returns (alert_level, reason) based on what happened and what context exists.

    DETECTION alone → INFO (logged, not an alert)
    ZONE_ENTRY by AUTHORIZED entity → INFO (patrol activity)
    ZONE_ENTRY (RESTRICTED) by UNKNOWN entity → ALERT
    WATCHLIST_FACE_MATCH → PRIORITY regardless of zone
    WATCHLIST_PLATE_MATCH → PRIORITY
    LOITERING in RESTRICTED/BORDER by non-authorized → ALERT
    CAMERA_OFFLINE → NOTICE (infrastructure)
    """

    # Watchlist matches are always PRIORITY
    if event_type in (EventType.WATCHLIST_FACE_MATCH, EventType.WATCHLIST_PLATE_MATCH):
        return AlertLevel.PRIORITY, f"Watchlist match confirmed ({event_type})"

    # Camera infrastructure events
    if event_type == EventType.CAMERA_OFFLINE:
        return AlertLevel.NOTICE, "Camera offline — infrastructure alert"

    # Detection events alone are just INFO
    if event_type in (EventType.PERSON_DETECTED, EventType.VEHICLE_DETECTED):
        return AlertLevel.INFO, "New entity detected — logged"

    # Authorized personnel/patrol activity in any zone → INFO
    if event_type == EventType.ZONE_ENTRY:
        if context.authorization_state == AuthorizationState.AUTHORIZED or context.patrol_session_id:
            return AlertLevel.INFO, "Authorized entity zone entry — patrol activity logged"
        if zone_type in SENSITIVE_ZONE_TYPES:
            return AlertLevel.ALERT, (
                f"Unverified entity entered {zone_type} zone "
                f"(authorization_state={context.authorization_state})"
            )
        return AlertLevel.INFO, f"Entity entered {zone_type} zone — logged"

    if event_type == EventType.LOITERING:
        if context.authorization_state == AuthorizationState.AUTHORIZED or context.patrol_session_id:
            return AlertLevel.INFO, "Authorized entity dwell in zone — expected activity"
        if zone_type in SENSITIVE_ZONE_TYPES:
            return AlertLevel.ALERT, (
                f"Unverified entity loitering in {zone_type} zone "
                f"(dwell exceeded threshold)"
            )
        return AlertLevel.NOTICE, f"Entity loitering in {zone_type} zone"

    if event_type == EventType.NIGHT_MOVEMENT:
        if context.authorization_state == AuthorizationState.AUTHORIZED or context.patrol_session_id:
            return AlertLevel.INFO, "Authorized night movement — patrol"
        return AlertLevel.ALERT, "Unverified entity detected during night hours"

    if event_type == EventType.UNAUTHORIZED_ZONE_ACTIVITY:
        return AlertLevel.PRIORITY, "Explicit unauthorized zone activity detected"

    if event_type == EventType.PATROL_ACTIVITY:
        return AlertLevel.INFO, "Authorized patrol activity logged"

    # Default: informational
    return AlertLevel.INFO, f"Event logged: {event_type}"


def should_create_alert(alert_level: str) -> bool:
    """Only ALERT and PRIORITY level events generate an Alert record."""
    return alert_level in (AlertLevel.ALERT, AlertLevel.PRIORITY)


def should_create_incident(alert_level: str, context: OperationalContext) -> bool:
    """
    PRIORITY events always create/update an incident.
    ALERT events create an incident only if the entity has repeated violations
    or multiple sensitive zone entries.
    """
    if alert_level == AlertLevel.PRIORITY:
        return True
    if alert_level == AlertLevel.ALERT:
        sensitive_zones = context.zone_types_entered & SENSITIVE_ZONE_TYPES
        return len(sensitive_zones) >= 1
    return False
