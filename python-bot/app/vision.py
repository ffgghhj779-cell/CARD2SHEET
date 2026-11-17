import asyncio
import base64
import logging

from openai import AsyncOpenAI

from . import config
from .phones import normalize_all
from .schema import Lead, ScanResult

log = logging.getLogger(__name__)
_client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)

SYSTEM_PROMPT = """You are a meticulous OCR and data-extraction engine for exhibition lead capture.
The image may contain ONE or SEVERAL business cards, exhibition badges/lanyards, or brochures.

RULES
1. Output one lead per unique person/company entity. A card and a badge belonging to the same
   person/company on the same table should be MERGED into a single lead (card_type of the richer one,
   mention the other in notes). Different people/companies -> separate leads.
2. The image may be rotated 90/180/270 degrees, skewed, or have glare/shadows. Mentally rotate it and
   read every piece of text, including small print and text on logos.
3. Bilingual: put Arabic names in full_name_ar and Latin-script names in full_name_en. If the card shows
   only one language, leave the other EMPTY - never translate or invent a name. Keep company_name as
   printed (if both languages exist: "Arabic / English").
4. Copy digits, e-mails and URLs EXACTLY. Convert Arabic-Indic digits to 0-9. Never guess missing digits;
   if a character is unreadable, keep the rest and add a note "unclear: <field>".
5. Phones: include ALL numbers (mobile, landline, WhatsApp, fax is excluded -> put fax in notes).
   primary_phone = the mobile/main contact number. Keep the country code as printed (e.g. +966 55 552 8123);
   if none is printed, write the number as printed (e.g. 057 680 0730). Mark WhatsApp numbers in notes.
6. industry_category: ALWAYS fill it, in Arabic, inferring from the company name/logo/title/services when
   not printed. Examples: تموين -> تموين وإعاشة; شاليهات/فنادق -> سياحة وفندقة; تجهيزات المواسم للتجارة ->
   تجارة عامة وتوريدات; مقاولات -> مقاولات وإنشاءات; software/IT -> تقنية. Use short, consistent labels.
7. city_country: "City - Country" in Arabic if the card is Arabic (infer country from phone code/address,
   e.g. +967 -> اليمن, +966 -> السعودية). full_address: as printed.
8. card_type must be exactly one of: Business Card, Exhibition Badge, Brochure.
9. Missing values: empty string / empty array. If the image has no readable contact info, return {"leads": []}.
"""


async def extract_leads(image_jpeg: bytes) -> list[Lead]:
    last_err: Exception | None = None
    b64 = base64.b64encode(image_jpeg).decode("ascii")
    for attempt in range(3):
        try:
            resp = await _client.beta.chat.completions.parse(
                model=config.OPENAI_MODEL,
                temperature=0.0,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Extract all leads from this image."},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}},
                        ],
                    },
                ],
                response_format=ScanResult,
            )
            result = resp.choices[0].message.parsed
            if not result:
                return []
            return [_post_process(l) for l in result.leads if _has_content(l)]
        except Exception as e:
            last_err = e
            log.warning("Vision attempt %d failed: %s", attempt + 1, e)
            await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Vision extraction failed: {last_err}")


def _has_content(l: Lead) -> bool:
    return any([l.full_name_ar, l.full_name_en, l.company_name, l.primary_phone, l.email])


def _post_process(l: Lead) -> Lead:
    l.primary_phone, l.secondary_phones = normalize_all(
        l.primary_phone, l.secondary_phones, config.DEFAULT_REGION
    )
    l.email = l.email.strip().lower()
    if l.card_type not in ("Business Card", "Exhibition Badge", "Brochure"):
        l.card_type = "Business Card"
    return l
