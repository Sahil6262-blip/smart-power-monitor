import csv
import io

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from database import get_db
from routes.history import bounds
from schemas import Summary
from services.calculations import summarize

router = APIRouter(prefix="/api/reports", tags=["Reports"])


@router.get("", response_model=Summary)
def report(window=Depends(bounds), db=Depends(get_db)):
    return summarize(db, *window)


@router.get("/export")
def export_report(window=Depends(bounds), db=Depends(get_db)):
    summary = summarize(db, *window)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["metric", "value"])
    writer.writerows(summary.model_dump(mode="json").items())
    return Response(
        buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="power-summary.csv"'},
    )
