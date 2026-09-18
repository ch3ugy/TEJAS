import datetime
from typing import List, Optional, Any, Dict, Union
from pydantic import BaseModel, Field

# Auth schemas
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    full_name: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True

# Camera schemas
class CameraCreate(BaseModel):
    code: str
    name: str
    location: str
    lat: float = 32.7266
    lng: float = 74.8570
    status: str = "ONLINE"
    fps: int = 30
    resolution: str = "1920x1080"
    stream_type: str = "RTSP"
    stream_url: str = ""
    ai_enabled: bool = True

class CameraUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    status: Optional[str] = None
    fps: Optional[int] = None
    resolution: Optional[str] = None
    stream_type: Optional[str] = None
    stream_url: Optional[str] = None
    ai_enabled: Optional[bool] = None

class CameraResponse(CameraCreate):
    id: str

    class Config:
        from_attributes = True

# Zone schemas
class ZoneCreate(BaseModel):
    name: str
    type: str = "RESTRICTED"
    color: str = "#EF4444"
    camera_code: str
    threat_weight: int = 30
    points_json: List[Dict[str, Any]] = []
    rule_triggers: List[str] = []
    fence_type: str = "2D"     # "2D" or "3D"
    fence_depth: float = 0.0  # metres (camera-space extrusion depth, relevant for 3D)

class ZoneUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    color: Optional[str] = None
    camera_code: Optional[str] = None
    threat_weight: Optional[int] = None
    points_json: Optional[List[Dict[str, Any]]] = None
    rule_triggers: Optional[List[str]] = None
    fence_type: Optional[str] = None
    fence_depth: Optional[float] = None

class ZoneResponse(ZoneCreate):
    id: str

    class Config:
        from_attributes = True

# Event schemas
class EventCreate(BaseModel):
    event_type: str
    camera_id: str
    entity_id: str
    confidence: float = 0.94
    location: str = ""
    metadata_json: Dict[str, Any] = {}

class EventResponse(EventCreate):
    id: str
    timestamp: str

    class Config:
        from_attributes = True

# Evidence schemas
class EvidenceResponse(BaseModel):
    id: str
    incident_id: str
    camera_id: str
    event_id: Optional[str] = None
    track_id: Optional[str] = None
    evidence_type: str = "SNAPSHOT"
    timestamp: str
    threat_score: int = 0
    file_path: Optional[str] = None
    snapshot_base64: Optional[str] = None
    metadata_json: Dict[str, Any] = {}

    class Config:
        from_attributes = True

# Audit Log schemas
class AuditLogResponse(BaseModel):
    id: int
    incident_id: Optional[str] = None
    user: str
    action: str
    timestamp: str
    details: Dict[str, Any] = {}
    created_at: Optional[datetime.datetime] = None

    class Config:
        from_attributes = True

# Incident schemas
class IncidentAction(BaseModel):
    status: Optional[str] = None
    comment: Optional[str] = None
    user: Optional[str] = "Duty Operator"
    action_type: Optional[str] = "STATUS_UPDATE"
    resolution_notes: Optional[str] = None
    assigned_to: Optional[str] = None

class IncidentResponse(BaseModel):
    id: str
    title: str
    target_entity: str
    threat_score: int
    severity: str
    primary_camera: str
    timestamp: str
    status: str
    assigned_to: str
    threat_factors: List[Dict[str, Any]] = []
    timeline: List[Dict[str, Any]] = []
    resolution_notes: Optional[str] = None
    anpr_data: Optional[Dict[str, Any]] = {}
    affected_track_id: Optional[str] = None
    created_at: Optional[datetime.datetime] = None
    updated_at: Optional[datetime.datetime] = None

    class Config:
        from_attributes = True

class IncidentDetailResponse(IncidentResponse):
    evidence: List[EvidenceResponse] = []
    audit_logs: List[AuditLogResponse] = []
    triggering_events: List[Dict[str, Any]] = []

# Alert schemas
class AlertResponse(BaseModel):
    id: str
    camera: str
    title: str
    severity: str
    threat_score: int
    message: str
    timestamp: str
    acknowledged: bool

    class Config:
        from_attributes = True

