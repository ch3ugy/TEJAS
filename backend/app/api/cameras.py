import logging
import time
import queue
import re
import threading
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Camera
from app.schemas.schemas import CameraCreate, CameraUpdate, CameraResponse
from app.services.camera_manager import camera_manager
from app.services.reid_service import reid_service
from app.services.video_source import VideoSource

logger = logging.getLogger("tejas.api.cameras")

router = APIRouter(prefix="/cameras", tags=["Cameras"])


class ProbeRequest(BaseModel):
    stream_url: Optional[str] = None
    source_url: Optional[str] = None
    stream_type: str = "RTSP"  # WEBCAM, RTSP, DEMO_MP4, MP4

    @property
    def resolved_url(self) -> str:
        return self.stream_url or self.source_url or ""


def probe_video_source(source_str: str, source_type: str = "RTSP") -> Dict[str, Any]:
    """Tests a camera source and always returns a bounded JSON result."""
    start = time.time()
    source_str = (source_str or "").strip()
    st = (source_type or "").upper()

    if not source_str:
        return {
            "status": "EMPTY_SOURCE",
            "connected": False,
            "reachable": False,
            "latency_ms": 0.0,
            "fps": 0.0,
            "resolution": "--",
            "message": "Stream URL / device index cannot be empty."
        }

    if st in ("WEBCAM", "LOCAL_CAM", "HARDWARE") or source_str.isdigit():
        parsed_source: Any = int(source_str) if source_str.isdigit() else 0
        timeout_seconds = 2.5
    else:
        parsed_source = source_str
        timeout_seconds = 5.0

    result_queue: queue.Queue = queue.Queue(maxsize=1)

    def _probe_worker():
        try:
            result_queue.put(VideoSource.test_source(parsed_source, timeout_seconds=timeout_seconds))
        except Exception as e:
            result_queue.put({"success": False, "error": str(e)})

    worker = threading.Thread(target=_probe_worker, daemon=True, name="CameraProbe")
    worker.start()
    worker.join(timeout_seconds + 1.0)

    latency = round((time.time() - start) * 1000, 1)
    if worker.is_alive():
        return {
            "status": "PROBE_TIMEOUT",
            "connected": False,
            "reachable": False,
            "latency_ms": latency,
            "fps": 0.0,
            "resolution": "--",
            "message": f"Timed out while probing {source_type} source '{source_str}'. Verify the stream URL, phone app, firewall, and Wi-Fi network."
        }

    try:
        test = result_queue.get_nowait()
    except queue.Empty:
        test = {"success": False, "error": "Probe worker ended without a result"}

    if not test.get("success"):
        return {
            "status": "UNREACHABLE",
            "connected": False,
            "reachable": False,
            "latency_ms": latency,
            "fps": 0.0,
            "resolution": "--",
            "message": test.get("error") or f"Could not connect to {source_type} stream at '{source_str}'."
        }

    return {
        "status": "CONNECTED",
        "connected": True,
        "reachable": True,
        "latency_ms": latency,
        "fps": float(test.get("fps") or 30.0),
        "resolution": test.get("resolution") or "--",
        "codec": f"{st} / OPENCV",
        "message": (
            f"Stream probe verified: {test.get('resolution', '--')} "
            f"@ {test.get('fps', 30.0)} FPS ({latency}ms latency)."
        )
    }


def _normalize_camera_code(code: str) -> str:
    normalized = re.sub(r"\s+", "-", (code or "").strip().upper())
    normalized = re.sub(r"[^A-Z0-9_-]", "-", normalized)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    if not normalized:
        raise HTTPException(status_code=422, detail="Camera code cannot be empty")
    return normalized


