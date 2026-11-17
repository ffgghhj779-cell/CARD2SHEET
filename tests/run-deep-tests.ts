import fs from "node:fs";
import path from "node:path";

// Load .env.local before importing app modules
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
// Use a fresh test DB file so production leads.db stays clean
process.env.DB_PATH = `tests/tmp_${Date.now()}.db`;

const { config } = await import("../lib/config");
const store = await import("../lib/store");
const sheets = await import("../lib/sheets");
const { createBot } = await import("../lib/telegramBot");

interface SentMsg {
  id: number;
  text: string;
  replyTo?: number;
}
interface SentDoc {
  filename: string;
  caption: string;
  size: number;
}

const sentMessages: SentMsg[] = [];
const sentDocs: SentDoc[] = [];
const fileStore = new Map<string, Buffer>();
let nextMsgId = 1000;
let userMsgId = 1;

const mockTransport = {
  async send(_chatId: number, text: string, replyTo?: number) {
    const id = ++nextMsgId;
    sentMessages.push({ id, text, replyTo });
    return id;
  },
  async sendDocument(_chatId: number, buf: Buffer, filename: string, caption: string) {
    sentDocs.push({ filename, caption, size: buf.length });
  },
  async download(fileId: string) {
    const b = fileStore.get(fileId);
    if (!b) throw new Error("Missing mock file: " + fileId);
    return b;
  },
  async typing() {},
};

const bot = createBot(mockTransport);
const CHAT_ID = 777000;
const USER = { id: 999, first_name: "Test", last_name: "Engineer" };

function putFixture(filename: string): string {
  const buf = fs.readFileSync(path.join("tests/fixtures", filename));
  fileStore.set(filename, buf);
  return filename;
}

async function makeVoiceOgg(text: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: "onyx",
      input: text,
      response_format: "opus",
    }),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const id = `voice_${Date.now()}.ogg`;
  fileStore.set(id, buf);
  return id;
}

const results: { name: string; pass: boolean; details: string }[] = [];
function check(name: string, cond: boolean, details: string) {
  results.push({ name, pass: cond, details });
  console.log(`${cond ? "✅ PASS" : "❌ FAIL"} | ${name} -> ${details}`);
}

