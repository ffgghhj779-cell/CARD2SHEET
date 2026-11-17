export interface Lead {
  full_name_ar: string;
  full_name_en: string;
  job_title: string;
  company_name: string;
  industry_category: string;
  primary_phone: string;
  secondary_phones: string[];
  email: string;
  website: string;
  city_country: string;
  full_address: string;
  card_type: string;
  notes: string;
}

// Column order is identical to the Telegram bot so both can feed the same sheet / Excel layout.
export const COLUMNS = [
  ["scanned_at", "Scanned At"],
  ["scanned_by", "Scanned By"],
  ["full_name_ar", "الاسم (عربي)"],
  ["full_name_en", "Name (English)"],
  ["job_title", "Job Title"],
  ["company_name", "Company"],
  ["industry_category", "Industry"],
  ["primary_phone", "Primary Phone"],
  ["secondary_phones", "Other Phones"],
  ["email", "Email"],
  ["website", "Website"],
  ["city_country", "City / Country"],
  ["full_address", "Address"],
  ["card_type", "Card Type"],
  ["notes", "Notes"],
] as const;

export type Key = (typeof COLUMNS)[number][0];
export const KEYS: Key[] = COLUMNS.map((c) => c[0]);
export const HEADERS: string[] = COLUMNS.map((c) => c[1]);

export type Row = Record<Key, string> & { id: number; synced?: number };
