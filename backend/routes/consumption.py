from typing import Literal

from fastapi import APIRouter, Depends

from database import get_db
from models import Settings
from schemas import Budget, ConsumptionResponse
from services.calculations import consumption_buckets, month_budget, period_bounds, summarize

router = APIRouter(prefix="/api/consumption", tags=["Consumption"])


@router.get("/budget", response_model=Budget)
def budget(db=Depends(get_db)):
    return month_budget(db, db.get(Settings, 1))


@router.get("/{period}", response_model=ConsumptionResponse)
def consumption(
    period: Literal["today", "week", "month", "30d"],
    granularity: Literal["hourly", "daily", "weekly", "monthly"] | None = None,
    db=Depends(get_db),
):
    settings = db.get(Settings, 1)
    start, end = period_bounds(period)
    granularity = granularity or ("hourly" if period == "today" else "daily")
    return ConsumptionResponse(
        summary=summarize(db, start, end, settings),
        buckets=consumption_buckets(db, start, end, granularity, settings),
    )
