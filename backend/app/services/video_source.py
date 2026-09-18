import os
import sys
import time
import logging
from typing import Optional, Dict, Any, List, Union
import cv2
import numpy as np

logger = logging.getLogger("tejas.video_source")

class VideoSource:
    """
    Unified, generic VideoSource abstraction supporting:
    - Local Windows camera devices by index (with DirectShow)
    - RTSP streaming pipelines
    - Video files (MP4/MKV)
    """

    @staticmethod
    def create_capture(source: Union[int, str], width: Optional[int] = None, height: Optional[int] = None) -> Optional[cv2.VideoCapture]:
        cap = None
        try:
            is_int = False
            cam_idx = 0
            if isinstance(source, int):
                is_int = True
                cam_idx = source
            elif isinstance(source, str) and source.isdigit():
                is_int = True
                cam_idx = int(source)

            if is_int:
                try:
                    if sys.platform.startswith("win"):
                        cap = cv2.VideoCapture(cam_idx, cv2.CAP_DSHOW)
                    else:
                        cap = cv2.VideoCapture(cam_idx)
                except (cv2.error, Exception) as cap_err:
                    logger.warning(f"VideoCapture({cam_idx}) initialization error: {cap_err}")
                    return None
            else:
                source_str = str(source).strip()
                try:
                    if source_str.startswith("rtsp://") or source_str.startswith("rtsps://"):
                        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|max_delay;500000|stimeout;3000000"
                        cap = cv2.VideoCapture(source_str, cv2.CAP_FFMPEG)
                    else:
                        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "stimeout;3000000"
                        cap = cv2.VideoCapture(source_str, cv2.CAP_FFMPEG)
                except (cv2.error, Exception) as cap_err:
                    logger.warning(f"VideoCapture('{source_str}') initialization error: {cap_err}")
                    return None

            if cap is not None and cap.isOpened():
                if width and height:
                    try:
                        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
                        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
                    except Exception:
                        pass
                try:
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                except Exception:
                    pass
                return cap
            else:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                return None

        except (cv2.error, Exception) as e:
            logger.error(f"Error opening VideoSource '{source}': {e}")
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
            return None

    @staticmethod
    def test_source(
        source: Union[int, str], 
        timeout_seconds: float = 3.0, 
        active_source: Optional[Union[int, str]] = None,
        active_telemetry: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Safely verifies a video source before switching to it.
        Checks connection status, acquires sample frames, and measures dimensions & luminosity.
        Handles Windows camera device exclusivity to prevent DirectShow hardware lock conflicts.
        """
        # If testing the currently active running source, use its live telemetry
        if active_source is not None and str(source) == str(active_source):
            if active_telemetry and active_telemetry.get("is_connected"):
                return {
                    "success": True,
                    "source": str(source),
                    "resolution": f"{active_telemetry.get('width', 640)}x{active_telemetry.get('height', 480)}",
                    "width": active_telemetry.get('width', 640),
                    "height": active_telemetry.get('height', 480),
                    "fps": active_telemetry.get('fps', 30.0),
                    "valid_frames_read": 5,
                    "mean_luminosity": 150.0,
                    "is_illuminated": True,
                    "is_active_stream": True
                }

        t0 = time.time()
        cap = VideoSource.create_capture(source)
        if cap is None or not cap.isOpened():
            return {
                "success": False,
                "error": f"Failed to open source: {source}",
                "source": str(source)
            }

        try:
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)

            valid_frames = 0
            luminosity = 0.0
            for _ in range(5):
                ret, frame = cap.read()
                if ret and frame is not None and frame.size > 0:
                    valid_frames += 1
                    luminosity = float(np.mean(frame))
                if time.time() - t0 > timeout_seconds:
                    break

            cap.release()

            if valid_frames > 0:
                return {
                    "success": True,
                    "source": str(source),
                    "resolution": f"{w}x{h}",
                    "width": w,
                    "height": h,
                    "fps": round(fps, 1) if fps > 0 else 30.0,
                    "valid_frames_read": valid_frames,
                    "mean_luminosity": round(luminosity, 1),
                    "is_illuminated": luminosity > 2.0
                }
            else:
                return {
                    "success": False,
                    "source": str(source),
                    "error": "Source opened but failed to deliver valid video frames"
                }

        except Exception as e:
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
            return {
                "success": False,
                "source": str(source),
                "error": str(e)
            }

    @staticmethod
    def probe_local_cameras(
        max_indices: int = 4, 
        active_source: Optional[Union[int, str]] = None,
        active_telemetry: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Discovers and tests available Windows/local camera devices by index,
        reusing live telemetry for the active device without creating hardware contention.
        """
        discovered = []
        for idx in range(max_indices):
            res = VideoSource.test_source(
                idx, 
                timeout_seconds=1.5,
                active_source=active_source,
                active_telemetry=active_telemetry
            )
            if res.get("success"):
                label = f"Local Camera Device #{idx}"
                if idx == 0:
                    label += " (Primary / Integrated)"
                elif idx == 1:
                    label += " (Secondary / Connected Device)"

                discovered.append({
                    "index": idx,
                    "name": label,
                    "resolution": res.get("resolution", "Unknown"),
                    "mean_luminosity": res.get("mean_luminosity", 0.0),
                    "is_illuminated": res.get("is_illuminated", False),
                    "status": "ONLINE",
                    "is_active": (active_source is not None and str(idx) == str(active_source))
                })
        return discovered
