import { config } from "./config";
import { normalizeAll, normalizePhone } from "./phones";
import { CLASSIFY_PROMPT, SYSTEM_PROMPT, TEXT_PROMPT, TRANSCRIBE_PROMPT } from "./prompt";
import { DECISION, DEPARTMENTS, LEVELS, SECTOR_NAMES, matchEnum } from "./taxonomy";
import type { Lead } from "./types";

const LEAD_FIELDS = [
  "full_name_ar", "full_name_en", "job_title", "management_level", "department", "decision_maker",
  "company_name", "sector", "industry_category", "primary_phone", "secondary_phones", "email", "website",
  "city_country", "full_address", "card_type", "notes",
] as const;
export const CARD_TYPES = ["Business Card", "Exhibition Badge", "Brochure"];

const ENUMS: Record<string, readonly string[]> = {
  card_type: CARD_TYPES,
  sector: SECTOR_NAMES,
  management_level: LEVELS,
  department: DEPARTMENTS,
  decision_maker: DECISION,
};

const fieldSchema = (f: string) =>
  f === "secondary_phones"
    ? { type: "array", items: { type: "string" } }
    : ENUMS[f]
      ? { type: "string", enum: [...ENUMS[f]] }
      : { type: "string" };

const LEAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(LEAD_FIELDS.map((f) => [f, fieldSchema(f)])),
  required: [...LEAD_FIELDS],
};

const SCAN_SCHEMA = {
  name: "scan_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { leads: { type: "array", items: LEAD_SCHEMA } },
    required: ["leads"],
  },
};

export const CORRECTABLE = [
  "full_name_ar", "full_name_en", "job_title", "management_level", "department", "decision_maker",
  "company_name", "sector", "industry_category", "primary_phone", "secondary_phones", "email", "website",
  "city_country", "full_address", "notes",
] as const;

const optEnum = (vals: readonly string[]) => ({ type: "string", enum: ["", ...vals] });

const TEXT_SCHEMA = {
  name: "text_intent",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: { type: "string", enum: ["new_contact", "note", "correction", "search", "other"] },
      leads: { type: "array", items: LEAD_SCHEMA },
      note: { type: "string" },
      corrections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { field: { type: "string", enum: [...CORRECTABLE] }, value: { type: "string" } },
          required: ["field", "value"],
        },
      },
      target_indexes: { type: "array", items: { type: "integer" } },
      query: { type: "string" },
      filters: {
        type: "object",
        additionalProperties: false,
        properties: {
          sector: optEnum(SECTOR_NAMES),
          management_level: optEnum(LEVELS),
          department: optEnum(DEPARTMENTS),
          decision_maker: optEnum(DECISION),
        },
        required: ["sector", "management_level", "department", "decision_maker"],
      },
      reply: { type: "string" },
    },
    required: ["intent", "leads", "note", "corrections", "target_indexes", "query", "filters", "reply"],
  },
};

const CLASSIFY_SCHEMA = {
  name: "classification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      ["sector", "industry_category", "management_level", "department", "decision_maker"].map((f) => [f, fieldSchema(f)]),
    ),
    required: ["sector", "industry_category", "management_level", "department", "decision_maker"],
  },
};

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof Error && /HTTP (400|401|403|404)/.test(e.message)) break;
      console.warn(`${label} attempt ${i + 1} failed:`, e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`${label} failed: ${last instanceof Error ? last.message : String(last)}`);
}

async function chatJSON<T>(messages: unknown[], schema: unknown, label: string): Promise<T> {
  return retry(label, async () => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature: 0,
        messages,
        response_format: { type: "json_schema", json_schema: schema },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } }[] };
    const msg = data.choices?.[0]?.message;
    if (msg?.refusal) throw new Error(`OpenAI refusal: ${msg.refusal}`);
    return JSON.parse(msg?.content ?? "{}") as T;
  });
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));

/** Enforce enums + consistency rules on classification fields. */
export function normalizeClassification<T extends Partial<Lead>>(l: T): T {
  const out = { ...l };
  out.sector = matchEnum(str(l.sector), SECTOR_NAMES, "أخرى");
  out.management_level = matchEnum(str(l.management_level), LEVELS, "5 - غير محدد");
  out.department = matchEnum(str(l.department), DEPARTMENTS, "غير محدد");
  out.decision_maker = matchEnum(str(l.decision_maker), DECISION, "لا");
  if (out.management_level === LEVELS[0]) out.decision_maker = "نعم";
  if (!str(l.job_title) && out.management_level !== LEVELS[0] && "job_title" in l) {
    out.management_level = LEVELS[4];
    out.decision_maker = "لا";
  }
  out.industry_category = str(l.industry_category) || out.sector;
  return out;
}