# Watchlist schemas
class WatchlistCreate(BaseModel):
    type: str
    identifier: str
    title: str
    threat_level: str = "CRITICAL"
    category: str = "Suspected Infiltration"
    notes: str = ""

class WatchlistResponse(WatchlistCreate):
    id: str
    date_added: str
    last_seen: str
    status: str

    class Config:
        from_attributes = True

# Threat Rule schemas
class ThreatRuleResponse(BaseModel):
    id: str
    name: str
    weight: int
    category: str
    enabled: bool
    description: str

    class Config:
        from_attributes = True

class ThreatRuleUpdate(BaseModel):
    weight: int
    enabled: Optional[bool] = None

# ANPR & Restoration schemas
class PlateRestoreRequest(BaseModel):
    plate_number: Optional[str] = None
    image_base64: Optional[str] = None
    degradation_type: str = "motion_blur"
    intensity: float = 0.75

class PlateRestoreResponse(BaseModel):
    plate_number: str
    raw_ocr_text: str = ""
    confidence_before: float
    confidence_after: float
    is_restored: bool
    watchlist_match: bool
    watchlist_status: str = "CLEAR"
    watchlist_entry: Optional[Dict[str, Any]] = None
    applied_enhancements: List[str] = []
    raw_crop_base64: Optional[str] = None
    restored_crop_base64: Optional[str] = None
    quality_assessment: Optional[Dict[str, Any]] = None

class ANPRProcessRequest(BaseModel):
    image_base64: Optional[str] = None
    camera_id: str = "CAM-00"
    vehicle_box: Optional[List[int]] = None
    vehicle_type: str = "Vehicle"

class PlateItemResponse(BaseModel):
    id: str
    plate_number: str
    vehicle_type: str = ""
    confidence_before: float = 0.0
    confidence_after: float = 0.0
    camera: str = ""
    timestamp: str = ""
    watchlist_status: str = "CLEAR"
    quality_score: str = ""
    applied_enhancements: List[str] = []
    raw_crop_base64: Optional[str] = None
    restored_crop_base64: Optional[str] = None
    raw_ocr_text: Optional[str] = None
    quality_metrics: Optional[Dict[str, Any]] = None
    threat_score: int = 0
    track_id: Optional[int] = None

    class Config:
        from_attributes = True

# Dynamic Threat Calculation schemas
class ThreatFactorInput(BaseModel):
    factor_id: str
    detected: bool

class ThreatCalculationRequest(BaseModel):
    factors: Union[List[ThreatFactorInput], List[str]]
    custom_weights: Optional[Dict[str, int]] = None

class ThreatCalculationResponse(BaseModel):
    score: int
    severity: str
    breakdown: List[Dict[str, Any]]
    ethical_disclaimer: str

# Modular Face Recognition Schemas
class FaceConfigResponse(BaseModel):
    enabled: bool
    similarity_threshold: float
    min_quality_score: float

class FaceConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    similarity_threshold: Optional[float] = None
    min_quality_score: Optional[float] = None
    user: Optional[str] = "Duty Operator"

class FaceEnrollRequest(BaseModel):
    name: str
    category: str = "WATCHLIST"       # WATCHLIST, AUTHORIZED, SECURITY_STAFF, VISITOR
    threat_level: str = "CRITICAL"    # CRITICAL, HIGH, MEDIUM, LOW, NEUTRAL
    notes: Optional[str] = ""
    image_base64: str                 # Raw or base64 encoded photo
    user: Optional[str] = "Duty Operator"

class EnrolledFaceResponse(BaseModel):
    id: str
    name: str
    category: str
    threat_level: str
    notes: Optional[str] = ""
    photo_base64: Optional[str] = None
    quality_score: float = 0.85
    status: str = "ACTIVE"
    created_at: Optional[datetime.datetime] = None

    class Config:
        from_attributes = True

class FaceRecognitionRequest(BaseModel):
    image_base64: str
    camera_id: str = "CAM-00"
    track_id: Optional[int] = None
    person_box: Optional[List[int]] = None

class FaceRecognitionResponse(BaseModel):
    enabled: bool
    state: str
    faces_detected: int
    detections: List[Dict[str, Any]] = []
    best_match: Optional[Dict[str, Any]] = None
    camera_id: str
    track_id: Optional[int] = None

