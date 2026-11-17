import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const AR = "٠١٢٣٤٥٦٧٨٩";
const FA = "۰۱۲۳۴۵۶۷۸۹";

function digitsToLatin(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => String(AR.includes(c) ? AR.indexOf(c) : FA.indexOf(c)));
}

export function normalizePhone(raw: string, region: string): string {
  if (!raw) return "";
  let s = digitsToLatin(raw).trim();
  s = s.replace(/\b(tel|mob|mobile|whatsapp|wa|fax)\b[:.\s]*/gi, "").trim();
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const p = parsePhoneNumberFromString(s, region as CountryCode);
  return p && p.isPossible() ? p.formatInternational() : s;
}

const key = (s: string) => s.replace(/\D/g, "");

export function normalizeAll(primary: string, others: string[], region: string): [string, string[]] {
  let p = normalizePhone(primary, region);
  const seen = new Set([key(p)]);
  const out: string[] = [];
  for (const o of others) {
    const n = normalizePhone(o, region);
    if (n && !seen.has(key(n))) {
      seen.add(key(n));
      out.push(n);
    }
  }
  if (!p && out.length) p = out.shift()!;
  return [p, out];
}
