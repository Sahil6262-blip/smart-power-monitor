import csv
import io
import math
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from database import SessionLocal, get_db
from models import Reading
from schemas import HistoryResponse, ReadingOut, TrendPoint
from services.calculations import period_bounds, reading_filter

router = APIRouter(prefix="/api/history", tags=["History"])


def bounds(range: str = "today", start: datetime | None = None, end: datetime | None = None):
    try:
        return period_bounds(range, start, end)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("", response_model=HistoryResponse)
def history(
    window=Depends(bounds),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=200),
    db=Depends(get_db),
):
    filters = reading_filter(*window)
    total = db.scalar(select(func.count(Reading.id)).where(*filters))
    rows = db.scalars(
        select(Reading)
        .where(*filters)
        .order_by(Reading.timestamp.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return HistoryResponse(
        items=[ReadingOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/trend", response_model=list[TrendPoint])
def trend(window=Depends(bounds), points: int = Query(180, ge=10, le=1000), db=Depends(get_db)):
    # Window-function sampling bounds both the response and browser memory.
    filters = reading_filter(*window)
    total = db.scalar(select(func.count(Reading.id)).where(*filters))
    step = max(1, math.ceil(total / points))
    ranked = (
        select(Reading, func.row_number().over(order_by=Reading.timestamp).label("rn"))
        .where(*filters)
        .subquery()
    )
    rows = db.execute(
        select(ranked)
        .where((ranked.c.rn % step == 0) | (ranked.c.rn == total))
        .order_by(ranked.c.timestamp)
    ).mappings()
    return [TrendPoint(**dict(r)) for r in rows]


@router.get("/export")
def export_history(window=Depends(bounds)):
    def generate():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        fields = [
            "timestamp",
            "source",
            "voltage",
            "current",
            "power",
            "energy",
            "frequency",
            "power_factor",
            "energy_delta",
        ]
        writer.writerow(fields)
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        with SessionLocal() as db:
            rows = db.scalars(
                select(Reading)
                .where(*reading_filter(*window))
                .order_by(Reading.timestamp)
                .execution_options(yield_per=1000)
            )
            for row in rows:
                writer.writerow(
                    [
                        getattr(row, f).isoformat() if f == "timestamp" else getattr(row, f)
                        for f in fields
                    ]
                )
                yield buffer.getvalue()
                buffer.seek(0)
                buffer.truncate(0)

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="power-readings.csv"'},
    )