async function run() {
  console.log("🚀 Starting Deep End-to-End Test Suite...\n");
  // Ensure sheet starts with only the header row
  const initialSheet = await sheets.readAll();
  if (initialSheet.length > 1) {
    const existingIds = initialSheet
      .slice(1)
      .map((r) => Number(String(r[15] ?? "").replace("web-", "")))
      .filter((n) => n > 0);
    if (existingIds.length) await sheets.deleteRows(existingIds);
  }

  // 1. /start command
  sentMessages.length = 0;
  await bot.handleMessage({ message_id: ++userMsgId, chat: { id: CHAT_ID }, from: USER, text: "/start" });
  check(
    "1. /start Command & Help",
    sentMessages.length === 1 && sentMessages[0].text.includes("/export") && sentMessages[0].text.includes("/undo"),
    `Replied with help menu (${sentMessages[0]?.text.length} chars)`,
  );

  // 2. Bilingual Card (AR + EN) + Caption
  sentMessages.length = 0;
  const fid1 = putFixture("01_bilingual_sedra.jpg");
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    photo: [{ file_id: fid1 }],
    caption: "عميل VIP مهتم بعقود الإعاشة في موسم الحج",
  });
  const akramMsgId = sentMessages[0]?.id;
  let rows = store.allRows();
  const akram = rows[0];
  const norm = (s = "") => s.replace(/[أإآ]/g, "ا");
  check(
    "2. Bilingual Card + Caption (Sedra)",
    rows.length === 1 &&
      norm(akram.full_name_ar).includes("اكرم") &&
      akram.full_name_en.toLowerCase().includes("akram") &&
      akram.primary_phone === "+966 55 552 8123" &&
      akram.secondary_phones.includes("+966 12 540 7788") &&
      akram.email === "akram@sedra-catering.com" &&
      Boolean(akram.industry_category) &&
      akram.notes.includes("[Caption] عميل VIP مهتم بعقود الإعاشة في موسم الحج") &&
      akram.synced === 1,
    `AR="${akram?.full_name_ar}", EN="${akram?.full_name_en}", Phone="${akram?.primary_phone}", Sector="${akram?.industry_category}", Synced=${akram?.synced}`,
  );

  // 3. 90° Rotated Card + Smart Deduplication/Merge
  sentMessages.length = 0;
  const fid2 = putFixture("02_rotated90_sedra.jpg");
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    photo: [{ file_id: fid2 }],
    caption: "قابلت نائبه في جناح B4",
  });
  rows = store.allRows();
  const akramAfter = rows[0];
  check(
    "3. 90° Rotated Card + Smart Dedupe & Note Merge",
    rows.length === 1 &&
      akramAfter.notes.includes("عميل VIP") &&
      akramAfter.notes.includes("قابلت نائبه في جناح B4"),
    `Row count stayed 1 (no dup), merged notes="${akramAfter?.notes}"`,
  );

  // 4. 180° Upside-Down Card (Yemen) + Fax separation
  sentMessages.length = 0;
  const fid3 = putFixture("03_upside_down_yemen.jpg");
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    photo: [{ file_id: fid3 }],
  });
  rows = store.allRows();
  const yemen = rows.find((r) => r.primary_phone.includes("967"));
  check(
    "4. 180° Upside-Down Card (Yemen +967) + Fax separation",
    Boolean(yemen) &&
      yemen!.full_name_en.toLowerCase().includes("al-hamdani") &&
      yemen!.primary_phone === "+967 776 311 133" &&
      !yemen!.secondary_phones.includes("567") && // Fax excluded from phones
      yemen!.city_country.includes("اليمن"),
    `Name="${yemen?.full_name_en}", Phone="${yemen?.primary_phone}", OtherPhones="${yemen?.secondary_phones}", City="${yemen?.city_country}", Notes="${yemen?.notes}"`,
  );

  // 5. Arabic-only Card with Arabic-Indic Digits (٠٥٧٦٨٠٠٧٣٠)
  sentMessages.length = 0;
  const fid4 = putFixture("04_arabic_only_indic_digits.jpg");
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    photo: [{ file_id: fid4 }],
  });
  rows = store.allRows();
  const chalets = rows.find((r) => r.company_name.includes("الريم"));
  check(
    "5. Arabic-Only Card + Indic Digits (٠٥٧ -> +966 57) + No Hallucinated EN Name",
    Boolean(chalets) &&
      chalets!.full_name_ar.includes("محمد") &&
      chalets!.full_name_en === "" &&
      chalets!.primary_phone === "+966 57 680 0730" &&
      chalets!.secondary_phones.includes("+966 50 123 4567"),
    `AR="${chalets?.full_name_ar}", EN="${chalets?.full_name_en}", Phone="${chalets?.primary_phone}", Other="${chalets?.secondary_phones}", Sector="${chalets?.industry_category}"`,
  );

  // 6. Skewed + Glare + Blur + Shadow Card
  sentMessages.length = 0;
  const fid7 = putFixture("07_skew_glare_blur_seasons.jpg");
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    photo: [{ file_id: fid7 }],
  });
  rows = store.allRows();
  const khaled = rows.find((r) => r.email === "sales@mawasim-trade.sa" || r.full_name_ar.includes("خالد"));
  check(
    "6. Skewed + Glare + Blur + Shadow Card",
    Boolean(khaled) &&
      khaled!.full_name_ar.includes("خالد") &&
      khaled!.primary_phone === "+966 53 322 1900" &&
      khaled!.email === "sales@mawasim-trade.sa",
    `AR="${khaled?.full_name_ar}", Company="${khaled?.company_name}", Phone="${khaled?.primary_phone}", Sector="${khaled?.industry_category}"`,
  );

  // 7. Real Voice Note (.ogg TTS -> Whisper-1) attached via Bot Memory to Khaled
  sentMessages.length = 0;
  const voiceId = await makeVoiceOgg("العميل خالد طالب عرض سعر لخمسمائة كرتونة، نتواصل معاه يوم الخميس");
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    voice: { file_id: voiceId, mime_type: "audio/ogg" },
  });
  const khaledUpdated = store.getRow(khaled!.id)!;
  check(
    "7. Voice Note Transcription (Whisper-1) + Bot Memory Attachment",
    khaledUpdated.notes.includes("[Voice]") &&
      (khaledUpdated.notes.includes("خالد") || khaledUpdated.notes.includes("عرض سعر") || khaledUpdated.notes.includes("كرتونة")),
    `Notes after voice="${khaledUpdated.notes}"`,
  );

  // 8. Multi-Card (3 Cards + 1 Exhibition Badge in one photo)
  sentMessages.length = 0;
  const fid8 = putFixture("08_multi_3cards_1badge.jpg");
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    photo: [{ file_id: fid8 }],
  });
  rows = store.allRows();
  const sara = rows.find((r) => r.full_name_en.toLowerCase().includes("sara"));
  const omar = rows.find((r) => r.full_name_en.toLowerCase().includes("omar") || r.full_name_ar.includes("عمر"));
  check(
    "8. Multi-Card Photo (3 Cards + 1 Badge -> Dedupe 2, Insert 2 New)",
    rows.length === 6 &&
      Boolean(sara) &&
      sara!.primary_phone === "+971 50 123 4567" &&
      Boolean(omar) &&
      omar!.card_type === "Exhibition Badge",
    `Total unique leads=${rows.length}, Sara="${sara?.full_name_en}" (${sara?.primary_phone}), Omar="${omar?.full_name_en}" (Type=${omar?.card_type})`,
  );

  // 9a. Smart Target Selection by Name inside Multi-Card Batch
  sentMessages.length = 0;
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    text: "سارة من شركة نيكسورا مهتمة باشتراك سنوي للنظام السحابي",
  });
  const saraAfter = store.getRow(sara!.id)!;
  const omarAfter = store.getRow(omar!.id)!;
  check(
    "9a. Smart Target Selection inside Multi-Card Batch",
    saraAfter.notes.includes("اشتراك سنوي") && !omarAfter.notes.includes("اشتراك سنوي"),
    `Sara notes="${saraAfter.notes}" | Omar notes="${omarAfter.notes}"`,
  );

  // 9b. Reply-To Memory + Natural Language Field Correction on an Earlier Lead (Akram)
  sentMessages.length = 0;
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    reply_to_message: { message_id: akramMsgId },
    text: "الإيميل الصحيح هو ceo@sedra-catering.com",
  });
  const akramCorrected = store.getRow(akram.id)!;
  check(
    "9b. Reply-To Memory + Field Correction",
    akramCorrected.email === "ceo@sedra-catering.com",
    `Akram email updated to "${akramCorrected.email}"`,
  );

  // 10a. Free-Text Contact Creation
  sentMessages.length = 0;
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    text: "سجل عندك العميل ده: المهندس طارق محمود - شركة البنيان للمقاولات - مدير المشاريع - جوال 0544112233 - ايميل tarek@bunyan.sa - جدة",
  });
  const tarek = store.allRows().find((r) => r.email === "tarek@bunyan.sa");
  check(
    "10a. Lead Creation from Free Text Message",
    Boolean(tarek) &&
      tarek!.primary_phone === "+966 54 411 2233" &&
      tarek!.company_name.includes("البنيان"),
    `Tarek="${tarek?.full_name_ar}", Company="${tarek?.company_name}", Phone="${tarek?.primary_phone}", Sector="${tarek?.industry_category}"`,
  );

  // 10b. Conversational Search ("مين كان من شركة سدرة؟")
  sentMessages.length = 0;
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    text: "مين كان من شركة سدرة؟",
  });
  check(
    "10b. Conversational Search & Recall",
    sentMessages.some((m) => norm(m.text).includes("اكرم") && m.text.includes("ceo@sedra-catering.com")),
    `Search replies: ${sentMessages.map((m) => m.text.slice(0, 60)).join(" || ")}`,
  );

  // 11. Irrelevant Photo + /stats + /export + /undo + Google Sheets verification
  sentMessages.length = 0;
  const fid9 = putFixture("09_no_contacts_landscape.jpg");
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    photo: [{ file_id: fid9 }],
  });
  check(
    "11a. Irrelevant Photo Rejection",
    sentMessages.length === 1 && sentMessages[0].text.includes("ملقتش بيانات"),
    `Rejected non-card landscape image cleanly`,
  );

  sentDocs.length = 0;
  await bot.handleMessage({ message_id: ++userMsgId, chat: { id: CHAT_ID }, from: USER, text: "/export" });
  check(
    "11b. Excel (.xlsx) Export",
    sentDocs.length === 1 && sentDocs[0].size > 5000,
    `Exported ${sentDocs[0]?.filename} (${sentDocs[0]?.size} bytes)`,
  );

  // Undo last lead (Tarek)
  await bot.handleMessage({ message_id: ++userMsgId, chat: { id: CHAT_ID }, from: USER, text: "/undo" });
  const sheetRows = await sheets.readAll();
  const dbRows = store.allRows();
  check(
    "11c. /undo + Live Google Sheets Sync Consistency",
    dbRows.length === 6 && !dbRows.some((r) => r.email === "tarek@bunyan.sa") && sheetRows.length === dbRows.length + 1,
    `SQLite rows=${dbRows.length}, Google Sheets rows=${sheetRows.length - 1} (+1 header row)`,
  );

  // Clean up test rows from Google Sheets so the user's sheet is left spotless!
  await sheets.deleteRows(dbRows.map((r) => r.id));
  store.deleteLeads(dbRows.map((r) => r.id));

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n========================================`);
  console.log(`🏆 TOTAL PASSED: ${passed} / ${results.length}`);
  console.log(`========================================`);
  if (passed !== results.length) process.exit(1);
}

run().catch((e) => {
  console.error("Test suite fatal error:", e);
  process.exit(1);
});
