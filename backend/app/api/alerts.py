"""
TEJAS Alerts API — Phase 2
Returns real alerts from DB only. No seeded demo data.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Alert
from app.schemas.schemas import AlertResponse

router = APIRouter(prefix="/alerts", tags=["Alerts"])


@router.get("", response_model=List[AlertResponse])
def get_alerts(
    db: Session = Depends(get_db),
    limit: int = Query(default=100, le=500),
    unacknowledged_only: bool = Query(default=False),
):
    """Returns real operational alerts from the database, newest first."""
    q = db.query(Alert).order_by(Alert.created_at.desc())
    if unacknowledged_only:
        q = q.filter(Alert.acknowledged == False)
    return q.limit(limit).all()


@router.post("/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    db.commit()
    return {"status": "ACKNOWLEDGED", "id": alert_id}
