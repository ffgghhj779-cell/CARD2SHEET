import { authorized, unauthorized } from "@/lib/auth";
import { prepareImage } from "@/lib/imagePrep";
import { saveLeads } from "@/lib/service";
import { extractLeads, transcribe } from "@/lib/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const form = await req.formData();
    const image = form.get("image");
    const audio = form.get("audio");
    const caption = String(form.get("caption") ?? "").trim();
    const user = String(form.get("user") ?? "web").trim() || "web";
    if (!(image instanceof File)) return Response.json({ error: "image is required" }, { status: 400 });

    const [leads, voice] = await Promise.all([
      prepareImage(Buffer.from(await image.arrayBuffer())).then(extractLeads),
      audio instanceof File && audio.size > 0
        ? transcribe(Buffer.from(await audio.arrayBuffer()), audio.type || "audio/wav").catch((e) => {
            console.error(e);
            return "";
          })
        : Promise.resolve(""),
    ]);
    if (!leads.length) return Response.json({ leads: [], synced: true, voice });

    const tags = [caption && `[Caption] ${caption}`, voice && `[Voice] ${voice}`].filter(Boolean) as string[];
    for (const l of leads) if (tags.length) l.notes = [l.notes, ...tags].filter(Boolean).join(" | ");
    const { results, sheet } = await saveLeads(leads, user);
    return Response.json({ leads: results.map((r) => ({ ...r.row, isNew: r.isNew })), synced: sheet === "ok", voice });
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "Scan failed" }, { status: 500 });
  }
}
