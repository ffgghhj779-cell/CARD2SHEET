import io
import logging
import time
from datetime import datetime

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from app import config, exporter, sheets, store
from app.audio import transcribe
from app.image_utils import prepare_image
from app.vision import extract_leads

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
log = logging.getLogger("bot")

VOICE_WINDOW_SEC = 600  # a voice note is attached to the last photo if sent within 10 minutes


def allowed(update: Update) -> bool:
    return not config.ALLOWED_USER_IDS or update.effective_user.id in config.ALLOWED_USER_IDS


async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not allowed(update):
        return
    await update.message.reply_text(
        "📇 أرسل صورة كرت / بادج / بروشور (يمكن أكثر من كرت في صورة واحدة).\n"
        "Send a photo of cards, badges or brochures.\n\n"
        "📝 Add a caption to the photo, or 🎤 send a voice note right after it – "
        "it is appended to the lead's Notes.\n\n"
        "/export – Excel file\n/stats – count\n/sync – retry Google Sheets sync"
    )


def _fmt(row: dict, is_new: bool) -> str:
    name = " / ".join(x for x in (row["full_name_ar"], row["full_name_en"]) if x) or "—"
    lines = [
        f"{'✅' if is_new else '♻️ (duplicate, skipped)'} {name}",
        f"🏢 {row['company_name'] or '—'}",
        f"🏷 {row['industry_category'] or '—'}",
    ]
    if row["job_title"]:
        lines.append(f"💼 {row['job_title']}")
    phones = " | ".join(x for x in (row["primary_phone"], row["secondary_phones"]) if x)
    if phones:
        lines.append(f"📞 {phones}")
    for icon, k in (("✉️", "email"), ("🌐", "website"), ("📍", "city_country")):
        if row[k]:
            lines.append(f"{icon} {row[k]}")
    if row["notes"]:
        lines.append(f"📝 {row['notes']}")
    return "\n".join(lines)


async def attach_note(ids: list[int], label: str, text: str) -> str:
    """Append '[label] text' to the notes of existing leads (SQLite + Google Sheets row)."""
    rows = store.append_note(ids, f"[{label}] {text}")
    in_sheet = [(i, n) for i, n, synced in rows if synced]
    if len(in_sheet) < len(rows):
        # not yet in the sheet -> the note goes out with the row on the next /sync
        return "saved locally – will reach Google Sheets on /sync"
    if in_sheet and await sheets.update_notes(in_sheet):
        store.clear_notes_pending([i for i, _ in in_sheet])
        return "Google Sheets ✔"
    return "saved locally – Sheets update pending, use /sync"


