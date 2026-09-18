"""
TEJAS Camera Manager — Phase 2 (Step 19)
Multi-camera pipeline architecture.

Each camera has its own:
  - VideoSource (RTSP / webcam / MP4)
  - YOLO detector
  - ByteTrack tracker
  - Per-camera EventEngine state

Cameras fail independently.
CameraManager is the single entry point for pipeline control.
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import cv2
import numpy as np

try:
    import torch
    _CUDA_AVAILABLE = torch.cuda.is_available()
except ImportError:
    _CUDA_AVAILABLE = False

from ultralytics import YOLO

from app.config import settings
from app.services.video_source import VideoSource
from app.services.reid_service import reid_service

logger = logging.getLogger("tejas.camera_manager")

# ── Target COCO class IDs ──────────────────────
TARGET_CLASS_IDS = [0, 2, 3, 5, 7]  # person, car, motorcycle, bus, truck
YOLO_MODEL_PATH: Optional[str] = None


def _resolve_model_path() -> str:
    global YOLO_MODEL_PATH
    if YOLO_MODEL_PATH:
        return YOLO_MODEL_PATH
    candidates = [
        Path("yolov8n.pt"),
        Path(__file__).resolve().parent.parent.parent / "yolov8n.pt",
        Path(__file__).resolve().parent.parent.parent.parent / "yolov8n.pt",
    ]
    for p in candidates:
        if p.exists():
            YOLO_MODEL_PATH = str(p)
            return YOLO_MODEL_PATH
    return "yolov8n.pt"


# ──────────────────────────────────────────────
# CameraPipeline — one per physical/logical camera
# ──────────────────────────────────────────────
class CameraPipeline:
    """
    Independent pipeline for a single camera source.
    Runs 3 threads: Capture / Inference+Annotate / AsyncProtection
    """

    def __init__(
        self,
        camera_id: str,
        source: Union[int, str],
        model_path: str,
        device: str,
        inference_fps: int,
        inference_width: int,
        inference_height: int,
        confidence_threshold: float = 0.35,
    ):
        self.camera_id = camera_id
        self.source = source
        self.model_path = model_path
        self.device = device
        self.inference_fps = max(5, min(30, inference_fps))
        self.inference_width = inference_width
        self.inference_height = inference_height
        self.confidence_threshold = confidence_threshold

        # State
        self.is_running = False
        self.is_connected = False
        self.cap: Optional[cv2.VideoCapture] = None
        self.model: Optional[YOLO] = None

        # Thread synchronization
        self.lock = threading.Lock()
        self.frame_lock = threading.Lock()
        self.new_frame_event = threading.Event()
        self.new_jpeg_event = threading.Event()
        self.event_queue: queue.Queue = queue.Queue(maxsize=10)

        # Buffers
        self.latest_raw_frame: Optional[np.ndarray] = None
        self.latest_jpeg: Optional[bytes] = None
        self.latest_processed_frame: Optional[np.ndarray] = None

        # Telemetry
        self.capture_fps: float = 0.0
        self.infer_fps: float = 0.0
        self.inference_ms: float = 0.0
        self.active_tracks: List[Dict[str, Any]] = []
        self.detection_counts: Dict[str, int] = {"person": 0, "vehicle": 0, "total": 0}
        self.frame_count: int = 0

        # Zone data (camera-specific)
        self.zones: List[Dict[str, Any]] = []

        # Face scan cache
        self.face_cache: Dict[int, Dict[str, Any]] = {}
        self.face_evaluating: set = set()

        # Re-ID result cache — keyed by ByteTrack local_track_id, NOT by the transient
        # per-frame track dict. _run_inference() rebuilds a brand-new list of dicts on
        # every cycle, so a Re-ID result written only onto the dict that was queued for
        # the async worker would vanish the moment the next inference cycle replaces
        # self.active_tracks (which happens far more often than Re-ID can complete).
        # Caching by track_id lets every subsequent frame re-attach the already-known
        # persistent identity immediately, instead of only the one frame it was computed on.
        self.reid_cache: Dict[int, Dict[str, Any]] = {}
        self.reid_cache_lock = threading.Lock()

        # Thread handles
        self._capture_thread: Optional[threading.Thread] = None
        self._inference_thread: Optional[threading.Thread] = None
        self._async_thread: Optional[threading.Thread] = None

    def load_model(self) -> bool:
        try:
            self.model = YOLO(self.model_path)
            self.model.to(self.device)
            logger.info(f"[{self.camera_id}] YOLO loaded on {self.device}")
            return True
        except Exception as e:
            logger.error(f"[{self.camera_id}] Model load failed: {e}")
            self.model = None
            return False

    def reload_zones(self):
        """Loads zones from DB that belong to this camera (matching id or code)."""
        try:
            from app.database import SessionLocal
            from app.models.models import Zone, Camera
            db = SessionLocal()
            cam_row = db.query(Camera).filter(
                (Camera.id == self.camera_id) | (Camera.code == self.camera_id)
            ).first()
            target_codes = {self.camera_id}
            if cam_row:
                if cam_row.id:
                    target_codes.add(cam_row.id)
                if cam_row.code:
                    target_codes.add(cam_row.code)

            db_zones = db.query(Zone).filter(Zone.camera_code.in_(target_codes)).all()
            zones_data = [
                {
                    "id": z.id,
                    "name": z.name,
                    "type": z.type,
                    "color": z.color or "#EF4444",
                    "points_json": z.points_json or [],
                    "fence_type": z.fence_type or "2D",
                    "fence_depth": float(z.fence_depth or 0.0),
                    "camera_code": z.camera_code,
                }
                for z in db_zones
            ]
            with self.lock:
                self.zones = zones_data
            db.close()
            logger.info(f"[{self.camera_id}] Loaded {len(zones_data)} zones from DB (codes: {target_codes})")
        except Exception as e:
            logger.warning(f"[{self.camera_id}] Zone reload failed: {e}")

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self._capture_thread = threading.Thread(
            target=self._capture_worker, daemon=True, name=f"Cap-{self.camera_id}"
        )
        self._inference_thread = threading.Thread(
            target=self._inference_worker, daemon=True, name=f"Inf-{self.camera_id}"
        )
        self._async_thread = threading.Thread(
            target=self._async_worker, daemon=True, name=f"Async-{self.camera_id}"
        )
        self._capture_thread.start()
        self._inference_thread.start()
        self._async_thread.start()
        logger.info(f"[{self.camera_id}] Pipeline started — source={self.source}")

    def stop(self):
        self.is_running = False
        self.new_frame_event.set()
        with self.frame_lock:
            if self.cap:
                try:
                    self.cap.release()
                except Exception:
                    pass
                self.cap = None
        self.is_connected = False
        logger.info(f"[{self.camera_id}] Pipeline stopped")

    # ── Thread 1: Capture ──────────────────────
    def _capture_worker(self):
        last_t = time.time()
        reconnect_at = 0.0

        while self.is_running:
            if self.cap is None or not self.cap.isOpened():
                if time.time() > reconnect_at:
                    reconnect_at = time.time() + 3.0
                    with self.frame_lock:
                        self.cap = VideoSource.create_capture(
                            self.source,
                            width=self.inference_width,
                            height=self.inference_height,
                        )
                        connected = self.cap is not None and self.cap.isOpened()
                    if not connected:
                        self._broadcast_camera_status("CAMERA_OFFLINE")
                    else:
                        self.is_connected = True
                        self._broadcast_camera_status("CAMERA_ONLINE")
                time.sleep(0.05)
                continue

            ret, raw = self.cap.read()
            if ret and raw is not None and raw.size > 0:
                self.is_connected = True
                with self.frame_lock:
                    self.latest_raw_frame = raw
                self.new_frame_event.set()
                self.frame_count += 1
                now = time.time()
                dt = now - last_t
                last_t = now
                if dt > 0:
                    self.capture_fps = round(self.capture_fps * 0.85 + (1.0 / dt) * 0.15, 1)
            else:
                self.is_connected = False
                with self.frame_lock:
                    if self.cap:
                        try:
                            self.cap.release()
                        except Exception:
                            pass
                        self.cap = None
                self._broadcast_camera_status("CAMERA_OFFLINE")
                time.sleep(0.1)

    # ── Thread 2: Inference + Annotate ────────
    def _inference_worker(self):
        last_t = time.time()

        while self.is_running:
            loop_start = time.time()
            target_delay = 1.0 / self.inference_fps

            self.new_frame_event.wait(timeout=0.1)
            self.new_frame_event.clear()

            with self.frame_lock:
                frame = self.latest_raw_frame.copy() if self.latest_raw_frame is not None else None

            if frame is None:
                frame = self._fallback_frame()
                tracks_data = []
                inf_ms = 0.0
            else:
                h, w = frame.shape[:2]
                if w != self.inference_width or h != self.inference_height:
                    frame = cv2.resize(frame, (self.inference_width, self.inference_height))
                tracks_data, inf_ms = self._run_inference(frame)

                now = time.time()
                dt = now - last_t
                last_t = now
                if dt > 0:
                    self.infer_fps = round(self.infer_fps * 0.85 + (1.0 / dt) * 0.15, 1)
                self.inference_ms = round(inf_ms, 1)

                if settings.ENABLE_ASYNC_PROTECTION and tracks_data:
                    try:
                        with self.lock:
                            zones_snap = list(self.zones)
                        self.event_queue.put_nowait({
                            "camera_id": self.camera_id,
                            "tracks": tracks_data,
                            "zones": zones_snap,
                            "shape": frame.shape,
                            "frame": frame.copy(),
                        })
                    except queue.Full:
                        pass

            annotated = self._render_hud(frame, tracks_data, inf_ms)
            ret_enc, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 78])
            if ret_enc:
                with self.lock:
                    self.latest_jpeg = buf.tobytes()
                    self.latest_processed_frame = annotated
                self.new_jpeg_event.set()

            elapsed = time.time() - loop_start
            time.sleep(max(0.001, target_delay - elapsed))

    # ── Thread 3: Async Protection ────────────
    def _async_worker(self):
        while self.is_running:
            try:
                item = self.event_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                # Re-ID runs BEFORE the event engine so that ZONE_ENTRY / intrusion
                # events can carry a persistent global_person_id when available.
                # Any failure here must never take down zones/vehicles/ANPR/events.
                if settings.REID_ENABLED:
                    frame_for_crop = item["frame"]
                    fh, fw = frame_for_crop.shape[:2]
                    for ent in item["tracks"]:
                        if ent.get("class_name", "") != "person":
                            continue
                        t_id = ent.get("track_id", -1)
                        if t_id < 0:
                            continue
                        try:
                            x1, y1, x2, y2 = ent["box"]
                            # Clip strictly to the SAME frame the detection box came
                            # from (avoids the classic resized-frame/coordinate-
                            # mismatch bug that breaks Re-ID crops).
                            cx1, cy1 = max(0, min(x1, fw - 1)), max(0, min(y1, fh - 1))
                            cx2, cy2 = max(0, min(x2, fw)), max(0, min(y2, fh))
                            crop = frame_for_crop[cy1:cy2, cx1:cx2] if cx2 > cx1 and cy2 > cy1 else None
                            reid_result = reid_service.resolve_person_identity(
                                camera_id=self.camera_id,
                                local_track_id=t_id,
                                crop_bgr=crop,
                                box=[cx1, cy1, cx2, cy2],
                                frame_shape=(fh, fw),
                            )
                            if reid_result.get("global_id"):
                                ent["global_person_id"] = reid_result["global_id"]
                                ent["reid_status"] = reid_result.get("status")
                                with self.reid_cache_lock:
                                    self.reid_cache[t_id] = {
                                        "global_person_id": reid_result["global_id"],
                                        "reid_status": reid_result.get("status"),
                                    }
                        except Exception as reid_err:
                            logger.debug(f"[{self.camera_id}] Re-ID skipped for track {t_id}: {reid_err}")

                from app.services.event_engine import event_engine
                event_engine.process_frame(
                    item["camera_id"], item["tracks"], item["zones"], item["shape"]
                )
                for ent in item["tracks"]:
                    t_id = ent.get("track_id", -1)
                    if t_id >= 0 and ent.get("class_name", "") == "person":
                        if t_id not in self.face_evaluating:
                            self.face_evaluating.add(t_id)
                            self._trigger_face_scan(item["frame"], t_id, ent["box"])
            except Exception as e:
                logger.debug(f"[{self.camera_id}] Async worker error: {e}")
            finally:
                self.event_queue.task_done()

    def _run_inference(self, frame: np.ndarray) -> tuple[list, float]:
        if self.model is None:
            return [], 0.0
        import time as t
        t0 = t.perf_counter()
        persons, vehicles = 0, 0
        active = []
        try:
            results = self.model.track(
                frame,
                persist=True,
                tracker="bytetrack.yaml",
                conf=self.confidence_threshold,
                classes=TARGET_CLASS_IDS,
                device=self.device,
                verbose=False,
            )
            inf_ms = (t.perf_counter() - t0) * 1000.0
            if results and results[0].boxes is not None:
                for box in results[0].boxes:
                    cls_id = int(box.cls[0].item())
                    cls_name = self.model.names.get(cls_id, f"class_{cls_id}")
                    conf = float(box.conf[0].item())
                    tid = int(box.id[0].item()) if box.id is not None else -1
                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                    if cls_name == "person":
                        persons += 1
                    else:
                        vehicles += 1
                    det = {
                        "track_id": tid,
                        "class_name": cls_name,
                        "confidence": round(conf, 3),
                        "box": [x1, y1, x2, y2],
                        "camera_id": self.camera_id,
                    }
                    if cls_name == "person" and tid >= 0:
                        with self.reid_cache_lock:
                            cached = self.reid_cache.get(tid)
                        if cached:
                            det["global_person_id"] = cached["global_person_id"]
                            det["reid_status"] = cached["reid_status"]
                    active.append(det)
        except Exception as e:
            logger.error(f"[{self.camera_id}] Inference error: {e}")
            return [], 0.0

        # Prune Re-ID cache entries for local track ids ByteTrack is no longer reporting
        # (person left frame / occluded past recovery). Persistent identity itself lives
        # in reid_service's DB-backed gallery, not here — this only forgets the transient
        # local_track_id -> global_id shortcut so a reused/next id doesn't inherit a stale one.
        current_ids = {t["track_id"] for t in active if t.get("class_name") == "person" and t.get("track_id", -1) >= 0}
        with self.reid_cache_lock:
            stale = [k for k in self.reid_cache if k not in current_ids]
            for k in stale:
                del self.reid_cache[k]

        self.active_tracks = active
        self.detection_counts = {"person": persons, "vehicle": vehicles, "total": persons + vehicles}
        return active, inf_ms

    def _trigger_face_scan(self, frame_copy: np.ndarray, track_id: int, box: list):
        def _worker():
            try:
                from app.services.face_service import face_service
                x1, y1, x2, y2 = box
                h_f, w_f = frame_copy.shape[:2]
                pw = int((x2 - x1) * 0.2)
                ph = int((y2 - y1) * 0.2)
                crop = frame_copy[
                    max(0, y1 - ph): min(h_f, y2 + ph),
                    max(0, x1 - pw): min(w_f, x2 + pw),
                ]
                if crop.size > 0:
                    res = face_service.recognize_face(crop)
                    self.face_cache[track_id] = res
                    if res.get("enabled") and res.get("state") in ("MATCHED", "UNVERIFIED"):
                        from app.services.event_engine import event_engine
                        event_engine.handle_face_event(self.camera_id, res, track_id)
            except Exception as e:
                logger.debug(f"[{self.camera_id}] Face scan error: {e}")
            finally:
                self.face_evaluating.discard(track_id)

        threading.Thread(target=_worker, daemon=True).start()

    def _broadcast_camera_status(self, event_type: str):
        from app.websocket.connection_manager import manager
        manager.broadcast_sync({
            "type": event_type,
            "camera_id": self.camera_id,
            "source": str(self.source),
            "timestamp": __import__("datetime").datetime.now().strftime("%H:%M:%S"),
        })
        logger.info(f"[{self.camera_id}] {event_type}")

    def _fallback_frame(self) -> np.ndarray:
        frame = np.zeros((self.inference_height, self.inference_width, 3), dtype=np.uint8)
        frame[:] = (20, 15, 10)
        cv2.putText(
            frame,
            f"[{self.camera_id}] SENSOR OFFLINE",
            (20, self.inference_height // 2),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2,
        )
        cv2.putText(
            frame,
            time.strftime("%Y-%m-%d %H:%M:%S"),
            (20, self.inference_height - 20),
            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 100, 100), 1,
        )
        return frame

    def _render_hud(self, frame: np.ndarray, tracks: list, inf_ms: float) -> np.ndarray:
        canvas = frame.copy()
        h, w = canvas.shape[:2]

        # Draw zones
        with self.lock:
            zones_snap = list(self.zones)
        for z in zones_snap:
            pts = z.get("points_json", [])
            if len(pts) >= 3:
                parsed = []
                for p in pts:
                    if isinstance(p, dict):
                        px, py = float(p.get("x", 0)), float(p.get("y", 0))
                    elif isinstance(p, (list, tuple)) and len(p) >= 2:
                        px, py = float(p[0]), float(p[1])
                    else:
                        continue
                    if px > 1.0:
                        px /= 100.0
                    if py > 1.0:
                        py /= 100.0
                    parsed.append([int(px * w), int(py * h)])
                if len(parsed) >= 3:
                    poly = np.array(parsed, np.int32).reshape((-1, 1, 2))
                    cv2.polylines(canvas, [poly], True, (0, 165, 255), 2)

        # Draw tracks
        for trk in tracks:
            x1, y1, x2, y2 = trk["box"]
            cls = trk["class_name"]
            tid = trk.get("track_id", -1)
            conf = trk.get("confidence", 0.0)
            gpid = trk.get("global_person_id")
            color = (0, 255, 128) if cls == "person" else (255, 180, 0)
            if gpid:
                color = (0, 210, 255) if trk.get("reid_status") == "REIDENTIFIED" else (0, 255, 128)
            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 2)
            base_label = f"{cls.upper()} #{tid} ({int(conf*100)}%)" if tid >= 0 else f"{cls.upper()} ({int(conf*100)}%)"
            label = f"{base_label} [{gpid}]" if gpid else base_label
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1)
            cv2.rectangle(canvas, (x1, max(0, y1 - th - 6)), (x1 + tw + 4, max(0, y1)), color, -1)
            cv2.putText(canvas, label, (x1 + 2, max(th + 2, y1 - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)

        # Header
        hdr = np.zeros((26, w, 3), dtype=np.uint8)
        hdr[:] = (15, 11, 8)
        canvas[0:26] = cv2.addWeighted(canvas[0:26], 0.3, hdr, 0.7, 0)
        sc = (0, 255, 128) if self.is_connected else (0, 0, 255)
        cv2.circle(canvas, (12, 13), 4, sc, -1)
        cv2.putText(canvas, f"TEJAS [{self.camera_id}] | {self.source}", (24, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (240, 240, 240), 1)

        # Footer
        ftr = np.zeros((22, w, 3), dtype=np.uint8)
        ftr[:] = (15, 11, 8)
        canvas[h-22:h] = cv2.addWeighted(canvas[h-22:h], 0.3, ftr, 0.7, 0)
        info = f"YOLOv8+ByteTrack | CAP:{self.capture_fps:.1f} INF:{self.infer_fps:.1f}fps | {inf_ms:.0f}ms | T:{len(tracks)}"
        cv2.putText(canvas, info, (8, h - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 215, 255), 1)

        return canvas

    def get_telemetry(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "camera_id": self.camera_id,
                "source": str(self.source),
                "is_connected": self.is_connected,
                "capture_fps": self.capture_fps,
                "infer_fps": self.infer_fps,
                "inference_ms": self.inference_ms,
                "device": self.device,
                "model": "YOLOv8-N",
                "tracker": "ByteTrack",
                "confidence_threshold": self.confidence_threshold,
                "target_inference_fps": self.inference_fps,
                "detection_counts": self.detection_counts,
                "active_tracks": self.active_tracks,
                "zone_count": len(self.zones),
            }

    def _create_standby_frame(self, message: str = "CONNECTING TO STREAM") -> bytes:
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        # Tactical border
        cv2.rectangle(img, (12, 12), (628, 468), (45, 45, 45), 1)
        cv2.rectangle(img, (16, 16), (624, 464), (30, 30, 30), 1)
        # Tactical crosshairs
        cv2.line(img, (320, 20), (320, 40), (60, 60, 60), 1)
        cv2.line(img, (320, 440), (320, 460), (60, 60, 60), 1)
        cv2.line(img, (20, 240), (40, 240), (60, 60, 60), 1)
        cv2.line(img, (600, 240), (620, 240), (60, 60, 60), 1)
        
        # Header Info
        cv2.putText(img, f"TEJAS NODE: {self.camera_id}", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 210, 255), 2)
        cv2.putText(img, f"SOURCE: {str(self.source)[:45]}", (30, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (170, 170, 170), 1)
        
        # Status Box
        is_connecting = "CONNECTING" in message
        status_color = (0, 180, 255) if is_connecting else (0, 70, 255)
        cv2.putText(img, f"[ {message} ]", (70, 225), cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2)
        cv2.putText(img, "Verify IP camera / phone streaming server is active", (70, 260), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (160, 160, 160), 1)
        
        # Timestamp
        ts = time.strftime("%Y-%m-%d %H:%M:%S UTC")
        cv2.putText(img, ts, (30, 445), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 100, 100), 1)
        
        ret, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes() if ret else b""

    def generate_mjpeg_stream(self):
        last_standby_time = 0.0
        while self.is_running:
            self.new_jpeg_event.wait(timeout=0.1)
            self.new_jpeg_event.clear()
            
            with self.lock:
                jpeg = self.latest_jpeg
                connected = self.is_connected
            now = time.time()
            if jpeg and connected:
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
            else:
                # Send standby frame at ~2 fps so browser immediately displays status instead of spinning
                if now - last_standby_time >= 0.5:
                    status_msg = "CONNECTING TO STREAM" if not connected else "STREAM SYNCING"
                    standby = self._create_standby_frame(status_msg)
                    if standby:
                        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + standby + b"\r\n"
                    last_standby_time = now


# ──────────────────────────────────────────────
# CameraManager — manages N camera pipelines
# ──────────────────────────────────────────────
class CameraManager:
    """
    Singleton manager for all active camera pipelines.
    Each camera pipeline is independent — failures are isolated.
    """

    def __init__(self):
        self._pipelines: Dict[str, CameraPipeline] = {}
        self._lock = threading.Lock()
        self._device = "cuda:0" if _CUDA_AVAILABLE else "cpu"
        self._model_path = _resolve_model_path()
        logger.info(f"CameraManager initialized — device={self._device} model={self._model_path}")

    def _make_pipeline(self, camera_id: str, source: Union[int, str]) -> CameraPipeline:
        p = CameraPipeline(
            camera_id=camera_id,
            source=source,
            model_path=self._model_path,
            device=self._device,
            inference_fps=settings.TARGET_INFERENCE_FPS,
            inference_width=settings.INFERENCE_WIDTH,
            inference_height=settings.INFERENCE_HEIGHT,
        )
        p.load_model()
        p.reload_zones()
        return p

    def start_camera(self, camera_id: str, source: Union[int, str]) -> CameraPipeline:
        with self._lock:
            if camera_id in self._pipelines:
                logger.info(f"Camera {camera_id} already running")
                return self._pipelines[camera_id]
            p = self._make_pipeline(camera_id, source)
            p.start()
            self._pipelines[camera_id] = p
        return p

    def stop_camera(self, camera_id: str):
        with self._lock:
            p = self._pipelines.pop(camera_id, None)
        if p:
            p.stop()

    def stop_all(self):
        with self._lock:
            ids = list(self._pipelines.keys())
        for camera_id in ids:
            self.stop_camera(camera_id)

    def get_pipeline(self, camera_id: str) -> Optional[CameraPipeline]:
        with self._lock:
            return self._pipelines.get(camera_id)

    def list_active(self) -> List[str]:
        with self._lock:
            return list(self._pipelines.keys())

    def get_all_telemetry(self) -> Dict[str, Any]:
        with self._lock:
            pipelines = dict(self._pipelines)
        return {cid: p.get_telemetry() for cid, p in pipelines.items()}

    def reload_zones(self, camera_id: Optional[str] = None):
        with self._lock:
            targets = [camera_id] if camera_id else list(self._pipelines.keys())
        for cid in targets:
            p = self.get_pipeline(cid)
            if p:
                p.reload_zones()

    def switch_source(self, camera_id: str, new_source: Union[int, str]) -> Dict[str, Any]:
        """Test candidate source and swap atomically if successful."""
        test = VideoSource.test_source(new_source, timeout_seconds=3.0)
        if not test.get("success"):
            return {"success": False, "error": test.get("error", "Source test failed")}

        p = self.get_pipeline(camera_id)
        if p is None:
            self.start_camera(camera_id, new_source)
            return {"success": True, "camera_id": camera_id, "source": str(new_source)}

        new_cap = VideoSource.create_capture(new_source, width=p.inference_width, height=p.inference_height)
        if new_cap is None or not new_cap.isOpened():
            return {"success": False, "error": "Could not open new capture handle"}

        with p.frame_lock:
            old_cap = p.cap
            p.cap = new_cap
            p.source = new_source
            p.is_connected = True
            p.active_tracks = []
        if old_cap:
            try:
                old_cap.release()
            except Exception:
                pass

        return {"success": True, "camera_id": camera_id, "source": str(new_source), "resolution": test.get("resolution")}


# ── Global singleton ───────────────────────────
camera_manager = CameraManager()
