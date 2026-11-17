import { config } from "./config";
import { buildXlsx } from "./exporter";
import { prepareImage } from "./imagePrep";
import * as svc from "./service";
import * as store from "./store";
import { LEVELS } from "./taxonomy";
import type { Row } from "./types";
import { analyzeText, extractLeads, transcribe, type SearchFilters } from "./vision";

const MEMORY_WINDOW_MS = 30 * 60 * 1000;
const TG_LIMIT = 3900;

export interface Transport {
  send(chatId: number, text: string, replyTo?: number): Promise<number | undefined>;
  sendDocument(chatId: number, buf: Buffer, filename: string, caption: string): Promise<void>;
  download(fileId: string): Promise<Buffer>;
  typing(chatId: number): Promise<void>;
}

// ---------------- formatting ----------------
export function fmtRow(row: Row, tag = ""): string {
  const name = [row.full_name_ar, row.full_name_en].filter(Boolean).join(" / ") || "—";
  const dmBadge = row.decision_maker === "نعم" ? " ⭐ (صانع قرار)" : "";
  const lines = [
    `${tag}👤 ${name}${dmBadge}`.trim(),
    `🏢 ${row.company_name || "—"}`,
    `📂 القطاع (الشيت): ${row.sector || "—"}${row.industry_category && row.industry_category !== row.sector ? ` — ${row.industry_category}` : ""}`,
    `🏛 الهيكل الإداري: ${row.management_level || "—"}${row.department && row.department !== "غير محدد" ? ` | ${row.department}` : ""}`,
  ];
  if (row.job_title) lines.push(`💼 المسمى: ${row.job_title}`);
  const phones = [row.primary_phone, row.secondary_phones].filter(Boolean).join(" | ");
  if (phones) lines.push(`📞 ${phones}`);
  if (row.email) lines.push(`✉️ ${row.email}`);
  if (row.website) lines.push(`🌐 ${row.website}`);
  if (row.city_country) lines.push(`📍 ${row.city_country}`);
  if (row.full_address) lines.push(`🗺 ${row.full_address}`);
  if (row.card_type) lines.push(`🗂 ${row.card_type}`);
  if (row.notes) lines.push(`📝 ${row.notes}`);
  return lines.join("\n");
}

