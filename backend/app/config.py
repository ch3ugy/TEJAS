import os
from pydantic import BaseModel

def _load_env_file():
    candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env")),
        os.path.abspath(".env")
    ]
    for env_path in candidates:
        if os.path.exists(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k, v = k.strip(), v.strip().strip("'").strip('"')
                            if k not in os.environ:
                                os.environ[k] = v
            except Exception:
                pass

_load_env_file()

class Settings(BaseModel):
    PROJECT_NAME: str = "TEJAS — Threat Evaluation & Joint AI Surveillance"
    VERSION: str = "2.4.0"
    API_V1_STR: str = "/api"
    DEFAULT_DB_FILE: str = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "tejas.db")).replace("\\", "/")
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_FILE}")
    SECRET_KEY: str = os.getenv("SECRET_KEY", "tejas_border_intelligence_secret_key_2026_sih")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    CORS_ORIGINS: list[str] = ["*"]
    EVIDENCE_DIR: str = os.getenv(
        "EVIDENCE_DIR",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "evidence"))
    )
    FACE_ENROLL_DIR: str = os.getenv(
        "FACE_ENROLL_DIR",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "faces"))
    )
    FACE_RECOGNITION_ENABLED: bool = True
    FACE_SIMILARITY_THRESHOLD: float = 0.40
    FACE_MIN_QUALITY_SCORE: float = 0.35
    VIDEO_SOURCE: str = os.getenv("VIDEO_SOURCE", "webcam")
    WEBCAM_INDEX: int = int(os.getenv("WEBCAM_INDEX", "0"))
    TEJAS_RTSP_URL: str = os.getenv("TEJAS_RTSP_URL", "")
    VIDEO_FILE_PATH: str = os.getenv("VIDEO_FILE_PATH", "")

    TARGET_INFERENCE_FPS: int = int(os.getenv("TARGET_INFERENCE_FPS", "15"))
    INFERENCE_WIDTH: int = int(os.getenv("INFERENCE_WIDTH", "640"))
    INFERENCE_HEIGHT: int = int(os.getenv("INFERENCE_HEIGHT", "480"))
    ENABLE_ASYNC_PROTECTION: bool = os.getenv("ENABLE_ASYNC_PROTECTION", "true").lower() in ("true", "1", "yes")

    # Auth credential overrides (set in .env, never hardcode)
    ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "tejas_admin_2026")
    OPERATOR_USERNAME: str = os.getenv("OPERATOR_USERNAME", "operator")
    OPERATOR_PASSWORD: str = os.getenv("OPERATOR_PASSWORD", "tejas_op_2026")

    # Loitering threshold (seconds)
    LOITER_THRESHOLD_SECONDS: float = float(os.getenv("LOITER_THRESHOLD_SECONDS", "10.0"))

    # Single-camera person Re-ID (appearance-based persistent identity)
    REID_ENABLED: bool = os.getenv("REID_ENABLED", "true").lower() in ("true", "1", "yes")
    REID_MATCH_THRESHOLD: float = float(os.getenv("REID_MATCH_THRESHOLD", "0.72"))
    REID_UNCERTAIN_THRESHOLD: float = float(os.getenv("REID_UNCERTAIN_THRESHOLD", "0.55"))
    REID_BINDING_RELEASE_SECONDS: float = float(os.getenv("REID_BINDING_RELEASE_SECONDS", "4.0"))
    REID_GALLERY_TTL_SECONDS: float = float(os.getenv("REID_GALLERY_TTL_SECONDS", str(24 * 3600)))
    REID_MIN_CROP_WIDTH: int = int(os.getenv("REID_MIN_CROP_WIDTH", "24"))
    REID_MIN_CROP_HEIGHT: int = int(os.getenv("REID_MIN_CROP_HEIGHT", "50"))

    # Night hours for night-movement context
    NIGHT_START_HOUR: int = int(os.getenv("NIGHT_START_HOUR", "20"))
    NIGHT_END_HOUR: int = int(os.getenv("NIGHT_END_HOUR", "6"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

    def get_resolved_video_source(self):
        src = (self.VIDEO_SOURCE or "webcam").lower().strip()
        if src == "webcam":
            return self.WEBCAM_INDEX
        elif src == "rtsp":
            return self.TEJAS_RTSP_URL if self.TEJAS_RTSP_URL else self.WEBCAM_INDEX
        elif src in ("mp4", "file", "video"):
            return self.VIDEO_FILE_PATH if self.VIDEO_FILE_PATH else self.WEBCAM_INDEX
        return self.WEBCAM_INDEX

settings = Settings()


