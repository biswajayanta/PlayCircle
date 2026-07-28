from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PLAYCIRCLE_", env_file=".env", extra="ignore")

    DB_HOST: str = "127.0.0.1"
    PORT: int = 5432
    USER: str = "postgres"
    PASSWORD: str = "Maddy14@"
    NAME: str = "playcircle"

    
    # JWT_SECRET_KEY MUST be overridden via env var in any real deployment —
    # this default only exists so local dev works without extra setup.
    JWT_SECRET_KEY: str = "dev-only-insecure-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 14  # 14 days

    @property
    def db_dsn(self) -> str:
        # PASSWORD may contain special characters (e.g. literal '@'), so it must be
        # percent-encoded or asyncpg's DSN parser breaks on the extra '@'.
        user = quote_plus(self.USER)
        password = quote_plus(self.PASSWORD)
        return f"postgresql://{user}:{password}@{self.DB_HOST}:{self.PORT}/{self.NAME}"


settings = Settings()
