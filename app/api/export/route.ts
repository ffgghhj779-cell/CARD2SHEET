import { authorized, unauthorized } from "@/lib/auth";
import { buildXlsx } from "@/lib/exporter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const data = await buildXlsx();
  if (!data) return Response.json({ error: "No leads yet" }, { status: 404 });
  const d = new Date();
  const name = `leads_${d.toISOString().slice(0, 16).replace(/[-:T]/g, "")}.xlsx`;
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
