import cv2
import datetime
import logging
import numpy as np
import uuid
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models.models import GlobalTrack, TrackHandoff
from app.services.reid_service import reid_service, encode_crop_to_base64
from app.services.event_engine import event_engine

logger = logging.getLogger("tejas.api.tracking")

router = APIRouter(prefix="/tracking", tags=["Multi-Camera Tracking & Re-ID"])


class TrackingConfigPayload(BaseModel):
    similarity_threshold: Optional[float] = None
    uncertainty_threshold: Optional[float] = None
    max_transit_seconds: Optional[float] = None


class CameraEdgePayload(BaseModel):
    from_camera: str
    to_camera: str
    min_transit_seconds: float = 1.0
    max_transit_seconds: float = 180.0
    is_connected: bool = True
    corridor_name: Optional[str] = None
    bidirectional: bool = True


class StrictModePayload(BaseModel):
    strict_mode: bool


class SimulateTransitPayload(BaseModel):
    from_camera: str = "CAM-00"
    to_camera: str = "CAM-02"
    transit_seconds: float = 12.5
    subject_type: str = "PERSON"
    mode: str = "MATCH"  # "MATCH", "UNCERTAIN", "NO_MATCH"
    subject_outfit: str = "navy_jacket_dark_jeans"



def generate_synthetic_person_crop(outfit: str = "navy_jacket_dark_jeans", variant: int = 0) -> np.ndarray:
    """Generates an authentic person surveillance crop with identifiable clothing patterns."""
    crop = np.zeros((160, 80, 3), dtype=np.uint8)
    
    # Slight background noise
    bg_noise = np.random.normal(30, 5, crop.shape).astype(np.int16)
    crop = np.clip(crop.astype(np.int16) + bg_noise, 0, 255).astype(np.uint8)

    # Head / Face
    cv2.circle(crop, (40, 24), 14, (140, 175, 215), -1) # skin tone
    cv2.ellipse(crop, (40, 18), (14, 10), 0, 0, 180, (20, 20, 30), -1) # dark hair

    if outfit == "navy_jacket_dark_jeans":
        # Upper body: Navy Jacket (BGR: 80, 40, 20) with variant lighting
        b = int(max(40, min(120, 80 + variant * 8)))
        g = int(max(20, min(80, 40 + variant * 4)))
        r = int(max(10, min(50, 20 + variant * 2)))
        cv2.rectangle(crop, (20, 38), (60, 95), (b, g, r), -1)
        # Jacket zipper / details
        cv2.line(crop, (40, 40), (40, 95), (b + 30, g + 30, r + 30), 1)

        # Lower body: Dark Jeans (BGR: 45, 30, 25)
        cv2.rectangle(crop, (24, 96), (38, 148), (45, 30, 25), -1)
        cv2.rectangle(crop, (42, 96), (56, 148), (45, 30, 25), -1)

    elif outfit == "red_hoodie_khaki":
        # Upper body: Bright Red Hoodie (BGR: 30, 30, 210)
        cv2.rectangle(crop, (20, 38), (60, 95), (30, 30, 210), -1)
        # Lower body: Khaki Pants (BGR: 110, 160, 190)
        cv2.rectangle(crop, (24, 96), (38, 148), (110, 160, 190), -1)
        cv2.rectangle(crop, (42, 96), (56, 148), (110, 160, 190), -1)

    else:
        # Grey Overcoat & Black Trousers
        cv2.rectangle(crop, (20, 38), (60, 105), (90, 90, 90), -1)
        cv2.rectangle(crop, (24, 106), (38, 148), (15, 15, 15), -1)
        cv2.rectangle(crop, (42, 106), (56, 148), (15, 15, 15), -1)

    # Footwear
    cv2.rectangle(crop, (22, 148), (38, 156), (15, 15, 15), -1)
    cv2.rectangle(crop, (42, 148), (58, 156), (15, 15, 15), -1)

    # Add realistic optical blur and sensor noise
    crop = cv2.GaussianBlur(crop, (3, 3), 0.6)
    noise = np.random.normal(0, 4, crop.shape).astype(np.int16)
    crop = np.clip(crop.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    return crop


@router.get("/global-tracks")
def get_global_tracks():
    """Returns list of unified global identities across all CCTV nodes."""
    return reid_service.get_all_global_tracks()


@router.get("/global-tracks/{track_id}")
def get_global_track_detail(track_id: str):
    """Returns full multi-camera handoff history and appearance snapshots for an entity."""
    dossier = reid_service.get_track_dossier(track_id)
    if not dossier:
        raise HTTPException(status_code=404, detail=f"Global track {track_id} not found")
    return dossier


@router.post("/config")
def update_tracking_config(payload: TrackingConfigPayload):
    """Configures Re-ID sensitivity thresholds and transit window."""
    reid_service.set_config(
        threshold=payload.similarity_threshold,
        uncertainty_threshold=payload.uncertainty_threshold,
        max_transit=payload.max_transit_seconds
    )
    return {
        "similarity_threshold": reid_service.similarity_threshold,
        "uncertainty_threshold": reid_service.uncertainty_threshold,
        "max_transit_seconds": reid_service.max_transit_seconds,
        "message": "Re-ID configuration updated successfully"
    }


@router.get("/config")
def get_tracking_config():
    """Gets current Re-ID sensitivity and temporal settings."""
    return {
        "similarity_threshold": reid_service.similarity_threshold,
        "uncertainty_threshold": reid_service.uncertainty_threshold,
        "max_transit_seconds": reid_service.max_transit_seconds
    }


@router.get("/topology")
def get_camera_topology():
    """Returns dynamic camera adjacency graph, corridor constraints, and registered nodes."""
    return reid_service.get_topology()


@router.post("/topology/edge")
def set_camera_edge(payload: CameraEdgePayload):
    """Configures or updates a directional or bidirectional transition corridor between cameras."""
    reid_service.set_camera_edge(
        from_cam=payload.from_camera,
        to_cam=payload.to_camera,
        min_transit=payload.min_transit_seconds,
        max_transit=payload.max_transit_seconds,
        is_connected=payload.is_connected,
        corridor_name=payload.corridor_name or "",
        bidirectional=payload.bidirectional
    )
    return {
        "status": "CONFIGURED",
        "edge": payload.model_dump(),
        "topology": reid_service.get_topology()
    }


@router.delete("/topology/edge")
def remove_camera_edge(from_camera: str = Query(...), to_camera: str = Query(...), bidirectional: bool = True):
    """Removes a corridor edge between two cameras in the topology graph."""
    reid_service.remove_camera_edge(from_camera, to_camera, bidirectional)
    return {
        "status": "REMOVED",
        "from_camera": from_camera,
        "to_camera": to_camera,
        "topology": reid_service.get_topology()
    }


@router.post("/topology/strict")
def toggle_strict_mode(payload: StrictModePayload):
    """Toggles strict topology mode (if enabled, unlinked cameras strictly cannot handoff)."""
    reid_service.topology.strict_mode = payload.strict_mode
    return {
        "strict_mode": reid_service.topology.strict_mode,
        "message": f"Strict topology mode {'enabled' if payload.strict_mode else 'disabled'}"
    }


@router.post("/simulate-transit")
def simulate_multi_camera_transit(payload: SimulateTransitPayload):
    """
    Executes an explainable multi-camera transition evaluation:
    1. Ingests Camera A frame with subject crop.
    2. Simulates physical transit across blind-zone to Camera B.
    3. Ingests Camera B frame with appearance variation based on requested mode.
    4. Evaluates physical feasibility via CameraTopology (impossible-transition protection).
    5. Runs genuine Re-ID appearance embedding extraction and cosine similarity matching.
    6. Returns MATCH / UNCERTAIN / NO_MATCH probabilistic categorization without numeric threat scores.
    """
    # 1. Camera A detection
    outfit_a = payload.subject_outfit
    crop_a = generate_synthetic_person_crop(outfit_a, variant=0)
    time_a = (datetime.datetime.now() - datetime.timedelta(seconds=int(payload.transit_seconds))).strftime("%H:%M:%S")

    # Ingest Camera A
    local_id_a = 501
    gid_a, _, _ = reid_service.match_or_create_global_track(
        camera_id=payload.from_camera,
        local_track_id=local_id_a,
        entity_type=payload.subject_type,
        crop_bgr=crop_a,
        box=[120, 80, 200, 240],
        timestamp_str=time_a
    )

    # 2. Camera B detection
    if payload.mode == "MATCH":
        # Same subject with subtle lighting/angle shift (high similarity)
        crop_b = generate_synthetic_person_crop(outfit_a, variant=1)
    elif payload.mode == "UNCERTAIN":
        # Partial similarity shift (e.g. jacket lighting change or minor color delta)
        crop_b = generate_synthetic_person_crop(outfit_a, variant=5)
    else:
        # Completely different subject
        alt_outfit = "red_hoodie_khaki" if outfit_a != "red_hoodie_khaki" else "grey_overcoat"
        crop_b = generate_synthetic_person_crop(alt_outfit, variant=0)

    time_b = datetime.datetime.now().strftime("%H:%M:%S")
    local_id_b = 602

    # Ingest Camera B with topological and temporal checking
    gid_b, is_handoff, match_info = reid_service.match_or_create_global_track(
        camera_id=payload.to_camera,
        local_track_id=local_id_b,
        entity_type=payload.subject_type,
        crop_bgr=crop_b,
        box=[180, 100, 260, 260],
        timestamp_str=time_b,
        transit_dt_override=payload.transit_seconds
    )

    # If cross-camera handoff occurred, dispatch event to operational event engine
    if is_handoff and match_info:
        event_engine.handle_cross_camera_candidate(
            global_track_id=gid_b,
            from_camera=match_info["from_camera"],
            to_camera=match_info["to_camera"],
            similarity_score=match_info["similarity_score"],
            transit_seconds=payload.transit_seconds,
            entity_type=payload.subject_type,
            snapshot_b64=match_info.get("snapshot_b64"),
            match_status=match_info.get("match_status", "MATCH")
        )

    # Compute measured similarity between crops for explainable verification
    emb_a = reid_service.extract_reid_embedding(crop_a)
    emb_b = reid_service.extract_reid_embedding(crop_b)
    measured_sim = reid_service.compute_similarity(emb_a["vector_np"], emb_b["vector_np"])

    match_status = match_info.get("match_status", "MATCH" if is_handoff else "NO_MATCH") if match_info else "NO_MATCH"

    return {
        "success": True,
        "is_matched": is_handoff,
        "match_status": match_status,
        "global_track_id": gid_b,
        "camera_a": payload.from_camera,
        "camera_b": payload.to_camera,
        "transit_seconds": payload.transit_seconds,
        "measured_similarity": round(measured_sim, 3),
        "similarity_threshold": reid_service.similarity_threshold,
        "uncertainty_threshold": reid_service.uncertainty_threshold,
        "match_confidence_pct": round(measured_sim * 100, 1),
        "camera_a_snapshot_b64": encode_crop_to_base64(crop_a),
        "camera_b_snapshot_b64": encode_crop_to_base64(crop_b),
        "camera_a_timestamp": time_a,
        "camera_b_timestamp": time_b,
        "match_info": match_info,
        "message": (
            f"Associated {gid_b} across {payload.from_camera} -> {payload.to_camera} "
            f"(Similarity: {round(measured_sim * 100, 1)}%, Status: {match_status})."
            if is_handoff else
            f"Identity separated ({gid_b}) — appearance similarity {round(measured_sim * 100, 1)}% "
            f"(Status: {match_status})."
        )
    }
