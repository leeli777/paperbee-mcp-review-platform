import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { uploadTokens } from "@/db/schema";
import { errorResponse, requireActiveMember } from "@/lib/auth";
import { createSessionToken, hashSessionToken } from "@/lib/credentials";
import { UPLOAD_TOKEN_LIFETIME_MINUTES } from "@/lib/upload-token-auth";

const MAX_ACTIVE_TOKENS = 5;

export async function GET() {
  try {
    const member = await requireActiveMember();
    const db = await getDb();
    const tokens = await db
      .select({
        id: uploadTokens.id,
        name: uploadTokens.name,
        tokenPrefix: uploadTokens.tokenPrefix,
        createdAt: uploadTokens.createdAt,
        lastUsedAt: uploadTokens.lastUsedAt,
        expiresAt: uploadTokens.expiresAt,
        revokedAt: uploadTokens.revokedAt,
      })
      .from(uploadTokens)
      .where(eq(uploadTokens.memberId, member.id))
      .orderBy(desc(uploadTokens.createdAt));
    return Response.json({ tokens }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireActiveMember();
    const payload = (await request.json()) as { name?: string };
    const name = payload.name?.trim().slice(0, 60) || "AI 自动上传";
    const db = await getDb();
    const now = new Date();
    if (member.role !== "admin") {
      const activeWindowStart = new Date(
        now.getTime() - UPLOAD_TOKEN_LIFETIME_MINUTES * 60 * 1000,
      ).toISOString();
      const [{ value: activeTokenCount }] = await db
        .select({ value: count() })
        .from(uploadTokens)
        .where(
          and(
            eq(uploadTokens.memberId, member.id),
            isNull(uploadTokens.revokedAt),
            gt(uploadTokens.createdAt, activeWindowStart),
            gt(uploadTokens.expiresAt, now.toISOString()),
          ),
        );
      if (activeTokenCount >= MAX_ACTIVE_TOKENS) {
        return Response.json({ error: "最多保留 5 枚有效上传密钥，请先撤销不用的密钥" }, { status: 409 });
      }
    }

    const token = `pb_upload_${createSessionToken()}`;
    const expiresAt = new Date(
      now.getTime() + UPLOAD_TOKEN_LIFETIME_MINUTES * 60 * 1000,
    ).toISOString();
    const id = crypto.randomUUID();
    await db.insert(uploadTokens).values({
      id,
      memberId: member.id,
      name,
      tokenHash: await hashSessionToken(token),
      tokenPrefix: `${token.slice(0, 18)}…`,
      createdAt: now.toISOString(),
      expiresAt,
    });
    return Response.json(
      { id, token, expiresAt },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
