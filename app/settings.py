import os
from pydantic import BaseModel

class Settings(BaseModel):
    app_env: str = os.getenv("APP_ENV", "dev")

    allowed_origins: list[str] = [
        o.strip() for o in os.getenv(
            "ALLOWED_ORIGINS",
            "https://obearchitects.com,https://www.obearchitects.com,http://client.local:5500,http://localhost:5500"
        ).split(",") if o.strip()
    ]

    admin_api_key: str = os.getenv("ADMIN_API_KEY", "dev_key")

    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    postgres_dsn: str = os.getenv("POSTGRES_DSN", "postgresql://postgres:postgres@localhost:5432/postgres")
    sendgrid_api_key: str = os.getenv("SENDGRID_API_KEY", "")
    email_from: str = os.getenv("EMAIL_FROM", "")
    leads_notify_to: str = os.getenv("LEADS_NOTIFY_TO", "")
    handoff_notify_to: str = os.getenv("HANDOFF_NOTIFY_TO", "")

    ig_verify_token: str = os.getenv("IG_WEBHOOK_VERIFY_TOKEN", "")
    wa_verify_token: str = os.getenv("WHATSAPP_VERIFY_TOKEN", os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", ""))
    wa_app_secret: str = os.getenv("WHATSAPP_APP_SECRET", "")
    wa_access_token: str = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
    wa_phone_number_id: str = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
    wa_graph_version: str = os.getenv("WHATSAPP_GRAPH_VERSION", "v20.0")
    wa_mock_send: bool = os.getenv("WHATSAPP_MOCK_SEND", "").strip().lower() in {"1", "true", "yes", "on"}

settings = Settings()


def validate_settings() -> None:
    if settings.app_env != "production":
        return

    missing = []

    def _req(name: str, value: str) -> None:
        if not (value or "").strip():
            missing.append(name)

    _req("POSTGRES_DSN", settings.postgres_dsn)
    _req("REDIS_URL", settings.redis_url)
    _req("ADMIN_API_KEY", settings.admin_api_key)
    _req("SENDGRID_API_KEY", settings.sendgrid_api_key)
    _req("EMAIL_FROM", settings.email_from)
    _req("LEADS_NOTIFY_TO", settings.leads_notify_to)

    # WhatsApp is optional, but if any WA config is set, require core vars.
    wa_any = any([
        (settings.wa_verify_token or "").strip(),
        (settings.wa_access_token or "").strip(),
        (settings.wa_phone_number_id or "").strip(),
    ])
    if wa_any:
        _req("WHATSAPP_VERIFY_TOKEN", settings.wa_verify_token)
        _req("WHATSAPP_ACCESS_TOKEN", settings.wa_access_token)
        _req("WHATSAPP_PHONE_NUMBER_ID", settings.wa_phone_number_id)

    if missing:
        raise RuntimeError(f"Missing required production env vars: {', '.join(missing)}")

    if settings.admin_api_key in {"dev_key", "change_me", "replace_with_long_random_admin_key"}:
        raise RuntimeError("ADMIN_API_KEY must be set to a strong non-default value in production")
