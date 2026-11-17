export interface Lead {
  full_name_ar: string;
  full_name_en: string;
  job_title: string;
  management_level: string;
  department: string;
  decision_maker: string;
  company_name: string;
  sector: string;
  industry_category: string; // precise specialty inside the sector
  primary_phone: string;
  secondary_phones: string[];
  email: string;
  website: string;
  city_country: string;
  full_address: string;
  card_type: string;
  notes: string;
}

// Column order used in Google Sheets (all tabs) and Excel.
export const COLUMNS = [
  ["scanned_at", "تاريخ المسح"],
  ["scanned_by", "سجّله"],
  ["full_name_ar", "الاسم بالعربي"],
  ["full_name_en", "الاسم بالإنجليزي"],
  ["job_title", "المسمى الوظيفي"],
  ["management_level", "المستوى الإداري"],
  ["department", "الإدارة أو القسم"],
  ["decision_maker", "صانع قرار"],
  ["company_name", "الشركة"],
  ["sector", "القطاع"],
  ["industry_category", "التخصص الدقيق"],
  ["primary_phone", "الجوال الأساسي"],
  ["secondary_phones", "أرقام أخرى"],
  ["email", "البريد الإلكتروني"],
  ["website", "الموقع الإلكتروني"],
  ["city_country", "المدينة - الدولة"],
  ["full_address", "العنوان"],
  ["card_type", "نوع المستند"],
  ["notes", "ملاحظات"],
] as const;

export type Key = (typeof COLUMNS)[number][0];
export const KEYS: Key[] = COLUMNS.map((c) => c[0]);
export const HEADERS: string[] = COLUMNS.map((c) => c[1]);

export type Row = Record<Key, string> & { id: number; synced?: number; sheet_tab?: string | null };
