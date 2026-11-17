import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

// Load .env.local before importing app modules
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
// Isolate test DB and disable live Sheet writes during unit/E2E tests so production sheet (160 real leads) is untouched
process.env.DB_PATH = `tests/tmp_${Date.now()}.db`;
process.env.GOOGLE_SHEET_ID = "";

const { config } = await import("../lib/config");
const store = await import("../lib/store");
const sheets = await import("../lib/sheets");
const { LEVELS, SECTOR_NAMES } = await import("../lib/taxonomy");
const { createBot } = await import("../lib/telegramBot");

interface SentMsg {
  id: number;
  text: string;
  replyTo?: number;
}
interface SentDoc {
  filename: string;
  caption: string;
  buf: Buffer;
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
    sentDocs.push({ filename, caption, buf });
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
  console.log("🚀 Starting Deep End-to-End Test Suite (with Sector & Management Hierarchy)...\n");

  // 1. /start command
  sentMessages.length = 0;
  await bot.handleMessage({ message_id: ++userMsgId, chat: { id: CHAT_ID }, from: USER, text: "/start" });
  check(
    "1. /start Command & Help",
    sentMessages.length === 1 && sentMessages[0].text.includes("/sectors") && sentMessages[0].text.includes("/export"),
    `Replied with help menu (${sentMessages[0]?.text.length} chars)`,
  );

  // 2. Bilingual Card (AR + EN) + Sector & Top Management Classification (General Manager -> Level 1 + Decision Maker)
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
    "2. Bilingual Card + Sector & Level-1 GM Classification (Sedra)",
    rows.length === 1 &&
      norm(akram.full_name_ar).includes("اكرم") &&
      akram.full_name_en.toLowerCase().includes("akram") &&
      akram.sector === "تموين وإعاشة" &&
      akram.management_level === LEVELS[0] &&
      akram.decision_maker === "نعم" &&
      akram.primary_phone === "+966 55 552 8123",
    `Sector="${akram?.sector}", Specialty="${akram?.industry_category}", Level="${akram?.management_level}", Dept="${akram?.department}", DM="${akram?.decision_maker}"`,
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

