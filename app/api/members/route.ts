import { getDb } from "@/db";
import { members } from "@/db/schema";
import { AccessError, errorResponse, requireActiveMember } from "@/lib/auth";
import { hashPassword } from "@/lib/credentials";
import { isSiteOwner } from "@/lib/site-owner";

export async function POST(request: Request) {
  try {
    const member = await requireActiveMember();
    if (member.role !== "admin") throw new AccessError("只有管理员可以邀请成员", 403);

    const payload = (await request.json()) as {
      email?: string;
      name?: string;
      role?: string;
      researchField?: string;
      password?: string;
    };
    const email = payload.email?.trim().toLowerCase() ?? "";
    const name = payload.name?.trim() ?? "";
    const password = payload.password ?? "";
    const requestedRole = ["member", "reviewer", "admin"].includes(payload.role ?? "")
      ? payload.role!
      : "member";
    if (!email || !name || !email.includes("@")) {
      return Response.json({ error: "请填写有效的姓名和邮箱" }, { status: 400 });
    }
    if (password.length < 12) {
      return Response.json({ error: "初始密码至少需要 12 个字符" }, { status: 400 });
    }
    if (isSiteOwner(email)) {
      throw new AccessError("站点管理员账号只能在站点初始化时创建", 409);
    }
    if (requestedRole === "admin" && !isSiteOwner(member.email)) {
      throw new AccessError("只有站点管理员可以创建管理员账号", 403);
    }

    const db = await getDb();
    await db.insert(members).values({
      id: crypto.randomUUID(),
      siteUserId: email,
      passwordHash: await hashPassword(password),
      email,
      name,
      role: requestedRole,
      researchField: payload.researchField?.trim() || "待补充",
      status: "active",
    });

    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "邀请失败";
    if (message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: "该邮箱已经在成员列表中" }, { status: 409 });
    }
    return errorResponse(error);
  }
}
