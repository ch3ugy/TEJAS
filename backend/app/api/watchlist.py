from typing import List
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import WatchlistEntry
from app.schemas.schemas import WatchlistCreate, WatchlistResponse

router = APIRouter(prefix="/watchlist", tags=["Watchlist"])

INITIAL_WATCHLIST = [
    {
        "id": "WL-001",
        "type": "VEHICLE",
        "identifier": "MP09AB1234",
        "title": "Black Scorpio SUV",
        "threat_level": "CRITICAL",
        "category": "Suspected Reconnaissance",
        "date_added": "2026-08-14",
        "notes": "Reported casing border outpost perimeters during night hours. High interception priority.",
        "last_seen": "Border Rd Checkpoint 12 (10:14 AM)",
        "status": "ACTIVE_ALERT"
    },
    {
        "id": "WL-002",
        "type": "VEHICLE",
        "identifier": "DL01CA4092",
        "title": "White Bolero Pickup",
        "threat_level": "HIGH",
        "category": "Contraband Suspect",
        "date_added": "2026-08-28",
        "notes": "Repeated unauthorized night entries reported near Sector B culvert.",
        "last_seen": "Gate 01 Logistics (Yesterday)",
        "status": "FLAGGED"
    },
    {
        "id": "WL-003",
        "type": "PERSON",
        "identifier": "SUSPECT-994",
        "title": "Unidentified Male (Cross-border Courier)",
        "threat_level": "CRITICAL",
        "category": "Border Infiltration",
        "date_added": "2026-09-01",
        "notes": "Associated with night wire breach attempts near BOP-03.",
        "last_seen": "Sector A (Today 10:21 AM)",
        "status": "TRACKING_ACTIVE"
    }
]

@router.get("", response_model=List[WatchlistResponse])
def get_watchlist(db: Session = Depends(get_db)):
    entries = db.query(WatchlistEntry).all()
    if not entries:
        for item in INITIAL_WATCHLIST:
            db.add(WatchlistEntry(**item))
        db.commit()
        entries = db.query(WatchlistEntry).all()
    return entries

@router.post("", response_model=WatchlistResponse)
def add_watchlist_entry(payload: WatchlistCreate, db: Session = Depends(get_db)):
    wl_id = f"WL-00{db.query(WatchlistEntry).count() + 1}"
    entry = WatchlistEntry(
        id=wl_id,
        date_added="2026-09-13",
        last_seen="Not yet observed",
        status="ACTIVE_ALERT",
        **payload.model_dump()
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry

@router.delete("/{entry_id}")
def delete_watchlist_entry(entry_id: str, db: Session = Depends(get_db)):
    entry = db.query(WatchlistEntry).filter(WatchlistEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return {"status": "DELETED", "id": entry_id}
