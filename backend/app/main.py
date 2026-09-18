"""
TEJAS FastAPI Application — Phase 2
Multi-camera CameraManager architecture.
Real JWT auth. No threat scores. No simulated data.
"""
from contextlib import asynccontextmanager

import time
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("tejas.core")

from app.config import settings
from app.database import engine, Base, run_database_migrations
from app.api import auth, cameras, events, incidents, alerts, anpr, zones, watchlist, threat_rules, analytics, video, tracking, face, patrol
from app.services.camera_manager import camera_manager
from app.services.face_service import face_service
from app.websocket.connection_manager import manager

import app.models.models
# Create all database tables + apply non-destructive migrations
Base.metadata.create_all(bind=engine)
run_database_migrations()


def _seed_initial_data():
    """Seeds the primary webcam camera and a default zone if the DB is empty."""
    from app.database import SessionLocal
    from app.models.models import Camera, Zone

    db = SessionLocal()
    try:
        if not db.query(Camera).filter(Camera.code == "CAM-00").first():
            db.add(Camera(
                id="CAM-00",
                code="CAM-00",
                name="Primary Webcam",
                location="Command Console",
                lat=32.7266,
                lng=74.8570,
                status="ONLINE",
                fps=settings.TARGET_INFERENCE_FPS,
                resolution=f"{settings.INFERENCE_WIDTH}x{settings.INFERENCE_HEIGHT}",
                stream_type="HARDWARE",
                stream_url=str(settings.get_resolved_video_source()),
                ai_enabled=True,
            ))

        if not db.query(Zone).filter(Zone.camera_code == "CAM-00").first():
            db.add(Zone(
                id="ZONE-00",
                name="Webcam Default Restricted Zone",
                type="RESTRICTED",
                color="#EF4444",
                camera_code="CAM-00",
                threat_weight=0,
                points_json=[
                    {"x": 15, "y": 20},
                    {"x": 85, "y": 20},
                    {"x": 85, "y": 85},
                    {"x": 15, "y": 85},
                ],
                rule_triggers=[],
                fence_type="3D",
                fence_depth=2.5,
            ))

        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    # Store running event loop for thread-safe WS broadcasts
    manager.set_loop(asyncio.get_running_loop())

    # Seed DB defaults
    _seed_initial_data()

    # Seed real users (bcrypt hashed)
    from app.api.auth import seed_default_users
    seed_default_users()

    # Reload enrolled faces
    from app.database import SessionLocal
    init_db = SessionLocal()
    try:
        face_service.reload_enrolled_faces(init_db)
    finally:
        init_db.close()

    # Start primary webcam pipeline
    primary_source = settings.get_resolved_video_source()
    camera_manager.start_camera("CAM-00", primary_source)
    camera_manager.reload_zones("CAM-00")

    yield

    # Shutdown all pipelines cleanly
    camera_manager.stop_all()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Threat Evaluation & Joint AI Surveillance — Phase 2",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_timing_and_security_headers(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - start_time) * 1000, 2)
    response.headers["X-Response-Time-Ms"] = str(duration_ms)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    if duration_ms > 500:
        logger.warning(f"Slow request: {request.method} {request.url.path} took {duration_ms}ms")
    return response


@app.exception_handler(Exception)
async def global_unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled server error on {request.method} {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if settings.LOG_LEVEL == "DEBUG" else "An unexpected error occurred. Please contact the administrator.",
            "path": request.url.path
        }
    )

# ── API Routers ────────────────────────────────
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(cameras.router, prefix=settings.API_V1_STR)
app.include_router(video.router, prefix=settings.API_V1_STR)
app.include_router(events.router, prefix=settings.API_V1_STR)
app.include_router(incidents.router, prefix=settings.API_V1_STR)
app.include_router(alerts.router, prefix=settings.API_V1_STR)
app.include_router(anpr.router, prefix=settings.API_V1_STR)
app.include_router(zones.router, prefix=settings.API_V1_STR)
app.include_router(watchlist.router, prefix=settings.API_V1_STR)
app.include_router(threat_rules.router, prefix=settings.API_V1_STR)
app.include_router(analytics.router, prefix=settings.API_V1_STR)
app.include_router(tracking.router, prefix=settings.API_V1_STR)
app.include_router(face.router, prefix=settings.API_V1_STR)
app.include_router(patrol.router, prefix=settings.API_V1_STR)


@app.get("/")
def root():
    return {
        "platform": "TEJAS",
        "version": settings.VERSION,
        "phase": "Phase 2",
        "status": "OPERATIONAL",
        "active_cameras": camera_manager.list_active(),
        "docs_url": "/docs",
    }


@app.get("/api/health")
def health_check():
    return {
        "status": "HEALTHY",
        "service": "TEJAS Surveillance Core",
        "version": settings.VERSION,
        "active_cameras": camera_manager.list_active(),
    }


@app.websocket("/ws/events")
async def websocket_events_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_json({"type": "ACK", "payload": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
