from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PLAYCIRCLE_", env_file=".env", extra="ignore")

    DB_HOST: str = "127.0.0.1"
    PORT: int = 5432
    USER: str = "postgres"
    PASSWORD: str = ""
    NAME: str = "playcircle"
    # Azure Database for PostgreSQL requires SSL by default; local dev doesn't use it.
    # Set PLAYCIRCLE_DB_SSL_MODE=require in Azure App Service configuration.
    DB_SSL_MODE: str = "disable"

    # JWT_SECRET_KEY MUST be overridden via env var in any real deployment —
    # this default only exists so local dev works without extra setup.
    JWT_SECRET_KEY: str = "dev-only-insecure-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 14  # 14 days

    # Comma-separated list, e.g. "https://playcircle.azurestaticapps.net,http://localhost:8081"
    # Defaults to "*" for local dev convenience; set a real value in production.
    CORS_ORIGINS_RAW: str = Field(default="*", alias="PLAYCIRCLE_CORS_ORIGINS")

    # For the in-app assistant (app/routers/assistant.py). Empty by default
    # so the app still starts without it configured — the assistant
    # endpoints just fail with a clear auth error from OpenAI until it's set.
    OPENAI_API_KEY: str = ""

    @property
    def CORS_ORIGINS(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS_RAW.split(",") if origin.strip()]

    @property
    def db_dsn(self) -> str:
        # PASSWORD may contain special characters (e.g. literal '@'), so it must be
        # percent-encoded or asyncpg's DSN parser breaks on the extra '@'.
        user = quote_plus(self.USER)
        password = quote_plus(self.PASSWORD)
        dsn = f"postgresql://{user}:{password}@{self.DB_HOST}:{self.PORT}/{self.NAME}"
        if self.DB_SSL_MODE != "disable":
            dsn += f"?sslmode={self.DB_SSL_MODE}"
        return dsn


settings = Settings()
