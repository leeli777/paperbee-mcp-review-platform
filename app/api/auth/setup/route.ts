import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { members } from "@/db/schema";
import { createSession, errorResponse, isSetupRequired, sessionCookie } from "@/lib/auth";
import { hashPassword, secureTextEqual } from "@/lib/credentials";
import { SITE_OWNER_EMAIL, isSiteOwner } from "@/lib/site-owner";

export async function POST(request: Request) {
  try {
    if (!(await isSetupRequired())) {
      return Response.json({ error: "PaperBee 已完成初始化" }, { status: 409 });
    }

    const expectedToken = (env as unknown as { SETUP_TOKEN?: string }).SETUP_TOKEN;
    if (!expectedToken) {
      return Response.json({ error: "站点安装码尚未配置" }, { status: 503 });
    }

    const payload = (await request.json()) as {
      setupToken?: string;
      name?: string;
      email?: string;
      password?: string;
    };
    const setupToken = payload.setupToken?.trim() ?? "";
    const name = payload.name?.trim() ?? "";
    const email = payload.email?.trim().toLowerCase() ?? "";
    const password = payload.password ?? "";

    if (!secureTextEqual(setupToken, expectedToken)) {
      return Response.json({ error: "安装码不正确" }, { status: 403 });
    }
    if (!name || !email.includes("@")) {
      return Response.json({ error: "请填写姓名和有效邮箱" }, { status: 400 });
    }
    if (!isSiteOwner(email)) {
      return Response.json(
        { error: `站点管理员邮箱必须为 ${SITE_OWNER_EMAIL}` },
        { status: 400 },
      );
    }
    if (password.length < 12) {
      return Response.json({ error: "密码至少需要 12 个字符" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const db = await getDb();
    await db.insert(members).values({
      id,
      siteUserId: email,
      passwordHash: await hashPassword(password),
      email,
      name,
      role: "admin",
      researchField: "站点管理员",
      status: "active",
      lastSeenAt: new Date().toISOString(),
    });

    const response = Response.json({ ok: true }, { status: 201 });
    response.headers.set("Set-Cookie", sessionCookie(await createSession(id)));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