INITIAL_CAMERAS = [
    {
        "id": "CAM-01",
        "code": "BOP-03",
        "name": "Border Outpost 03 (North Perimeter)",
        "location": "Sector A - Post 3",
        "lat": 32.7266,
        "lng": 74.8570,
        "status": "ONLINE",
        "fps": 30,
        "resolution": "1920x1080",
        "stream_type": "RTSP",
        "stream_url": "rtsp://192.168.1.101:554/ch0",
        "ai_enabled": True
    },
    {
        "id": "CAM-02",
        "code": "BORDER-RD-12",
        "name": "Patrol Road Checkpoint 12",
        "location": "Sector A - Road Access",
        "lat": 32.7289,
        "lng": 74.8612,
        "status": "ONLINE",
        "fps": 30,
        "resolution": "1920x1080",
        "stream_type": "RTSP",
        "stream_url": "rtsp://192.168.1.102:554/ch0",
        "ai_enabled": True
    },
    {
        "id": "CAM-03",
        "code": "BOP-04",
        "name": "Border Outpost 04 (Ammunition Depot)",
        "location": "Sector B - High Security",
        "lat": 32.7315,
        "lng": 74.8645,
        "status": "ONLINE",
        "fps": 28,
        "resolution": "1920x1080",
        "stream_type": "RTSP",
        "stream_url": "rtsp://192.168.1.103:554/ch0",
        "ai_enabled": True
    },
    {
        "id": "CAM-04",
        "code": "RESTRICTED-Z01",
        "name": "Restricted Zone Tactical Camera",
        "location": "Sector B - Perimeter Gate 4",
        "lat": 32.7340,
        "lng": 74.8680,
        "status": "ONLINE",
        "fps": 30,
        "resolution": "1920x1080",
        "stream_type": "RTSP",
        "stream_url": "rtsp://192.168.1.104:554/ch0",
        "ai_enabled": True
    },
    {
        "id": "CAM-05",
        "code": "GATE-01",
        "name": "Main Entry Logistics Gate",
        "location": "Sector C - Commercial Entry",
        "lat": 32.7210,
        "lng": 74.8510,
        "status": "ONLINE",
        "fps": 30,
        "resolution": "1920x1080",
        "stream_type": "RTSP",
        "stream_url": "rtsp://192.168.1.105:554/ch0",
        "ai_enabled": True
    },
    {
        "id": "CAM-06",
        "code": "WAREHOUSE-E",
        "name": "Supply Depot Yard East",
        "location": "Sector C - Logistics Depot",
        "lat": 32.7245,
        "lng": 74.8540,
        "status": "ONLINE",
        "fps": 25,
        "resolution": "1280x720",
        "stream_type": "RTSP",
        "stream_url": "rtsp://192.168.1.106:554/ch0",
        "ai_enabled": True
    }
]


@router.get("", response_model=List[CameraResponse])
def get_cameras(db: Session = Depends(get_db)):
    cams = db.query(Camera).all()
    if not cams:
        for item in INITIAL_CAMERAS:
            db_cam = Camera(**item)
            db.add(db_cam)
        db.commit()
        cams = db.query(Camera).all()
    return cams


