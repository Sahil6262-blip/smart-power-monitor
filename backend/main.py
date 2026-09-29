from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from config import get_config
from routes import alerts, consumption, history, live, predictions, reports, settings
from services.runtime import runtime


@asynccontextmanager
async def lifespan(app):
    await runtime.start()
    yield
    await runtime.stop()


app = FastAPI(
    title="Smart Power Monitor",
    version="1.0.0",
    lifespan=lifespan,
    description="Single-meter monitoring with a simulated source and an authenticated hardware ingestion adapter.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_config().origins,
    allow_methods=["GET", "POST", "PUT", "PATCH"],
    allow_headers=["Content-Type", "X-Ingest-Key"],
)
for module in (live, consumption, history, alerts, settings, reports, predictions):
    app.include_router(module.router)


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, exc: SQLAlchemyError):
    return JSONResponse(
        status_code=503, content={"detail": "Database temporarily unavailable. Please retry."}
    )