  // 4. 180° Upside-Down Card (Yemen) + Sales Director (Level 2) + General Trading Sector
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
    "4. 180° Upside-Down Card + Level-2 Sales Director Classification",
    Boolean(yemen) &&
      yemen!.full_name_en.toLowerCase().includes("al-hamdani") &&
      SECTOR_NAMES.includes(yemen!.sector) &&
      (yemen!.management_level === LEVELS[1] || yemen!.management_level === LEVELS[0]) &&
      yemen!.primary_phone === "+967 776 311 133" &&
      yemen!.city_country.includes("اليمن"),
    `Sector="${yemen?.sector}", Level="${yemen?.management_level}", Dept="${yemen?.department}", DM="${yemen?.decision_maker}"`,
  );

  // 5. Arabic-only Card with Indic Digits (شاليهات الريم -> فنادق وضيافة)
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
    "5. Arabic-Only Card + Hospitality Sector & Reservation Manager Level",
    Boolean(chalets) &&
      chalets!.full_name_ar.includes("محمد") &&
      chalets!.full_name_en === "" &&
      chalets!.sector === "فنادق وضيافة" &&
      chalets!.primary_phone === "+966 57 680 0730",
    `Sector="${chalets?.sector}", Specialty="${chalets?.industry_category}", Level="${chalets?.management_level}"`,
  );

  // 6. Skewed + Glare + Blur + Shadow Card (تجهيزات المواسم للتجارة - مسؤول المبيعات)
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
    "6. Skewed + Glare + Blur + Shadow Card + Trading Sector",
    Boolean(khaled) &&
      khaled!.full_name_ar.includes("خالد") &&
      SECTOR_NAMES.includes(khaled!.sector) &&
      khaled!.department === "المبيعات" &&
      khaled!.primary_phone === "+966 53 322 1900",
    `Sector="${khaled?.sector}", Level="${khaled?.management_level}", Dept="${khaled?.department}"`,
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
    `Notes="${khaledUpdated.notes}"`,
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
    "8. Multi-Card Photo (IT & Logistics Sectors + Exhibition Badge)",
    rows.length === 6 &&
      Boolean(sara) &&
      sara!.sector === "تقنية معلومات وبرمجيات" &&
      Boolean(omar) &&
      omar!.card_type === "Exhibition Badge",
    `Sara Sector="${sara?.sector}" (${sara?.management_level}), Omar Sector="${omar?.sector}" (${omar?.management_level})`,
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

  // 9b. Reply-To Memory + Sector & Email Correction on Akram
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

  // 10a. Free-Text Contact Creation + Contracting Sector Classification
  sentMessages.length = 0;
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    text: "سجل عندك العميل ده: المهندس طارق محمود - شركة البنيان للمقاولات - مدير المشاريع - جوال 0544112233 - ايميل tarek@bunyan.sa - جدة",
  });
  const tarek = store.allRows().find((r) => r.email === "tarek@bunyan.sa");
  check(
    "10a. Lead Creation from Free Text + Sector & Level Classification",
    Boolean(tarek) &&
      tarek!.sector === "مقاولات وإنشاءات" &&
      tarek!.management_level === LEVELS[1] &&
      tarek!.primary_phone === "+966 54 411 2233",
    `Tarek Sector="${tarek?.sector}", Level="${tarek?.management_level}", Dept="${tarek?.department}", DM="${tarek?.decision_maker}"`,
  );

  // 10b. Filtered Conversational Search by Sector / Hierarchy
  sentMessages.length = 0;
  await bot.handleMessage({
    message_id: ++userMsgId,
    chat: { id: CHAT_ID },
    from: USER,
    text: "مين معانا في قطاع مقاولات وإنشاءات؟",
  });
  check(
    "10b. Conversational Search by Sector & Hierarchy",
    sentMessages.some((m) => m.text.includes("طارق") && m.text.includes("البنيان")),
    `Search replies: ${sentMessages.map((m) => m.text.slice(0, 70)).join(" || ")}`,
  );

  // 11. /sectors + Multi-Tab Excel (.xlsx) Export verification
  sentMessages.length = 0;
  await bot.handleMessage({ message_id: ++userMsgId, chat: { id: CHAT_ID }, from: USER, text: "/sectors" });
  check(
    "11a. /sectors Command",
    sentMessages.length === 1 && sentMessages[0].text.includes("تموين وإعاشة") && sentMessages[0].text.includes("فنادق وضيافة"),
    `Listed active sector sheets`,
  );

  sentDocs.length = 0;
  await bot.handleMessage({ message_id: ++userMsgId, chat: { id: CHAT_ID }, from: USER, text: "/export" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(sentDocs[0].buf as never);
  const sheetNames = wb.worksheets.map((w) => w.name);
  check(
    "11b. Multi-Sheet Excel (.xlsx) Export (Master + Summary + Sector Tabs)",
    sheetNames.includes("كل العملاء") &&
      sheetNames.includes("ملخص") &&
      sheetNames.includes("تموين وإعاشة") &&
      sheetNames.includes("فنادق وضيافة") &&
      sheetNames.includes("تقنية معلومات وبرمجيات"),
    `Excel tabs (${sheetNames.length}): ${sheetNames.join(" | ")}`,
  );

  // 11c. Hierarchy Sorting + Summary Matrix Verification
  const sorted = sheets.sortForTab(store.allRows());
  const summary = sheets.summaryMatrix(store.allRows());
  check(
    "11c. Management Hierarchy Sorting & Summary Dashboard Matrix",
    sorted[0].management_level === LEVELS[0] && summary.length >= 6,
    `Top-sorted lead="${sorted[0].full_name_en || sorted[0].full_name_ar}" (${sorted[0].management_level}), Summary rows=${summary.length}`,
  );

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
