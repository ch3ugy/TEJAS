import cv2
import numpy as np
from typing import Dict, Any, Tuple

class FaceQualityChecker:
    """
    Evaluates facial image quality prior to biometric embedding and matching.
    Prevents false matches by rejecting severely degraded, blurry, or low-resolution crops.
    """

    def __init__(
        self,
        min_blur_var: float = 35.0,
        min_face_size: int = 36,
        min_brightness: float = 25.0,
        max_brightness: float = 235.0,
        min_contrast_std: float = 16.0
    ):
        self.min_blur_var = min_blur_var
        self.min_face_size = min_face_size
        self.min_brightness = min_brightness
        self.max_brightness = max_brightness
        self.min_contrast_std = min_contrast_std

    def assess_face_quality(self, face_crop: np.ndarray) -> Dict[str, Any]:
        """
        Calculates biometric quality metrics on a face crop.
        Returns quality_score (0.0 - 1.0), is_acceptable (bool), and diagnostics.
        """
        if face_crop is None or face_crop.size == 0:
            return {
                "quality_score": 0.0,
                "is_acceptable": False,
                "status": "EMPTY_IMAGE",
                "metrics": {}
            }

        h, w = face_crop.shape[:2]

        # 1. Resolution Check
        if h < self.min_face_size or w < self.min_face_size:
            return {
                "quality_score": round(min(h, w) / float(self.min_face_size) * 0.4, 2),
                "is_acceptable": False,
                "status": "TOO_SMALL",
                "metrics": {
                    "width": w,
                    "height": h,
                    "min_required": self.min_face_size
                }
            }

        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop

        # 2. Sharpness / Blur estimation via Laplacian variance
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        blur_var = float(laplacian.var())

        # 3. Brightness and Contrast
        mean_brightness = float(np.mean(gray))
        contrast_std = float(np.std(gray))

        # Check thresholds
        issues = []
        if blur_var < self.min_blur_var:
            issues.append("BLURRY")
        if mean_brightness < self.min_brightness:
            issues.append("UNDEREXPOSED")
        elif mean_brightness > self.max_brightness:
            issues.append("OVEREXPOSED")
        if contrast_std < self.min_contrast_std:
            issues.append("LOW_CONTRAST")

        # Compute normalized composite quality score (0.0 to 1.0)
        # Sharpness score (sigmoidal saturation around 100)
        sharpness_score = min(1.0, blur_var / 120.0)
        
        # Resolution score
        res_score = min(1.0, min(h, w) / 128.0)
        
        # Illumination score
        if 50.0 <= mean_brightness <= 200.0:
            illum_score = 1.0
        elif self.min_brightness <= mean_brightness <= self.max_brightness:
            illum_score = 0.7
        else:
            illum_score = 0.2

        # Contrast score
        contrast_score = min(1.0, contrast_std / 50.0)

        composite_score = round(
            0.40 * sharpness_score +
            0.25 * res_score +
            0.20 * illum_score +
            0.15 * contrast_score,
            3
        )

        is_acceptable = (len(issues) == 0) and (composite_score >= 0.35)

        return {
            "quality_score": composite_score,
            "is_acceptable": is_acceptable,
            "status": "PASS" if is_acceptable else issues[0] if issues else "LOW_QUALITY",
            "issues": issues,
            "metrics": {
                "sharpness_var": round(blur_var, 1),
                "resolution": f"{w}x{h}",
                "mean_brightness": round(mean_brightness, 1),
                "contrast_std": round(contrast_std, 1)
            }
        }
