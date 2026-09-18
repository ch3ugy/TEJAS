# TEJAS — Threat Evaluation & Joint AI Surveillance

> **Tagline:** *From CCTV to Border Intelligence*  
> **Smart India Hackathon (SIH) — Autonomous AI Surveillance & Tactical Threat Intelligence Platform**  
> **Phase 3 Production Hardening & Operational Readiness Baseline**

---

## 1. Executive Summary

**TEJAS** is an AI-driven, software-defined surveillance and tactical intelligence platform designed for high-security border perimeters, forward operating bases, and critical infrastructure installations.

Rather than functioning as isolated, disconnected object detectors that flood duty operators with noisy alerts, TEJAS grounds surveillance in a rigorous operational hierarchy:

$$\mathbf{DETECTION \neq EVENT \neq ALERT \neq INCIDENT}$$
$$\mathbf{UNKNOWN \neq HOSTILE}$$

Every operational alert produced by TEJAS answers:
- **WHAT** happened (the operational event type)
- **WHERE** (exact camera, calibrated coordinates, and virtual zone)
- **WHEN** (UTC epoch and timestamped chronology)
- **WHICH** entity (local tracking ID and cross-camera global identity)
- **WHAT** context existed (patrol status, biometric verification, night-time posture)
- **WHAT** evidence was captured (physical crop, snapshot, metadata hash)
- **WHY** it was surfaced (clear operational reasoning)

---

## 2. Core Architecture

```
                       CCTV / RTSP / HARDWARE INGESTION
                                      │
                                      ▼
                        CAMERA MANAGER (Multi-Pipeline)
                         ├── Dynamic Stream Probing (OpenCV)
                         ├── Independent Thread Isolation
                         └── Per-Camera Lifecycle & Auto-Reconnect
                                      │
               ┌──────────────────────┼──────────────────────┐
               ▼                      ▼                      ▼
        YOLOv8 + ByteTrack       YuNet + SFace          Classical ANPR
      (People, Vehicles, Bags) (Biometric Quality Gate) (CLAHE / Lanczos Sinc)
               │                      │                      │
               └──────────────────────┼──────────────────────┘
                                      ▼
                               EVENT ENGINE
                         ├── Spatial State Machine (ZONE_ENTRY / LOITERING / ZONE_EXIT)
                         ├── Cross-Camera Topology Corridors (min/max transit bounds)
                         └── Multi-Camera Isolation
                                      │
                                      ▼
                         OPERATIONAL ALERT ENGINE
                    (INFO  │  NOTICE  │  ALERT  │  PRIORITY)
                                      │
                                      ▼
                        INCIDENT & EVIDENCE ENGINE
                         ├── Physical Crop & Snapshot Storage
                         └── Operator Triage & Dispatch Audit Trail
                                      │
                        ┌─────────────┴─────────────┐
                        ▼                           ▼
                 REST API (FastAPI)         WebSockets (/ws/events)
                        │                           │
                        └─────────────┬─────────────┘
                                      ▼
                         TEJAS TACTICAL COMMAND UI
                      (React / Vite / Tailwind CSS / Leaflet)
```

---

## 3. Operational Alert Hierarchy (No Threat Scores)

TEJAS strictly rejects arbitrary, uncalibrated numerical threat scores (e.g. `0–100` scores or arbitrary deductions like `-30`). All decisions are evaluated according to 4 discrete operational alert levels:

| Level | Operational Meaning | System Action | Examples |
|---|---|---|---|
| **INFO** | Normal logged activity; expected or authorized events | Logged to timeline; zero operator disturbance | Authorized staff patrol, clear license plate, routine vehicle transit |
| **NOTICE** | Tactical advisory; infrastructure or notable conditions | Surface in advisory feed; no siren/pop-up | Camera offline/online, unknown face with low quality, minor transit delay |
| **ALERT** | Operational awareness required; actionable perimeter event | Surface on dashboard with alert modal and audio cue | Unknown person entering restricted polygon zone, prolonged loitering |
| **PRIORITY** | Immediate threat response required; critical breach or match | High-priority modal, dispatch prompt, persistent incident banner | Watchlist person match, watchlist plate match, border fence breach |

