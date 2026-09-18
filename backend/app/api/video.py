"""
TEJAS Video API — Phase 2
Uses CameraManager for multi-camera support.
Backward compatible: defaults to CAM-00 when no camera_id is specified.
"""
from typing import Optional, Any, Dict, List

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.services.camera_manager import camera_manager
from app.services.video_source import VideoSource
from app.config import settings
from app.database import get_db

router = APIRouter(prefix="/video", tags=["Video Pipeline & Live Streams"])


class VideoConfigRequest(BaseModel):
    confidence: Optional[float] = Field(None, ge=0.1, le=0.95)
    processing_fps: Optional[int] = Field(None, ge=5, le=30)
    camera_id: str = "CAM-00"


class VideoTestRequest(BaseModel):
    source: Any = Field(..., description="Webcam index, RTSP URL, or file path")


class VideoSwitchRequest(BaseModel):
    source: Any = Field(..., description="New camera source")
    camera_id: str = "CAM-00"


class CameraStartRequest(BaseModel):
    camera_id: str
    source: Any


# ── MJPEG Stream ──────────────────────────────
@router.get("/feed")
def get_live_video_feed(camera_id: str = Query(default="CAM-00"), db: Session = Depends(get_db)):
    """Real-time annotated MJPEG stream from a camera pipeline."""
    p = camera_manager.get_pipeline(camera_id)
    if p is None:
        # Look up this camera in DB to get its actual stream source
        from app.models.models import Camera
        cam = db.query(Camera).filter(
            (Camera.id == camera_id) | (Camera.code == camera_id)
        ).first()

        if cam is None:
            # Unknown camera — only fall back to webcam for CAM-00
            if camera_id == "CAM-00":
                src = settings.get_resolved_video_source()
                camera_manager.start_camera(camera_id, src)
            else:
                raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found in database")
        else:
            # Use the camera's configured stream source
            stream_type = (cam.stream_type or "").upper()
            if stream_type in ("WEBCAM", "HARDWARE") or not cam.stream_url:
                src = int(cam.stream_url) if (cam.stream_url or "").isdigit() else 0
            else:
                src = cam.stream_url  # RTSP / MP4 / etc.
            camera_manager.start_camera(cam.id, src)
            # Also register by code so both keys work
            if cam.code and cam.code != cam.id:
                p2 = camera_manager.get_pipeline(cam.id)
                if p2:
                    camera_manager._pipelines[cam.code] = p2

        p = camera_manager.get_pipeline(camera_id)

    if p is None:
        raise HTTPException(status_code=503, detail=f"Camera pipeline {camera_id} unavailable")

    return StreamingResponse(
        p.generate_mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ── Telemetry ─────────────────────────────────
@router.get("/telemetry")
def get_video_telemetry(camera_id: str = Query(default="CAM-00")):
    """Returns real-time inference telemetry for a camera."""
    p = camera_manager.get_pipeline(camera_id)
    if p is None:
        return {"camera_id": camera_id, "is_connected": False, "error": "Not running"}
    return p.get_telemetry()


@router.get("/telemetry/all")
def get_all_telemetry():
    """Returns telemetry for all active camera pipelines."""
    return camera_manager.get_all_telemetry()


# ── Status ─────────────────────────────────────
@router.get("/status")
def get_video_status(camera_id: str = Query(default="CAM-00")):
    p = camera_manager.get_pipeline(camera_id)
    if p is None:
        return {"camera_id": camera_id, "status": "NOT_STARTED", "is_connected": False}
    return {
        "camera_id": camera_id,
        "status": "OPERATIONAL" if p.is_connected else "OFFLINE",
        "is_running": p.is_running,
        "is_connected": p.is_connected,
        "source": str(p.source),
        "device": p.device,
        "capture_fps": p.capture_fps,
        "infer_fps": p.infer_fps,
        "inference_ms": p.inference_ms,
    }


# ── Active cameras ─────────────────────────────
@router.get("/cameras/active")
def get_active_cameras():
    return {"active_cameras": camera_manager.list_active()}


# ── Discover local cameras ─────────────────────
@router.get("/discover")
def discover_camera_sources() -> List[Dict[str, Any]]:
    """Discovers available local webcam devices."""
    return VideoSource.probe_local_cameras(max_indices=4)


# ── Test source ────────────────────────────────
@router.post("/test")
def test_camera_source(payload: VideoTestRequest) -> Dict[str, Any]:
    src = payload.source
    if isinstance(src, str) and src.isdigit():
        src = int(src)
    return VideoSource.test_source(src, timeout_seconds=3.0)


# ── Switch source ──────────────────────────────
@router.post("/switch")
def switch_camera_source(payload: VideoSwitchRequest) -> Dict[str, Any]:
    src = payload.source
    if isinstance(src, str) and src.isdigit():
        src = int(src)
    res = camera_manager.switch_source(payload.camera_id, src)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Switch failed"))
    return res


# ── Config ─────────────────────────────────────
@router.post("/config")
def update_video_config(payload: VideoConfigRequest):
    p = camera_manager.get_pipeline(payload.camera_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Camera {payload.camera_id} not running")
    with p.lock:
        if payload.confidence is not None:
            p.confidence_threshold = max(0.1, min(0.95, payload.confidence))
        if payload.processing_fps is not None:
            p.inference_fps = max(5, min(30, payload.processing_fps))
    return {"message": "Config updated", "telemetry": p.get_telemetry()}


# ── Start / Stop single camera ─────────────────
@router.post("/start")
def start_camera_pipeline(payload: CameraStartRequest):
    src = payload.source
    if isinstance(src, str) and src.isdigit():
        src = int(src)
    pipeline = camera_manager.start_camera(payload.camera_id, src)
    return {
        "message": f"Camera {payload.camera_id} started",
        "success": bool(pipeline and pipeline.is_running),
        "camera_id": payload.camera_id,
        "source": str(src),
    }


@router.post("/stop")
def stop_camera_pipeline(camera_id: str = Query(default="CAM-00")):
    camera_manager.stop_camera(camera_id)
    return {"message": f"Camera {camera_id} stopped"}


# ── Reload zones ───────────────────────────────
@router.post("/zones/reload")
def reload_zones(camera_id: Optional[str] = Query(default=None)):
    camera_manager.reload_zones(camera_id)
    return {"message": "Zones reloaded", "camera_id": camera_id or "all"}
