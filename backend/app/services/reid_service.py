import base64
import datetime
import logging
import threading
import time
import uuid
from typing import Dict, Any, List, Optional, Tuple, Set

import cv2
import numpy as np

from app.database import SessionLocal
from app.models.models import GlobalTrack, TrackHandoff

logger = logging.getLogger("tejas.reid_service")


def encode_crop_to_base64(img_bgr: np.ndarray, quality: int = 85) -> str:
    """Encodes an OpenCV image crop to a base64 data URI."""
    if img_bgr is None or img_bgr.size == 0:
        return ""
    success, buffer = cv2.imencode('.jpg', img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not success:
        return ""
    b64_str = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/jpeg;base64,{b64_str}"


def compute_crop_quality(crop_bgr: np.ndarray) -> float:
    """
    Estimates a [0.0, 1.0] quality score for a person crop, used to gate and weight
    Re-ID observations so that blurry / tiny / degenerate crops do not corrupt the
    identity template.

    Combines:
      - resolution adequacy (very small crops carry unreliable appearance info)
      - aspect ratio sanity (a valid standing/walking person crop is taller than wide)
      - sharpness (variance of Laplacian) as a blur proxy
    """
    try:
        if crop_bgr is None or crop_bgr.size == 0:
            return 0.0
        h, w = crop_bgr.shape[:2]
        if h < 10 or w < 6:
            return 0.0

        # --- Resolution term ---
        # Saturates at a modest size; a full-body crop rarely needs to be huge
        # for the handcrafted appearance descriptor to be meaningful.
        area = h * w
        res_score = min(1.0, area / (60.0 * 140.0))

        # --- Aspect ratio term ---
        ratio = h / max(1.0, float(w))
        # Ideal standing-person ratio is roughly 1.6 - 3.2 (h/w). Heavily truncated
        # or near-square crops (occlusion, partial detection) are penalized.
        if 1.3 <= ratio <= 3.6:
            ratio_score = 1.0
        elif ratio < 1.3:
            ratio_score = max(0.0, ratio / 1.3)
        else:
            ratio_score = max(0.0, 1.0 - (ratio - 3.6) / 4.0)

        # --- Sharpness term (blur proxy) ---
        gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
        # Normalize scale before Laplacian so the metric is resolution-independent
        norm_gray = cv2.resize(gray, (64, 128), interpolation=cv2.INTER_LINEAR)
        lap_var = cv2.Laplacian(norm_gray, cv2.CV_64F).var()
        # Empirically, sharp small crops score well above ~80-100; heavily blurred
        # ones fall under ~15-20. Map to [0,1] with a soft knee.
        sharp_score = min(1.0, lap_var / 120.0)

        quality = (0.35 * res_score) + (0.25 * ratio_score) + (0.40 * sharp_score)
        return float(max(0.0, min(1.0, quality)))
    except Exception:
        return 0.3  # Unknown-but-usable fallback; never silently crash the pipeline


def compute_dominant_colors(crop_bgr: np.ndarray) -> Dict[str, str]:
    """Extracts human-readable dominant hex colors for upper and lower clothing."""
    try:
        h, w = crop_bgr.shape[:2]
        upper_strip = crop_bgr[int(h * 0.1):int(h * 0.5), :]
        lower_strip = crop_bgr[int(h * 0.5):int(h * 0.9), :]

        def get_hex(strip):
            if strip.size == 0:
                return "#888888"
            mean_bgr = np.mean(strip, axis=(0, 1)).astype(int)
            b, g, r = mean_bgr[0], mean_bgr[1], mean_bgr[2]
            return f"#{r:02X}{g:02X}{b:02X}"

        return {
            "upper_clothing": get_hex(upper_strip),
            "lower_clothing": get_hex(lower_strip)
        }
    except Exception:
        return {"upper_clothing": "#4A5568", "lower_clothing": "#2D3748"}


class CameraTopology:
    """
    Manages physical or logical camera network topology, adjacency, and transition corridors.
    Guarantees:
      1. Arbitrary camera registration (dynamically synced from DB and CameraManager).
      2. Configurable pairwise relationships with minimum and maximum transit bounds.
      3. Physical impossible-transition protection:
         - Minimum transit time validation (detects physically impossible speeds).
         - Maximum transit expiry (detects stale association windows).
         - Explicitly disconnected / blocked paths.
         - Strict topology mode support.
    """
    def __init__(self):
        self.lock = threading.Lock()
        self.nodes: Set[str] = set()
        # Edge key: (from_camera, to_camera) -> dict
        self.edges: Dict[Tuple[str, str], Dict[str, Any]] = {}
        self.default_min_transit: float = 0.5
        self.default_max_transit: float = 300.0
        self.strict_mode: bool = False  # If True, unconfigured transitions are rejected

    def register_camera(self, camera_id: str):
        if not camera_id:
            return
        with self.lock:
            self.nodes.add(str(camera_id).strip())

    def unregister_camera(self, camera_id: str):
        with self.lock:
            self.nodes.discard(str(camera_id).strip())
            to_del = [k for k in self.edges.keys() if k[0] == camera_id or k[1] == camera_id]
            for k in to_del:
                del self.edges[k]

    def set_edge(
        self,
        from_cam: str,
        to_cam: str,
        min_transit: float = 1.0,
        max_transit: float = 180.0,
        is_connected: bool = True,
        corridor_name: str = "",
        bidirectional: bool = True
    ):
        with self.lock:
            self.nodes.add(from_cam)
            self.nodes.add(to_cam)
            edge_data = {
                "min_transit": max(0.1, float(min_transit)),
                "max_transit": max(float(min_transit), float(max_transit)),
                "is_connected": bool(is_connected),
                "corridor_name": corridor_name or f"{from_cam} <-> {to_cam}"
            }
            self.edges[(from_cam, to_cam)] = edge_data
            if bidirectional:
                self.edges[(to_cam, from_cam)] = {
                    "min_transit": edge_data["min_transit"],
                    "max_transit": edge_data["max_transit"],
                    "is_connected": edge_data["is_connected"],
                    "corridor_name": edge_data["corridor_name"]
                }

    def remove_edge(self, from_cam: str, to_cam: str, bidirectional: bool = True):
        with self.lock:
            self.edges.pop((from_cam, to_cam), None)
            if bidirectional:
                self.edges.pop((to_cam, from_cam), None)

    def validate_transition(
        self, from_cam: str, to_cam: str, transit_seconds: float
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Validates whether transition between from_cam and to_cam is physically possible.
        Returns: (is_valid, reason_code, edge_info)
        """
        with self.lock:
            self.nodes.add(from_cam)
            self.nodes.add(to_cam)

            edge = self.edges.get((from_cam, to_cam))
            if edge is not None:
                if not edge["is_connected"]:
                    return False, "DISCONNECTED_CORRIDOR", edge
                if transit_seconds < edge["min_transit"]:
                    return False, "PHYSICALLY_IMPOSSIBLE_SPEED", edge
                if transit_seconds > edge["max_transit"]:
                    return False, "TRANSIT_WINDOW_EXPIRED", edge
                return True, "VALID_CORRIDOR", edge

            if self.strict_mode:
                return False, "NO_PATH_IN_STRICT_TOPOLOGY", {}

            # Default heuristic path
            if transit_seconds < self.default_min_transit:
                return False, "PHYSICALLY_IMPOSSIBLE_SPEED", {
                    "min_transit": self.default_min_transit,
                    "max_transit": self.default_max_transit,
                    "is_connected": True,
                    "corridor_name": "Default Ad-hoc"
                }
            if transit_seconds > self.default_max_transit:
                return False, "TRANSIT_WINDOW_EXPIRED", {
                    "min_transit": self.default_min_transit,
                    "max_transit": self.default_max_transit,
                    "is_connected": True,
                    "corridor_name": "Default Ad-hoc"
                }
            return True, "DEFAULT_HEURISTIC_CORRIDOR", {
                "min_transit": self.default_min_transit,
                "max_transit": self.default_max_transit,
                "is_connected": True,
                "corridor_name": "Default Ad-hoc"
            }

    def get_topology(self) -> Dict[str, Any]:
        with self.lock:
            edges_list = [
                {
                    "from_camera": k[0],
                    "to_camera": k[1],
                    "min_transit_seconds": v["min_transit"],
                    "max_transit_seconds": v["max_transit"],
                    "is_connected": v["is_connected"],
                    "corridor_name": v["corridor_name"]
                }
                for k, v in self.edges.items()
            ]
            return {
                "nodes": sorted(list(self.nodes)),
                "edges": edges_list,
                "total_nodes": len(self.nodes),
                "total_edges": len(edges_list),
                "strict_mode": self.strict_mode,
                "default_min_transit": self.default_min_transit,
                "default_max_transit": self.default_max_transit
            }

    def sync_from_db(self):
        try:
            from app.models.models import Camera
            db = SessionLocal()
            cams = db.query(Camera).all()
            with self.lock:
                for c in cams:
                    if c.id:
                        self.nodes.add(c.id)
                    if c.code:
                        self.nodes.add(c.code)
            db.close()
        except Exception as e:
            logger.warning(f"Failed to sync topology with DB cameras: {e}")


class ReIDService:
    """
    Production Cross-Camera Re-Identification (Re-ID) & Association Service.
    Tracks entities across separate camera fields of view:
      1. Extracts normalized spatial-appearance feature vectors.
      2. Enforces temporal and spatial connectivity constraints via CameraTopology.
      3. Uses cosine distance with configurable thresholding to associate tracks.
      4. Assigns and maintains unified Global Track IDs (e.g. GLOBAL-027).
      5. Connects transitions to the Event & Operational Alert engines without numeric scores.
      6. Handles probabilistic uncertainty (MATCH / UNCERTAIN / NO_MATCH / IMPOSSIBLE_TRANSITION).
    """

    def __init__(self):
        self.lock = threading.Lock()
        # Configuration
        self.similarity_threshold = 0.72       # Threshold for cross-camera identity match (MATCH)
        self.uncertainty_threshold = 0.55      # Threshold for probabilistic uncertainty region (UNCERTAIN)
        self.min_transit_seconds = 0.5         # Minimum physical time between camera handoffs
        self.max_transit_seconds = 180.0       # Maximum time an entity can stay in transit
        self.global_track_counter = 20         # Starting index for human-readable IDs

        # Camera topology network
        self.topology = CameraTopology()

        # In-memory candidate active tracks for low-latency matching
        # Key: global_track_id -> track dictionary
        self.active_tracks: Dict[str, Dict[str, Any]] = {}
        # Local camera track map: (camera_id, local_track_id) -> global_track_id
        self.local_to_global: Dict[Tuple[str, int], str] = {}

        # ---------------------------------------------------------------
        # SINGLE-CAMERA PERSON RE-ID (appearance-based persistent identity)
        # ---------------------------------------------------------------
        # This is intentionally separate in-memory state from the cross-camera
        # handoff logic above (active_tracks / local_to_global), which only
        # matches identities across DIFFERENT cameras. Most of TEJAS's live
        # demo value comes from a person keeping the same GLOBAL-PERSON-xxx
        # identity on a SINGLE camera even after ByteTrack loses and re-issues
        # a new local track id (occlusion, brief exit, re-entry, etc).
        #
        # self.person_gallery[camera_id][global_id] = {
        #     "embedding": np.ndarray,          # quality-weighted running template
        #     "quality_weight": float,          # accumulated quality mass behind template
        #     "observation_count": int,
        #     "last_seen_epoch": float,
        #     "bound_local_track_id": Optional[int],   # currently claimed by this local track, or None if released
        #     "status": "NEW" | "TRACKED" | "REIDENTIFIED" | "UNCERTAIN",
        #     "snapshot_b64": str,
        #     "dominant_colors": dict,
        # }
        self.person_gallery: Dict[str, Dict[str, Dict[str, Any]]] = {}
        # Fast path: (camera_id, local_track_id) -> global_person_id, valid only while
        # that local track is the current, unreleased owner of the identity.
        self.person_local_binding: Dict[Tuple[str, int], str] = {}
        # RLock (not Lock): resolve_person_identity holds this lock while calling
        # _generate_new_person_id, which also acquires it — a plain Lock would
        # self-deadlock the very first time a new identity had to be created.
        self.person_lock = threading.RLock()
        self.person_id_counter = 0

        from app.config import settings as _settings
        self.reid_enabled = bool(getattr(_settings, "REID_ENABLED", True))
        self.person_match_threshold = float(getattr(_settings, "REID_MATCH_THRESHOLD", 0.72))
        self.person_uncertain_threshold = float(getattr(_settings, "REID_UNCERTAIN_THRESHOLD", 0.55))
        self.person_binding_release_seconds = float(getattr(_settings, "REID_BINDING_RELEASE_SECONDS", 4.0))
        self.person_gallery_ttl_seconds = float(getattr(_settings, "REID_GALLERY_TTL_SECONDS", 24 * 3600))
        self.reid_min_crop_w = int(getattr(_settings, "REID_MIN_CROP_WIDTH", 24))
        self.reid_min_crop_h = int(getattr(_settings, "REID_MIN_CROP_HEIGHT", 50))
        # Minimum quality a crop must have before it is allowed to *update* an
        # existing identity template (protects against drift from bad frames).
        self.min_update_quality = 0.30
        # Minimum quality a crop must have before it is even used to attempt a
        # NEW match against the gallery (protects against false merges caused
        # by a single terrible frame on a brand new local track).
        self.min_match_quality = 0.22

        self._seed_initial_state()

    def _seed_initial_state(self):
        """Pre-seeds or loads existing global tracks from database on startup."""
        try:
            self.topology.sync_from_db()
            db = SessionLocal()
            existing = db.query(GlobalTrack).order_by(GlobalTrack.created_at.desc()).all()
            for gt in existing:
                try:
                    num_part = int(gt.id.split("-")[-1])
                    if num_part > self.global_track_counter:
                        self.global_track_counter = num_part
                except Exception:
                    pass

                if len(self.active_tracks) < 20:
                    self.active_tracks[gt.id] = {
                        "id": gt.id,
                        "entity_type": gt.entity_type,
                        "status": gt.status,
                        "current_camera": gt.current_camera,
                        "previous_camera": gt.previous_camera,
                        "first_seen_time": gt.first_seen_time,
                        "last_seen_time": gt.last_seen_time,
                        "last_seen_epoch": time.time() - 10.0,
                        "threat_score": 0,
                        "severity": "INFO",
                        "total_handoffs": gt.total_handoffs,
                        "embedding": np.array(gt.embedding_summary.get("vector", []), dtype=np.float32) if gt.embedding_summary else None,
                        "dominant_colors": gt.embedding_summary.get("dominant_colors", {}) if gt.embedding_summary else {},
                        "snapshot_b64": gt.latest_snapshot_base64,
                        "movement_path": gt.movement_path or []
                    }
            db.close()
            logger.info(f"Loaded {len(self.active_tracks)} existing global tracks into Re-ID memory (counter={self.global_track_counter}).")
        except Exception as e:
            logger.warning(f"Failed to hydrate global tracks: {e}")

    # -------------------------------------------------------------------------
    # 1. FEATURE EXTRACTION & APPEARANCE EMBEDDINGS
    # -------------------------------------------------------------------------
    def extract_reid_embedding(self, crop_bgr: np.ndarray) -> Optional[Dict[str, Any]]:
        """
        Extracts an L2-normalized 256-dimensional spatial-appearance feature vector
        combining multi-strip Hue-Saturation-Value and LAB color distributions
        with edge texture descriptors.
        """
        if crop_bgr is None or crop_bgr.size == 0:
            return None

        h, w = crop_bgr.shape[:2]
        if h < 20 or w < 10:
            return None

        # Standardize size for consistent spatial binning (128x64 standard Re-ID aspect ratio)
        resized = cv2.resize(crop_bgr, (64, 128), interpolation=cv2.INTER_LINEAR)

        # Multi-strip physiological partitioning:
        # Strip 1: Head / Shoulders (0% to 33% height)
        # Strip 2: Torso / Waist (33% to 66% height)
        # Strip 3: Lower Body / Legs (66% to 100% height)
        strips = [resized[0:42, :], resized[42:85, :], resized[85:, :]]

        features = []
        for s in strips:
            hsv = cv2.cvtColor(s, cv2.COLOR_BGR2HSV)
            lab = cv2.cvtColor(s, cv2.COLOR_BGR2LAB)

            # 2D HS color histogram (12 H bins, 8 S bins = 96 features)
            h_hist = cv2.calcHist([hsv], [0, 1], None, [12, 8], [0, 180, 0, 256]).flatten()
            h_hist = h_hist / (np.linalg.norm(h_hist) + 1e-6)

            # LAB A/B chrominance histogram (8x8 = 64 features)
            ab_hist = cv2.calcHist([lab], [1, 2], None, [8, 8], [0, 256, 0, 256]).flatten()
            ab_hist = ab_hist / (np.linalg.norm(ab_hist) + 1e-6)

            # LAB L-luminance histogram (16 features)
            l_hist = cv2.calcHist([lab], [0], None, [16], [0, 256]).flatten()
            l_hist = l_hist / (np.linalg.norm(l_hist) + 1e-6)

            # Texture edge orientation distribution (8 features)
            gray = cv2.cvtColor(s, cv2.COLOR_BGR2GRAY)
            gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
            gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
            _, ang = cv2.cartToPolar(gx, gy, angleInDegrees=True)
            t_hist = cv2.calcHist([ang], [0], None, [8], [0, 360]).flatten()
            t_hist = t_hist / (np.linalg.norm(t_hist) + 1e-6)

            # Strip vector with balanced weights (HS: 0.55, AB: 0.30, L: 0.10, Texture: 0.05)
            strip_vec = np.concatenate([h_hist * 0.55, ab_hist * 0.30, l_hist * 0.10, t_hist * 0.05])
            strip_vec = strip_vec / (np.linalg.norm(strip_vec) + 1e-6)
            features.extend(strip_vec)

        raw_vec = np.array(features, dtype=np.float32)
        norm = np.linalg.norm(raw_vec)
        norm_vec = raw_vec / (norm + 1e-6)

        dominant_colors = compute_dominant_colors(crop_bgr)
        snapshot_b64 = encode_crop_to_base64(crop_bgr)

        return {
            "vector": norm_vec.tolist(),
            "vector_np": norm_vec,
            "dimension": len(norm_vec),
            "dominant_colors": dominant_colors,
            "snapshot_b64": snapshot_b64
        }

    # -------------------------------------------------------------------------
    # 2. COSINE SIMILARITY
    # -------------------------------------------------------------------------
    @staticmethod
    def compute_similarity(vec1: np.ndarray, vec2: np.ndarray) -> float:
        """
        Calculates normalized cosine similarity between two unit-norm feature vectors.
        Returns value strictly bounded between 0.0 and 1.0.
        """
        if vec1 is None or vec2 is None:
            return 0.0
        if len(vec1) != len(vec2):
            return 0.0
        dot = float(np.dot(vec1, vec2))
        return max(0.0, min(1.0, dot))

    # -------------------------------------------------------------------------
    # 2b. SINGLE-CAMERA PERSON RE-ID (persistent identity within one camera)
    # -------------------------------------------------------------------------
    def _generate_new_person_id(self) -> str:
        with self.person_lock:
            while True:
                self.person_id_counter += 1
                cand = f"GLOBAL-PERSON-{self.person_id_counter:03d}"
                already_used = any(
                    cand in gal for gal in self.person_gallery.values()
                )
                if not already_used:
                    return cand

    def _release_stale_person_bindings(self, camera_id: str, now: float):
        """
        Releases local-track bindings that have gone quiet (ByteTrack lost the
        track / camera occlusion / RTSP hiccup) so the identity becomes eligible
        for re-identification the next time it reappears under a NEW local id.
        Templates themselves are kept alive for REID_GALLERY_TTL_SECONDS so a
        person who briefly leaves frame can still be re-associated later; only
        after the full TTL expires is the identity forgotten entirely.
        """
        gallery = self.person_gallery.get(camera_id)
        if not gallery:
            return
        to_forget = []
        for gid, rec in gallery.items():
            idle = now - rec["last_seen_epoch"]
            if rec["bound_local_track_id"] is not None and idle > self.person_binding_release_seconds:
                # Release the binding but keep the template for later re-id
                lt = rec["bound_local_track_id"]
                self.person_local_binding.pop((camera_id, lt), None)
                rec["bound_local_track_id"] = None
                rec["status"] = "TRACKED"  # no longer actively "NEW"/"REIDENTIFIED" this instant
            if idle > self.person_gallery_ttl_seconds:
                to_forget.append(gid)
        for gid in to_forget:
            gallery.pop(gid, None)

    def resolve_person_identity(
        self,
        camera_id: str,
        local_track_id: int,
        crop_bgr: Optional[np.ndarray],
        box: List[int],
        frame_shape: Optional[Tuple[int, int]] = None,
    ) -> Dict[str, Any]:
        """
        Resolves a persistent GLOBAL-PERSON-xxx identity for a person detected on
        a SINGLE camera, surviving temporary ByteTrack local-id loss (occlusion,
        brief exit + re-entry, RTSP frame drops).

        This is intentionally conservative: a wrong merge is treated as worse than
        creating a new identity (see module docstring / TEJAS Re-ID requirements).
        Never raises — any internal failure degrades to a safe fallback so the
        camera pipeline (zones/vehicles/ANPR/events) is never affected by Re-ID.

        Returns a dict:
            {
                "global_id": str,
                "status": "NEW" | "TRACKED" | "REIDENTIFIED" | "UNCERTAIN" | "DISABLED" | "LOW_QUALITY",
                "similarity": float,
                "quality": float,
            }
        """
        if not self.reid_enabled:
            return {"global_id": None, "status": "DISABLED", "similarity": 0.0, "quality": 0.0}

        now = time.time()
        local_key = (camera_id, local_track_id)

        try:
            with self.person_lock:
                self._release_stale_person_bindings(camera_id, now)
                gallery = self.person_gallery.setdefault(camera_id, {})

                # ---- Fast path: this local track is already bound to an identity ----
                existing_gid = self.person_local_binding.get(local_key)
                if existing_gid and existing_gid in gallery:
                    rec = gallery[existing_gid]
                    rec["last_seen_epoch"] = now
                    quality = compute_crop_quality(crop_bgr) if crop_bgr is not None else 0.0
                    if quality >= self.min_update_quality:
                        emb_data = self.extract_reid_embedding(crop_bgr)
                        if emb_data is not None:
                            new_vec = emb_data["vector_np"]
                            # Quality-weighted running template update (bad frames
                            # contribute little; good frames refine the template).
                            w_new = min(0.5, 0.15 + 0.35 * quality)
                            blended = (1 - w_new) * rec["embedding"] + w_new * new_vec
                            norm = np.linalg.norm(blended)
                            rec["embedding"] = blended / (norm + 1e-6)
                            rec["observation_count"] += 1
                            rec["quality_weight"] += quality
                            rec["snapshot_b64"] = emb_data["snapshot_b64"]
                            rec["dominant_colors"] = emb_data["dominant_colors"]
                    if rec["observation_count"] >= 3 and rec["status"] not in ("REIDENTIFIED",):
                        rec["status"] = "TRACKED"
                    self._persist_person_track(existing_gid, camera_id, rec, now)
                    return {
                        "global_id": existing_gid,
                        "status": rec["status"],
                        "similarity": 1.0,
                        "quality": quality,
                    }

                # ---- New/returned local track id: attempt Re-ID ----
                quality = compute_crop_quality(crop_bgr) if crop_bgr is not None else 0.0
                h_ok = crop_bgr is not None and crop_bgr.shape[0] >= self.reid_min_crop_h
                w_ok = crop_bgr is not None and crop_bgr.shape[1] >= self.reid_min_crop_w

                if crop_bgr is None or not h_ok or not w_ok:
                    # Crop unusable (too small/empty/out of frame). Do not attempt a
                    # match on unreliable data — start a fresh, clearly-flagged
                    # identity rather than risking a false merge.
                    new_gid = self._generate_new_person_id()
                    gallery[new_gid] = {
                        "embedding": None,
                        "quality_weight": 0.0,
                        "observation_count": 0,
                        "last_seen_epoch": now,
                        "bound_local_track_id": local_track_id,
                        "status": "LOW_QUALITY",
                        "snapshot_b64": "",
                        "dominant_colors": {},
                    }
                    self.person_local_binding[local_key] = new_gid
                    return {"global_id": new_gid, "status": "LOW_QUALITY", "similarity": 0.0, "quality": quality}

                emb_data = self.extract_reid_embedding(crop_bgr)
                if emb_data is None:
                    new_gid = self._generate_new_person_id()
                    gallery[new_gid] = {
                        "embedding": None, "quality_weight": 0.0, "observation_count": 0,
                        "last_seen_epoch": now, "bound_local_track_id": local_track_id,
                        "status": "LOW_QUALITY", "snapshot_b64": "", "dominant_colors": {},
                    }
                    self.person_local_binding[local_key] = new_gid
                    return {"global_id": new_gid, "status": "LOW_QUALITY", "similarity": 0.0, "quality": quality}

                new_vec = emb_data["vector_np"]

                best_gid, best_sim = None, -1.0
                if quality >= self.min_match_quality:
                    for gid, rec in gallery.items():
                        # Multi-cue guard #1: never steal an identity that is
                        # CURRENTLY bound to a different, still-live local track —
                        # that would collide two simultaneously-visible people.
                        if rec["bound_local_track_id"] is not None:
                            continue
                        if rec["embedding"] is None:
                            continue
                        sim = self.compute_similarity(new_vec, rec["embedding"])
                        if sim > best_sim:
                            best_sim, best_gid = sim, gid

                if best_gid is not None and best_sim >= self.person_match_threshold:
                    # === REIDENTIFIED: conservative high-confidence match ===
                    rec = gallery[best_gid]
                    w_new = min(0.5, 0.15 + 0.35 * quality)
                    blended = (1 - w_new) * rec["embedding"] + w_new * new_vec
                    rec["embedding"] = blended / (np.linalg.norm(blended) + 1e-6)
                    rec["observation_count"] += 1
                    rec["quality_weight"] += quality
                    rec["last_seen_epoch"] = now
                    rec["bound_local_track_id"] = local_track_id
                    rec["status"] = "REIDENTIFIED"
                    rec["snapshot_b64"] = emb_data["snapshot_b64"]
                    rec["dominant_colors"] = emb_data["dominant_colors"]
                    self.person_local_binding[local_key] = best_gid
                    self._persist_person_track(best_gid, camera_id, rec, now)
                    return {"global_id": best_gid, "status": "REIDENTIFIED", "similarity": round(best_sim, 3), "quality": quality}

                # === NO_MATCH or UNCERTAIN: never force an ambiguous merge ===
                status = "UNCERTAIN" if (best_gid is not None and best_sim >= self.person_uncertain_threshold) else "NEW"
                new_gid = self._generate_new_person_id()
                gallery[new_gid] = {
                    "embedding": new_vec,
                    "quality_weight": quality,
                    "observation_count": 1,
                    "last_seen_epoch": now,
                    "bound_local_track_id": local_track_id,
                    "status": status,
                    "snapshot_b64": emb_data["snapshot_b64"],
                    "dominant_colors": emb_data["dominant_colors"],
                }
                self.person_local_binding[local_key] = new_gid
                self._persist_person_track(new_gid, camera_id, gallery[new_gid], now)
                return {
                    "global_id": new_gid,
                    "status": status,
                    "similarity": round(best_sim, 3) if best_sim > 0 else 0.0,
                    "quality": quality,
                }
        except Exception as e:
            logger.debug(f"[{camera_id}] Single-camera Re-ID resolution failed safely: {e}")
            return {"global_id": None, "status": "ERROR", "similarity": 0.0, "quality": 0.0}

    def _persist_person_track(self, global_id: str, camera_id: str, rec: Dict[str, Any], now: float):
        """Best-effort DB persistence of a single-camera person identity, reusing
        the existing GlobalTrack table (entity_type='PERSON'). Never blocks or
        crashes the caller — persistence failures are logged and swallowed.
        Throttled to avoid a DB write on every single frame."""
        last_persist = rec.get("_last_persist_epoch", 0.0)
        if now - last_persist < 2.0:
            return
        rec["_last_persist_epoch"] = now
        try:
            time_str = datetime.datetime.now().strftime("%H:%M:%S")
            db = SessionLocal()
            try:
                existing = db.query(GlobalTrack).filter(GlobalTrack.id == global_id).first()
                emb_list = rec["embedding"].tolist() if rec.get("embedding") is not None else []
                if existing:
                    existing.current_camera = camera_id
                    existing.last_seen_time = time_str
                    existing.status = rec["status"]
                    existing.total_handoffs = rec.get("observation_count", existing.total_handoffs)
                    existing.embedding_summary = {
                        "dimension": len(emb_list),
                        "dominant_colors": rec.get("dominant_colors", {}),
                        "vector": emb_list,
                    }
                    if rec.get("snapshot_b64"):
                        existing.latest_snapshot_base64 = rec["snapshot_b64"]
                else:
                    db.add(GlobalTrack(
                        id=global_id,
                        entity_type="PERSON",
                        status=rec["status"],
                        first_seen_camera=camera_id,
                        current_camera=camera_id,
                        previous_camera=None,
                        first_seen_time=time_str,
                        last_seen_time=time_str,
                        threat_score=0,
                        severity="INFO",
                        total_handoffs=rec.get("observation_count", 1),
                        embedding_summary={
                            "dimension": len(emb_list),
                            "dominant_colors": rec.get("dominant_colors", {}),
                            "vector": emb_list,
                        },
                        latest_snapshot_base64=rec.get("snapshot_b64"),
                        movement_path=[{
                            "from_camera": camera_id, "to_camera": camera_id, "time": time_str,
                            "transit_seconds": 0.0, "similarity": 1.0, "match_status": "SINGLE_CAMERA",
                        }],
                    ))
                db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.debug(f"Failed to persist single-camera person track {global_id}: {e}")

    # -------------------------------------------------------------------------
    # 3. CROSS-CAMERA ASSOCIATION & GLOBAL TRACK LIFECYCLE
    # -------------------------------------------------------------------------
    def match_or_create_global_track(
        self,
        camera_id: str,
        local_track_id: int,
        entity_type: str,
        crop_bgr: np.ndarray,
        box: List[int],
        timestamp_str: Optional[str] = None,
        transit_dt_override: Optional[float] = None
    ) -> Tuple[str, bool, Optional[Dict[str, Any]]]:
        """
        Matches a local camera detection to an existing global track identity or creates a new one.
        Returns:
          (global_track_id, is_cross_camera_handoff, match_metadata)
        """
        now = time.time()
        time_str = timestamp_str or datetime.datetime.now().strftime("%H:%M:%S")

        # Check if this local track on this camera is already assigned
        local_key = (camera_id, local_track_id)
        with self.lock:
            if local_key in self.local_to_global:
                gid = self.local_to_global[local_key]
                if gid in self.active_tracks:
                    self.active_tracks[gid]["last_seen_time"] = time_str
                    self.active_tracks[gid]["last_seen_epoch"] = now
                return gid, False, None

        # Extract appearance embedding
        emb_data = self.extract_reid_embedding(crop_bgr)
        if emb_data is None:
            # Fallback for unextractable small crops
            new_id = self._generate_new_global_id()
            return new_id, False, None

        new_vec = emb_data["vector_np"]
        best_candidate_id = None
        best_similarity = -1.0
        best_transit_dt = 0.0
        best_transition_info: Dict[str, Any] = {}
        impossible_reasons: List[str] = []

        with self.lock:
            for gid, track_data in list(self.active_tracks.items()):
                cand_cam = track_data.get("current_camera")
                # Only match tracks that were seen on a DIFFERENT camera
                if cand_cam == camera_id:
                    continue

                cand_vec = track_data.get("embedding")
                if cand_vec is None or cand_vec.size == 0:
                    continue

                last_epoch = track_data.get("last_seen_epoch", now - 5.0)
                transit_dt = transit_dt_override if transit_dt_override is not None else (now - last_epoch)

                # Validate transition physical feasibility through CameraTopology
                is_valid_transit, reason_code, edge_info = self.topology.validate_transition(
                    cand_cam, camera_id, transit_dt
                )

                if not is_valid_transit:
                    impossible_reasons.append(f"{cand_cam}->{camera_id} [{gid}]: {reason_code} ({transit_dt:.1f}s)")
                    continue

                sim = self.compute_similarity(new_vec, cand_vec)
                if sim > best_similarity:
                    best_similarity = sim
                    best_candidate_id = gid
                    best_transit_dt = transit_dt
                    best_transition_info = {
                        "from_camera": cand_cam,
                        "to_camera": camera_id,
                        "transit_seconds": round(transit_dt, 1),
                        "reason_code": reason_code,
                        "corridor": edge_info.get("corridor_name", "Ad-hoc Corridor")
                    }

        # ---------------------------------------------------------------------
        # Evaluation: MATCH / UNCERTAIN / NO_MATCH
        # ---------------------------------------------------------------------
        if best_candidate_id and best_similarity >= self.similarity_threshold:
            # === 1. PROBABILISTIC MATCH (HIGH CONFIDENCE) ===
            matched_gid = best_candidate_id
            with self.lock:
                cand_data = self.active_tracks[matched_gid]
                prev_cam = cand_data["current_camera"]
                cand_data["previous_camera"] = prev_cam
                cand_data["current_camera"] = camera_id
                cand_data["last_seen_time"] = time_str
                cand_data["last_seen_epoch"] = now
                cand_data["total_handoffs"] += 1
                cand_data["status"] = "ACTIVE"
                cand_data["snapshot_b64"] = emb_data["snapshot_b64"]

                # Moving average embedding smoothing
                cand_data["embedding"] = 0.7 * cand_data["embedding"] + 0.3 * new_vec
                cand_data["embedding"] = cand_data["embedding"] / (np.linalg.norm(cand_data["embedding"]) + 1e-6)

                path_step = {
                    "from_camera": prev_cam,
                    "to_camera": camera_id,
                    "time": time_str,
                    "transit_seconds": round(best_transit_dt, 1),
                    "similarity": round(best_similarity, 3),
                    "match_status": "MATCH"
                }
                cand_data["movement_path"].append(path_step)
                self.local_to_global[local_key] = matched_gid

            handoff_id = f"HOFF-{uuid.uuid4().hex[:6].upper()}"
            try:
                db = SessionLocal()
                db_gt = db.query(GlobalTrack).filter(GlobalTrack.id == matched_gid).first()
                if db_gt:
                    db_gt.previous_camera = prev_cam
                    db_gt.current_camera = camera_id
                    db_gt.last_seen_time = time_str
                    db_gt.total_handoffs += 1
                    db_gt.movement_path = cand_data["movement_path"]
                    db_gt.latest_snapshot_base64 = emb_data["snapshot_b64"]
                    db_gt.status = "ACTIVE"

                db_hoff = TrackHandoff(
                    id=handoff_id,
                    global_track_id=matched_gid,
                    from_camera=prev_cam,
                    to_camera=camera_id,
                    local_track_id=local_track_id,
                    timestamp=time_str,
                    transition_time_seconds=round(best_transit_dt, 1),
                    similarity_score=round(best_similarity, 3),
                    confidence=round(best_similarity, 3),  # Probabilistic, not fabricated
                    snapshot_base64=emb_data["snapshot_b64"],
                    metadata_json={
                        "box": box,
                        "dominant_colors": emb_data["dominant_colors"],
                        "match_status": "MATCH",
                        "topology_info": best_transition_info
                    }
                )
                db.add(db_hoff)
                db.commit()
                db.close()
            except Exception as db_err:
                logger.error(f"Failed to persist track handoff: {db_err}", exc_info=True)

            match_info = {
                "handoff_id": handoff_id,
                "global_track_id": matched_gid,
                "match_status": "MATCH",
                "from_camera": prev_cam,
                "to_camera": camera_id,
                "similarity_score": round(best_similarity, 3),
                "confidence": round(best_similarity, 3),
                "transit_seconds": round(best_transit_dt, 1),
                "dominant_colors": emb_data["dominant_colors"],
                "snapshot_b64": emb_data["snapshot_b64"],
                "topology_info": best_transition_info
            }

            logger.info(
                f"CROSS-CAMERA RE-ID MATCH: [{matched_gid}] {prev_cam} -> {camera_id} "
                f"(Similarity: {round(best_similarity * 100, 1)}%, Transit: {round(best_transit_dt, 1)}s)"
            )
            return matched_gid, True, match_info

        elif best_candidate_id and best_similarity >= self.uncertainty_threshold:
            # === 2. PROBABILISTIC UNCERTAIN REGION (0.55 <= SIM < 0.72) ===
            # Cross-camera identity is probabilistic. Do NOT claim perfect identity or force-merge!
            new_gid = self._generate_new_global_id()
            with self.lock:
                self.active_tracks[new_gid] = {
                    "id": new_gid,
                    "entity_type": entity_type,
                    "status": "UNCERTAIN_CANDIDATE",
                    "current_camera": camera_id,
                    "previous_camera": best_transition_info.get("from_camera"),
                    "first_seen_time": time_str,
                    "last_seen_time": time_str,
                    "last_seen_epoch": now,
                    "threat_score": 0,
                    "severity": "NOTICE",
                    "total_handoffs": 0,
                    "embedding": new_vec,
                    "dominant_colors": emb_data["dominant_colors"],
                    "snapshot_b64": emb_data["snapshot_b64"],
                    "movement_path": [
                        {
                            "from_camera": camera_id,
                            "to_camera": camera_id,
                            "time": time_str,
                            "transit_seconds": 0.0,
                            "similarity": 1.0,
                            "match_status": "UNCERTAIN_ORIGIN",
                            "candidate_parent": best_candidate_id,
                            "candidate_similarity": round(best_similarity, 3)
                        }
                    ]
                }
                self.local_to_global[local_key] = new_gid

            # Record candidate handoff in DB with UNCERTAIN flag for auditability
            handoff_id = f"HOFF-{uuid.uuid4().hex[:6].upper()}"
            try:
                db = SessionLocal()
                db_gt = GlobalTrack(
                    id=new_gid,
                    entity_type=entity_type,
                    status="UNCERTAIN_CANDIDATE",
                    first_seen_camera=camera_id,
                    current_camera=camera_id,
                    previous_camera=best_transition_info.get("from_camera"),
                    first_seen_time=time_str,
                    last_seen_time=time_str,
                    threat_score=0,
                    severity="NOTICE",
                    total_handoffs=0,
                    embedding_summary={
                        "dimension": emb_data["dimension"],
                        "dominant_colors": emb_data["dominant_colors"],
                        "vector": emb_data["vector"],
                        "candidate_parent": best_candidate_id,
                        "candidate_similarity": round(best_similarity, 3)
                    },
                    latest_snapshot_base64=emb_data["snapshot_b64"],
                    movement_path=self.active_tracks[new_gid]["movement_path"]
                )
                db.add(db_gt)

                db_hoff = TrackHandoff(
                    id=handoff_id,
                    global_track_id=new_gid,
                    from_camera=best_transition_info.get("from_camera", "UNKNOWN"),
                    to_camera=camera_id,
                    local_track_id=local_track_id,
                    timestamp=time_str,
                    transition_time_seconds=round(best_transit_dt, 1),
                    similarity_score=round(best_similarity, 3),
                    confidence=round(best_similarity, 3),
                    snapshot_base64=emb_data["snapshot_b64"],
                    metadata_json={
                        "box": box,
                        "dominant_colors": emb_data["dominant_colors"],
                        "match_status": "UNCERTAIN",
                        "candidate_parent": best_candidate_id,
                        "topology_info": best_transition_info
                    }
                )
                db.add(db_hoff)
                db.commit()
                db.close()
            except Exception as db_err:
                logger.error(f"Failed to persist uncertain track candidate: {db_err}", exc_info=True)

            match_info = {
                "handoff_id": handoff_id,
                "global_track_id": new_gid,
                "candidate_parent": best_candidate_id,
                "match_status": "UNCERTAIN",
                "from_camera": best_transition_info.get("from_camera"),
                "to_camera": camera_id,
                "similarity_score": round(best_similarity, 3),
                "confidence": round(best_similarity, 3),
                "transit_seconds": round(best_transit_dt, 1),
                "dominant_colors": emb_data["dominant_colors"],
                "snapshot_b64": emb_data["snapshot_b64"],
                "topology_info": best_transition_info,
                "reason": f"Tentative appearance similarity ({round(best_similarity*100, 1)}%) in uncertainty window — logged for operator review"
            }

            logger.info(
                f"CROSS-CAMERA RE-ID UNCERTAIN: [{new_gid}] tentative link to {best_candidate_id} "
                f"(Similarity: {round(best_similarity * 100, 1)}%, Transit: {round(best_transit_dt, 1)}s)"
            )
            return new_gid, False, match_info

        else:
            # === 3. NEW GLOBAL TRACK (NO_MATCH or IMPOSSIBLE_TRANSITION) ===
            new_gid = self._generate_new_global_id()
            status_label = "ACTIVE"
            no_match_reason = "No candidate exceeded uncertainty threshold"
            if impossible_reasons and best_similarity < 0:
                no_match_reason = f"Transitions rejected by topology protection: {'; '.join(impossible_reasons[:2])}"

            with self.lock:
                self.active_tracks[new_gid] = {
                    "id": new_gid,
                    "entity_type": entity_type,
                    "status": status_label,
                    "current_camera": camera_id,
                    "previous_camera": None,
                    "first_seen_time": time_str,
                    "last_seen_time": time_str,
                    "last_seen_epoch": now,
                    "threat_score": 0,
                    "severity": "INFO",
                    "total_handoffs": 0,
                    "embedding": new_vec,
                    "dominant_colors": emb_data["dominant_colors"],
                    "snapshot_b64": emb_data["snapshot_b64"],
                    "movement_path": [
                        {
                            "from_camera": camera_id,
                            "to_camera": camera_id,
                            "time": time_str,
                            "transit_seconds": 0.0,
                            "similarity": 1.0,
                            "match_status": "NO_MATCH"
                        }
                    ]
                }
                self.local_to_global[local_key] = new_gid

            # Persist new GlobalTrack in database
            try:
                db = SessionLocal()
                existing = db.query(GlobalTrack).filter(GlobalTrack.id == new_gid).first()
                if not existing:
                    db_gt = GlobalTrack(
                        id=new_gid,
                        entity_type=entity_type,
                        status=status_label,
                        first_seen_camera=camera_id,
                        current_camera=camera_id,
                        previous_camera=None,
                        first_seen_time=time_str,
                        last_seen_time=time_str,
                        threat_score=0,
                        severity="INFO",
                        total_handoffs=0,
                        embedding_summary={
                            "dimension": emb_data["dimension"],
                            "dominant_colors": emb_data["dominant_colors"],
                            "vector": emb_data["vector"]
                        },
                        latest_snapshot_base64=emb_data["snapshot_b64"],
                        movement_path=self.active_tracks[new_gid]["movement_path"]
                    )
                    db.add(db_gt)
                    db.commit()
                db.close()
            except Exception as db_err:
                logger.error(f"Failed to persist new GlobalTrack: {db_err}", exc_info=True)

            match_info = {
                "global_track_id": new_gid,
                "match_status": "NO_MATCH",
                "from_camera": None,
                "to_camera": camera_id,
                "similarity_score": round(best_similarity, 3) if best_similarity > 0 else 0.0,
                "confidence": 1.0,
                "reason": no_match_reason
            }
            return new_gid, False, match_info

    def _generate_new_global_id(self) -> str:
        """Generates sequential, tactical global identity labels (e.g. GLOBAL-027)."""
        db = SessionLocal()
        try:
            while True:
                self.global_track_counter += 1
                cand_id = f"GLOBAL-{self.global_track_counter:03d}"
                exists = db.query(GlobalTrack).filter(GlobalTrack.id == cand_id).first()
                if not exists and cand_id not in self.active_tracks:
                    return cand_id
        finally:
            db.close()

    def get_all_global_tracks(self) -> List[Dict[str, Any]]:
        """Returns all global tracks sorted with active ones first."""
        db = SessionLocal()
        try:
            tracks = db.query(GlobalTrack).order_by(GlobalTrack.updated_at.desc()).limit(30).all()
            result = []
            for t in tracks:
                result.append({
                    "id": t.id,
                    "entity_type": t.entity_type,
                    "status": t.status,
                    "first_seen_camera": t.first_seen_camera,
                    "current_camera": t.current_camera,
                    "previous_camera": t.previous_camera,
                    "first_seen_time": t.first_seen_time,
                    "last_seen_time": t.last_seen_time,
                    "threat_score": 0,
                    "severity": "INFO",
                    "total_handoffs": t.total_handoffs,
                    "dominant_colors": t.embedding_summary.get("dominant_colors", {}) if t.embedding_summary else {},
                    "snapshot_base64": t.latest_snapshot_base64,
                    "movement_path": t.movement_path or []
                })
            return result
        finally:
            db.close()

    def get_track_dossier(self, global_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves full cross-camera handoff history and snapshots for a single global entity."""
        db = SessionLocal()
        try:
            gt = db.query(GlobalTrack).filter(GlobalTrack.id == global_id).first()
            if not gt:
                return None
            handoffs = db.query(TrackHandoff).filter(TrackHandoff.global_track_id == global_id).order_by(TrackHandoff.created_at.asc()).all()
            return {
                "id": gt.id,
                "entity_type": gt.entity_type,
                "status": gt.status,
                "first_seen_camera": gt.first_seen_camera,
                "current_camera": gt.current_camera,
                "previous_camera": gt.previous_camera,
                "first_seen_time": gt.first_seen_time,
                "last_seen_time": gt.last_seen_time,
                "threat_score": 0,
                "severity": "INFO",
                "total_handoffs": gt.total_handoffs,
                "dominant_colors": gt.embedding_summary.get("dominant_colors", {}) if gt.embedding_summary else {},
                "snapshot_base64": gt.latest_snapshot_base64,
                "movement_path": gt.movement_path or [],
                "handoffs": [
                    {
                        "id": h.id,
                        "from_camera": h.from_camera,
                        "to_camera": h.to_camera,
                        "local_track_id": h.local_track_id,
                        "timestamp": h.timestamp,
                        "transition_time_seconds": h.transition_time_seconds,
                        "similarity_score": h.similarity_score,
                        "confidence": h.confidence,
                        "snapshot_base64": h.snapshot_base64,
                        "metadata": h.metadata_json
                    }
                    for h in handoffs
                ]
            }
        finally:
            db.close()

    def set_config(
        self,
        threshold: Optional[float] = None,
        uncertainty_threshold: Optional[float] = None,
        max_transit: Optional[float] = None
    ):
        """Allows dynamic operator configuration of Re-ID sensitivity."""
        with self.lock:
            if threshold is not None:
                self.similarity_threshold = max(0.40, min(0.95, float(threshold)))
            if uncertainty_threshold is not None:
                self.uncertainty_threshold = max(0.30, min(self.similarity_threshold - 0.05, float(uncertainty_threshold)))
            if max_transit is not None:
                self.max_transit_seconds = max(5.0, min(600.0, float(max_transit)))
        logger.info(
            f"Re-ID config updated: threshold={self.similarity_threshold}, "
            f"uncertainty={self.uncertainty_threshold}, max_transit={self.max_transit_seconds}s"
        )

    # Topology delegation methods
    def register_camera(self, camera_id: str):
        self.topology.register_camera(camera_id)

    def set_camera_edge(
        self,
        from_cam: str,
        to_cam: str,
        min_transit: float = 1.0,
        max_transit: float = 180.0,
        is_connected: bool = True,
        corridor_name: str = "",
        bidirectional: bool = True
    ):
        self.topology.set_edge(
            from_cam, to_cam, min_transit, max_transit, is_connected, corridor_name, bidirectional
        )

    def remove_camera_edge(self, from_cam: str, to_cam: str, bidirectional: bool = True):
        self.topology.remove_edge(from_cam, to_cam, bidirectional)

    def get_topology(self) -> Dict[str, Any]:
        return self.topology.get_topology()


# Global Re-ID singleton instance
reid_service = ReIDService()
