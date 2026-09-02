import { and, count, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { members, sessions } from "@/db/schema";
import { createSessionToken, hashSessionToken } from "@/lib/credentials";

const SESSION_COOKIE = "paperbee_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SiteIdentity = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export class AccessError extends Error {
  constructor(
    message: string,
    public status = 403,
  ) {
    super(message);
  }
}

export async function getSiteIdentity(): Promise<SiteIdentity | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    const tokenHash = await hashSessionToken(token);
    const now = new Date().toISOString();
    const [record] = await db
      .select({
        id: members.id,
        email: members.email,
        name: members.name,
      })
      .from(sessions)
      .innerJoin(members, eq(sessions.memberId, members.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, now),
          eq(members.status, "active"),
        ),
      )
      .limit(1);

    if (record) {
      return {
        userId: record.id,
        email: record.email,
        displayName: record.name,
        fullName: record.name,
      };
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      userId: "paperbee-local-owner",
      email: "owner@paperbee.local",
      displayName: "本地管理员",
      fullName: "本地管理员",
    };
  }

  return null;
}

export async function requireActiveMember() {
  const identity = await getSiteIdentity();
  if (!identity) throw new AccessError("请登录 PaperBee 后继续", 401);

  const db = await getDb();
  const [existing] = await db
    .select()
    .from(members)
    .where(eq(members.id, identity.userId))
    .limit(1);

  if (existing) {
    if (existing.status === "disabled") throw new AccessError("此账号已停用", 403);
    await db
      .update(members)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(members.id, existing.id));
    return { ...existing, identity };
  }

  if (process.env.NODE_ENV !== "production") {
    const [{ value: memberCount }] = await db.select({ value: count() }).from(members);
    if (memberCount === 0) {
      const member = {
        id: identity.userId,
        siteUserId: identity.userId,
        email: identity.email,
        name: identity.displayName,
        role: "admin",
        researchField: "站点管理员",
        status: "active",
        lastSeenAt: new Date().toISOString(),
      };
      await db.insert(members).values(member);
      return { ...member, passwordHash: null, createdAt: new Date().toISOString(), identity };
    }
  }

  throw new AccessError("账号不存在或已失效", 403);
}

export async function isSetupRequired() {
  const db = await getDb();
  const [{ value }] = await db.select({ value: count() }).from(members);
  return value === 0;
}

export async function createSession(memberId: string) {
  const db = await getDb();
  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    memberId,
    tokenHash,
    expiresAt,
  });
  return token;
}

export async function deleteCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, await hashSessionToken(token)));
}

export function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function expiredSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}

export function errorResponse(error: unknown) {
  if (error instanceof AccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "服务暂时不可用";
  return Response.json({ error: message }, { status: 500 });
}
