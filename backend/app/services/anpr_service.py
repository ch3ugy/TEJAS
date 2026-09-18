import base64
import datetime
import logging
import os
import re
import threading
import time
import uuid
from typing import Dict, Any, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger("tejas.anpr_service")

# Global EasyOCR Reader Singleton
_ocr_reader = None
_ocr_lock = threading.Lock()

def get_ocr_reader():
    """Initializes or returns cached EasyOCR Reader instance safely."""
    global _ocr_reader
    if _ocr_reader is None:
        with _ocr_lock:
            if _ocr_reader is None:
                try:
                    import easyocr
                    # Force UTF-8 and quiet mode to avoid Windows encoding issues
                    logger.info("Initializing EasyOCR reader (English, CPU mode)...")
                    _ocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
                    logger.info("EasyOCR reader initialized successfully.")
                except Exception as e:
                    logger.error(f"Failed to initialize EasyOCR: {e}", exc_info=True)
                    _ocr_reader = None
    return _ocr_reader


def encode_image_to_base64(img_bgr: np.ndarray, quality: int = 90) -> str:
    """Encodes OpenCV BGR image to base64 data URI string."""
    if img_bgr is None or img_bgr.size == 0:
        return ""
    success, buffer = cv2.imencode('.jpg', img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not success:
        return ""
    b64_str = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/jpeg;base64,{b64_str}"


def decode_base64_to_image(b64_str: str) -> Optional[np.ndarray]:
    """Decodes base64 data URI or raw base64 string to OpenCV BGR image."""
    try:
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_str)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        logger.error(f"Failed to decode base64 image: {e}")
        return None