async def handle_image(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not allowed(update):
        return
    msg = update.message
    if msg.photo:
        file = await msg.photo[-1].get_file()
    elif msg.document and (msg.document.mime_type or "").startswith("image/"):
        file = await msg.document.get_file()  # sending as file keeps full resolution
    else:
        return
    await ctx.bot.send_chat_action(msg.chat_id, ChatAction.TYPING)
    try:
        raw = bytes(await file.download_as_bytearray())
        leads = await extract_leads(prepare_image(raw))
    except Exception as e:
        log.exception("scan failed")
        await msg.reply_text(f"❌ تعذر قراءة الصورة، حاول مرة أخرى.\n{e}")
        return
    if not leads:
        await msg.reply_text("⚠️ لم أجد بيانات اتصال واضحة. صوّر الكرت أقرب وبإضاءة أفضل.")
        return

    caption = (msg.caption or "").strip()
    user = update.effective_user.full_name or str(update.effective_user.id)
    new_rows, new_ids, all_ids, dup_ids, replies = [], [], [], [], []
    for lead in leads:
        if caption:  # caption applies to every lead found in this photo
            tag = f"[Caption] {caption}"
            lead.notes = f"{lead.notes} | {tag}" if lead.notes else tag
        rid, is_new, row = store.add(lead, user)
        all_ids.append(rid)
        replies.append(_fmt(row, is_new))
        if is_new:
            new_ids.append(rid)
            new_rows.append(row)
        else:
            dup_ids.append(rid)

    ok = await sheets.append_rows(new_rows) if new_rows else True
    if ok and new_ids:
        store.mark_synced(new_ids)
    if caption and dup_ids:
        await attach_note(dup_ids, "Caption", caption)

    # remember the batch so a voice note sent next is attached to these leads
    ctx.user_data["last"] = {"ids": all_ids, "t": time.time()}

    status = (
        f"\n\n📊 {len(new_rows)} new → Google Sheets ✔" if ok and new_rows
        else "" if ok
        else "\n\n⚠️ Saved locally, Sheets sync failed – use /sync later."
    )
    hint = "\n🎤 Send a voice note now to add it to these leads' notes." if not caption else ""
    await msg.reply_text(f"تم استخراج {len(leads)} سجل:\n\n" + "\n\n".join(replies) + status + hint)


async def handle_voice(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not allowed(update):
        return
    msg = update.message
    last = ctx.user_data.get("last")
    if not last or time.time() - last["t"] > VOICE_WINDOW_SEC:
        await msg.reply_text("🎤 Send the voice note within 10 minutes AFTER a card photo, so I know which lead it belongs to.")
        return
    media = msg.voice or msg.audio
    await ctx.bot.send_chat_action(msg.chat_id, ChatAction.TYPING)
    try:
        file = await media.get_file()
        data = bytes(await file.download_as_bytearray())
        text = await transcribe(data, media.mime_type or "audio/ogg")
    except Exception as e:
        log.exception("voice failed")
        await msg.reply_text(f"❌ Could not transcribe the voice note.\n{e}")
        return
    if not text:
        await msg.reply_text("⚠️ No speech detected in the voice note.")
        return
    result = await attach_note(last["ids"], "Voice", text)
    last["t"] = time.time()  # allow follow-up voice notes
    await msg.reply_text(f"🎤 Added to {len(last['ids'])} lead(s) – {result}\n\n“{text}”")


async def export(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not allowed(update):
        return
    data = exporter.build_xlsx()
    if not data:
        await update.message.reply_text("No leads yet.")
        return
    name = f"leads_{datetime.now():%Y%m%d_%H%M}.xlsx"
    await update.message.reply_document(io.BytesIO(data), filename=name, caption=f"📥 {len(store.all_rows())} leads")


async def stats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if allowed(update):
        rows = store.all_rows()
        await update.message.reply_text(f"Total: {len(rows)} | Unsynced: {sum(1 for r in rows if not r['synced'])}")


async def sync(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not allowed(update):
        return
    pending = store.unsynced()
    notes = store.pending_notes()
    if not pending and not notes:
        await update.message.reply_text("Everything is synced ✔")
        return
    parts = []
    if pending:
        if await sheets.append_rows([r for _, r in pending]):
            store.mark_synced([i for i, _ in pending])
            parts.append(f"{len(pending)} rows")
        else:
            await update.message.reply_text("Sync failed – check credentials/sheet sharing.")
            return
    notes = store.pending_notes()  # re-read: rows just appended no longer need a notes update
    if notes:
        if await sheets.update_notes(notes):
            store.clear_notes_pending([i for i, _ in notes])
            parts.append(f"{len(notes)} notes")
        else:
            await update.message.reply_text("Notes sync failed – check credentials.")
            return
    await update.message.reply_text("Synced " + " + ".join(parts) + " ✔")


def main():
    app = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()
    app.add_handler(CommandHandler(["start", "help"], start))
    app.add_handler(CommandHandler("export", export))
    app.add_handler(CommandHandler("stats", stats))
    app.add_handler(CommandHandler("sync", sync))
    app.add_handler(MessageHandler(filters.PHOTO | filters.Document.IMAGE, handle_image))
    app.add_handler(MessageHandler(filters.VOICE | filters.AUDIO, handle_voice))
    log.info("Bot running…")
    app.run_polling()


if __name__ == "__main__":
    main()
