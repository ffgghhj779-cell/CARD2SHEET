import { authorized, unauthorized } from "@/lib/auth";
import { attachNote } from "@/lib/service";
import { transcribe } from "@/lib/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Attach a voice note (audio file) or plain text to existing leads' notes. */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const form = await req.formData();
    const ids = (JSON.parse(String(form.get("ids") ?? "[]")) as unknown[]).map(Number).filter(Number.isFinite);
    const audio = form.get("audio");
    let text = String(form.get("text") ?? "").trim();
    let label = "Note";
    if (audio instanceof File && audio.size > 0) {
      text = await transcribe(Buffer.from(await audio.arrayBuffer()), audio.type || "audio/wav");
      label = "Voice";
    }
    if (!ids.length) return Response.json({ error: "ids required" }, { status: 400 });
    if (!text) return Response.json({ error: "No speech detected" }, { status: 422 });
    const { sheet } = await attachNote(ids, label, text);
    return Response.json({ text, sheet });
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
