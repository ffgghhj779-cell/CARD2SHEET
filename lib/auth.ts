import { config } from "./config";

export function authorized(req: Request): boolean {
  return !config.accessKey || req.headers.get("x-access-key") === config.accessKey;
}

export const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });
