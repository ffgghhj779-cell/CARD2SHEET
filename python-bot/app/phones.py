import re
import phonenumbers
from phonenumbers import PhoneNumberFormat

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize_phone(raw: str, region: str) -> str:
    """Return '+966 55 552 8123' style if valid, else cleaned original."""
    if not raw:
        return ""
    s = raw.translate(_AR_DIGITS).strip()
    s = re.sub(r"(?i)\b(tel|mob|mobile|whatsapp|wa|fax|ت|جوال|هاتف|واتس)\b[:.\s]*", "", s).strip()
    if s.startswith("00"):
        s = "+" + s[2:]
    try:
        num = phonenumbers.parse(s, region)
        if phonenumbers.is_possible_number(num):
            return phonenumbers.format_number(num, PhoneNumberFormat.INTERNATIONAL)
    except phonenumbers.NumberParseException:
        pass
    return s


def normalize_all(primary: str, others: list[str], region: str) -> tuple[str, list[str]]:
    seen, out = set(), []
    p = normalize_phone(primary, region)
    seen.add(re.sub(r"\D", "", p))
    for o in others:
        n = normalize_phone(o, region)
        key = re.sub(r"\D", "", n)
        if n and key not in seen:
            seen.add(key)
            out.append(n)
    if not p and out:
        p = out.pop(0)
    return p, out
