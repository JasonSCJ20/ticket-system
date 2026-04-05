# Import Pydantic BaseSettings for configuration management
from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict

# Define Settings class inheriting from BaseSettings for environment variable handling
class Settings(BaseSettings):
    # Database URL with default SQLite path
    DATABASE_URL: str = "sqlite:///./ticket_system.db"
    # Telegram bot token for API access (must be set in .env)
    TELEGRAM_BOT_TOKEN: str = ""
    # Webhook path for Telegram bot updates
    TELEGRAM_WEBHOOK_PATH: str = "/webhook/telegram"
    # Chat ID for sending monthly reports
    MONTHLY_REPORT_CHAT_ID: int = 0
    # Secret key for JWT token signing (change in production)
    SECRET_KEY: str = "PLEASE_CHANGE_ME"

    # Configuration for Pydantic settings
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )

# Instantiate settings object
settings = Settings()
