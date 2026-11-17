import { authorized, unauthorized } from "@/lib/auth";
import { syncAll } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  return Response.json(await syncAll());
}