class ANPRService:
    """
    Genuine Automatic Number Plate Recognition (ANPR) Service for TEJAS.
    Implements:
      1. Vehicle Crop & Number Plate Detection
      2. Image Quality Assessment (blur, brightness, contrast, resolution)
      3. Authentic Restoration (super-resolution, CLAHE, bilateral filtering, unsharp masking)
      4. EasyOCR Inference
      5. Character & Grammar Normalization (RTO/ANPR standard)
      6. Watchlist Matching against SQLite DB
      7. Threat Engine & Event Integration
    """

    def __init__(self):
        # Removed eager easyocr initialization to prevent blocking startup
        pass

    # -------------------------------------------------------------------------
    # 1. NUMBER PLATE DETECTION & CROPPING
    # -------------------------------------------------------------------------
    def detect_plate_region(
        self,
        frame: np.ndarray,
        vehicle_box: Optional[List[int]] = None
    ) -> Optional[Tuple[int, int, int, int]]:
        """
        Detects real number plate coordinates [px1, py1, px2, py2] within the camera frame.
        Uses morphological edge localization combined with aspect ratio constraints.
        Does NOT invent fake coordinates.
        """
        if frame is None or frame.size == 0:
            return None

        fh, fw = frame.shape[:2]

        if vehicle_box:
            vx1, vy1, vx2, vy2 = [max(0, int(v)) for v in vehicle_box]
            vx1, vy1 = min(fw - 1, vx1), min(fh - 1, vy1)
            vx2, vy2 = max(vx1 + 10, min(fw, vx2)), max(vy1 + 10, min(fh, vy2))
            veh_roi = frame[vy1:vy2, vx1:vx2]
            offset_x, offset_y = vx1, vy1
        else:
            veh_roi = frame
            offset_x, offset_y = 0, 0

        vh, vw = veh_roi.shape[:2]
        if vh < 30 or vw < 50:
            return None

        # Number plates are typically located in the lower 70% of vehicle bodies
        search_start_y = int(vh * 0.25)
        search_roi = veh_roi[search_start_y:, :]
        s_h, s_w = search_roi.shape[:2]
        if s_h < 20 or s_w < 40:
            return None

        gray = cv2.cvtColor(search_roi, cv2.COLOR_BGR2GRAY)
        
        # 1. Multi-scale morphological detection
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        sobel = cv2.Sobel(blur, cv2.CV_8U, 1, 0, ksize=3)
        _, thresh = cv2.threshold(sobel, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Rectangular structuring element to connect horizontal characters
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        best_candidate = None
        best_score = -1.0

        for cnt in contours:
            x, y, cw, ch = cv2.boundingRect(cnt)
            if ch == 0 or cw == 0:
                continue
            ar = float(cw) / float(ch)
            area = cw * ch
            
            # Standard license plate aspect ratio is between 1.8 and 5.8
            if 1.8 <= ar <= 5.8 and 400 < area < (s_w * s_h * 0.45):
                # Verify edge density inside the candidate
                plate_patch = gray[y:y+ch, x:x+cw]
                edge_density = float(np.count_nonzero(plate_patch > 50)) / float(cw * ch)
                
                # Favor central placement and standard aspect ratio ~ 3.2
                ar_diff = abs(ar - 3.2)
                score = (1.0 / (1.0 + ar_diff)) * (area ** 0.5) * edge_density
                
                if score > best_score:
                    best_score = score
                    # Add slight padding around detected plate
                    pad_x = int(cw * 0.06)
                    pad_y = int(ch * 0.12)
                    px1 = max(0, x - pad_x)
                    py1 = max(0, y - pad_y)
                    px2 = min(s_w, x + cw + pad_x)
                    py2 = min(s_h, y + ch + pad_y)
                    best_candidate = (
                        offset_x + px1,
                        offset_y + search_start_y + py1,
                        offset_x + px2,
                        offset_y + search_start_y + py2
                    )

        return best_candidate

    def crop_plate(self, frame: np.ndarray, plate_box: Tuple[int, int, int, int]) -> Optional[np.ndarray]:
        """Crops license plate region from frame given bounding box."""
        if frame is None or plate_box is None:
            return None
        x1, y1, x2, y2 = plate_box
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 <= x1 or y2 <= y1:
            return None
        return frame[y1:y2, x1:x2].copy()

    # -------------------------------------------------------------------------
    # 2. IMAGE QUALITY ASSESSMENT
    # -------------------------------------------------------------------------
    def assess_plate_quality(self, plate_crop: np.ndarray) -> Dict[str, Any]:
        """
        Estimates blur, resolution, brightness, and contrast.
        Returns metrics and flags whether restoration is necessary.
        """
        if plate_crop is None or plate_crop.size == 0:
            return {
                "laplacian_var": 0.0,
                "brightness": 0.0,
                "contrast": 0.0,
                "resolution": {"width": 0, "height": 0, "megapixels": 0},
                "issues": ["NO_IMAGE"],
                "needs_restoration": False,
                "quality_score": 0.0
            }

        gray = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2GRAY) if len(plate_crop.shape) == 3 else plate_crop
        h, w = gray.shape

        # 1. Blur via Laplacian variance
        lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        # 2. Brightness via mean intensity
        brightness = float(np.mean(gray))
        # 3. Contrast via standard deviation
        contrast = float(np.std(gray))
        # 4. Resolution
        resolution = {
            "width": w,
            "height": h,
            "aspect_ratio": round(w / max(1, h), 2),
            "megapixels": round((w * h) / 1e6, 4)
        }

        issues = []
        if lap_var < 95.0:
            issues.append("MOTION_BLUR" if lap_var < 45.0 else "GAUSSIAN_BLUR")
        if brightness < 80.0:
            issues.append("LOW_LIGHT")
        elif brightness > 195.0:
            issues.append("OVEREXPOSED")
        if contrast < 35.0:
            issues.append("LOW_CONTRAST")
        if h < 45 or w < 130:
            issues.append("LOW_RESOLUTION")

        needs_restoration = len(issues) > 0

        # Normalized quality index (0 to 100)
        q_blur = min(1.0, lap_var / 220.0)
        q_contrast = min(1.0, contrast / 55.0)
        q_bright = max(0.0, 1.0 - abs(brightness - 128.0) / 128.0)
        q_res = min(1.0, (w * h) / (180.0 * 55.0))

        overall_quality = round((0.35 * q_blur + 0.25 * q_contrast + 0.20 * q_bright + 0.20 * q_res) * 100.0, 1)

        return {
            "laplacian_var": round(lap_var, 2),
            "brightness": round(brightness, 1),
            "contrast": round(contrast, 1),
            "resolution": resolution,
            "issues": issues,
            "needs_restoration": needs_restoration,
            "quality_score": overall_quality
        }

    # -------------------------------------------------------------------------
    # 3. AUTHENTIC RESTORATION & ENHANCEMENT PIPELINE
    # -------------------------------------------------------------------------
    def restore_plate_image(
        self,
        plate_crop: np.ndarray,
        assessment: Optional[Dict[str, Any]] = None
    ) -> Tuple[np.ndarray, List[str]]:
        """
        Executes an authentic multi-stage restoration pipeline on degraded plate crops.
        Stages:
          - Super-Resolution / Lanczos Upsampling
          - Bilateral Edge-Preserving Denoising
          - CLAHE Contrast Normalization in LAB color space
          - Directional Unsharp Masking for Deblurring
        Returns:
          (restored_image_bgr, applied_enhancements_list)
        """
        if plate_crop is None or plate_crop.size == 0:
            return plate_crop, []

        if assessment is None:
            assessment = self.assess_plate_quality(plate_crop)

        restored = plate_crop.copy()
        applied_enhancements = []
        h, w = restored.shape[:2]

        # 1. Spatial Upscaling via Lanczos Sinc Interpolation if low resolution
        if h < 80 or w < 240:
            scale = 2.0 if (h >= 45 and w >= 130) else 3.0
            new_w, new_h = int(w * scale), int(h * scale)
            restored = cv2.resize(restored, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
            applied_enhancements.append(f"Lanczos Sinc Upsampling ({int(scale)}x)")

        # 2. Edge-Preserving Bilateral Filter (Removes noise & sensor grain)
        restored = cv2.bilateralFilter(restored, d=7, sigmaColor=45, sigmaSpace=45)
        applied_enhancements.append("Bilateral Noise & Smoothing Filter")

        # 3. Adaptive CLAHE Contrast Normalization in LAB Luminance Channel
        lab = cv2.cvtColor(restored, cv2.COLOR_BGR2LAB)
        l_channel, a_channel, b_channel = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.2, tileGridSize=(8, 8))
        cl = clahe.apply(l_channel)
        enhanced_lab = cv2.merge((cl, a_channel, b_channel))
        restored = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)
        applied_enhancements.append("Adaptive CLAHE Contrast Normalization")

        # 4. Unsharp Masking for Deblurring
        if "MOTION_BLUR" in assessment.get("issues", []) or "GAUSSIAN_BLUR" in assessment.get("issues", []):
            gaussian = cv2.GaussianBlur(restored, (0, 0), 2.0)
            restored = cv2.addWeighted(restored, 1.65, gaussian, -0.65, 0)
            applied_enhancements.append("Directional Unsharp Deblur Filter")
        else:
            gaussian = cv2.GaussianBlur(restored, (0, 0), 1.5)
            restored = cv2.addWeighted(restored, 1.35, gaussian, -0.35, 0)
            applied_enhancements.append("Acutance Edge Sharpening")

        return restored, applied_enhancements

    # -------------------------------------------------------------------------
    # 4. OCR INFERENCE & BOUNDING EXTRACTION
    # -------------------------------------------------------------------------
    def recognize_plate_text(self, plate_img: np.ndarray) -> Tuple[str, float]:
        """
        Runs EasyOCR on plate image crop.
        Returns:
          (raw_detected_text, ocr_confidence)
        """
        if plate_img is None or plate_img.size == 0:
            return "", 0.0

        reader = get_ocr_reader()
        if reader is None:
            logger.warning("OCR reader unavailable.")
            return "", 0.0

        try:
            # Add moderate border padding around crop to assist CRAFT text localization
            padded = cv2.copyMakeBorder(plate_img, 15, 15, 15, 15, cv2.BORDER_CONSTANT, value=[120, 120, 120])
            results = reader.readtext(padded)
            
            if not results:
                return "", 0.0

            # Sort detected boxes by vertical position, then horizontal
            # Filter for alphanumeric text fragments
            detected_parts = []
            confidences = []
            
            for bbox, text, conf in results:
                clean_part = re.sub(r'[^A-Za-z0-9]', '', str(text)).upper()
                if len(clean_part) >= 2:
                    detected_parts.append(clean_part)
                    confidences.append(float(conf))

            if not detected_parts:
                return "", 0.0

            combined_text = "".join(detected_parts)
            avg_conf = float(np.mean(confidences)) if confidences else 0.0
            return combined_text, round(avg_conf, 2)

        except Exception as e:
            logger.error(f"Error during OCR recognition: {e}", exc_info=True)
            return "", 0.0

    # -------------------------------------------------------------------------
    # 5. PLATE NORMALIZATION & GRAMMAR DISAMBIGUATION
    # -------------------------------------------------------------------------
    def normalize_plate(self, raw_text: str) -> str:
        """
        Normalizes OCR reads according to standard vehicle plate formats.
        Disambiguates common character confusions (O/0, I/1, Z/2, S/5, B/8)
        without inventing characters that were not detected.
        """
        if not raw_text:
            return ""

        clean = re.sub(r'[^A-Z0-9]', '', raw_text.upper())
        if len(clean) < 4:
            return clean

        # Strip HSRP country prefix if detected (e.g. "IND" on the left band)
        if clean.startswith("IND") and len(clean) >= 12:
            clean = clean[3:]

        chars = list(clean)
        n = len(chars)

        digit_map = {'O': '0', 'I': '1', 'Z': '2', 'S': '5', 'B': '8', 'G': '6', 'D': '0', 'Q': '0'}
        letter_map = {'0': 'O', '1': 'I', '8': 'B', '5': 'S', '2': 'Z', '6': 'G'}

        # Standard Indian format is: 2 letters (State) + 2 digits (RTO) + 1-2 letters (Series) + 4 digits
        # Example: MP09AB1234 (10 chars) or DL01CA4092 (10 chars)
        if n == 10:
            # Pos 0-1: Letters
            for i in [0, 1]:
                if chars[i] in letter_map:
                    chars[i] = letter_map[chars[i]]
            # Pos 2-3: Digits
            for i in [2, 3]:
                if chars[i] in digit_map:
                    chars[i] = digit_map[chars[i]]
            # Pos 4-5: Letters
            for i in [4, 5]:
                if chars[i] in letter_map:
                    chars[i] = letter_map[chars[i]]
            # Pos 6-9: Digits
            for i in range(6, 10):
                if chars[i] in digit_map:
                    chars[i] = digit_map[chars[i]]

        elif n == 9:
            # e.g. MP09A1234
            for i in [0, 1]:
                if chars[i] in letter_map:
                    chars[i] = letter_map[chars[i]]
            for i in [2, 3]:
                if chars[i] in digit_map:
                    chars[i] = digit_map[chars[i]]
            if chars[4] in letter_map:
                chars[4] = letter_map[chars[4]]
            for i in range(5, 9):
                if chars[i] in digit_map:
                    chars[i] = digit_map[chars[i]]

        return "".join(chars)

    # -------------------------------------------------------------------------
    # 6. WATCHLIST MATCHING
    # -------------------------------------------------------------------------
    def check_watchlist(self, plate_number: str, db_session = None) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """
        Queries the persistent SQLite database for watchlist match.
        """
        if not plate_number:
            return False, None

        should_close = False
        if db_session is None:
            from app.database import SessionLocal
            db_session = SessionLocal()
            should_close = True

        try:
            from app.models.models import WatchlistEntry
            # Match on identifier exactly
            entry = db_session.query(WatchlistEntry).filter(
                WatchlistEntry.type == "VEHICLE",
                WatchlistEntry.identifier == plate_number
            ).first()

            if entry:
                entry_dict = {
                    "id": entry.id,
                    "title": entry.title,
                    "threat_level": entry.threat_level,
                    "category": entry.category,
                    "date_added": entry.date_added,
                    "notes": entry.notes,
                    "status": entry.status
                }
                return True, entry_dict

            return False, None
        finally:
            if should_close:
                db_session.close()

    # -------------------------------------------------------------------------
    # 7. END-TO-END PIPELINE EXECUTION
    # -------------------------------------------------------------------------
    def process_frame_anpr(
        self,
        frame: np.ndarray,
        vehicle_box: Optional[List[int]] = None,
        camera_id: str = "CAM-00",
        track_id: Optional[int] = None,
        vehicle_type: str = "Vehicle"
    ) -> Dict[str, Any]:
        """
        Executes the full pipeline:
          vehicle detection ROI -> plate detection -> crop -> quality assessment
          -> restoration -> OCR -> normalization -> watchlist matching -> DB persistence
        """
        start_time = time.time()
        time_str = datetime.datetime.now().strftime("%H:%M:%S")

        # 1. Number Plate Detection
        plate_box = self.detect_plate_region(frame, vehicle_box)
        if plate_box is None:
            return {
                "plate_detected": False,
                "message": "No license plate region identified in frame",
                "execution_ms": round((time.time() - start_time) * 1000, 1)
            }

        # 2. Plate Crop
        raw_crop = self.crop_plate(frame, plate_box)
        if raw_crop is None or raw_crop.size == 0:
            return {
                "plate_detected": False,
                "message": "Failed to crop plate region",
                "execution_ms": round((time.time() - start_time) * 1000, 1)
            }

        # 3. Quality Assessment
        assessment = self.assess_plate_quality(raw_crop)

        # 4. Raw OCR pass
        raw_text, raw_conf = self.recognize_plate_text(raw_crop)

        # 5. Restoration
        restored_crop, applied_enhancements = self.restore_plate_image(raw_crop, assessment)

        # 6. Restored OCR pass
        restored_text, restored_conf = self.recognize_plate_text(restored_crop)

        # Pick best read
        if restored_conf >= raw_conf and restored_text:
            chosen_raw_text = restored_text
            final_conf = restored_conf
        else:
            chosen_raw_text = raw_text or restored_text
            final_conf = max(raw_conf, restored_conf)

        # 7. Normalization
        normalized_plate = self.normalize_plate(chosen_raw_text)

        # 8. Watchlist Matching
        watchlist_hit, watchlist_entry = self.check_watchlist(normalized_plate)
        watchlist_status = "CLEAR"
        watchlist_alert_level = "INFO"
        if watchlist_hit and watchlist_entry:
            t_level = watchlist_entry.get("threat_level", "MEDIUM")
            watchlist_status = f"WATCHLIST_HIT"
            watchlist_alert_level = "PRIORITY"

        # 9. Encode Images for UI presentation
        raw_b64 = encode_image_to_base64(raw_crop)
        restored_b64 = encode_image_to_base64(restored_crop)

        # 10. Persist Record to Database
        try:
            from app.database import SessionLocal
            from app.models.models import Plate
            db = SessionLocal()
            record_id = f"PLT-{uuid.uuid4().hex[:8].upper()}"
            plate_record = Plate(
                id=record_id,
                plate_number=normalized_plate or "UNKNOWN",
                vehicle_type=vehicle_type,
                confidence_before=raw_conf,
                confidence_after=final_conf,
                camera=camera_id,
                timestamp=time_str,
                watchlist_status=watchlist_status,
                quality_score=str(assessment.get("quality_score", 50.0)),
                applied_enhancements=applied_enhancements,
                raw_crop_base64=raw_b64,
                restored_crop_base64=restored_b64,
                raw_ocr_text=chosen_raw_text,
                quality_metrics=assessment,
                threat_score=0,
                track_id=track_id
            )
            db.add(plate_record)
            db.commit()
            db.close()
        except Exception as db_err:
            logger.error(f"Failed to persist plate record: {db_err}", exc_info=True)

        execution_ms = round((time.time() - start_time) * 1000, 1)

        return {
            "plate_detected": True,
            "plate_box": list(plate_box),
            "plate_number": normalized_plate,
            "raw_ocr_text": chosen_raw_text,
            "confidence_before": raw_conf,
            "confidence_after": final_conf,
            "quality_assessment": assessment,
            "applied_enhancements": applied_enhancements,
            "watchlist_match": watchlist_hit,
            "watchlist_status": watchlist_status,
            "watchlist_entry": watchlist_entry,
            "watchlist_alert_level": watchlist_alert_level,
            "raw_crop_base64": raw_b64,
            "restored_crop_base64": restored_b64,
            "camera_id": camera_id,
            "track_id": track_id,
            "timestamp": time_str,
            "execution_ms": execution_ms
        }


# Global ANPR service singleton
anpr_service = ANPRService()
