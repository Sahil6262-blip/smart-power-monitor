from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    database_url: str = f"sqlite:///{(ROOT / 'data' / 'power.db').as_posix()}"
    app_env: str = "development"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    demo_mode: bool = False
    seed_demo_history: bool = False
    timezone: str = "Asia/Kolkata"
    ingest_api_key: str = ""

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value):
        ZoneInfo(value)
        return value

    @field_validator("database_url")
    @classmethod
    def postgres_driver(cls, value):
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return value.replace(prefix, "postgresql+psycopg://", 1)
        return value

    @model_validator(mode="after")
    def hardware_key(self):
        if not self.demo_mode and len(self.ingest_api_key) < 16:
            raise ValueError("Hardware mode requires INGEST_API_KEY of at least 16 characters")
        return self

    @property
    def source(self):
        return "demo" if self.demo_mode else "hardware"

    @property
    def origins(self):
        return [v.strip() for v in self.cors_origins.split(",") if v.strip()]


@lru_cache
def get_config():
    return Config()
