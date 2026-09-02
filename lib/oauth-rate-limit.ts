import { lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { oauthRateLimits } from "@/db/schema";
import { hashSessionToken } from "@/lib/credentials";

export function oauthClientAddress(request: Request) {
  return request.headers.get("CF-Connecting-IP")
    ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? "unknown";
}

export async function consumeOAuthRateLimit(subject: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const bucket = Math.floor(now / (windowSeconds * 1000));
  const key = await hashSessionToken(`${subject}:${bucket}`);
  const db = await getDb();
  await db.delete(oauthRateLimits).where(lt(oauthRateLimits.expiresAt, new Date(now).toISOString()));
  const [record] = await db.insert(oauthRateLimits)
    .values({ key, count: 1, expiresAt: new Date((bucket + 2) * windowSeconds * 1000).toISOString() })
    .onConflictDoUpdate({
      target: oauthRateLimits.key,
      set: { count: sql`${oauthRateLimits.count} + 1` },
    })
    .returning({ count: oauthRateLimits.count });
  return Number(record?.count ?? limit + 1) <= limit;
}
