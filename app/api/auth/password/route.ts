import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { members, oauthTokenFamilies, oauthTokens, sessions } from "@/db/schema";
import { createSession, errorResponse, requireActiveMember, sessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/credentials";

export async function POST(request: Request) {
  try {
    const member = await requireActiveMember();
    const payload = (await request.json()) as { password?: string };
    const password = payload.password ?? "";
    if (password.length < 12) {
      return Response.json({ error: "新密码至少需要 12 个字符" }, { status: 400 });
    }

    const db = await getDb();
    await db
      .update(members)
      .set({
        passwordHash: await hashPassword(password),
        oauthCredentialVersion: sql`${members.oauthCredentialVersion} + 1`,
      })
      .where(eq(members.id, member.id));

    // Revoke every existing login and immediately issue a fresh session for
    // the browser that performed the password change.
    await db.delete(sessions).where(eq(sessions.memberId, member.id));
    await db.update(oauthTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(oauthTokens.memberId, member.id));
    await db.update(oauthTokenFamilies)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(oauthTokenFamilies.memberId, member.id));
    const response = Response.json({ ok: true });
    response.headers.set("Set-Cookie", sessionCookie(await createSession(member.id)));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
