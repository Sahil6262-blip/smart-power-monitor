from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from config import get_config
from database import get_db, utcnow
from models import Alert
from schemas import AlertOut, AlertUpdate
from websocket import manager

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


@router.get("", response_model=list[AlertOut])
@router.get("/history", response_model=list[AlertOut])
def alerts(
    status: Literal["active", "acknowledged", "resolved", "open"] | None = None,
    severity: Literal["info", "warning", "critical"] | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db=Depends(get_db),
):
    query = select(Alert).where(Alert.source == get_config().source)
    if status:
        query = query.where(
            Alert.status != "resolved" if status == "open" else Alert.status == status
        )
    if severity:
        query = query.where(Alert.severity == severity)
    if (
        (start and start.tzinfo is None)
        or (end and end.tzinfo is None)
        or (start and end and start >= end)
    ):
        raise HTTPException(422, "Provide an ordered timezone-aware date range")
    if start:
        query = query.where(Alert.timestamp >= start)
    if end:
        query = query.where(Alert.timestamp < end)
    return db.scalars(query.order_by(Alert.timestamp.desc()).offset(offset).limit(limit)).all()


@router.patch("/{alert_id}", response_model=AlertOut)
async def update_alert(alert_id: int, data: AlertUpdate, db=Depends(get_db)):
    alert = db.get(Alert, alert_id)
    if not alert or alert.source != get_config().source:
        raise HTTPException(404, "Alert not found")
    if alert.status == "resolved" and data.status != "resolved":
        raise HTTPException(409, "Resolved alerts cannot be acknowledged")
    alert.status = data.status
    if data.status == "acknowledged":
        alert.acknowledged_at = utcnow()
    else:
        alert.resolved_at = utcnow()
    db.commit()
    result = AlertOut.model_validate(alert)
    manager.broadcast({"type": "alerts_changed", "alerts": [result.model_dump(mode="json")]})
    return result
