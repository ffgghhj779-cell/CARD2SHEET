import { config } from "./config";
import { buildXlsx } from "./exporter";
import { prepareImage } from "./imagePrep";
import * as svc from "./service";
import * as store from "./store";
import type { Row } from "./types";
import { analyzeText, extractLeads, transcribe } from "./vision";

const MEMORY_WINDOW_MS = 30 * 60 * 1000; // follow-up text/voice attaches to the last scan within 30 min
const TG_LIMIT = 3900;

export interface Transport {
  send(chatId: number, text: string, replyTo?: number): Promise<number | undefined>; // returns message_id
  sendDocument(chatId: number, buf: Buffer, filename: string, caption: string): Promise<void>;
  download(fileId: string): Promise<Buffer>;
  typing(chatId: number): Promise<void>;
}

// ---------------- formatting ----------------
export function fmtRow(row: Row, tag = ""): string {
  const name = [row.full_name_ar, row.full_name_en].filter(Boolean).join(" / ") || "—";
  const lines = [`${tag}👤 ${name}`.trim(), `🏢 ${row.company_name || "—"}`, `🏷 ${row.industry_category || "—"}`];
  if (row.job_title) lines.push(`💼 ${row.job_title}`);
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

const sheetLine = (s: svc.SheetStatus) =>
  s === "ok" ? "📊 Google Sheets ✔" : "⚠️ اتحفظ محلياً، والشيت هيتحدث أول ما النت يرجع (أو اكتب /sync)";

const HELP =
  "📇 *بوت تسجيل العملاء من المعارض*\n\n" +
  "📷 ابعت صورة كرت / بادج / بروشور (ممكن كذا كرت في صورة واحدة). للدقة القصوى ابعتها كـ *File*.\n" +
  "📝 اكتب ملاحظة مع الصورة (Caption) أو بعدها مباشرة كرسالة.\n" +
  "🎤 ابعت Voice Note بعد الصورة وهتتفرغ وتتضاف للملاحظات.\n" +
  "↩️ اعمل Reply على رسالة أي عميل عشان تضيف له ملاحظة أو تصحح بياناته (مثال: الإيميل الصح ali@x.com).\n" +
  "✍️ أو الصق بيانات عميل كنص وهتتسجل كعميل جديد.\n" +
  "🔎 اسأل عن أي عميل: (مين من شركة سدرة؟) أو /find سدرة\n\n" +
  "الأوامر:\n/export – ملف Excel\n/last – آخر عملاء اتسجلوا\n/find – بحث\n/undo – حذف آخر مسح\n/stats – إحصائيات\n/sync – مزامنة الشيت";

// ---------------- bot ----------------
export function createBot(t: Transport) {
  async function reply(chatId: number, text: string, replyTo?: number, mapIds?: number[]) {
    const id = await t.send(chatId, text, replyTo);
    if (id && mapIds?.length) store.mapMessage(chatId, id, mapIds);
    return id;
  }

  async function sendLeads(chatId: number, header: string, rows: { row: Row; tag: string }[], footer: string, replyTo?: number) {
    const ids = rows.map((r) => r.row.id);
    // one message per lead when several => each one can be replied-to individually
    if (rows.length === 1) {
      await reply(chatId, chunks([fmtRow(rows[0].row, rows[0].tag)], header, footer).join("\n"), replyTo, ids);
      return;
    }
    await reply(chatId, header.trim(), replyTo, ids);
    for (const r of rows) await reply(chatId, fmtRow(r.row, r.tag), undefined, [r.row.id]);
    if (footer.trim()) await reply(chatId, footer.trim(), undefined, ids);
  }

  /** Resolve which leads a follow-up refers to: reply-to message > last scan (memory window). */
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
      await reply(chatId, "⚠️ ملقتش بيانات تواصل واضحة في الصورة.\nقرّب الكاميرا، خلي الإضاءة كويسة، أو ابعتها كـ File للجودة الكاملة.", msg.message_id);
      return;
    }
    const caption = (msg.caption ?? "").trim();
    if (caption) for (const l of leads) l.notes = [l.notes, `[Caption] ${caption}`].filter(Boolean).join(" | ");

    const { results, ids, sheet } = await svc.saveLeads(leads, user);
    store.setLastScan(userId, ids);
    store.mapMessage(chatId, msg.message_id, ids); // replying to the photo itself also works
    const nNew = results.filter((r) => r.isNew).length;
    const header = `✅ تم استخراج ${results.length} سجل` + (nNew < results.length ? ` (${results.length - nNew} موجود قبل كده واتحدّث)` : "");
    const footer = `\n\n${sheetLine(sheet)}` + (caption ? "" : "\n🎤 ابعت Voice Note أو اكتب ملاحظة دلوقتي وهتتضاف للعميل.");
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

    // a reply to a lead message is always about that lead (unless it's clearly a correction/search)
    const intent = isReply && (a.intent === "new_contact" || a.intent === "other") ? "note" : a.intent;

    if (intent === "new_contact" && a.leads.length) {
      for (const l of a.leads) l.notes = [l.notes, `[${source === "Voice" ? "Voice" : "Manual"}]`].filter(Boolean).join(" | ");
      const { results, ids, sheet } = await svc.saveLeads(a.leads, user);
      store.setLastScan(userId, ids);
      await sendLeads(
        chatId,
        `✍️ سجلت ${results.length} عميل من الرسالة`,
        results.map((r) => ({ row: r.row, tag: r.isNew ? "🆕 " : "♻️ (موجود واتحدّث) " })),
        `\n\n${sheetLine(sheet)}`,
        msg.message_id,
      );
      return;
    }

    if ((intent === "note" || intent === "correction") && !recentRows.length) {
      await reply(
        chatId,
        "🤔 مش عارف الملاحظة دي تخص أنهي عميل.\nاعمل *Reply* على رسالة العميل وابعتها تاني، أو ابعت صورة الكرت الأول.\n\n" +
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
      await reply(chatId, `📝 اتضافت الملاحظة لـ: ${who}\n«${note}»\n\n${sheetLine(sheet)}`, msg.message_id, ids);
      return;
    }

    if (intent === "correction" && a.corrections.length) {
      const ids = pick(a.target_indexes);
      const fields: Record<string, string> = {};
      for (const c of a.corrections) fields[c.field] = c.value;
      const { updated, sheet } = await svc.applyCorrections(ids, fields);
      store.touchLastScan(userId);
      await sendLeads(chatId, "✏️ اتعدّلت البيانات:", updated.map((row) => ({ row, tag: "" })), `\n\n${sheetLine(sheet)}`, msg.message_id);
      return;
    }

    if (intent === "search") {
      return doFind(chatId, a.query || text, msg.message_id);
    }

    await reply(chatId, a.reply || HELP, msg.message_id);
  }

  async function doFind(chatId: number, q: string, replyTo?: number) {
    const rows = q.trim() ? store.search(q) : [];
    if (!rows.length) {
      await reply(chatId, `🔎 مفيش نتائج لـ «${q}»`, replyTo);
      return;
    }
    await sendLeads(chatId, `🔎 لقيت ${rows.length} نتيجة لـ «${q}»:`, rows.map((row) => ({ row, tag: "" })), "", replyTo);
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
        return void (await t.sendDocument(chatId, xlsx, name, `📥 إجمالي السجلات: ${store.allRows().length}`));
      }
      case "/stats": {
        const rows = store.allRows();
        const by = new Map<string, number>();
        rows.forEach((r) => by.set(r.industry_category || "—", (by.get(r.industry_category || "—") ?? 0) + 1));
        const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `• ${k}: ${v}`).join("\n");
        const pending = rows.filter((r) => !r.synced).length + store.dirtyRows().length;
        return void (await reply(chatId, `📊 إجمالي العملاء: ${rows.length}\n⏳ في انتظار المزامنة: ${pending}\n\nحسب القطاع:\n${top || "—"}`));
      }
      case "/sync": {
        const r = await svc.syncAll();
        return void (await reply(
          chatId,
          !r.ok ? "❌ فشلت المزامنة – اتأكد من النت وصلاحيات الشيت." : !r.appended && !r.notes ? "✔ كله متزامن." : `✔ اتزامن ${r.appended} سجل جديد و ${r.notes} تحديث.`,
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
        return doFind(chatId, arg, msg.message_id);
      case "/undo": {
        const rt = msg.reply_to_message?.message_id;
        const ids = (rt && store.idsForMessage(chatId, rt)) || store.getLastScan(userId)?.ids;
        if (!ids?.length) return void (await reply(chatId, "مفيش حاجة أحذفها."));
        const names = store.getRows(ids).map((r) => r.full_name_ar || r.full_name_en || r.company_name).join("، ");
        const ok = await svc.removeLeads(ids);
        store.setLastScan(userId, []);
        return void (await reply(chatId, `🗑 اتحذف: ${names}` + (ok ? "\n📊 واتشال من Google Sheets ✔" : "\n⚠️ اتحذف محلياً بس، احذفه من الشيت يدوي.")));
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
        return void (await reply(chatId, "📄 ملفات PDF مش مدعومة لسه – خد Screenshot للصفحة وابعتها كصورة.", msg.message_id));
      if (msg.contact) {
        const c = msg.contact;
        return await handleText(msg, `سجل جهة اتصال: ${[c.first_name, c.last_name].filter(Boolean).join(" ")} ${c.phone_number}`, "Text", userId, user);
      }
      await reply(chatId, "🤷 النوع ده مش مدعوم. ابعت صورة كرت، نص، أو Voice Note.", msg.message_id);
    } catch (e) {
      console.error("bot error:", e);
      const m = e instanceof Error ? e.message : String(e);
      const friendly = /HTTP 401/.test(m) ? "مفتاح OpenAI غير صالح." : /HTTP 429/.test(m) ? "ضغط على خدمة الذكاء الاصطناعي أو الرصيد خلص، جرب تاني بعد شوية." : "حصل خطأ مؤقت، جرب تاني.";
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

// ---------------- real Telegram transport + long polling ----------------
const tgUrl = (m: string) => `https://api.telegram.org/bot${config.telegramToken}/${m}`;
async function tgCall(method: string, body: Record<string, unknown>) {
  const res = await fetch(tgUrl(method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as { ok: boolean; result?: { message_id?: number; file_path?: string }; description?: string };
}

export const telegramTransport: Transport = {
  async send(chatId, text, replyTo) {
    const base = { chat_id: chatId, text, ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) };
    let r = await tgCall("sendMessage", { ...base, parse_mode: "Markdown" });
    if (!r.ok) r = await tgCall("sendMessage", base); // fallback if Markdown breaks on user data
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