function chunks(blocks: string[], header = "", footer = ""): string[] {
  const out: string[] = [];
  let cur = header;
  for (const b of blocks) {
    if ((cur + "\n\n" + b).length > TG_LIMIT && cur) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${b}` : b;
  }
  if (footer) cur = (cur + footer).length > TG_LIMIT ? (out.push(cur), footer.trim()) : cur + footer;
  if (cur) out.push(cur);
  return out;
}

const sheetLine = (s: svc.SheetStatus, sectors: string[] = []) => {
  const tabs = [...new Set(sectors.filter(Boolean))];
  const tabsInfo = tabs.length ? ` (صفحة: ${tabs.join("، ")})` : "";
  return s === "ok"
    ? `📊 تم الحفظ في شيت جوجل${tabsInfo} ✔`
    : "⚠️ اتحفظ محلياً، والشيت هيتحدث أول ما النت يرجع (أو اكتب /sync)";
};

const HELP =
  "📇 *بوت تسجيل وتصنيف العملاء من المعارض*\n\n" +
  "📷 ابعت صورة كرت أو بادج أو بروشور (ممكن كذا كرت في صورة واحدة).\n" +
  "📂 البوت يصنّف كل كرت تلقائياً حسب *القطاع* و*المستوى الإداري* و*الإدارة* و*صانع القرار*، ويفتح لكل قطاع شيت مستقل مرتب من الإدارة العليا للأقل.\n" +
  "📝 اكتب ملاحظة مع الصورة أو بعدها مباشرة كرسالة.\n" +
  "🎤 ابعت بصمة صوتية بعد الصورة وهتتفرغ وتتضاف للملاحظات.\n" +
  "↩️ اعمل رد على رسالة أي عميل عشان تضيف له ملاحظة أو تصحح بياناته أو تغير قطاعه.\n" +
  "✍️ أو الصق بيانات عميل كنص وهتتسجل كعميل جديد في شيت قطاعه.\n" +
  "🔎 اسأل عن أي عميل أو قطاع أو مستوى إداري (مثال: مين صناع القرار في المقاولات؟).\n\n" +
  "الأوامر:\n" +
  "/export – ملف إكسيل مقسم بشيت لكل قطاع + ملخص\n" +
  "/sectors – عرض القطاعات المفتوحة وعدد عملاء كل قطاع\n" +
  "/stats – إحصائيات القطاعات والهيكل الإداري\n" +
  "/last – آخر عملاء اتسجلوا\n" +
  "/find – بحث\n" +
  "/undo – حذف آخر مسح\n" +
  "/sync – مزامنة الشيت\n" +
  "/rebuild – إعادة بناء وتنظيم كل صفحات الشيت";

// ---------------- bot ----------------
export function createBot(t: Transport) {
  async function reply(chatId: number, text: string, replyTo?: number, mapIds?: number[]) {
    const id = await t.send(chatId, text, replyTo);
    if (id && mapIds?.length) store.mapMessage(chatId, id, mapIds);
    return id;
  }

  async function sendLeads(chatId: number, header: string, rows: { row: Row; tag: string }[], footer: string, replyTo?: number) {
    const ids = rows.map((r) => r.row.id);
    if (rows.length === 1) {
      await reply(chatId, chunks([fmtRow(rows[0].row, rows[0].tag)], header, footer).join("\n"), replyTo, ids);
      return;
    }
    await reply(chatId, header.trim(), replyTo, ids);
    for (const r of rows) await reply(chatId, fmtRow(r.row, r.tag), undefined, [r.row.id]);
    if (footer.trim()) await reply(chatId, footer.trim(), undefined, ids);
  }

  function targetIds(msg: TgMessage, userId: number): number[] | null {
    const rt = msg.reply_to_message?.message_id;
    if (rt) {
      const ids = store.idsForMessage(msg.chat.id, rt);
      if (ids) return ids;
    }
    const last = store.getLastScan(userId);
    if (last && Date.now() - last.at < MEMORY_WINDOW_MS) return last.ids;
    return null;
  }

  async function handleImage(msg: TgMessage, fileId: string, userId: number, user: string) {
    const chatId = msg.chat.id;
    await t.typing(chatId);
    const raw = await t.download(fileId);
    const leads = await extractLeads(await prepareImage(raw));
    if (!leads.length) {
      await reply(chatId, "⚠️ ملقتش بيانات تواصل واضحة في الصورة.\nقرّب الكاميرا، خلي الإضاءة كويسة، أو ابعتها كملف للجودة الكاملة.", msg.message_id);
      return;
    }
    const caption = (msg.caption ?? "").trim();
    if (caption) for (const l of leads) l.notes = [l.notes, `[Caption] ${caption}`].filter(Boolean).join(" | ");

    const { results, ids, sheet } = await svc.saveLeads(leads, user);
    store.setLastScan(userId, ids);
    store.mapMessage(chatId, msg.message_id, ids);
    const nNew = results.filter((r) => r.isNew).length;
    const header = `✅ تم استخراج وتصنيف ${results.length} سجل` + (nNew < results.length ? ` (${results.length - nNew} موجود قبل كده واتحدّث)` : "");
    const footer = `\n\n${sheetLine(sheet, results.map((r) => r.row.sector))}` + (caption ? "" : "\n🎤 ابعت بصمة صوتية أو اكتب ملاحظة دلوقتي وهتتضاف للعميل.");
    await sendLeads(
      chatId,
      header,
      results.map((r) => ({ row: r.row, tag: r.isNew ? "🆕 " : r.changed ? "♻️ (اتحدّث) " : "♻️ (مكرر) " })),
      footer,
      msg.message_id,
    );
  }

  async function handleText(msg: TgMessage, text: string, source: "Text" | "Voice", userId: number, user: string) {
    const chatId = msg.chat.id;
    const targets = targetIds(msg, userId);
    const recentRows = targets ? store.getRows(targets) : [];
    const a = await analyzeText(
      text,
      recentRows.map((r) => ({ name: [r.full_name_ar, r.full_name_en].filter(Boolean).join(" / "), company: r.company_name })),
      source,
    );
    const pick = (idx: number[]) => (idx.length ? idx.map((i) => recentRows[i].id) : recentRows.map((r) => r.id));
    const isReply = !!msg.reply_to_message && !!targets;

    const intent = isReply && (a.intent === "new_contact" || a.intent === "other") ? "note" : a.intent;

    if (intent === "new_contact" && a.leads.length) {
      for (const l of a.leads) l.notes = [l.notes, `[${source === "Voice" ? "Voice" : "Manual"}]`].filter(Boolean).join(" | ");
      const { results, ids, sheet } = await svc.saveLeads(a.leads, user);
      store.setLastScan(userId, ids);
      await sendLeads(
        chatId,
        `✍️ سجلت وصنفت ${results.length} عميل من الرسالة`,
        results.map((r) => ({ row: r.row, tag: r.isNew ? "🆕 " : "♻️ (موجود واتحدّث) " })),
        `\n\n${sheetLine(sheet, results.map((r) => r.row.sector))}`,
        msg.message_id,
      );
      return;
    }

    if ((intent === "note" || intent === "correction") && !recentRows.length) {
      await reply(
        chatId,
        "🤔 مش عارف الملاحظة دي تخص أنهي عميل.\nاعمل رد على رسالة العميل وابعتها تاني، أو ابعت صورة الكرت الأول.\n\n" +
          (source === "Voice" ? `🎤 «${text}»` : ""),
        msg.message_id,
      );
      return;
    }

    if (intent === "note") {
      const ids = pick(a.target_indexes);
      const note = a.note || text;
      const { updated, sheet } = await svc.attachNote(ids, source === "Voice" ? "Voice" : "Note", note);
      store.touchLastScan(userId);
      const who = updated.map((r) => r.full_name_ar || r.full_name_en || r.company_name).join("، ");
      await reply(chatId, `📝 اتضافت الملاحظة لـ: ${who}\n«${note}»\n\n${sheetLine(sheet, updated.map((r) => r.sector))}`, msg.message_id, ids);
      return;
    }

    if (intent === "correction" && a.corrections.length) {
      const ids = pick(a.target_indexes);
      const fields: Record<string, string> = {};
      for (const c of a.corrections) fields[c.field] = c.value;
      const { updated, sheet } = await svc.applyCorrections(ids, fields);
      store.touchLastScan(userId);
      await sendLeads(
        chatId,
        "✏️ اتعدّلت البيانات وتحدثت صفحات الشيت:",
        updated.map((row) => ({ row, tag: "" })),
        `\n\n${sheetLine(sheet, updated.map((r) => r.sector))}`,
        msg.message_id,
      );
      return;
    }

    if (intent === "search") {
      return doFind(chatId, a.query, a.filters, msg.message_id);
    }

    await reply(chatId, a.reply || HELP, msg.message_id);
  }

  async function doFind(chatId: number, q: string, filters?: SearchFilters, replyTo?: number) {
    const hasFilter = filters && Object.values(filters).some(Boolean);
    const rows = q.trim() || hasFilter ? store.search(q, 10, filters) : [];
    const label = [q.trim(), filters?.sector, filters?.management_level, filters?.department, filters?.decision_maker === "نعم" ? "صناع القرار" : ""]
      .filter(Boolean)
      .join(" | ");
    if (!rows.length) {
      await reply(chatId, `🔎 مفيش نتائج لـ «${label || q}»`, replyTo);
      return;
    }
    await sendLeads(chatId, `🔎 لقيت ${rows.length} نتيجة لـ «${label || q}»:`, rows.map((row) => ({ row, tag: "" })), "", replyTo);
  }

  async function handleCommand(msg: TgMessage, cmd: string, arg: string, userId: number) {
    const chatId = msg.chat.id;
    switch (cmd) {
      case "/start":
      case "/help":
        return void (await reply(chatId, HELP));
      case "/export": {
        const xlsx = await buildXlsx();
        if (!xlsx) return void (await reply(chatId, "⚠️ لسه مفيش سجلات."));
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        const name = `leads_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
        const sectorsCount = store.sectorsInUse().length;
        return void (await t.sendDocument(chatId, xlsx, name, `📥 إجمالي العملاء: ${store.allRows().length} | عدد صفحات القطاعات: ${sectorsCount}`));
      }
      case "/sectors": {
        const rows = store.allRows();
        if (!rows.length) return void (await reply(chatId, "لسه مفيش عملاء متسجلين."));
        const bySector = new Map<string, { total: number; dm: number }>();
        for (const r of rows) {
          const s = r.sector || "أخرى";
          const cur = bySector.get(s) ?? { total: 0, dm: 0 };
          cur.total++;
          if (r.decision_maker === "نعم") cur.dm++;
          bySector.set(s, cur);
        }
        const list = [...bySector.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(([s, v], i) => `${i + 1}. 📂 *${s}*: ${v.total} عميل (منهم ${v.dm} صانع قرار ⭐)`)
          .join("\n");
        return void (await reply(chatId, `🗂 *صفحات القطاعات المفتوحة في الشيت (${bySector.size} قطاع):*\n\n${list}`));
      }
      case "/stats": {
        const rows = store.allRows();
        const bySector = new Map<string, number>();
        rows.forEach((r) => bySector.set(r.sector || "—", (bySector.get(r.sector || "—") ?? 0) + 1));
        const topSectors = [...bySector.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `• ${k}: ${v}`).join("\n");
        const byLevel = LEVELS.map((l) => `• ${l}: ${rows.filter((r) => r.management_level === l).length}`).join("\n");
        const dmCount = rows.filter((r) => r.decision_maker === "نعم").length;
        const pending = rows.filter((r) => !r.synced).length + store.dirtyRows().length;
        return void (await reply(
          chatId,
          `📊 *إجمالي العملاء:* ${rows.length}\n⭐ *صناع القرار:* ${dmCount}\n⏳ *في انتظار المزامنة:* ${pending}\n\n` +
            `🏛 *حسب المستوى الإداري:*\n${byLevel}\n\n` +
            `📂 *حسب القطاع (عدد الشيتات: ${bySector.size}):*\n${topSectors || "—"}`,
        ));
      }
      case "/sync": {
        const r = await svc.syncAll();
        return void (await reply(
          chatId,
          !r.ok ? "❌ فشلت المزامنة – اتأكد من النت وصلاحيات الشيت." : !r.appended && !r.notes ? "✔ كله متزامن." : `✔ اتزامن ${r.appended} سجل جديد و ${r.notes} تحديث.`,
        ));
      }
      case "/rebuild": {
        await t.typing(chatId);
        await svc.backfillClassification();
        const ok = await svc.rebuildEverything();
        return void (await reply(
          chatId,
          ok ? `✔ تم إعادة بناء وتنظيم كل صفحات الشيت (${store.sectorsInUse().length} قطاع + صفحة الملخص) بنجاح!` : "❌ تعذر إعادة بناء الشيت حالياً.",
        ));
      }
      case "/last": {
        const last = store.getLastScan(userId);
        const rows = last ? store.getRows(last.ids) : store.allRows().slice(-3);
        if (!rows.length) return void (await reply(chatId, "لسه مفيش سجلات."));
        return sendLeads(chatId, "🕘 آخر عملاء:", rows.map((row) => ({ row, tag: "" })), "");
      }
      case "/find":
        if (!arg) return void (await reply(chatId, "اكتب كلمة البحث بعد الأمر، مثال: /find سدرة"));
        return doFind(chatId, arg, undefined, msg.message_id);
      case "/undo": {
        const rt = msg.reply_to_message?.message_id;
        const ids = (rt && store.idsForMessage(chatId, rt)) || store.getLastScan(userId)?.ids;
        if (!ids?.length) return void (await reply(chatId, "مفيش حاجة أحذفها."));
        const names = store.getRows(ids).map((r) => r.full_name_ar || r.full_name_en || r.company_name).join("، ");
        const ok = await svc.removeLeads(ids);
        store.setLastScan(userId, []);
        return void (await reply(chatId, `🗑 اتحذف: ${names}` + (ok ? "\n📊 واتشال من كل صفحات الشيت ✔" : "\n⚠️ اتحذف محلياً بس، احذفه من الشيت يدوي.")));
      }
      default:
        return void (await reply(chatId, "أمر غير معروف.\n\n" + HELP));
    }
  }

  async function handleMessage(msg: TgMessage) {
    const chatId = msg.chat?.id;
    if (!chatId) return;
    const userId = msg.from?.id ?? chatId;
    if (config.allowedUsers.length && !config.allowedUsers.includes(userId)) {
      await reply(chatId, "⛔ غير مصرح لك باستخدام البوت.");
      return;
    }
    const user = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || String(userId);
    const text = (msg.text ?? "").trim();

    try {
      if (text.startsWith("/")) {
        const [c, ...rest] = text.split(/\s+/);
        return await handleCommand(msg, c.split("@")[0].toLowerCase(), rest.join(" "), userId);
      }
      const photoId = msg.photo?.length ? msg.photo[msg.photo.length - 1].file_id : undefined;
      const docImg = msg.document && /^image\//.test(msg.document.mime_type ?? "") ? msg.document.file_id : undefined;
      if (photoId || docImg) return await handleImage(msg, (photoId || docImg)!, userId, user);

      const media = msg.voice || msg.audio || (msg.document && /^audio\//.test(msg.document.mime_type ?? "") ? msg.document : undefined);
      if (media) {
        await t.typing(chatId);
        const transcript = await transcribe(await t.download(media.file_id), media.mime_type ?? "audio/ogg");
        if (!transcript) return void (await reply(chatId, "⚠️ مسمعتش كلام واضح في الريكورد.", msg.message_id));
        return await handleText(msg, transcript, "Voice", userId, user);
      }
      if (text) return await handleText(msg, text, "Text", userId, user);

      if (msg.document?.mime_type === "application/pdf")
        return void (await reply(chatId, "📄 ملفات PDF مش مدعومة لسه – خد لقطة شاشة للصفحة وابعتها كصورة.", msg.message_id));
      if (msg.contact) {
        const c = msg.contact;
        return await handleText(msg, `سجل جهة اتصال: ${[c.first_name, c.last_name].filter(Boolean).join(" ")} ${c.phone_number}`, "Text", userId, user);
      }
      await reply(chatId, "🤷 النوع ده مش مدعوم. ابعت صورة كرت، نص، أو بصمة صوتية.", msg.message_id);
    } catch (e) {
      console.error("bot error:", e);
      const m = e instanceof Error ? e.message : String(e);
      const friendly = /HTTP 401/.test(m) ? "مفتاح الذكاء الاصطناعي غير صالح." : /HTTP 429/.test(m) ? "ضغط على الخدمة، جرب تاني بعد ثواني." : "حصل خطأ مؤقت، جرب تاني.";
      await reply(chatId, `❌ ${friendly}`, msg.message_id);
    }
  }

  return { handleMessage };
}

