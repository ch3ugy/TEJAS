"""
TEJAS Video Pipeline — Phase 2 Compatibility Shim
The old singleton `pipeline` is replaced by CameraManager.
This module provides a backward-compatible `pipeline` proxy
for any code that still imports from app.services.video_pipeline.

New code should import from app.services.camera_manager.
"""
import logging
from typing import Any, Dict

logger = logging.getLogger("tejas.video_pipeline")


class _PipelineProxy:
    """
    Proxy that delegates to the primary CameraManager pipeline (CAM-00).
    Maintains backward compatibility for existing imports.
    """

    @property
    def _p(self):
        from app.services.camera_manager import camera_manager
        return camera_manager.get_pipeline("CAM-00")

    @property
    def is_running(self) -> bool:
        p = self._p
        return p.is_running if p else False

    @property
    def is_connected(self) -> bool:
        p = self._p
        return p.is_connected if p else False

    @property
    def source(self):
        p = self._p
        return p.source if p else 0

    @property
    def device(self):
        p = self._p
        return p.device if p else "cpu"

    @property
    def model_name(self) -> str:
        return "yolov8n.pt"

    @property
    def actual_fps(self) -> float:
        p = self._p
        return p.infer_fps if p else 0.0

    @property
    def infer_fps(self) -> float:
        p = self._p
        return p.infer_fps if p else 0.0

    @property
    def capture_fps(self) -> float:
        p = self._p
        return p.capture_fps if p else 0.0

    @property
    def inference_ms(self) -> float:
        p = self._p
        return p.inference_ms if p else 0.0

    @property
    def active_tracks(self):
        p = self._p
        return p.active_tracks if p else []

    @property
    def camera_code(self) -> str:
        return "CAM-00"

    @property
    def zones(self):
        p = self._p
        return p.zones if p else []

    def get_telemetry(self) -> Dict[str, Any]:
        p = self._p
        if p is None:
            return {
                "camera_id": "CAM-00",
                "is_connected": False,
                "fps": 0.0,
                "infer_fps": 0.0,
                "inference_ms": 0.0,
                "device": "cpu",
            }
        t = p.get_telemetry()
        # Maintain legacy key names
        t.setdefault("fps", t.get("capture_fps", 0.0))
        t.setdefault("counts", t.get("detection_counts", {}))
        t.setdefault("camera_code", "CAM-00")
        t.setdefault("target_classes", ["person", "car", "motorcycle", "bus", "truck"])
        return t

    def start(self):
        from app.services.camera_manager import camera_manager
        from app.config import settings
        if not camera_manager.get_pipeline("CAM-00"):
            src = settings.get_resolved_video_source()
            camera_manager.start_camera("CAM-00", src)

    def stop(self):
        from app.services.camera_manager import camera_manager
        camera_manager.stop_camera("CAM-00")

    def switch_source(self, new_source) -> Dict[str, Any]:
        from app.services.camera_manager import camera_manager
        return camera_manager.switch_source("CAM-00", new_source)

    def reload_zones(self):
        from app.services.camera_manager import camera_manager
        camera_manager.reload_zones("CAM-00")

    def set_config(self, confidence=None, source=None, processing_fps=None):
        from app.services.camera_manager import camera_manager
        p = camera_manager.get_pipeline("CAM-00")
        if p:
            if confidence is not None:
                p.confidence_threshold = max(0.1, min(0.95, float(confidence)))
            if processing_fps is not None:
                p.inference_fps = max(5, min(30, int(processing_fps)))
        if source is not None:
            self.switch_source(source)

    def generate_mjpeg_stream(self):
        p = self._p
        if p:
            yield from p.generate_mjpeg_stream()


# Backward-compatible singleton
pipeline = _PipelineProxy()
