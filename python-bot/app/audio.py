import asyncio
import io
import logging

from .vision import _client

log = logging.getLogger(__name__)

PROMPT = (
    "Transcribe this voice note verbatim in its original language (Arabic, English or mixed). "
    "Do NOT translate, summarize or add anything. Keep names, numbers and amounts exactly as spoken."
)


async def transcribe(data: bytes, mime: str = "audio/ogg") -> str:
    ext = "ogg" if "ogg" in mime or "opus" in mime else "wav"
    last: Exception | None = None
    for attempt in range(3):
        try:
            buf = io.BytesIO(data)
            buf.name = f"voice.{ext}"
            resp = await _client.audio.transcriptions.create(
                model="whisper-1",
                file=buf,
                prompt=PROMPT,
                temperature=0.0,
            )
            return " ".join((resp.text or "").split())
        except Exception as e:
            last = e
            log.warning("Transcribe attempt %d failed: %s", attempt + 1, e)
            await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Transcription failed: {last}")
