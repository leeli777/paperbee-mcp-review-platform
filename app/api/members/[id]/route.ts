import { and, count, eq, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  aiAccessLogs,
  assignments,
  downloadLogs,
  members,
  oauthAuthorizationCodes,
  oauthTokenFamilies,
  oauthTokens,
  projectLikes,
  projects,
  projectTags,
  projectVersions,
  sessions,
  tagLikes,
  uploadTokens,
} from "@/db/schema";
import { AccessError, errorResponse, requireActiveMember } from "@/lib/auth";
import { SITE_OWNER_EMAIL, isSiteOwner } from "@/lib/site-owner";

const MEMBER_ROLES = ["member", "reviewer", "admin"] as const;
const MEMBER_STATUSES = ["active", "disabled", "invited"] as const;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const payload = (await request.json()) as {
      name?: unknown;
      researchField?: unknown;
      role?: unknown;
      status?: unknown;
    };
    const db = await getDb();
    const [target] = await db.select().from(members).where(eq(members.id, id)).limit(1);
    if (!target) throw new AccessError("成员不存在", 404);
    if (isSiteOwner(target.email)) throw new AccessError("站点管理员账号不可更改", 409);
    if (!isSiteOwner(admin.email) && target.role === "admin") {
      throw new AccessError("只有站点管理员可以管理其他管理员", 403);
    }

    const updates: Partial<typeof members.$inferInsert> = {};
    if (payload.name !== undefined) {
      if (typeof payload.name !== "string" || !payload.name.trim() || payload.name.trim().length > 120) {
        throw new AccessError("成员姓名不能为空且不能超过 120 个字符", 400);
      }
      updates.name = payload.name.trim();
    }
    if (payload.researchField !== undefined) {
      if (typeof payload.researchField !== "string" || payload.researchField.trim().length > 120) {
        throw new AccessError("研究方向不能超过 120 个字符", 400);
      }
      updates.researchField = payload.researchField.trim() || "待补充";
    }
    if (payload.role !== undefined) {
      if (typeof payload.role !== "string" || !MEMBER_ROLES.includes(payload.role as typeof MEMBER_ROLES[number])) {
        throw new AccessError("成员角色无效", 400);
      }
      if (payload.role === "admin" && !isSiteOwner(admin.email)) {
        throw new AccessError("只有站点管理员可以授予管理员权限", 403);
      }
      updates.role = payload.role;
    }
    if (payload.status !== undefined) {
      if (typeof payload.status !== "string" || !MEMBER_STATUSES.includes(payload.status as typeof MEMBER_STATUSES[number])) {
        throw new AccessError("成员状态无效", 400);
      }
      if (payload.status === "invited" && target.status !== "invited") {
        throw new AccessError("已启用或停用的成员不能改回待登录状态", 400);
      }
      updates.status = payload.status;
    }
    if (!Object.keys(updates).length) throw new AccessError("没有需要更新的成员信息", 400);

    const nextRole = updates.role ?? target.role;
    const nextStatus = updates.status ?? target.status;
    const targetWriteCondition = isSiteOwner(admin.email)
      ? and(eq(members.id, id), sql`lower(${members.email}) <> ${SITE_OWNER_EMAIL}`)
      : and(
          eq(members.id, id),
          ne(members.role, "admin"),
          sql`lower(${members.email}) <> ${SITE_OWNER_EMAIL}`,
        );
    const targetStillManageable = isSiteOwner(admin.email)
      ? sql`EXISTS (SELECT 1 FROM members AS target WHERE target.id = ${id} AND lower(target.email) <> ${SITE_OWNER_EMAIL})`
      : sql`EXISTS (SELECT 1 FROM members AS target WHERE target.id = ${id} AND target.role <> 'admin' AND lower(target.email) <> ${SITE_OWNER_EMAIL})`;
    const removesActiveAdmin = target.role === "admin" && target.status === "active" &&
      (nextRole !== "admin" || nextStatus !== "active");
    if (removesActiveAdmin) {
      const [{ value: otherActiveAdmins }] = await db
        .select({ value: count() })
        .from(members)
        .where(and(eq(members.role, "admin"), eq(members.status, "active"), ne(members.id, id)));
      if (otherActiveAdmins === 0) {
        throw new AccessError("必须至少保留一名启用中的管理员", 409);
      }
    }

    const disabling = target.status === "active" && nextStatus === "disabled";
    if (disabling) {
      const now = new Date().toISOString();
      const [updated] = await db.batch([
        db.update(members)
          .set({ ...updates, oauthCredentialVersion: sql`${members.oauthCredentialVersion} + 1` })
          .where(targetWriteCondition)
          .returning({ id: members.id }),
        db.delete(sessions).where(and(eq(sessions.memberId, id), targetStillManageable)),
        db.update(uploadTokens).set({ revokedAt: now })
          .where(and(eq(uploadTokens.memberId, id), isNull(uploadTokens.revokedAt), targetStillManageable)),
        db.delete(oauthAuthorizationCodes).where(and(eq(oauthAuthorizationCodes.memberId, id), targetStillManageable)),
        db.update(oauthTokens).set({ revokedAt: now })
          .where(and(eq(oauthTokens.memberId, id), isNull(oauthTokens.revokedAt), targetStillManageable)),
        db.update(oauthTokenFamilies).set({ revokedAt: now })
          .where(and(eq(oauthTokenFamilies.memberId, id), isNull(oauthTokenFamilies.revokedAt), targetStillManageable)),
      ]);
      if (updated.length === 0) throw new AccessError("该成员的权限已发生变化，请刷新后重试", 409);
    } else {
      const updated = await db
        .update(members)
        .set(updates)
        .where(targetWriteCondition)
        .returning({ id: members.id });
      if (updated.length === 0) throw new AccessError("该成员的权限已发生变化，请刷新后重试", 409);
    }

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isActiveAdminConstraint(error)) {
      return errorResponse(new AccessError("必须至少保留一名启用中的管理员", 409));
    }
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    if (id === admin.id) throw new AccessError("不能删除当前登录的管理员账号", 409);

    const db = await getDb();
    const [target] = await db.select({ id: members.id, email: members.email, role: members.role }).from(members).where(eq(members.id, id)).limit(1);
    if (!target) throw new AccessError("成员不存在", 404);
    if (isSiteOwner(target.email)) throw new AccessError("站点管理员账号不可删除", 409);
    if (!isSiteOwner(admin.email) && target.role === "admin") {
      throw new AccessError("只有站点管理员可以删除其他管理员", 403);
    }

    const references = await Promise.all([
      db.select({ id: projects.id }).from(projects).where(eq(projects.ownerMemberId, id)).limit(1),
      db.select({ id: projectVersions.id }).from(projectVersions).where(eq(projectVersions.uploadedByMemberId, id)).limit(1),
      db.select({ id: projectTags.id }).from(projectTags).where(eq(projectTags.createdByMemberId, id)).limit(1),
      db.select({ id: projectLikes.id }).from(projectLikes).where(eq(projectLikes.memberId, id)).limit(1),
      db.select({ id: tagLikes.id }).from(tagLikes).where(eq(tagLikes.memberId, id)).limit(1),
      db.select({ id: assignments.id }).from(assignments)
        .where(or(eq(assignments.reviewerMemberId, id), eq(assignments.assignedByMemberId, id))).limit(1),
      db.select({ id: downloadLogs.id }).from(downloadLogs).where(eq(downloadLogs.memberId, id)).limit(1),
      db.select({ id: aiAccessLogs.id }).from(aiAccessLogs).where(eq(aiAccessLogs.memberId, id)).limit(1),
    ]);
    if (references.some((rows) => rows.length > 0)) {
      throw new AccessError("该成员已有项目、审核或审计记录，请改为停用以保留历史", 409);
    }

    const targetStillManageable = isSiteOwner(admin.email)
      ? sql`EXISTS (SELECT 1 FROM members AS target WHERE target.id = ${id} AND lower(target.email) <> ${SITE_OWNER_EMAIL})`
      : sql`EXISTS (SELECT 1 FROM members AS target WHERE target.id = ${id} AND target.role <> 'admin' AND lower(target.email) <> ${SITE_OWNER_EMAIL})`;
    const [, , , , , deleted] = await db.batch([
      db.delete(oauthTokens).where(and(eq(oauthTokens.memberId, id), targetStillManageable)),
      db.delete(oauthTokenFamilies).where(and(eq(oauthTokenFamilies.memberId, id), targetStillManageable)),
      db.delete(oauthAuthorizationCodes).where(and(eq(oauthAuthorizationCodes.memberId, id), targetStillManageable)),
      db.delete(uploadTokens).where(and(eq(uploadTokens.memberId, id), targetStillManageable)),
      db.delete(sessions).where(and(eq(sessions.memberId, id), targetStillManageable)),
      db.delete(members)
        .where(and(eq(members.id, id), targetStillManageable))
        .returning({ id: members.id }),
    ]);
    if (deleted.length === 0) throw new AccessError("该成员的权限已发生变化，请刷新后重试", 409);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isActiveAdminConstraint(error)) {
      return errorResponse(new AccessError("必须至少保留一名启用中的管理员", 409));
    }
    return errorResponse(error);
  }
}

async function requireAdmin() {
  const member = await requireActiveMember();
  if (member.role !== "admin") throw new AccessError("只有管理员可以管理成员", 403);
  return member;
}

function isActiveAdminConstraint(error: unknown) {
  return error instanceof Error && error.message.includes("paperbee_requires_active_admin");
}
