import os
import cv2
import base64
import uuid
import datetime
import logging
import numpy as np
from typing import Optional, Dict, Any, Union
from sqlalchemy.orm import Session

from app.config import settings
from app.models.models import Evidence

logger = logging.getLogger("tejas.evidence_service")


class EvidenceService:
    """
    Manages physical storage, directory organization, and DB records for incident evidence.
    Evidence is safely categorized under:
      backend/data/evidence/<incident_id>/<evidence_id>_<type>.jpg
    """

    def __init__(self, base_dir: Optional[str] = None):
        self.base_dir = base_dir or settings.EVIDENCE_DIR
        os.makedirs(self.base_dir, exist_ok=True)
        logger.info(f"EvidenceService initialized with storage root: {self.base_dir}")

    def get_incident_dir(self, incident_id: str) -> str:
        """Returns and creates the dedicated incident directory."""
        # Sanitize incident ID for path traversal prevention
        safe_inc_id = "".join(c for c in incident_id if c.isalnum() or c in ("-", "_"))
        inc_dir = os.path.join(self.base_dir, safe_inc_id)
        os.makedirs(inc_dir, exist_ok=True)
        return inc_dir

    def save_image_to_disk(
        self,
        incident_id: str,
        filename: str,
        image_data: Union[np.ndarray, str, bytes]
    ) -> Optional[str]:
        """
        Saves image data (BGR ndarray, base64 string, or raw bytes) to disk under the incident folder.
        Returns absolute file path.
        """
        try:
            inc_dir = self.get_incident_dir(incident_id)
            safe_filename = "".join(c for c in filename if c.isalnum() or c in ("-", "_", "."))
            file_path = os.path.join(inc_dir, safe_filename)

            if isinstance(image_data, np.ndarray):
                cv2.imwrite(file_path, image_data)
            elif isinstance(image_data, str):
                # Check for base64 prefix
                if "," in image_data:
                    image_data = image_data.split(",", 1)[1]
                img_bytes = base64.b64decode(image_data)
                with open(file_path, "wb") as f:
                    f.write(img_bytes)
            elif isinstance(image_data, bytes):
                with open(file_path, "wb") as f:
                    f.write(image_data)
            else:
                logger.warning(f"Unsupported image data type: {type(image_data)}")
                return None

            return file_path
        except Exception as e:
            logger.error(f"Failed to save evidence image to disk: {e}", exc_info=True)
            return None

    def read_image_base64(self, file_path: str) -> Optional[str]:
        """Reads image from disk and encodes to base64 JPEG format."""
        if not file_path or not os.path.exists(file_path):
            return None
        try:
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
                return f"data:image/jpeg;base64,{encoded}"
        except Exception as e:
            logger.error(f"Failed to read evidence image: {e}")
            return None

    def create_evidence_record(
        self,
        db: Session,
        incident_id: str,
        camera_id: str,
        evidence_type: str = "SNAPSHOT",
        event_id: Optional[str] = None,
        track_id: Optional[str] = None,
        threat_score: int = 50,
        image_data: Optional[Union[np.ndarray, str, bytes]] = None,
        metadata_json: Optional[Dict[str, Any]] = None,
        timestamp_str: Optional[str] = None
    ) -> Optional[Evidence]:
        """
        Saves physical evidence file to disk and creates an Evidence database record.
        """
        now_str = timestamp_str or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        time_slug = datetime.datetime.now().strftime("%H%M%S")
        ev_id = f"EVD-{datetime.date.today().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
        filename = f"{ev_id}_{evidence_type.lower()}_{time_slug}.jpg"

        file_path = None
        preview_b64 = None

        if image_data is not None:
            file_path = self.save_image_to_disk(incident_id, filename, image_data)
            if isinstance(image_data, np.ndarray):
                _, buffer = cv2.imencode('.jpg', image_data, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                preview_b64 = base64.b64encode(buffer).decode('utf-8')
            elif isinstance(image_data, str):
                preview_b64 = image_data.split(",", 1)[-1]

        try:
            ev_record = Evidence(
                id=ev_id,
                incident_id=incident_id,
                camera_id=camera_id,
                event_id=event_id,
                track_id=str(track_id) if track_id is not None else None,
                evidence_type=evidence_type,
                timestamp=now_str,
                threat_score=threat_score,
                file_path=file_path,
                snapshot_base64=preview_b64,
                metadata_json=metadata_json or {}
            )
            db.add(ev_record)
            db.commit()
            db.refresh(ev_record)
            logger.info(f"Stored evidence {ev_id} for incident {incident_id} at {file_path}")
            return ev_record
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to create Evidence record: {e}", exc_info=True)
            return None


evidence_service = EvidenceService()
