import os
import logging
from typing import List, Dict, Any, Optional, Tuple
import cv2
import numpy as np

logger = logging.getLogger("tejas.face_detector")

class FaceDetector:
    """
    Modular Face Detection component for TEJAS.
    Primary detector: YuNet (CNN face detector with 5 facial landmarks).
    Fallback detector: OpenCV Haar Cascade Classifier.
    """

    def __init__(
        self, 
        model_path: Optional[str] = None,
        score_threshold: float = 0.60,
        nms_threshold: float = 0.30,
        top_k: int = 5000
    ):
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k
        self.yunet_detector = None
        self.haar_detector = None

        # Resolve model path
        if not model_path:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            model_path = os.path.join(base_dir, "models", "face_detection_yunet_2023mar.onnx")

        self.model_path = model_path
        self._init_detector()

    def _init_detector(self):
        # 1. Attempt to load YuNet
        if os.path.exists(self.model_path) and hasattr(cv2, "FaceDetectorYN"):
            try:
                # Default input size will be dynamically adjusted on detection
                self.yunet_detector = cv2.FaceDetectorYN.create(
                    model=self.model_path,
                    config="",
                    input_size=(320, 320),
                    score_threshold=self.score_threshold,
                    nms_threshold=self.nms_threshold,
                    top_k=self.top_k
                )
                logger.info(f"YuNet Face Detector initialized successfully from {self.model_path}")
            except Exception as e:
                logger.warning(f"Failed to initialize YuNet: {e}. Falling back to Haar Cascade.")
                self.yunet_detector = None

        # 2. Initialize Haar fallback
        try:
            haar_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
            if os.path.exists(haar_path):
                self.haar_detector = cv2.CascadeClassifier(haar_path)
                logger.info("Haar Cascade face detector fallback ready.")
        except Exception as e:
            logger.warning(f"Could not load Haar cascade: {e}")

    def detect_faces(self, image: np.ndarray) -> List[Dict[str, Any]]:
        """
        Detects all faces in the provided BGR image or ROI crop.
        Returns a list of dictionaries with bounding boxes, confidence, landmarks, and raw vectors.
        """
        if image is None or image.size == 0:
            return []

        h, w = image.shape[:2]
        if h < 10 or w < 10:
            return []

        results = []

        # 1. Try YuNet first
        if self.yunet_detector is not None:
            try:
                self.yunet_detector.setInputSize((w, h))
                _, faces = self.yunet_detector.detect(image)
                if faces is not None and len(faces) > 0:
                    for f in faces:
                        fx = int(max(0, f[0]))
                        fy = int(max(0, f[1]))
                        fw = int(min(w - fx, f[2]))
                        fh = int(min(h - fy, f[3]))
                        conf = float(f[14])

                        # 5 facial landmarks: right eye, left eye, nose tip, right mouth corner, left mouth corner
                        landmarks = [
                            [float(f[4]), float(f[5])],
                            [float(f[6]), float(f[7])],
                            [float(f[8]), float(f[9])],
                            [float(f[10]), float(f[11])],
                            [float(f[12]), float(f[13])]
                        ]

                        results.append({
                            "box": [fx, fy, fw, fh],
                            "confidence": round(conf, 3),
                            "landmarks": landmarks,
                            "raw_face": f,
                            "detector": "YUNET"
                        })
                    return results
            except Exception as e:
                logger.warning(f"YuNet detection error: {e}. Attempting Haar fallback.")

        # 2. Haar Cascade fallback if YuNet produced no faces or was unavailable
        if self.haar_detector is not None:
            try:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                haar_faces = self.haar_detector.detectMultiScale(
                    gray,
                    scaleFactor=1.1,
                    minNeighbors=4,
                    minSize=(24, 24)
                )
                for (fx, fy, fw, fh) in haar_faces:
                    # Synthetic 5-point landmarks estimate for Haar detections
                    re_x, re_y = fx + fw * 0.3, fy + fh * 0.35
                    le_x, le_y = fx + fw * 0.7, fy + fh * 0.35
                    nose_x, nose_y = fx + fw * 0.5, fy + fh * 0.55
                    rm_x, rm_y = fx + fw * 0.35, fy + fh * 0.75
                    lm_x, lm_y = fx + fw * 0.65, fy + fh * 0.75

                    synth_raw = np.array([
                        fx, fy, fw, fh,
                        re_x, re_y,
                        le_x, le_y,
                        nose_x, nose_y,
                        rm_x, rm_y,
                        lm_x, lm_y,
                        0.80
                    ], dtype=np.float32)

                    results.append({
                        "box": [int(fx), int(fy), int(fw), int(fh)],
                        "confidence": 0.80,
                        "landmarks": [
                            [re_x, re_y], [le_x, le_y],
                            [nose_x, nose_y],
                            [rm_x, rm_y], [lm_x, lm_y]
                        ],
                        "raw_face": synth_raw,
                        "detector": "HAAR"
                    })
            except Exception as e:
                logger.error(f"Haar detection error: {e}")

        return results
