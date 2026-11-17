import os
from dotenv import load_dotenv

load_dotenv()


def _ids(raw: str) -> set[int]:
    return {int(x) for x in raw.split(",") if x.strip().isdigit()}


TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
SA_FILE = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json")
SHEET_ID = os.getenv("GOOGLE_SHEET_ID", "")
WORKSHEET = os.getenv("GOOGLE_WORKSHEET", "Sheet1")
DEFAULT_REGION = os.getenv("DEFAULT_PHONE_REGION", "SA")
ALLOWED_USER_IDS = _ids(os.getenv("ALLOWED_USER_IDS", ""))
DB_PATH = os.getenv("DB_PATH", "leads.db")
