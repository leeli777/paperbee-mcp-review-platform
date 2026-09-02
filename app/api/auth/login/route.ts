import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { members } from "@/db/schema";
import { createSession, errorResponse, sessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/credentials";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string; password?: string };
    const email = payload.email?.trim().toLowerCase() ?? "";
    const password = payload.password ?? "";
    const db = await getDb();
    const [member] = await db
      .select()
      .from(members)
      .where(eq(members.email, email))
      .limit(1);

    const valid = Boolean(
      member?.passwordHash &&
        member.status === "active" &&
        (await verifyPassword(password, member.passwordHash)),
    );
    if (!valid || !member) {
      return Response.json({ error: "邮箱或密码不正确" }, { status: 401 });
    }

    const response = Response.json({ ok: true });
    response.headers.set("Set-Cookie", sessionCookie(await createSession(member.id)));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
