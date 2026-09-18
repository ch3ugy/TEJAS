"""
TEJAS Event Engine — Phase 2
Real zone state machine + operational alert logic.
No numerical threat scores. No LOW/MEDIUM/HIGH/CRITICAL.

Pipeline:
  Detection → Tracking → Entity State → Zone → Event → Context → Operational Alert
"""
from __future__ import annotations

import datetime
import logging
import time
import uuid
from typing import Dict, List, Any, Optional, Set, Tuple

import cv2
import numpy as np

from app.config import settings
from app.database import SessionLocal
from app.models.models import Event, Alert, Incident, Zone, Evidence, AuditLog
from app.services.operational_alert_engine import (
    OperationalContext,
    AuthorizationState,
    EventType,
    ZoneType,
    SENSITIVE_ZONE_TYPES,
    AlertLevel,
    evaluate_alert_level,
    should_create_alert,
    should_create_incident,
)
from app.services.evidence_service import evidence_service
from app.websocket.connection_manager import manager

logger = logging.getLogger("tejas.event_engine")


# ──────────────────────────────────────────────
# Entity Track State (Phase 2)
# ──────────────────────────────────────────────
class TrackState:
    """
    Per-entity state for a single camera's tracking session.
    Replaces threat_score/severity with OperationalContext.
    """

    def __init__(self, track_id: int, class_name: str, camera_id: str, first_seen: float):
        self.track_id = track_id
        self.class_name = class_name
        self.camera_id = camera_id
        self.first_seen = first_seen
        self.last_seen = first_seen

        # Operational context — no threat score
        self.context = OperationalContext(
            entity_id=f"{class_name.upper()} #{track_id}",
            camera_id=camera_id,
            entity_type=class_name,
        )

        # Zone state machine (Step 7)
        self.current_zones: Set[str] = set()          # Zone IDs entity is currently inside
        self.zone_entry_times: Dict[str, float] = {}   # zone_id → entry timestamp
        self.loiter_fired_zones: Set[str] = set()      # zones where loitering event fired
        self.zone_type_map: Dict[str, str] = {}        # zone_id → zone type

        # Event history (for de-duplication and incident building)
        self.initial_event_fired = False
        self.incident_id: Optional[str] = None
        self.timeline: List[Dict[str, Any]] = []


# ──────────────────────────────────────────────
# Patrol Session Model (Step 10)
# ──────────────────────────────────────────────
class PatrolSession:
    """
    An active patrol session that authorizes entities in expected zones/cameras.
    """

    def __init__(
        self,
        session_id: str,
        unit: str,
        authorized_face_ids: List[str],
        authorized_plate_ids: List[str],
        expected_cameras: List[str],
        expected_zone_types: List[str],
        start_time: float,
        expiry_time: float,
    ):
        self.session_id = session_id
        self.unit = unit
        self.authorized_face_ids: Set[str] = set(authorized_face_ids)
        self.authorized_plate_ids: Set[str] = set(authorized_plate_ids)
        self.expected_cameras: Set[str] = set(expected_cameras)
        self.expected_zone_types: Set[str] = set(expected_zone_types)
        self.start_time = start_time
        self.expiry_time = expiry_time

    def is_active(self) -> bool:
        return time.time() <= self.expiry_time

    def authorizes_camera(self, camera_id: str) -> bool:
        return camera_id in self.expected_cameras or not self.expected_cameras

    def authorizes_zone_type(self, zone_type: str) -> bool:
        return zone_type in self.expected_zone_types or not self.expected_zone_types


