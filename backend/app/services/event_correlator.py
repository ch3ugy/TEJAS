"""
TEJAS Event Correlator — Phase 2
Lightweight correlation helper used by the /events API endpoint.
No threat scores — returns operational context.
"""
import datetime
from typing import Dict, Any, List

from app.services.operational_alert_engine import (
    OperationalContext,
    AuthorizationState,
    EventType,
    evaluate_alert_level,
    AlertLevel,
)


class EventCorrelator:
    def __init__(self):
        self.active_tracks: Dict[str, Dict[str, Any]] = {}

    def correlate_event(self, event_data: Dict[str, Any]) -> Dict[str, Any]:
        entity_id = event_data.get("entity_id", "UNKNOWN")
        camera_id = event_data.get("camera_id", "CAM-01")
        event_type = event_data.get("event_type", "PERSON_DETECTED")
        timestamp = event_data.get("timestamp", datetime.datetime.utcnow().strftime("%H:%M:%S"))
        zone_type = event_data.get("metadata_json", {}).get("zone_type")

        if entity_id not in self.active_tracks:
            self.active_tracks[entity_id] = {
                "context": OperationalContext(
                    entity_id=entity_id,
                    camera_id=camera_id,
                    entity_type="unknown",
                ),
                "cameras": [camera_id],
                "timeline": [],
            }

        track = self.active_tracks[entity_id]
        context: OperationalContext = track["context"]

        if camera_id not in track["cameras"]:
            track["cameras"].append(camera_id)

        # Update context based on event type
        if event_type == EventType.WATCHLIST_FACE_MATCH or event_type == EventType.WATCHLIST_PLATE_MATCH:
            context.authorization_state = AuthorizationState.WATCHLIST_MATCH
        elif event_type == EventType.AUTHORIZED_FACE_VERIFIED:
            context.authorization_state = AuthorizationState.AUTHORIZED
        if zone_type:
            context.zone_types_entered.add(zone_type)

        track["timeline"].append({
            "time": timestamp,
            "camera": camera_id,
            "event": f"{event_type.replace('_', ' ').title()}",
        })

        alert_level, reason = evaluate_alert_level(event_type, context, zone_type)

        return {
            "entity_id": entity_id,
            "alert_level": alert_level,
            "alert_reason": reason,
            "authorization_state": context.authorization_state,
            "timeline": track["timeline"],
            "cameras_involved": track["cameras"],
            # Legacy field retained for frontend compatibility (always 0)
            "threat_score": 0,
            "severity": alert_level,
        }


correlator = EventCorrelator()
