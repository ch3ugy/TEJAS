import logging
import base64
from typing import List, Optional
import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import EnrolledFace
from app.schemas.schemas import (
    FaceConfigResponse,
    FaceConfigUpdate,
    FaceEnrollRequest,
    EnrolledFaceResponse,
    FaceRecognitionRequest,
    FaceRecognitionResponse
)
from app.services.face_service import face_service

logger = logging.getLogger("tejas.api.face")

router = APIRouter(prefix="/face", tags=["Face Recognition"])


@router.get("/config", response_model=FaceConfigResponse)
def get_face_config():
    """Returns runtime configuration of the modular Face Recognition subsystem."""
    return {
        "enabled": face_service.enabled,
        "similarity_threshold": face_service.similarity_threshold,
        "min_quality_score": face_service.min_quality_score
    }


@router.post("/config", response_model=FaceConfigResponse)
def update_face_config(payload: FaceConfigUpdate, db: Session = Depends(get_db)):
    """Calibrates similarity threshold, minimum quality gating, or toggles module on/off."""
    res = face_service.set_config(
        enabled=payload.enabled,
        similarity_threshold=payload.similarity_threshold,
        min_quality_score=payload.min_quality_score,
        operator_user=payload.user or "Duty Operator",
        db=db
    )
    return {
        "enabled": res["enabled"],
        "similarity_threshold": res["similarity_threshold"],
        "min_quality_score": res["min_quality_score"]
    }


@router.get("/enrolled", response_model=List[EnrolledFaceResponse])
def list_enrolled_faces(
    category: Optional[str] = Query(None, description="Filter by category (WATCHLIST, AUTHORIZED, ALL)"),
    db: Session = Depends(get_db)
):
    """Lists all enrolled biometric face identities currently registered in the database."""
    query = db.query(EnrolledFace).filter(EnrolledFace.status == "ACTIVE")
    if category and category.upper() != "ALL":
        query = query.filter(EnrolledFace.category == category.upper().strip())
    
    faces = query.order_by(EnrolledFace.created_at.desc()).all()
    # If database had no faces, ensure seeded cache is reflected
    if not faces:
        face_service.reload_enrolled_faces(db)
        faces = db.query(EnrolledFace).filter(EnrolledFace.status == "ACTIVE").all()

    return faces


@router.post("/enrolled")
def enroll_new_face(payload: FaceEnrollRequest, db: Session = Depends(get_db)):
    """
    Enrolls a new identity into the biometric database:
    1. Validates face detection and landmark presence.
    2. Enforces biometric quality threshold.
    3. Computes 128-D SFace embedding.
    4. Persists physical photo and database record.
    5. Records an irreversible operator action in AuditLog.
    """
    # Clean base64 string
    b64_str = payload.image_base64
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]

    try:
        raw_bytes = base64.b64decode(b64_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 encoded image data.")

    try:
        result = face_service.enroll_face_from_image(
            name=payload.name,
            category=payload.category,
            threat_level=payload.threat_level,
            notes=payload.notes or "",
            image_bytes=raw_bytes,
            db=db,
            operator_user=payload.user or "Duty Operator"
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to enroll face: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error during face enrollment.")


@router.delete("/enrolled/{face_id}")
def remove_enrolled_face(face_id: str, user: str = "Duty Operator", db: Session = Depends(get_db)):
    """Removes an enrolled face identity from the active registry with an audit trail entry."""
    success = face_service.remove_face(face_id, operator_user=user, db=db)
    if not success:
        raise HTTPException(status_code=404, detail=f"Enrolled identity {face_id} not found.")
    return {"success": True, "message": f"Successfully removed identity {face_id}."}


@router.post("/recognize", response_model=FaceRecognitionResponse)
def recognize_face_testbench(payload: FaceRecognitionRequest):
    """
    Evaluates an input image or person crop through the modular face recognition pipeline:
    1. Face detection & landmark localization.
    2. Quality assessment (sharpness, resolution, contrast).
    3. 128-D SFace embedding generation.
    4. Cosine similarity matching against enrolled identities.
    5. Identity resolution (MATCHED, UNKNOWN, LOW_QUALITY, NO_FACE_DETECTED).
    """
    b64_str = payload.image_base64
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]

    try:
        raw_bytes = base64.b64decode(b64_str)
        nparr = np.frombuffer(raw_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image payload.")

    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image from payload.")

    res = face_service.process_person_face(
        img,
        camera_id=payload.camera_id,
        track_id=payload.track_id,
        person_box=payload.person_box
    )

    return res
