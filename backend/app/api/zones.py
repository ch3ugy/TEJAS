from typing import List, Optional
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import Zone
from app.schemas.schemas import ZoneCreate, ZoneUpdate, ZoneResponse
from app.services.camera_manager import camera_manager

logger = logging.getLogger("tejas.api.zones")

router = APIRouter(prefix="/zones", tags=["Zones"])

INITIAL_ZONES = [
    {
        "id": "ZONE-01",
        "name": "Sector B Restricted Perimeter",
        "type": "RESTRICTED",
        "color": "#EF4444",
        "camera_code": "RESTRICTED-Z01",
        "threat_weight": 30,
        "points_json": [{"x": 15, "y": 35}, {"x": 85, "y": 30}, {"x": 90, "y": 85}, {"x": 10, "y": 85}],
        "rule_triggers": ["Intrusion", "Loitering > 60s"],
        "fence_type": "2D",
        "fence_depth": 0.0,
    },
    {
        "id": "ZONE-02",
        "name": "Ammunition Storage Buffer",
        "type": "SENSITIVE",
        "color": "#F59E0B",
        "camera_code": "BOP-04",
        "threat_weight": 20,
        "points_json": [{"x": 30, "y": 25}, {"x": 80, "y": 25}, {"x": 80, "y": 75}, {"x": 30, "y": 75}],
        "rule_triggers": ["Directional Vector", "Unattended Object"],
        "fence_type": "3D",
        "fence_depth": 3.5,
    },
    {
        "id": "ZONE-03",
        "name": "North Outpost Approach Line",
        "type": "BORDER",
        "color": "#06B6D4",
        "camera_code": "BOP-03",
        "threat_weight": 15,
        "points_json": [{"x": 5, "y": 60}, {"x": 95, "y": 55}, {"x": 95, "y": 95}, {"x": 5, "y": 95}],
        "rule_triggers": ["Night Motion", "Human Entry"],
        "fence_type": "3D",
        "fence_depth": 5.0,
    }
]


@router.get("", response_model=List[ZoneResponse])
def get_zones(camera_code: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Zone)
    if camera_code:
        query = query.filter(Zone.camera_code == camera_code)
    zones = query.all()
    if not zones and not camera_code:
        for item in INITIAL_ZONES:
            db.add(Zone(**item))
        db.commit()
        zones = db.query(Zone).all()
    return zones


@router.get("/{zone_id}", response_model=ZoneResponse)
def get_zone(zone_id: str, db: Session = Depends(get_db)):
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone


@router.post("", response_model=ZoneResponse)
def create_zone(payload: ZoneCreate, db: Session = Depends(get_db)):
    zone_id = f"ZONE-{uuid.uuid4().hex[:6].upper()}"
    db_zone = Zone(id=zone_id, **payload.model_dump())
    db.add(db_zone)
    db.commit()
    db.refresh(db_zone)

    # Hot reload zones across running camera pipelines
    camera_manager.reload_zones(db_zone.camera_code)
    logger.info(f"Created zone {db_zone.id} for camera {db_zone.camera_code} with {len(db_zone.points_json)} vertices")
    return db_zone


@router.put("/{zone_id}", response_model=ZoneResponse)
def update_zone(zone_id: str, payload: ZoneUpdate, db: Session = Depends(get_db)):
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    update_dict = payload.model_dump(exclude_unset=True)
    for k, v in update_dict.items():
        setattr(zone, k, v)

    db.commit()
    db.refresh(zone)

    # Hot reload zones for camera pipeline
    camera_manager.reload_zones(zone.camera_code)
    logger.info(f"Updated zone {zone_id} ({zone.name}) - hot reloaded in pipeline")
    return zone


@router.delete("/{zone_id}")
def delete_zone(zone_id: str, db: Session = Depends(get_db)):
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    cam_code = zone.camera_code
    db.delete(zone)
    db.commit()

    camera_manager.reload_zones(cam_code)
    logger.info(f"Deleted zone {zone_id} - hot reloaded pipeline for camera {cam_code}")
    return {"status": "DELETED", "id": zone_id}


