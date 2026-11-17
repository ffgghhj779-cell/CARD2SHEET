import { config } from "./config";
import { normalizeAll, normalizePhone } from "./phones";
import { SYSTEM_PROMPT, TEXT_PROMPT, TRANSCRIBE_PROMPT } from "./prompt";
import type { Lead } from "./types";

const LEAD_FIELDS = [
  "full_name_ar", "full_name_en", "job_title", "company_name", "industry_category",
  "primary_phone", "secondary_phones", "email", "website", "city_country",
  "full_address", "card_type", "notes",
] as const;
export const CARD_TYPES = ["Business Card", "Exhibition Badge", "Brochure"];

const LEAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    LEAD_FIELDS.map((f) => [
      f,
      f === "secondary_phones"
        ? { type: "array", items: { type: "string" } }
        : f === "card_type"
          ? { type: "string", enum: CARD_TYPES }
          : { type: "string" },
    ]),
  ),
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
  "full_name_ar", "full_name_en", "job_title", "company_name", "industry_category",
  "primary_phone", "secondary_phones", "email", "website", "city_country", "full_address", "notes",
] as const;

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
      reply: { type: "string" },
    },
    required: ["intent", "leads", "note", "corrections", "target_indexes", "query", "reply"],
  },
};

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      // do not retry auth / bad-request errors
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

export function cleanLead(raw: Record<string, unknown>): Lead {
  const [primary, others] = normalizeAll(
    str(raw.primary_phone),
    Array.isArray(raw.secondary_phones) ? raw.secondary_phones.map(str) : [],
    config.region,
  );
  const type = str(raw.card_type);
  let email = toLatin(str(raw.email)).toLowerCase().replace(/\s/g, "").replace(/^mailto:/, "");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) email = ""; // reject junk
  let website = str(raw.website).replace(/\s/g, "");
  if (website && !/\.[a-z]{2,}/i.test(website)) website = "";
  return {
    full_name_ar: str(raw.full_name_ar),
    full_name_en: str(raw.full_name_en),
    job_title: str(raw.job_title),
    company_name: str(raw.company_name),
    industry_category: str(raw.industry_category),
    primary_phone: primary,
    secondary_phones: others,
    email,
    website,
    city_country: str(raw.city_country),
    full_address: str(raw.full_address),
    card_type: CARD_TYPES.includes(type) ? type : "Business Card",
    notes: str(raw.notes),
  };
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

export interface TextAnalysis {
  intent: "new_contact" | "note" | "correction" | "search" | "other";
  leads: Lead[];
  note: string;
  corrections: { field: (typeof CORRECTABLE)[number]; value: string }[];
  target_indexes: number[];
  query: string;
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
  const corrections = (raw.corrections ?? []).map((c) => ({
    field: c.field,
    value:
      c.field === "primary_phone" ? normalizePhone(c.value, config.region)
      : c.field === "email" ? c.value.trim().toLowerCase()
      : c.value.trim(),
  }));
  return {
    ...raw,
    leads: (raw.leads ?? []).map(cleanLead).filter(hasContent),
    corrections,
    target_indexes: (raw.target_indexes ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < recent.length),
  };
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
