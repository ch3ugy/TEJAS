import os
import logging
from typing import Optional, Tuple
import cv2
import numpy as np

logger = logging.getLogger("tejas.face_embedder")

class FaceEmbedder:
    """
    Extracts 128-dimensional deep facial biometric embeddings using OpenCV's SFace model.
    Performs 5-point landmark facial alignment prior to feature extraction.
    """

    def __init__(self, model_path: Optional[str] = None):
        if not model_path:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            model_path = os.path.join(base_dir, "models", "face_recognition_sface_2021dec.onnx")

        self.model_path = model_path
        self.recognizer = None
        self._init_recognizer()

    def _init_recognizer(self):
        if os.path.exists(self.model_path) and hasattr(cv2, "FaceRecognizerSF"):
            try:
                self.recognizer = cv2.FaceRecognizerSF.create(
                    model=self.model_path,
                    config=""
                )
                logger.info(f"SFace Biometric Embedder initialized successfully from {self.model_path}")
            except Exception as e:
                logger.error(f"Failed to load SFace model: {e}")
                self.recognizer = None
        else:
            logger.warning(f"SFace model not found at {self.model_path}")

    def align_face(self, image: np.ndarray, raw_face: np.ndarray) -> Optional[np.ndarray]:
        """
        Aligns the face crop using 5-point facial landmarks into a standardized 112x112 canonical crop.
        """
        if self.recognizer is None or image is None or raw_face is None:
            return None
        try:
            aligned = self.recognizer.alignCrop(image, raw_face)
            return aligned
        except Exception as e:
            logger.warning(f"Face alignment error: {e}")
            return None

    def extract_embedding(self, aligned_or_crop: np.ndarray, raw_face: Optional[np.ndarray] = None) -> Optional[np.ndarray]:
        """
        Extracts 128-D L2-normalized feature embedding vector from aligned face or raw image + raw_face.
        """
        if self.recognizer is None or aligned_or_crop is None:
            return None

        try:
            # If raw_face is provided, align first
            if raw_face is not None:
                aligned = self.align_face(aligned_or_crop, raw_face)
            else:
                aligned = aligned_or_crop

            if aligned is None or aligned.size == 0:
                return None

            # Ensure aligned image is 112x112 if passing directly
            if aligned.shape[:2] != (112, 112):
                aligned = cv2.resize(aligned, (112, 112))

            feat = self.recognizer.feature(aligned)
            # L2 normalize
            norm = np.linalg.norm(feat)
            if norm > 1e-6:
                feat = feat / norm
            return feat.flatten()
        except Exception as e:
            logger.error(f"Feature extraction error: {e}")
            return None

    def compute_similarity(self, feat1: np.ndarray, feat2: np.ndarray) -> float:
        """
        Computes cosine similarity between two 128-D embedding vectors.
        Returns a float typically in [-1.0, 1.0].
        """
        if feat1 is None or feat2 is None:
            return 0.0

        v1 = feat1.flatten().astype(np.float32)
        v2 = feat2.flatten().astype(np.float32)

        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)
        if norm1 < 1e-6 or norm2 < 1e-6:
            return 0.0

        cosine_sim = float(np.dot(v1, v2) / (norm1 * norm2))
        return cosine_sim

    @staticmethod
    def cosine_to_confidence(cosine_sim: float, match_threshold: float = 0.363) -> float:
        """
        Converts SFace cosine similarity into an intuitive confidence probability [0.0, 1.0].
        Where cosine >= match_threshold yields >= 0.70 confidence.
        """
        if cosine_sim <= 0:
            return 0.0
        if cosine_sim < match_threshold:
            # Linear scaling from 0 to 0.69
            return round((cosine_sim / match_threshold) * 0.69, 3)
        else:
            # Linear scaling from 0.70 to 1.00
            rem = (cosine_sim - match_threshold) / (1.0 - match_threshold + 1e-6)
            return round(0.70 + min(0.30, rem * 0.30), 3)
