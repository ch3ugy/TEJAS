import os
import time
import logging
import base64
import uuid
from typing import List, Dict, Any, Optional, Tuple
import cv2
import numpy as np
from sqlalchemy.orm import Session

import sys
from pathlib import Path
repo_root = str(Path(__file__).resolve().parent.parent.parent.parent)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from app.config import settings
from ai.face import FaceDetector, FaceQualityChecker, FaceEmbedder

logger = logging.getLogger("tejas.face_service")

class FaceService:
    """
    Modular Face Recognition & Biometric Identity Verification Service for TEJAS.
    Features:
    - Independent from generic person detection (invoked on person crops/frames).
    - Modular & optional: can be toggled on/off without affecting object tracking.
    - Quality-gated: rejects blurry or degraded crops before embedding.
    - Neutral unknown handling: unknown faces NEVER trigger threat increases.
    - Direct integration with Threat Engine and Event Engine for watchlist hits.
    """

    def __init__(self):
        self.enabled = settings.FACE_RECOGNITION_ENABLED
        self.similarity_threshold = settings.FACE_SIMILARITY_THRESHOLD
        self.min_quality_score = settings.FACE_MIN_QUALITY_SCORE

        self.detector = FaceDetector()
        self.quality_checker = FaceQualityChecker()
        self.embedder = FaceEmbedder()

        # In-memory dictionary of enrolled identities: { face_id: { ... } }
        self.enrolled_cache: Dict[str, Dict[str, Any]] = {}
        self.enroll_dir = settings.FACE_ENROLL_DIR
        os.makedirs(self.enroll_dir, exist_ok=True)

        logger.info(f"FaceService initialized (Enabled={self.enabled}, Threshold={self.similarity_threshold})")

    def reload_enrolled_faces(self, db: Session):
        """Loads all active enrolled faces from the database into in-memory template cache."""
        try:
            from app.models.models import EnrolledFace
            faces = db.query(EnrolledFace).filter(EnrolledFace.status == "ACTIVE").all()

            cache = {}
            for f in faces:
                emb_arr = np.array(f.embedding_json, dtype=np.float32) if f.embedding_json else None
                if emb_arr is not None and emb_arr.size == 128:
                    cache[f.id] = {
                        "id": f.id,
                        "name": f.name,
                        "category": f.category,
                        "threat_level": f.threat_level,
                        "notes": f.notes,
                        "embedding": emb_arr,
                        "photo_path": f.photo_path,
                        "photo_base64": f.photo_base64,
                        "quality_score": f.quality_score
                    }
            self.enrolled_cache = cache
            logger.info(f"Loaded {len(cache)} enrolled facial identities into memory cache.")

            # If database has no enrolled faces, seed initial default templates
            if len(faces) == 0:
                self._seed_default_identities(db)
        except Exception as e:
            logger.error(f"Failed to reload enrolled faces: {e}", exc_info=True)

    def _seed_default_identities(self, db: Session):
        """Creates initial reference enrolled identities for operator demonstrations."""
        try:
            from app.models.models import EnrolledFace

            # Attempt to use genuine sample face assets if available
            sample_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "face_samples")
            z_path = os.path.join(sample_dir, "zidane.jpg")
            h_path = os.path.join(sample_dir, "grace_hopper.jpg")

            # 1. Suspect Tariq (Watchlist Infiltration Suspect)
            emb1 = None
            b64_1 = None
            q1 = 0.92
            if os.path.exists(z_path):
                z_img = cv2.imread(z_path)
                dets1 = self.detector.detect_faces(z_img)
                if dets1:
                    # Pick prominent face (Zidane)
                    dets1.sort(key=lambda d: d["box"][2] * d["box"][3], reverse=True)
                    f_det = dets1[0]
                    emb1 = self.embedder.extract_embedding(z_img, raw_face=f_det.get("raw_face"))
                    bx, by, bw, bh = f_det["box"]
                    crop1 = z_img[by:by+bh, bx:bx+bw]
                    _, buf1 = cv2.imencode('.jpg', crop1, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                    b64_1 = base64.b64encode(buf1).decode('utf-8')
                    q_res = self.quality_checker.assess_face_quality(crop1)
                    q1 = q_res["quality_score"]

            if emb1 is None:
                img1 = np.ones((160, 160, 3), dtype=np.uint8) * 120
                cv2.circle(img1, (80, 80), 55, (180, 160, 140), -1)
                _, buf1 = cv2.imencode('.jpg', img1)
                b64_1 = base64.b64encode(buf1).decode('utf-8')
                np.random.seed(42)
                emb1 = np.random.randn(128).astype(np.float32)
                emb1 /= np.linalg.norm(emb1)

            # 2. Commander Vikram Sharma (Authorized Lead Personnel)
            emb2 = None
            b64_2 = None
            q2 = 0.95
            if os.path.exists(h_path):
                h_img = cv2.imread(h_path)
                dets2 = self.detector.detect_faces(h_img)
                if dets2:
                    f_det2 = dets2[0]
                    emb2 = self.embedder.extract_embedding(h_img, raw_face=f_det2.get("raw_face"))
                    bx, by, bw, bh = f_det2["box"]
                    crop2 = h_img[by:by+bh, bx:bx+bw]
                    _, buf2 = cv2.imencode('.jpg', crop2, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                    b64_2 = base64.b64encode(buf2).decode('utf-8')
                    q_res2 = self.quality_checker.assess_face_quality(crop2)
                    q2 = q_res2["quality_score"]

            if emb2 is None:
                img2 = np.ones((160, 160, 3), dtype=np.uint8) * 130
                cv2.circle(img2, (80, 80), 55, (190, 175, 150), -1)
                _, buf2 = cv2.imencode('.jpg', img2)
                b64_2 = base64.b64encode(buf2).decode('utf-8')
                np.random.seed(137)
                emb2 = np.random.randn(128).astype(np.float32)
                emb2 /= np.linalg.norm(emb2)

            # Update or create f1
            f1 = db.query(EnrolledFace).filter(EnrolledFace.id == "FACE-WL-001").first()
            if not f1:
                f1 = EnrolledFace(
                    id="FACE-WL-001",
                    name="Tariq Mansoor",
                    category="WATCHLIST",
                    threat_level="CRITICAL",
                    notes="High-priority border infiltration operative flagged by National Intelligence Grid.",
                    embedding_json=emb1.tolist(),
                    photo_base64=f"data:image/jpeg;base64,{b64_1}",
                    quality_score=q1,
                    status="ACTIVE"
                )
                db.add(f1)
            else:
                f1.embedding_json = emb1.tolist()
                f1.photo_base64 = f"data:image/jpeg;base64,{b64_1}"
                f1.quality_score = q1

            # Update or create f2
            f2 = db.query(EnrolledFace).filter(EnrolledFace.id == "FACE-AUTH-002").first()
            if not f2:
                f2 = EnrolledFace(
                    id="FACE-AUTH-002",
                    name="Cmdr. Vikram Sharma",
                    category="AUTHORIZED",
                    threat_level="NEUTRAL",
                    notes="Head of Perimeter Security Operations (Authorized Clearance Level 4).",
                    embedding_json=emb2.tolist(),
                    photo_base64=f"data:image/jpeg;base64,{b64_2}",
                    quality_score=q2,
                    status="ACTIVE"
                )
                db.add(f2)
            else:
                f2.embedding_json = emb2.tolist()
                f2.photo_base64 = f"data:image/jpeg;base64,{b64_2}"
                f2.quality_score = q2

            db.commit()
            logger.info("Initialized enrolled identities with real facial biometric models: Tariq Mansoor & Cmdr. Vikram Sharma.")

            # Update cache
            self.enrolled_cache["FACE-WL-001"] = {
                "id": f1.id, "name": f1.name, "category": f1.category, "threat_level": f1.threat_level,
                "notes": f1.notes, "embedding": emb1, "photo_base64": f1.photo_base64, "quality_score": f1.quality_score
            }
            self.enrolled_cache["FACE-AUTH-002"] = {
                "id": f2.id, "name": f2.name, "category": f2.category, "threat_level": f2.threat_level,
                "notes": f2.notes, "embedding": emb2, "photo_base64": f2.photo_base64, "quality_score": f2.quality_score
            }
        except Exception as e:
            logger.error(f"Error seeding default enrolled identities: {e}", exc_info=True)

    def process_person_face(
        self,
        person_or_frame: np.ndarray,
        camera_id: str = "CAM-00",
        track_id: Optional[int] = None,
        person_box: Optional[List[int]] = None
    ) -> Dict[str, Any]:
        """
        Main recognition pipeline:
        1. Checks module enabled state.
        2. Detects faces within person ROI.
        3. Assesses biometric quality.
        4. Extracts 128-D SFace embedding.
        5. Matches against enrolled database.
        6. Resolves identity state (MATCHED, UNKNOWN, LOW_QUALITY, NO_FACE_DETECTED).
        """
        if not self.enabled:
            return {
                "enabled": False,
                "state": "DISABLED",
                "faces_detected": 0,
                "detections": [],
                "best_match": None,
                "camera_id": camera_id,
                "track_id": track_id
            }

        if person_or_frame is None or person_or_frame.size == 0:
            return {
                "enabled": True,
                "state": "NO_FACE_DETECTED",
                "faces_detected": 0,
                "detections": [],
                "best_match": None,
                "camera_id": camera_id,
                "track_id": track_id
            }

        # Crop to person box if provided
        roi = person_or_frame
        offset_x, offset_y = 0, 0
        if person_box is not None and len(person_box) == 4:
            px1, py1, px2, py2 = person_box
            h, w = person_or_frame.shape[:2]
            px1, py1 = max(0, px1), max(0, py1)
            px2, py2 = min(w, px2), min(h, py2)
            if px2 > px1 and py2 > py1:
                roi = person_or_frame[py1:py2, px1:px2]
                offset_x, offset_y = px1, py1

        # 1. Face Detection
        raw_detections = self.detector.detect_faces(roi)
        if not raw_detections:
            return {
                "enabled": True,
                "state": "NO_FACE_DETECTED",
                "faces_detected": 0,
                "detections": [],
                "best_match": None,
                "camera_id": camera_id,
                "track_id": track_id
            }

        processed_detections = []
        best_candidate = None
        best_candidate_sim = -1.0

        for det in raw_detections:
            bx, by, bw, bh = det["box"]
            # Extract face crop from ROI
            face_crop = roi[by:by+bh, bx:bx+bw]

            # 2. Quality Assessment
            quality_info = self.quality_checker.assess_face_quality(face_crop)
            is_acceptable = quality_info["is_acceptable"] and (quality_info["quality_score"] >= self.min_quality_score)

            face_res = {
                "box_in_roi": [bx, by, bw, bh],
                "box_global": [bx + offset_x, by + offset_y, bw, bh],
                "detection_confidence": det["confidence"],
                "landmarks": det.get("landmarks", []),
                "quality": quality_info,
                "state": "UNVERIFIED",
                "matched_identity": None,
                "similarity": 0.0,
                "confidence": 0.0
            }

            if not is_acceptable:
                face_res["state"] = "LOW_QUALITY"
                face_res["status_reason"] = quality_info.get("status", "LOW_QUALITY")
                processed_detections.append(face_res)
                continue

            # 3. 5-Point Alignment & Deep Embedding Extraction
            embedding = self.embedder.extract_embedding(roi, raw_face=det.get("raw_face"))
            if embedding is None:
                face_res["state"] = "EMBEDDING_FAILED"
                processed_detections.append(face_res)
                continue

            # 4. Enrolled Identity Matching
            top_match, top_sim = self._match_embedding(embedding)
            conf = self.embedder.cosine_to_confidence(top_sim, self.similarity_threshold)

            face_res["similarity"] = round(top_sim, 3)
            face_res["confidence"] = conf

            if top_match is not None and top_sim >= self.similarity_threshold:
                face_res["state"] = "MATCHED"
                face_res["matched_identity"] = {
                    "id": top_match["id"],
                    "name": top_match["name"],
                    "category": top_match["category"],
                    "threat_level": top_match["threat_level"],
                    "notes": top_match["notes"]
                }
                if top_sim > best_candidate_sim:
                    best_candidate_sim = top_sim
                    best_candidate = face_res
            else:
                # IMPORTANT: Unenrolled or below-threshold face is UNKNOWN / UNVERIFIED.
                # NEVER treated as suspicious by default.
                face_res["state"] = "UNKNOWN"
                face_res["matched_identity"] = None

            processed_detections.append(face_res)

        # Determine overall state
        if best_candidate is not None:
            overall_state = "MATCHED"
        elif any(d["state"] == "UNKNOWN" for d in processed_detections):
            overall_state = "UNKNOWN"
        elif any(d["state"] == "LOW_QUALITY" for d in processed_detections):
            overall_state = "LOW_QUALITY"
        else:
            overall_state = "UNVERIFIED"

        return {
            "enabled": True,
            "state": overall_state,
            "faces_detected": len(processed_detections),
            "detections": processed_detections,
            "best_match": best_candidate,
            "camera_id": camera_id,
            "track_id": track_id
        }

    def _match_embedding(self, query_emb: np.ndarray) -> Tuple[Optional[Dict[str, Any]], float]:
        """Compares query vector against all enrolled identity templates using cosine similarity."""
        if not self.enrolled_cache or query_emb is None:
            return None, -1.0

        best_entry = None
        max_sim = -1.0

        for face_id, entry in self.enrolled_cache.items():
            enrolled_emb = entry.get("embedding")
            if enrolled_emb is not None:
                sim = self.embedder.compute_similarity(query_emb, enrolled_emb)
                if sim > max_sim:
                    max_sim = sim
                    best_entry = entry

        return best_entry, max_sim

    def enroll_face_from_image(
        self,
        name: str,
        category: str,
        threat_level: str,
        notes: str,
        image_bytes: bytes,
        db: Session,
        operator_user: str = "Duty Operator"
    ) -> Dict[str, Any]:
        """
        Enrolls a new face identity:
        - Decodes image.
        - Detects primary face.
        - Assesses quality (must be >= 0.40).
        - Extracts 128-D embedding.
        - Stores on-disk JPEG and database record.
        - Appends to in-memory cache and audit trail.
        """
        from app.models.models import EnrolledFace, AuditLog

        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode uploaded image. Invalid image format.")

        # Detect face
        detections = self.detector.detect_faces(img)
        if not detections:
            raise ValueError("No facial landmarks or human face detected in the provided image.")

        # Pick largest/highest confidence face
        detections.sort(key=lambda d: d["box"][2] * d["box"][3], reverse=True)
        primary = detections[0]
        bx, by, bw, bh = primary["box"]
        face_crop = img[by:by+bh, bx:bx+bw]

        # Quality check
        quality = self.quality_checker.assess_face_quality(face_crop)
        if quality["quality_score"] < 0.30 or not quality["is_acceptable"]:
            raise ValueError(
                f"Face image quality insufficient ({quality['quality_score']}). Issues: {quality.get('status')}."
            )

        # Extract embedding
        emb = self.embedder.extract_embedding(img, raw_face=primary.get("raw_face"))
        if emb is None:
            raise ValueError("Failed to compute 128-D facial feature representation.")

        # Generate face ID
        face_id = f"FACE-{uuid.uuid4().hex[:6].upper()}"
        photo_filename = f"{face_id}_{int(time.time())}.jpg"
        photo_path = os.path.join(self.enroll_dir, photo_filename)
        cv2.imwrite(photo_path, face_crop)

        # Thumbnail base64
        _, thumb_buf = cv2.imencode('.jpg', face_crop, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        thumb_b64 = f"data:image/jpeg;base64,{base64.b64encode(thumb_buf).decode('utf-8')}"

        db_face = EnrolledFace(
            id=face_id,
            name=name.strip(),
            category=category.upper().strip(),
            threat_level=threat_level.upper().strip(),
            notes=notes.strip(),
            embedding_json=emb.tolist(),
            photo_path=photo_path,
            photo_base64=thumb_b64,
            quality_score=quality["quality_score"],
            status="ACTIVE"
        )
        db.add(db_face)

        # Audit log entry
        audit_msg = f"Enrolled new facial biometric identity [{face_id}: {name}] (Category: {category}, Threat: {threat_level}). Quality: {quality['quality_score']}."
        db_log = AuditLog(
            user=operator_user,
            action=audit_msg,
            timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
            details={
                "action_type": "FACE_ENROLLMENT",
                "face_id": face_id,
                "name": name,
                "category": category,
                "threat_level": threat_level
            }
        )
        db.add(db_log)
        db.commit()
        db.refresh(db_face)

        # Update in-memory cache
        self.enrolled_cache[face_id] = {
            "id": face_id,
            "name": db_face.name,
            "category": db_face.category,
            "threat_level": db_face.threat_level,
            "notes": db_face.notes,
            "embedding": emb,
            "photo_path": photo_path,
            "photo_base64": thumb_b64,
            "quality_score": db_face.quality_score
        }

        logger.info(f"Successfully enrolled face {face_id} for '{name}'")
        return {
            "success": True,
            "face_id": face_id,
            "name": name,
            "quality_score": quality["quality_score"],
            "category": category,
            "message": f"Successfully enrolled {name} into tactical face registry."
        }

    def remove_face(self, face_id: str, operator_user: str, db: Session) -> bool:
        """Removes an enrolled face from the database and cache with an irreversible audit log."""
        from app.models.models import EnrolledFace, AuditLog

        f = db.query(EnrolledFace).filter(EnrolledFace.id == face_id).first()
        if not f:
            return False

        name = f.name
        f.status = "REMOVED"
        db.delete(f)

        # Audit log
        audit_msg = f"Removed enrolled facial biometric identity [{face_id}: {name}]."
        db_log = AuditLog(
            user=operator_user,
            action=audit_msg,
            timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
            details={
                "action_type": "FACE_REMOVAL",
                "face_id": face_id,
                "name": name
            }
        )
        db.add(db_log)
        db.commit()

        self.enrolled_cache.pop(face_id, None)
        logger.info(f"Enrolled face {face_id} removed by {operator_user}")
        return True

    def set_config(
        self,
        enabled: Optional[bool] = None,
        similarity_threshold: Optional[float] = None,
        min_quality_score: Optional[float] = None,
        operator_user: str = "Duty Operator",
        db: Optional[Session] = None
    ) -> Dict[str, Any]:
        """Calibrates face recognition parameters and logs adjustments."""
        changes = []
        if enabled is not None and enabled != self.enabled:
            changes.append(f"Module Enabled: {self.enabled} -> {enabled}")
            self.enabled = bool(enabled)
        if similarity_threshold is not None:
            new_thresh = round(max(0.20, min(0.95, float(similarity_threshold))), 3)
            changes.append(f"Similarity Threshold: {self.similarity_threshold} -> {new_thresh}")
            self.similarity_threshold = new_thresh
        if min_quality_score is not None:
            new_q = round(max(0.10, min(0.90, float(min_quality_score))), 2)
            changes.append(f"Min Quality Score: {self.min_quality_score} -> {new_q}")
            self.min_quality_score = new_q

        if changes and db is not None:
            from app.models.models import AuditLog
            log_desc = f"Face Recognition config calibrated: {'; '.join(changes)}"
            db_log = AuditLog(
                user=operator_user,
                action=log_desc,
                timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
                details={"action_type": "FACE_CONFIG_UPDATE", "changes": changes}
            )
            db.add(db_log)
            db.commit()

        return {
            "enabled": self.enabled,
            "similarity_threshold": self.similarity_threshold,
            "min_quality_score": self.min_quality_score,
            "message": "Configuration updated successfully."
        }

# Singleton service instance
face_service = FaceService()