// ---------------- Telegram types (subset) ----------------
export interface TgFile { file_id: string; mime_type?: string }
export interface TgMessage {
  message_id: number;
  chat: { id: number };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  text?: string;
  caption?: string;
  photo?: TgFile[];
  document?: TgFile & { file_name?: string };
  voice?: TgFile;
  audio?: TgFile;
  contact?: { phone_number: string; first_name?: string; last_name?: string };
  reply_to_message?: { message_id: number };
  media_group_id?: string;
}

const tgUrl = (m: string) => `https://api.telegram.org/bot${config.telegramToken}/${m}`;
async function tgCall(method: string, body: Record<string, unknown>) {
  const res = await fetch(tgUrl(method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as { ok: boolean; result?: { message_id?: number; file_path?: string }; description?: string };
}

export const telegramTransport: Transport = {
  async send(chatId, text, replyTo) {
    const base = { chat_id: chatId, text, ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) };
    let r = await tgCall("sendMessage", { ...base, parse_mode: "Markdown" });
    if (!r.ok) r = await tgCall("sendMessage", base);
    return r.result?.message_id;
  },
  async sendDocument(chatId, buf, filename, caption) {
    const fd = new FormData();
    fd.append("chat_id", String(chatId));
    fd.append("caption", caption);
    fd.append("document", new Blob([new Uint8Array(buf)]), filename);
    await fetch(tgUrl("sendDocument"), { method: "POST", body: fd });
  },
  async download(fileId) {
    const info = await tgCall("getFile", { file_id: fileId });
    if (!info.result?.file_path) throw new Error("Telegram getFile failed: " + info.description);
    const res = await fetch(`https://api.telegram.org/file/bot${config.telegramToken}/${info.result.file_path}`);
    if (!res.ok) throw new Error(`File download HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
  async typing(chatId) {
    await tgCall("sendChatAction", { chat_id: chatId, action: "typing" });
  },
};

export function startTelegramBot() {
  if (!config.telegramToken) return;
  const g = globalThis as unknown as { __tgBotPolling?: boolean };
  if (g.__tgBotPolling) return;
  g.__tgBotPolling = true;
  const bot = createBot(telegramTransport);
  console.log("🤖 Telegram bot polling…");
  // Automatically classify any legacy leads and ensure sector tabs are built
  svc.backfillClassification().catch((e) => console.error("backfill:", e));
  (async () => {
    let offset = 0;
    for (;;) {
      try {
        const res = await fetch(tgUrl("getUpdates"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset, timeout: 25, allowed_updates: ["message"] }),
        });
        const data = (await res.json()) as { ok?: boolean; result?: { update_id: number; message?: TgMessage }[]; description?: string };
        if (!data.ok) {
          console.error("getUpdates:", data.description);
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        for (const upd of data.result ?? []) {
          offset = upd.update_id + 1;
          if (upd.message) bot.handleMessage(upd.message).catch((e) => console.error("handleMessage:", e));
        }
      } catch (e) {
        console.error("poll error:", e instanceof Error ? e.message : e);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();
}
