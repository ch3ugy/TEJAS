"""
TEJAS Cross-Camera Re-Identification & Association Engine
Computes cosine similarity between deep visual embeddings and enforces spatio-temporal transit constraints.
"""
import numpy as np
from typing import Dict, List, Any

class CrossCameraTracker:
    def __init__(self, similarity_threshold: float = 0.85):
        self.similarity_threshold = similarity_threshold
        # Predefined node distances in meters / estimated transit times in seconds
        self.node_graph = {
            ("BOP-03", "BORDER-RD-12"): {"dist_m": 220, "min_time_s": 90, "max_time_s": 240},
            ("BORDER-RD-12", "BOP-04"): {"dist_m": 180, "min_time_s": 70, "max_time_s": 200},
            ("BOP-04", "RESTRICTED-Z01"): {"dist_m": 120, "min_time_s": 45, "max_time_s": 150},
        }

    def compute_cosine_similarity(self, embedding_a: List[float], embedding_b: List[float]) -> float:
        vec_a = np.array(embedding_a, dtype=np.float32)
        vec_b = np.array(embedding_b, dtype=np.float32)
        dot_product = np.dot(vec_a, vec_b)
        norm_a = np.linalg.norm(vec_a)
        norm_b = np.linalg.norm(vec_b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(dot_product / (norm_a * norm_b))

    def associate_handoff(
        self, 
        source_cam: str, 
        dest_cam: str, 
        elapsed_seconds: float, 
        appearance_similarity: float
    ) -> Dict[str, Any]:
        """Validates if entity handoff between two cameras is physically plausible and confident."""
        key = (source_cam, dest_cam)
        graph_edge = self.node_graph.get(key)

        time_plausible = True
        if graph_edge:
            time_plausible = graph_edge["min_time_s"] <= elapsed_seconds <= graph_edge["max_time_s"]

        is_match = (appearance_similarity >= self.similarity_threshold) and time_plausible

        return {
            "source_camera": source_cam,
            "dest_camera": dest_cam,
            "elapsed_seconds": elapsed_seconds,
            "appearance_similarity": round(appearance_similarity, 3),
            "spatio_temporal_feasible": time_plausible,
            "handoff_confirmed": is_match,
            "confidence_label": "HIGH CONFIDENCE MATCH" if is_match else "PROBABILISTIC VARIANCE"
        }