---

## 4. Key Subsystems

### A. Cross-Camera Re-ID & Topology Engine (`reid_service.py`)
- **Corridor Constraints**: Pairwise camera corridors enforce minimum transit times (preventing impossible teleportation) and maximum transit windows (preventing stale track association).
- **Appearance Embeddings**: Color-spatial histogram and deep feature vectors matched via cosine similarity with distinct probabilistic tiers:
  - $\ge 0.72$: Definite Identity Match (`MATCH`)
  - $0.55 - 0.72$: Probabilistic Uncertainty (`UNCERTAIN`)
  - $< 0.55$: Separate Global Entity (`NO_MATCH`)
- **Strict Mode**: Unconfigured transitions between unconnected cameras are strictly rejected in high-security posture.

### B. Biometric Face Recognition (`face_service.py`)
- **Detector**: OpenCV YuNet lightweight ONNX face detector.
- **Embedder**: OpenCV SFace 128-dimensional biometric embedding model.
- **Quality Gate**: Minimum crop size, brightness/contrast normalization, and Laplacian variance blur rejection. Degraded crops evaluate neutrally as `UNVERIFIED` rather than triggering false alerts.

### C. Classical Optical ANPR (`anpr_service.py`)
- **Real Optical Enhancement**: Lanczos sinc interpolation, Adaptive Contrast-Limited Histogram Equalization (CLAHE), bilateral denoising, and unsharp masking. Zero neural hallucination.
- **Syntax Normalization**: Resolves optical ambiguities (e.g., `'O'` vs `'0'`) based on standard Indian MoRTH registration plate grammar (`[STATE 2A][DISTRICT 2D][SERIES 2A][NUMBER 4D]`).
- **Watchlist Matching**: Direct indexed query against flagged database vehicles.

### D. Polygonal Zone Spatial State Machine (`event_engine.py`)
- Scaled normalized polygon contours ($0.0 - 100.0\%$).
- Single one-shot `ZONE_ENTRY` on penetration.
- Single one-shot `LOITERING` incident emitted when dwell time exceeds configurable threshold.
- Single one-shot `ZONE_EXIT` upon clearing boundary.
- Full multi-person and multi-camera thread-safe isolation.

---

## 5. Security & Authentication (RBAC)

TEJAS implements real bcrypt password hashing and HS256 JWT access tokens with three operational roles:

| Role | Permissions | Default Credentials |
|---|---|---|
| **ADMIN** | Full system control: Add/Delete cameras, user management, calibrate zones, adjust thresholds | `admin` / `tejas_admin_2026` |
| **OPERATOR** | Incident triage, live stream viewing, patrol verification, acknowledgement | `operator.rawat` / `tejas_op_2026` |
| **VIEWER** | Read-only observation of dashboard and live feeds; settings & control disabled | `viewer` / `tejas_viewer_2026` |

---

## 6. Quickstart Guide

### Prerequisites
- Python 3.10+ (Recommended: Python 3.11 / 3.12 / 3.13)
- Node.js 18+ and npm
- Optional: RTSP IP Camera or USB Webcam (Index `0`)

### Backend Setup
```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Backend Swagger API Docs: `http://localhost:8000/docs`

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Frontend Tactical Dashboard: `http://localhost:5173`

### Docker Deployment
```bash
docker-compose up -d --build
```

---

## 7. Verification & Regression Testing

Run the end-to-end regression test suite to validate all 28 Phase 3 checkpoints:
```bash
python scratch/test_full_system_regression.py
```
All tests validate:
- Zero numerical threat scores across decision trees
- Strict operational alert gating
- Real camera topology transit validation
- Face biometric quality rejection
- ANPR plate normalization and optical enhancement
- Token issuance and password security