export function cleanLead(raw: Record<string, unknown>): Lead {
  const [primary, others] = normalizeAll(
    str(raw.primary_phone),
    Array.isArray(raw.secondary_phones) ? raw.secondary_phones.map(str) : [],
    config.region,
  );
  const type = str(raw.card_type);
  let email = toLatin(str(raw.email)).toLowerCase().replace(/\s/g, "").replace(/^mailto:/, "");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) email = "";
  let website = str(raw.website).replace(/\s/g, "");
  if (website && !/\.[a-z]{2,}/i.test(website)) website = "";
  return normalizeClassification({
    full_name_ar: str(raw.full_name_ar),
    full_name_en: str(raw.full_name_en),
    job_title: str(raw.job_title),
    management_level: str(raw.management_level),
    department: str(raw.department),
    decision_maker: str(raw.decision_maker),
    company_name: str(raw.company_name),
    sector: str(raw.sector),
    industry_category: str(raw.industry_category),
    primary_phone: primary,
    secondary_phones: others,
    email,
    website,
    city_country: str(raw.city_country),
    full_address: str(raw.full_address),
    card_type: CARD_TYPES.includes(type) ? type : "Business Card",
    notes: str(raw.notes),
  });
}

const hasContent = (l: Lead) => !!(l.full_name_ar || l.full_name_en || l.company_name || l.primary_phone || l.email);

export async function extractLeads(jpeg: Buffer): Promise<Lead[]> {
  const parsed = await chatJSON<{ leads?: Record<string, unknown>[] }>(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all leads from this image." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" } },
        ],
      },
    ],
    SCAN_SCHEMA,
    "Vision extraction",
  );
  return (parsed.leads ?? []).map(cleanLead).filter(hasContent);
}

export interface SearchFilters {
  sector: string;
  management_level: string;
  department: string;
  decision_maker: string;
}

export interface TextAnalysis {
  intent: "new_contact" | "note" | "correction" | "search" | "other";
  leads: Lead[];
  note: string;
  corrections: { field: (typeof CORRECTABLE)[number]; value: string }[];
  target_indexes: number[];
  query: string;
  filters: SearchFilters;
  reply: string;
}

export async function analyzeText(
  text: string,
  recent: { name: string; company: string }[],
  source: "Text" | "Voice",
): Promise<TextAnalysis> {
  const ctx = recent.length
    ? `RECENT LEADS (the user scanned these last):\n${recent.map((r, i) => `${i}: ${r.name || "—"} | ${r.company || "—"}`).join("\n")}`
    : "RECENT LEADS: none (no recent scan).";
  const raw = await chatJSON<TextAnalysis & { leads: Record<string, unknown>[] }>(
    [
      { role: "system", content: TEXT_PROMPT },
      { role: "user", content: `${ctx}\n\nSOURCE: ${source}\nMESSAGE:\n${text}` },
    ],
    TEXT_SCHEMA,
    "Text analysis",
  );
  const corrections = (raw.corrections ?? []).map((c) => {
    let value = c.value.trim();
    if (c.field === "primary_phone") value = normalizePhone(value, config.region);
    else if (c.field === "email") value = value.toLowerCase();
    else if (ENUMS[c.field]) {
      const fb = c.field === "sector" ? "أخرى" : c.field === "management_level" ? LEVELS[4] : c.field === "department" ? "غير محدد" : "لا";
      value = matchEnum(value, ENUMS[c.field], fb);
    }
    return { field: c.field, value };
  });
  if (corrections.some((c) => c.field === "management_level" && c.value === LEVELS[0]) && !corrections.some((c) => c.field === "decision_maker"))
    corrections.push({ field: "decision_maker", value: "نعم" });
  return {
    ...raw,
    leads: (raw.leads ?? []).map(cleanLead).filter(hasContent),
    corrections,
    target_indexes: (raw.target_indexes ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < recent.length),
    filters: raw.filters ?? { sector: "", management_level: "", department: "", decision_maker: "" },
  };
}

/** Classify an already-saved lead from its text fields (used to back-fill old records). */
export async function classifyLead(l: {
  company_name: string; job_title: string; industry_category: string; email: string; website: string; notes: string;
  full_name_ar: string; full_name_en: string;
}) {
  const raw = await chatJSON<Partial<Lead>>(
    [
      { role: "system", content: CLASSIFY_PROMPT },
      {
        role: "user",
        content: `company: ${l.company_name}\njob_title: ${l.job_title}\nold_category: ${l.industry_category}\nemail: ${l.email}\nwebsite: ${l.website}\nnotes: ${l.notes}\nname: ${l.full_name_ar} ${l.full_name_en}`,
      },
    ],
    CLASSIFY_SCHEMA,
    "Classification",
  );
  return normalizeClassification({ ...raw, job_title: l.job_title });
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
  return "wav";
}

export async function transcribe(audio: Buffer, mime = "audio/wav"): Promise<string> {
  return retry("Transcription", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `voice.${extFromMime(mime)}`);
    fd.append("model", "whisper-1");
    fd.append("prompt", TRANSCRIBE_PROMPT);
    fd.append("temperature", "0");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiKey}` },
      body: fd,
    });
    if (!res.ok) throw new Error(`OpenAI Whisper HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").replace(/\s+/g, " ").trim();
  });
}
