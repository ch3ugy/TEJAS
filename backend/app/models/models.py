import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), default="OPERATOR")  # ADMIN, OPERATOR, VIEWER
    full_name = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Camera(Base):
    __tablename__ = "cameras"
    id = Column(String(50), primary_key=True, index=True)
    code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(150), nullable=False)
    location = Column(String(150), nullable=False)
    lat = Column(Float, default=32.7266)
    lng = Column(Float, default=74.8570)
    status = Column(String(20), default="ONLINE")
    fps = Column(Integer, default=30)
    resolution = Column(String(50), default="1920x1080")
    stream_type = Column(String(20), default="RTSP")
    stream_url = Column(String(255), default="")
    ai_enabled = Column(Boolean, default=True)

class Zone(Base):
    __tablename__ = "zones"
    id = Column(String(50), primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    type = Column(String(50), default="RESTRICTED")  # RESTRICTED, SENSITIVE, BORDER, ENTRY, EXIT, CUSTOM
    color = Column(String(20), default="#EF4444")
    camera_code = Column(String(50), index=True)
    threat_weight = Column(Integer, default=30)
    points_json = Column(JSON, default=list)
    rule_triggers = Column(JSON, default=list)
    # Phase 3: 3D fence support — backward compatible (2D is default)
    fence_type = Column(String(10), default="2D")   # "2D" or "3D"
    fence_depth = Column(Float, default=0.0)        # metres (camera-space extrusion depth)

class WatchlistEntry(Base):
    __tablename__ = "watchlist"
    id = Column(String(50), primary_key=True, index=True)
    type = Column(String(20), nullable=False)  # VEHICLE, PERSON
    identifier = Column(String(100), index=True, nullable=False)
    title = Column(String(150), nullable=False)
    threat_level = Column(String(20), default="CRITICAL")  # CRITICAL, HIGH, MEDIUM
    category = Column(String(100), default="Suspected Infiltration")
    date_added = Column(String(50), default="")
    notes = Column(Text, default="")
    last_seen = Column(String(100), default="")
    status = Column(String(50), default="ACTIVE_ALERT")

class ThreatRule(Base):
    __tablename__ = "threat_rules"
    id = Column(String(100), primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    weight = Column(Integer, default=15)
    category = Column(String(50), default="Spatial")
    enabled = Column(Boolean, default=True)
    description = Column(Text, default="")

class Event(Base):
    __tablename__ = "events"
    id = Column(String(100), primary_key=True, index=True)
    event_type = Column(String(100), index=True, nullable=False)
    camera_id = Column(String(50), index=True, nullable=False)
    entity_id = Column(String(50), index=True, nullable=False)
    timestamp = Column(String(50), default="")
    confidence = Column(Float, default=0.94)
    location = Column(String(150), default="")
    metadata_json = Column(JSON, default=dict)
    incident_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Incident(Base):
    __tablename__ = "incidents"
    id = Column(String(100), primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    target_entity = Column(String(100), nullable=False)
    threat_score = Column(Integer, default=0)
    severity = Column(String(20), default="MEDIUM")  # LOW, MEDIUM, HIGH, CRITICAL
    primary_camera = Column(String(50), nullable=False)
    timestamp = Column(String(50), default="")
    status = Column(String(50), default="NEW")  # NEW, ACKNOWLEDGED, INVESTIGATING, RESOLVED
    assigned_to = Column(String(100), default="Duty Officer")
    threat_factors = Column(JSON, default=list)
    timeline = Column(JSON, default=list)
    resolution_notes = Column(Text, nullable=True)
    anpr_data = Column(JSON, default=dict)
    affected_track_id = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class Evidence(Base):
    __tablename__ = "evidence"
    id = Column(String(50), primary_key=True, index=True)
    incident_id = Column(String(100), ForeignKey("incidents.id"), index=True, nullable=False)
    camera_id = Column(String(50), nullable=False)
    event_id = Column(String(100), nullable=True)
    track_id = Column(String(50), nullable=True)
    evidence_type = Column(String(50), default="SNAPSHOT")  # SNAPSHOT, DETECTION_BOX, PLATE_CROP, REID_CROP
    timestamp = Column(String(50), default="")
    threat_score = Column(Integer, default=0)
    file_path = Column(String(255), nullable=True)
    snapshot_base64 = Column(Text, nullable=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Alert(Base):
    __tablename__ = "alerts"
    id = Column(String(100), primary_key=True, index=True)
    incident_id = Column(String(100), ForeignKey("incidents.id"), nullable=True)
    camera = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    severity = Column(String(20), default="MEDIUM")
    threat_score = Column(Integer, default=50)
    message = Column(Text, default="")
    timestamp = Column(String(50), default="")
    acknowledged = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Plate(Base):
    __tablename__ = "plates"
    id = Column(String(50), primary_key=True, index=True)
    plate_number = Column(String(50), index=True, nullable=False)
    vehicle_type = Column(String(100), default="")
    confidence_before = Column(Float, default=0.35)
    confidence_after = Column(Float, default=0.92)
    camera = Column(String(50), default="")
    timestamp = Column(String(50), default="")
    watchlist_status = Column(String(50), default="CLEAR")
    quality_score = Column(String(50), default="")
    applied_enhancements = Column(JSON, default=list)
    raw_crop_base64 = Column(Text, nullable=True)
    restored_crop_base64 = Column(Text, nullable=True)
    raw_ocr_text = Column(String(50), default="")
    quality_metrics = Column(JSON, default=dict)
    threat_score = Column(Integer, default=0)
    track_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column(String(100), nullable=True)
    user = Column(String(100), nullable=False)
    action = Column(String(255), nullable=False)
    timestamp = Column(String(50), default="")
    details = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class GlobalTrack(Base):
    __tablename__ = "global_tracks"
    id = Column(String(50), primary_key=True, index=True)  # e.g. GLOBAL-027
    entity_type = Column(String(50), default="PERSON")      # PERSON or VEHICLE
    status = Column(String(50), default="ACTIVE")          # ACTIVE, TRANSIT, TERMINATED
    first_seen_camera = Column(String(50), nullable=False)
    current_camera = Column(String(50), nullable=False)
    previous_camera = Column(String(50), nullable=True)
    first_seen_time = Column(String(50), default="")
    last_seen_time = Column(String(50), default="")
    threat_score = Column(Integer, default=10)
    severity = Column(String(20), default="LOW")
    total_handoffs = Column(Integer, default=0)
    embedding_summary = Column(JSON, default=dict)
    latest_snapshot_base64 = Column(Text, nullable=True)
    movement_path = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class TrackHandoff(Base):
    __tablename__ = "track_handoffs"
    id = Column(String(50), primary_key=True, index=True)
    global_track_id = Column(String(50), ForeignKey("global_tracks.id"), index=True, nullable=False)
    from_camera = Column(String(50), nullable=False)
    to_camera = Column(String(50), nullable=False)
    local_track_id = Column(Integer, default=-1)
    timestamp = Column(String(50), default="")
    transition_time_seconds = Column(Float, default=0.0)
    similarity_score = Column(Float, default=1.0)
    confidence = Column(Float, default=0.92)
    snapshot_base64 = Column(Text, nullable=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class EnrolledFace(Base):
    __tablename__ = "enrolled_faces"
    id = Column(String(50), primary_key=True, index=True)  # e.g. FACE-001 or FACE-VIKRAM
    name = Column(String(150), nullable=False)
    category = Column(String(50), default="WATCHLIST")      # WATCHLIST, AUTHORIZED, SECURITY_STAFF, VISITOR
    threat_level = Column(String(20), default="CRITICAL")   # CRITICAL, HIGH, MEDIUM, LOW, NEUTRAL
    notes = Column(Text, default="")
    embedding_json = Column(JSON, default=list)             # 128-D float vector
    photo_path = Column(String(255), default="")
    photo_base64 = Column(Text, default="")
    quality_score = Column(Float, default=0.85)
    status = Column(String(50), default="ACTIVE")          # ACTIVE, INACTIVE, FLAGGED
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


