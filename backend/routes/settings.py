from fastapi import APIRouter, Depends

from database import get_db
from models import Settings
from schemas import SettingsIn
from websocket import manager

router = APIRouter(prefix="/api/settings", tags=["Settings"])


@router.get("", response_model=SettingsIn)
def settings(db=Depends(get_db)):
    return db.get(Settings, 1)


@router.put("", response_model=SettingsIn)
async def save_settings(data: SettingsIn, db=Depends(get_db)):
    row = db.get(Settings, 1)
    for key, value in data.model_dump().items():
        setattr(row, key, value)
    db.commit()
    manager.broadcast({"type": "settings_changed"})
    return row