@router.get("/{camera_id}", response_model=CameraResponse)
def get_camera(camera_id: str, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter((Camera.id == camera_id) | (Camera.code == camera_id)).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return cam


@router.post("", response_model=CameraResponse)
def create_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    payload_data = payload.model_dump()
    payload_data["code"] = _normalize_camera_code(payload_data["code"])
    payload_data["name"] = payload_data["name"].strip()
    payload_data["location"] = payload_data["location"].strip()
    payload_data["stream_type"] = (payload_data.get("stream_type") or "RTSP").strip().upper()
    payload_data["stream_url"] = (payload_data.get("stream_url") or "").strip()

    if db.query(Camera).filter(Camera.code == payload_data["code"]).first():
        raise HTTPException(status_code=409, detail=f"Camera code '{payload_data['code']}' already exists")

    # Collision-safe ID generation: find max existing numeric ID
    existing_ids = [c.id for c in db.query(Camera.id).all()]
    max_num = 0
    for cid in existing_ids:
        try:
            num = int(cid.replace("CAM-", ""))
            max_num = max(max_num, num)
        except (ValueError, AttributeError):
            pass
    cam_id = f"CAM-{max_num + 1:02d}"
    db_cam = Camera(id=cam_id, **payload_data)
    db.add(db_cam)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        logger.warning("Camera create integrity error: %s", e)
        raise HTTPException(status_code=409, detail="Camera code or ID already exists")
    db.refresh(db_cam)

    # Register into ReID topology
    reid_service.register_camera(db_cam.id)
    reid_service.register_camera(db_cam.code)

    logger.info(f"Registered new camera: {db_cam.id} ({db_cam.code}) - source={db_cam.stream_url}")
    return db_cam


@router.put("/{camera_id}", response_model=CameraResponse)
def update_camera(camera_id: str, payload: CameraUpdate, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter((Camera.id == camera_id) | (Camera.code == camera_id)).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    update_dict = payload.model_dump(exclude_unset=True)
    if "name" in update_dict and update_dict["name"] is not None:
        update_dict["name"] = update_dict["name"].strip()
    if "location" in update_dict and update_dict["location"] is not None:
        update_dict["location"] = update_dict["location"].strip()
    if "stream_type" in update_dict and update_dict["stream_type"] is not None:
        update_dict["stream_type"] = update_dict["stream_type"].strip().upper()
    if "stream_url" in update_dict and update_dict["stream_url"] is not None:
        update_dict["stream_url"] = update_dict["stream_url"].strip()

    for k, v in update_dict.items():
        setattr(cam, k, v)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        logger.warning("Camera update integrity error: %s", e)
        raise HTTPException(status_code=409, detail="Camera update conflicts with an existing record")
    db.refresh(cam)

    # If stream url changed and pipeline is currently running, hot-switch source
    if "stream_url" in update_dict:
        pipeline = camera_manager.get_pipeline(cam.id) or camera_manager.get_pipeline(cam.code)
        if pipeline and pipeline.is_running:
            new_src = cam.stream_url if cam.stream_type != "WEBCAM" else 0
            camera_manager.switch_source(cam.id, new_src)

    return cam


@router.delete("/{camera_id}")
def delete_camera(camera_id: str, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter((Camera.id == camera_id) | (Camera.code == camera_id)).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Stop active pipeline if running
    camera_manager.stop_camera(cam.id)
    camera_manager.stop_camera(cam.code)

    reid_service.topology.unregister_camera(cam.id)
    reid_service.topology.unregister_camera(cam.code)

    db.delete(cam)
    db.commit()
    return {"status": "DELETED", "camera_id": camera_id}


@router.post("/probe")
def probe_arbitrary_stream(payload: ProbeRequest):
    """Tests connectivity to any stream source before creating camera."""
    return probe_video_source(payload.resolved_url, payload.stream_type)


@router.post("/{camera_id}/test")
def test_camera_connection(camera_id: str, db: Session = Depends(get_db)):
    """Tests real stream connection for a registered camera."""
    cam = db.query(Camera).filter((Camera.id == camera_id) | (Camera.code == camera_id)).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    src = cam.stream_url
    if cam.stream_type == "WEBCAM" or not src:
        src = "0"

    result = probe_video_source(src, cam.stream_type)
    result["camera_code"] = cam.code
    result["camera_id"] = cam.id
    return result


@router.post("/{camera_id}/start")
def start_camera_pipeline(camera_id: str, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter((Camera.id == camera_id) | (Camera.code == camera_id)).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    src: Any = cam.stream_url
    if cam.stream_type == "WEBCAM" or not src:
        src = 0

    pipeline = camera_manager.start_camera(cam.id, src)
    return {
        "status": "STARTED" if pipeline.is_running else "FAILED",
        "camera_id": cam.id,
        "source": str(src)
    }


@router.post("/{camera_id}/stop")
def stop_camera_pipeline(camera_id: str, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter((Camera.id == camera_id) | (Camera.code == camera_id)).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    camera_manager.stop_camera(cam.id)
    return {"status": "STOPPED", "camera_id": cam.id}


@router.post("/{camera_id}/restart")
def restart_camera_pipeline(camera_id: str, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter((Camera.id == camera_id) | (Camera.code == camera_id)).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    camera_manager.stop_camera(cam.id)
    time.sleep(0.5)

    src: Any = cam.stream_url
    if cam.stream_type == "WEBCAM" or not src:
        src = 0

    pipeline = camera_manager.start_camera(cam.id, src)
    return {
        "status": "RESTARTED",
        "camera_id": cam.id,
        "is_running": pipeline.is_running
    }
