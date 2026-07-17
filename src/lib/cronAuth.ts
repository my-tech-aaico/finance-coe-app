import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

/**
 * Shared-secret check for the /api/cron/* routes — these have no user session
 * (schedulers run as a system process, statement.md/scheduler.md §3.4), so the
 * only auth is a secret header set by whatever external cron caller invokes them.
 */
export function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
