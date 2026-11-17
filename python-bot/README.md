# Exhibition Lead Scanner Bot

Telegram bot → Gemini vision (structured JSON) → SQLite → Google Sheets (real-time) → `/export` Excel.

## Setup
1. `python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt`
2. Create a bot with @BotFather → `TELEGRAM_BOT_TOKEN`.
3. Get a Gemini key at https://aistudio.google.com → `GEMINI_API_KEY`.
4. Google Sheets: create a Google Cloud service account, enable the Sheets + Drive APIs, download the JSON as `service_account.json`,
   create a spreadsheet, **share it with the service account's `client_email` (Editor)**, put its ID in `GOOGLE_SHEET_ID`.
5. `copy .env.example .env` and fill in values. Run: `python bot.py`

## Usage
Send a photo (or send as *File* for full resolution). Multiple cards/badges in one photo become separate rows.
Commands: `/export` (xlsx), `/stats`, `/sync` (retry failed Sheets pushes).

## Design notes
- **Structured outputs**: `ScanResult` pydantic schema (`app/schema.py`) enforced via Gemini `response_schema`, temperature 0.
- **Orientation/quality**: EXIF fix + downscale + autocontrast (`image_utils.py`); remaining rotation/skew handled by the model prompt.
- **Bilingual**: separate AR/EN name fields, never translated; Arabic-Indic digits converted.
- **Phones**: `phonenumbers` normalizes to international format using `DEFAULT_PHONE_REGION` for numbers with no country code; stored as text.
- **Industry**: always inferred in Arabic with consistent labels (prompt in `vision.py`; edit examples to match your sectors).
- **Resilience**: SQLite is the source of truth; duplicates (same phone/email/name) are skipped; failed Sheets pushes retry via `/sync`.
- Model default is `gemini-2.5-flash`; set `GEMINI_MODEL=gemini-2.5-pro` for highest accuracy (Gemini 1.5 is retired).

## Accuracy note
No OCR system guarantees literally 100%. The bot shows every extracted record back in chat so you can spot errors immediately,
and flags unreadable fields in `notes`.