# ──────────────────────────────────────────────
# Event Engine (Phase 2)
# ──────────────────────────────────────────────
class EventEngine:
    def __init__(self):
        self.tracks: Dict[Tuple[str, int], TrackState] = {}  # (camera_id, track_id) → state
        self.patrol_sessions: Dict[str, PatrolSession] = {}  # session_id → session

        # Configuration from settings
        self.loiter_threshold: float = settings.LOITER_THRESHOLD_SECONDS
        self.night_start_hour: int = settings.NIGHT_START_HOUR
        self.night_end_hour: int = settings.NIGHT_END_HOUR
        self.force_night_mode: bool = False

    # ── Night context ──────────────────────────
    def is_night_time(self) -> bool:
        if self.force_night_mode:
            return True
        h = datetime.datetime.now().hour
        if self.night_start_hour > self.night_end_hour:
            return h >= self.night_start_hour or h < self.night_end_hour
        return self.night_start_hour <= h < self.night_end_hour

    # ── Reference point (bottom-center of bbox) ─
    @staticmethod
    def get_reference_point(box: List[int]) -> Tuple[int, int]:
        x1, y1, x2, y2 = box
        return int((x1 + x2) / 2), int(y2)

    # ── Point-in-polygon (OpenCV) ──────────────
    @staticmethod
    def is_point_in_polygon(ref_point: Tuple[int, int], contour: np.ndarray) -> bool:
        if contour is None or len(contour) < 3:
            return False
        return cv2.pointPolygonTest(
            contour, (float(ref_point[0]), float(ref_point[1])), measureDist=False
        ) >= 0

    # ── Patrol session management ──────────────
    def register_patrol_session(self, session: PatrolSession):
        self.patrol_sessions[session.session_id] = session
        logger.info(f"Patrol session registered: {session.session_id} unit={session.unit}")

    def _get_active_patrol_for_camera(self, camera_id: str) -> Optional[PatrolSession]:
        """Returns the first active patrol session that covers the given camera."""
        for session in self.patrol_sessions.values():
            if session.is_active() and session.authorizes_camera(camera_id):
                return session
        return None

    def _is_entity_authorized_by_patrol(
        self, track: TrackState, zone_type: str
    ) -> Optional[str]:
        """
        Returns patrol_session_id if this entity is authorized by an active patrol
        that covers its camera and zone type. Otherwise returns None.
        """
        session = self._get_active_patrol_for_camera(track.camera_id)
        if session is None:
            return None

        # Check if face or plate is explicitly authorized
        face_id = track.context.face_identity
        plate_id = track.context.plate_identity
        face_authorized = face_id and face_id in session.authorized_face_ids
        plate_authorized = plate_id and plate_id in session.authorized_plate_ids

        if face_authorized or plate_authorized:
            if session.authorizes_zone_type(zone_type):
                return session.session_id

        return None

    # ── Main per-frame entry point ─────────────
    def process_frame(
        self,
        camera_id: str,
        tracks: List[Dict[str, Any]],
        zones: List[Dict[str, Any]],
        frame_shape: Tuple[int, ...],
    ):
        """
        Called once per processed video frame (from the async protection worker).
        Evaluates real tracks against camera-specific zones.
        Produces events without threat scoring.
        """
        now = time.time()
        time_str = datetime.datetime.now().strftime("%H:%M:%S")
        is_night = self.is_night_time()
        h, w = frame_shape[:2]

        # Build zone contours for this frame's resolution
        scaled_zones = self._build_zone_contours(zones, w, h)

        seen_keys: Set[Tuple[str, int]] = set()

        for track_data in tracks:
            t_id = track_data.get("track_id", -1)
            if t_id < 0:
                continue

            key = (camera_id, t_id)
            seen_keys.add(key)
            cls_name = track_data["class_name"]
            box = track_data["box"]
            conf = track_data["confidence"]
            ref_pt = self.get_reference_point(box)
            global_person_id = track_data.get("global_person_id")
            reid_status = track_data.get("reid_status")

            # Initialize track state
            if key not in self.tracks:
                self.tracks[key] = TrackState(t_id, cls_name, camera_id, now)
                # Inherit any active patrol authorization
                session = self._get_active_patrol_for_camera(camera_id)
                if session:
                    self.tracks[key].context.patrol_session_id = session.session_id

            track = self.tracks[key]
            track.last_seen = now
            if global_person_id:
                track.context.global_person_id = global_person_id
                track.context.reid_status = reid_status
            entity_label = f"{cls_name.upper()} #{t_id}"
            if global_person_id:
                entity_label = f"{entity_label} [{global_person_id}]"

            # ── Step 3: First detection event ──
            if not track.initial_event_fired:
                track.initial_event_fired = True
                evt_type = (
                    EventType.PERSON_DETECTED
                    if cls_name == "person"
                    else EventType.VEHICLE_DETECTED
                )
                self._record_and_dispatch(
                    camera_id=camera_id,
                    entity_label=entity_label,
                    event_type=evt_type,
                    time_str=time_str,
                    confidence=conf,
                    location=f"Camera {camera_id} field of view",
                    metadata={
                        "box": box, "track_id": t_id, "class": cls_name,
                        "global_person_id": global_person_id, "reid_status": reid_status,
                    },
                    track=track,
                    zone_type=None,
                )

            # ── Step 7: Zone state machine ─────
            active_zone_ids: Set[str] = set()

            for zone_info in scaled_zones:
                z_id = zone_info["id"]
                z_name = zone_info["name"]
                z_type = zone_info["type"]
                contour = zone_info["contour"]

                inside = self.is_point_in_polygon(ref_pt, contour)

                if inside:
                    active_zone_ids.add(z_id)
                    track.context.active_zones.add(z_id)
                    track.context.zone_types_entered.add(z_type)
                    track.zone_type_map[z_id] = z_type

                    if z_id not in track.current_zones:
                        # ── ZONE ENTRY (one event per entry) ──
                        track.current_zones.add(z_id)
                        track.zone_entry_times[z_id] = now

                        # Check patrol authorization
                        patrol_id = self._is_entity_authorized_by_patrol(track, z_type)
                        if patrol_id:
                            track.context.patrol_session_id = patrol_id
                            track.context.authorization_state = AuthorizationState.AUTHORIZED

                        self._record_and_dispatch(
                            camera_id=camera_id,
                            entity_label=entity_label,
                            event_type=EventType.ZONE_ENTRY,
                            time_str=time_str,
                            confidence=conf,
                            location=f"{z_name} ({z_type})",
                            metadata={
                                "zone_id": z_id,
                                "zone_name": z_name,
                                "zone_type": z_type,
                                "box": box,
                                "ref_point": list(ref_pt),
                                "authorization_state": track.context.authorization_state,
                                "patrol_session_id": track.context.patrol_session_id,
                                "global_person_id": global_person_id,
                                "reid_status": reid_status,
                            },
                            track=track,
                            zone_type=z_type,
                        )

                        # Night context event
                        if is_night and z_type in SENSITIVE_ZONE_TYPES:
                            self._record_and_dispatch(
                                camera_id=camera_id,
                                entity_label=entity_label,
                                event_type=EventType.NIGHT_MOVEMENT,
                                time_str=time_str,
                                confidence=conf,
                                location=f"{z_name} [NIGHT]",
                                metadata={
                                    "zone_id": z_id,
                                    "zone_type": z_type,
                                    "night_hours": f"{self.night_start_hour}:00-{self.night_end_hour}:00",
                                },
                                track=track,
                                zone_type=z_type,
                            )

                    else:
                        # ── LOITERING CHECK (Step 8) ──
                        entry_time = track.zone_entry_times.get(z_id, now)
                        dwell = now - entry_time
                        if dwell >= self.loiter_threshold and z_id not in track.loiter_fired_zones:
                            track.loiter_fired_zones.add(z_id)
                            self._record_and_dispatch(
                                camera_id=camera_id,
                                entity_label=entity_label,
                                event_type=EventType.LOITERING,
                                time_str=time_str,
                                confidence=conf,
                                location=f"{z_name} [DWELL {int(dwell)}s]",
                                metadata={
                                    "zone_id": z_id,
                                    "zone_name": z_name,
                                    "zone_type": z_type,
                                    "dwell_seconds": round(dwell, 1),
                                    "box": box,
                                },
                                track=track,
                                zone_type=z_type,
                            )

            # ── ZONE EXIT ──
            exited = track.current_zones - active_zone_ids
            for z_id in exited:
                z_type = track.zone_type_map.get(z_id, "UNKNOWN")
                track.current_zones.discard(z_id)
                track.zone_entry_times.pop(z_id, None)
                track.loiter_fired_zones.discard(z_id)
                track.context.active_zones.discard(z_id)

                self._record_and_dispatch(
                    camera_id=camera_id,
                    entity_label=entity_label,
                    event_type=EventType.ZONE_EXIT,
                    time_str=time_str,
                    confidence=conf,
                    location=f"Zone {z_id} boundary",
                    metadata={"zone_id": z_id, "zone_type": z_type, "box": box},
                    track=track,
                    zone_type=z_type,
                )

        # Purge stale tracks (>30s unseen)
        stale = [k for k, trk in self.tracks.items() if now - trk.last_seen > 30.0]
        for k in stale:
            del self.tracks[k]

    # ── Zone contour builder ───────────────────
    def _build_zone_contours(
        self, zones: List[Dict[str, Any]], w: int, h: int
    ) -> List[Dict[str, Any]]:
        result = []
        for z in zones:
            pts = z.get("points_json", [])
            if not pts or len(pts) < 3:
                continue
            try:
                parsed = []
                for p in pts:
                    if isinstance(p, dict):
                        px, py = float(p.get("x", 0)), float(p.get("y", 0))
                    elif isinstance(p, (list, tuple)) and len(p) >= 2:
                        px, py = float(p[0]), float(p[1])
                    else:
                        continue
                    # Normalize: accept 0-100 (percentage) or 0.0-1.0
                    if px > 1.0:
                        px /= 100.0
                    if py > 1.0:
                        py /= 100.0
                    parsed.append([int(px * w), int(py * h)])

                if len(parsed) >= 3:
                    result.append({
                        "id": z.get("id"),
                        "name": z.get("name", "Zone"),
                        "type": z.get("type", ZoneType.RESTRICTED),
                        "contour": np.array(parsed, dtype=np.int32),
                    })
            except Exception:
                continue
        return result

    # ── ANPR event handler ─────────────────────
    def handle_anpr_event(
        self,
        camera_id: str,
        anpr_result: Dict[str, Any],
        track_id: Optional[int] = None,
    ):
        if not anpr_result or not anpr_result.get("plate_detected"):
            return

        now = time.time()
        time_str = anpr_result.get("timestamp") or datetime.datetime.now().strftime("%H:%M:%S")
        plate_number = anpr_result.get("plate_number") or "UNKNOWN"
        conf = float(anpr_result.get("confidence_after", 0.0))

        t_key = (camera_id, track_id if track_id is not None and track_id >= 0 else -1)
        if t_key in self.tracks:
            track = self.tracks[t_key]
            track.context.plate_identity = plate_number
            entity_label = f"VEHICLE #{track_id} [{plate_number}]"
        else:
            virtual_key = (camera_id, 8000 + abs(hash(plate_number)) % 1000)
            if virtual_key not in self.tracks:
                self.tracks[virtual_key] = TrackState(virtual_key[1], "vehicle", camera_id, now)
            track = self.tracks[virtual_key]
            track.context.plate_identity = plate_number
            entity_label = f"VEHICLE [{plate_number}]"

        track.last_seen = now

        self._record_and_dispatch(
            camera_id=camera_id,
            entity_label=entity_label,
            event_type=EventType.PLATE_DETECTED,
            time_str=time_str,
            confidence=conf,
            location=f"Camera {camera_id} checkpoint",
            metadata={
                "plate_number": plate_number,
                "raw_ocr_text": anpr_result.get("raw_ocr_text"),
                "quality_score": anpr_result.get("quality_assessment", {}).get("quality_score"),
                "watchlist_status": anpr_result.get("watchlist_status"),
                "track_id": track_id,
            },
            track=track,
            zone_type=None,
        )

        if anpr_result.get("watchlist_match"):
            track.context.watchlist_plate_match = True
            track.context.authorization_state = AuthorizationState.WATCHLIST_MATCH
            wl = anpr_result.get("watchlist_entry", {})
            self._record_and_dispatch(
                camera_id=camera_id,
                entity_label=entity_label,
                event_type=EventType.WATCHLIST_PLATE_MATCH,
                time_str=time_str,
                confidence=conf,
                location=f"Perimeter checkpoint — {wl.get('title', 'Flagged Vehicle')}",
                metadata={
                    "plate_number": plate_number,
                    "watchlist_id": wl.get("id"),
                    "category": wl.get("category"),
                    "notes": wl.get("notes"),
                },
                track=track,
                zone_type=None,
            )

        # Broadcast ANPR-specific payload
        manager.broadcast_sync({"type": "ANPR_DETECTION", "data": anpr_result})

    # ── Face event handler ─────────────────────
    def handle_face_event(
        self,
        camera_id: str,
        face_result: Dict[str, Any],
        track_id: Optional[int] = None,
    ):
        if not face_result or not face_result.get("enabled"):
            return

        state = face_result.get("state")
        best_match = face_result.get("best_match")
        now = time.time()
        time_str = datetime.datetime.now().strftime("%H:%M:%S")

        t_key = (camera_id, track_id if track_id is not None and track_id >= 0 else -1)
        if t_key not in self.tracks:
            virtual_key = (camera_id, 7000 + (track_id % 1000 if track_id else int(now) % 1000))
            if virtual_key not in self.tracks:
                self.tracks[virtual_key] = TrackState(virtual_key[1], "person", camera_id, now)
            t_key = virtual_key

        track = self.tracks[t_key]
        track.last_seen = now

        # Broadcast biometric HUD update (neutral — always sent)
        manager.broadcast_sync({
            "type": "FACE_RECOGNITION_EVENT",
            "data": {
                "camera_id": camera_id,
                "track_id": track_id,
                "state": state,
                "faces_detected": face_result.get("faces_detected", 0),
                "best_match": best_match,
                "timestamp": time_str,
            },
        })

        if state == "UNVERIFIED":
            track.context.authorization_state = AuthorizationState.UNVERIFIED
            return

        if state == "MATCHED" and best_match:
            identity = best_match.get("matched_identity", {})
            category = identity.get("category", "WATCHLIST")
            name = identity.get("name", "Unknown")
            conf = float(best_match.get("confidence", 0.0))

            track.context.face_identity = name

            if category == "WATCHLIST":
                track.context.watchlist_face_match = True
                track.context.authorization_state = AuthorizationState.WATCHLIST_MATCH
                self._record_and_dispatch(
                    camera_id=camera_id,
                    entity_label=f"WATCHLIST PERSON [{name}]",
                    event_type=EventType.WATCHLIST_FACE_MATCH,
                    time_str=time_str,
                    confidence=conf,
                    location=f"Biometric checkpoint ({camera_id})",
                    metadata={
                        "face_id": identity.get("id"),
                        "name": name,
                        "category": category,
                        "similarity": best_match.get("similarity"),
                        "notes": identity.get("notes"),
                        "box": best_match.get("box_global"),
                    },
                    track=track,
                    zone_type=None,
                )

            elif category in ("AUTHORIZED", "SECURITY_STAFF"):
                track.context.authorization_state = AuthorizationState.AUTHORIZED
                self._record_and_dispatch(
                    camera_id=camera_id,
                    entity_label=f"AUTHORIZED [{name}]",
                    event_type=EventType.AUTHORIZED_FACE_VERIFIED,
                    time_str=time_str,
                    confidence=conf,
                    location=f"Access portal ({camera_id})",
                    metadata={"face_id": identity.get("id"), "name": name, "category": category},
                    track=track,
                    zone_type=None,
                )

    # ── Cross-camera handoff (Step 20) ─────────
    def handle_cross_camera_candidate(
        self,
        global_track_id: str,
        from_camera: str,
        to_camera: str,
        similarity_score: float,
        transit_seconds: float,
        entity_type: str = "PERSON",
        snapshot_b64: Optional[str] = None,
        match_status: str = "MATCH",
    ):
        now = time.time()
        time_str = datetime.datetime.now().strftime("%H:%M:%S")
        virtual_key = (to_camera, 9000 + abs(hash(global_track_id)) % 1000)
        if virtual_key not in self.tracks:
            self.tracks[virtual_key] = TrackState(virtual_key[1], entity_type.lower(), to_camera, now)
        track = self.tracks[virtual_key]
        track.last_seen = now

        self._record_and_dispatch(
            camera_id=to_camera,
            entity_label=f"{entity_type.upper()} [{global_track_id}]",
            event_type=EventType.CROSS_CAMERA_CANDIDATE,
            time_str=time_str,
            confidence=similarity_score,
            location=f"Transit: {from_camera} -> {to_camera}",
            metadata={
                "global_track_id": global_track_id,
                "from_camera": from_camera,
                "to_camera": to_camera,
                "similarity_score": round(similarity_score, 3),
                "transit_seconds": round(transit_seconds, 1),
                "snapshot_b64": snapshot_b64,
                "match_status": match_status,
            },
            track=track,
            zone_type=None,
        )
        manager.broadcast_sync({
            "type": "CROSS_CAMERA_CANDIDATE",
            "data": {
                "global_track_id": global_track_id,
                "from_camera": from_camera,
                "to_camera": to_camera,
                "similarity_score": round(similarity_score, 3),
                "transit_seconds": round(transit_seconds, 1),
                "timestamp": time_str,
                "match_status": match_status,
            },
        })

    handle_cross_camera_handoff = handle_cross_camera_candidate

    # ── Record + Dispatch (Step 9 / 14 / 17) ──
    def _record_and_dispatch(
        self,
        camera_id: str,
        entity_label: str,
        event_type: str,
        time_str: str,
        confidence: float,
        location: str,
        metadata: Dict[str, Any],
        track: TrackState,
        zone_type: Optional[str],
    ):
        """
        1. Evaluates operational alert level (no threat score).
        2. Persists Event record to DB.
        3. Creates Alert / Incident only when alert level warrants it.
        4. Captures evidence reference where present.
        5. Broadcasts WebSocket event.
        """
        event_id = f"EVT-{uuid.uuid4().hex[:8].upper()}"

        # ── Operational alert evaluation ──
        alert_level, alert_reason = evaluate_alert_level(
            event_type, track.context, zone_type
        )

        # ── Timeline entry ──
        track.timeline.append({
            "time": time_str,
            "camera": camera_id,
            "event": f"{event_type.replace('_', ' ').title()}: {location}",
            "alert_level": alert_level,
        })

        db = SessionLocal()
        created_alert_data = None
        created_incident_data = None

        try:
            # 1. Insert Event
            db_event = Event(
                id=event_id,
                event_type=event_type,
                camera_id=camera_id,
                entity_id=entity_label,
                timestamp=time_str,
                confidence=float(confidence),
                location=location,
                metadata_json={
                    **metadata,
                    "alert_level": alert_level,
                    "alert_reason": alert_reason,
                    "authorization_state": track.context.authorization_state,
                    "patrol_session_id": track.context.patrol_session_id,
                },
            )
            db.add(db_event)

            # 2. Create Alert if warranted
            if should_create_alert(alert_level):
                alert_id = f"ALT-{uuid.uuid4().hex[:6].upper()}"
                alert_msg = (
                    f"{event_type.replace('_', ' ').title()} on {camera_id} "
                    f"by {entity_label} at {location}. Context: {alert_reason}"
                )
                db_alert = Alert(
                    id=alert_id,
                    camera=camera_id,
                    title=f"[{alert_level}] {event_type.replace('_', ' ').title()}",
                    severity=alert_level,           # INFO/NOTICE/ALERT/PRIORITY
                    threat_score=0,                 # Retained column — always 0 in Phase 2
                    message=alert_msg,
                    timestamp=time_str,
                )
                db.add(db_alert)
                created_alert_data = {
                    "id": alert_id,
                    "camera": camera_id,
                    "title": db_alert.title,
                    "alert_level": alert_level,
                    "message": alert_msg,
                    "timestamp": time_str,
                }

            # 3. Create/update Incident if warranted
            if should_create_incident(alert_level, track.context):
                evidence_img = (
                    metadata.get("snapshot_b64")
                    or metadata.get("raw_crop_base64")
                    or metadata.get("crop_b64")
                )
                if track.incident_id:
                    db_inc = db.query(Incident).filter(Incident.id == track.incident_id).first()
                    if db_inc:
                        db_inc.timeline = track.timeline
                        db_event.incident_id = db_inc.id
                        if evidence_img:
                            evidence_service.create_evidence_record(
                                db=db,
                                incident_id=db_inc.id,
                                camera_id=camera_id,
                                evidence_type="SNAPSHOT",
                                event_id=event_id,
                                track_id=str(track.track_id),
                                threat_score=0,
                                image_data=evidence_img,
                                metadata_json={"event_type": event_type, "location": location},
                                timestamp_str=time_str,
                            )
                        created_incident_data = {
                            "id": db_inc.id,
                            "title": db_inc.title,
                            "target_entity": entity_label,
                            "alert_level": alert_level,
                            "primary_camera": camera_id,
                            "timestamp": db_inc.timestamp,
                            "status": db_inc.status,
                            "timeline": track.timeline,
                        }
                else:
                    inc_id = f"INC-{datetime.date.today().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
                    track.incident_id = inc_id
                    db_event.incident_id = inc_id
                    inc_title = f"[{alert_level}] {event_type.replace('_', ' ').title()}"
                    db_inc = Incident(
                        id=inc_id,
                        title=inc_title,
                        target_entity=entity_label,
                        threat_score=0,            # Retained column — 0 in Phase 2
                        severity=alert_level,      # Repurposed: alert level
                        primary_camera=camera_id,
                        timestamp=time_str,
                        status="NEW",
                        assigned_to="Duty Officer",
                        threat_factors=[{
                            "alert_level": alert_level,
                            "reason": alert_reason,
                            "authorization_state": track.context.authorization_state,
                        }],
                        timeline=track.timeline,
                        anpr_data={},
                        affected_track_id=str(track.track_id),
                    )
                    db.add(db_inc)
                    db.add(AuditLog(
                        incident_id=inc_id,
                        user="TEJAS AI Engine",
                        action=f"Incident auto-created [{alert_level}] — {event_type} — {alert_reason}",
                        timestamp=time_str,
                        details={"event_type": event_type, "camera_id": camera_id, "reason": alert_reason},
                    ))
                    if evidence_img:
                        evidence_service.create_evidence_record(
                            db=db,
                            incident_id=inc_id,
                            camera_id=camera_id,
                            evidence_type="SNAPSHOT",
                            event_id=event_id,
                            track_id=str(track.track_id),
                            threat_score=0,
                            image_data=evidence_img,
                            metadata_json={"event_type": event_type, "location": location},
                            timestamp_str=time_str,
                        )
                    created_incident_data = {
                        "id": inc_id,
                        "title": inc_title,
                        "target_entity": entity_label,
                        "alert_level": alert_level,
                        "primary_camera": camera_id,
                        "timestamp": time_str,
                        "status": "NEW",
                        "timeline": track.timeline,
                    }

            db.commit()

        except Exception as e:
            db.rollback()
            logger.error(f"DB write failed for event {event_id}: {e}", exc_info=True)
        finally:
            db.close()

        # 4. Broadcast WebSocket event (Step 17)
        ws_payload = {
            "type": "OPERATIONAL_EVENT",
            "event": {
                "id": event_id,
                "event_type": event_type,
                "camera_id": camera_id,
                "entity_id": entity_label,
                "timestamp": time_str,
                "confidence": round(float(confidence), 3),
                "location": location,
                "alert_level": alert_level,
                "alert_reason": alert_reason,
                "authorization_state": track.context.authorization_state,
                "patrol_session_id": track.context.patrol_session_id,
                "metadata": metadata,
            },
            "alert": created_alert_data,
            "incident": created_incident_data,
        }
        manager.broadcast_sync(ws_payload)

        if created_incident_data and created_incident_data.get("status") == "NEW":
            manager.broadcast_sync({
                "type": "NEW_INCIDENT",
                "incident": created_incident_data,
                "alert_level": alert_level,
                "message": f"[{alert_level}] {created_incident_data['id']}: {inc_title if created_incident_data else event_type} on {camera_id}",
            })

        logger.info(
            f"[{alert_level}] {event_type} | {entity_label} | {camera_id} | {location} | {alert_reason}"
        )


# ── Global singleton (Phase 2 — will be replaced by per-camera in Step 19) ──
event_engine = EventEngine()
