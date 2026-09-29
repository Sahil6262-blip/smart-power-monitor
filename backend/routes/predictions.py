from fastapi import APIRouter

from schemas import PredictionsResponse

router = APIRouter(prefix="/api/predictions", tags=["Future AI"])


@router.get("", response_model=PredictionsResponse)
def predictions():
    return PredictionsResponse(
        capabilities=[
            "Abnormal consumption detection",
            "Daily energy prediction",
            "Monthly energy forecast",
            "Peak demand prediction",
            "Energy-saving recommendations",
        ],
        message="No trained model is connected. Predictions are unavailable.",
    )
