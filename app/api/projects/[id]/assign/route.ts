import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { assignments, members, projects } from "@/db/schema";
import { AccessError, errorResponse, requireActiveMember } from "@/lib/auth";
import { canAssignReviewer } from "@/lib/project-access-policy";

const ACTIVE_ASSIGNMENT_STATUSES = ["待接受", "待审核"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await requireActiveMember();
    const { id: projectId } = await params;
    const payload = (await request.json()) as {
      action?: string;
      reviewerMemberId?: string;
      scope?: string;
      dueDate?: string;
    };

    const db = await getDb();
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
    const isSelfClaim = payload.action === "claim";
    if (!isSelfClaim && member.role !== "admin" && project.ownerMemberId !== member.id) {
      throw new AccessError("只有项目作者或管理员可以分配审核", 403);
    }
    const reviewerMemberId = isSelfClaim ? member.id : payload.reviewerMemberId;
    const scope = isSelfClaim ? project.reviewScope : payload.scope?.trim();
    if (!reviewerMemberId || !scope) {
      return Response.json({ error: "请选择审核者并填写审核范围" }, { status: 400 });
    }
    if (!isSelfClaim && !canAssignReviewer({ reviewerMemberId, ownerMemberId: project.ownerMemberId })) {
      throw new AccessError("项目上传者不能被指定审核自己的项目", 403);
    }
    const [reviewer] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, reviewerMemberId), eq(members.status, "active")))
      .limit(1);
    if (!reviewer) return Response.json({ error: "所选审核者账号不可用" }, { status: 400 });
    const [activeAssignment] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.projectId, projectId),
          inArray(assignments.status, ACTIVE_ASSIGNMENT_STATUSES),
        ),
      )
      .limit(1);
    if (activeAssignment) {
      return Response.json({ error: "该项目已经有审稿人，不能重复接取或分配" }, { status: 409 });
    }

    await db.insert(assignments).values({
      id: crypto.randomUUID(),
      projectId,
      reviewerMemberId,
      assignedByMemberId: member.id,
      scope,
      dueDate: payload.dueDate || null,
      status: "待审核",
    });
    await db
      .update(projects)
      .set({ status: "审核中", updatedAt: new Date().toISOString() })
      .where(eq(projects.id, projectId));

    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "分配失败";
    if (message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: "该项目刚刚被其他成员接取，请刷新后查看" }, { status: 409 });
    }
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await requireActiveMember();
    const { id: projectId } = await params;
    const db = await getDb();
    const [assignment] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.projectId, projectId),
          eq(assignments.reviewerMemberId, member.id),
          inArray(assignments.status, ACTIVE_ASSIGNMENT_STATUSES),
        ),
      )
      .limit(1);
    if (!assignment) {
      return Response.json({ error: "没有可放弃的进行中审核任务" }, { status: 404 });
    }

    const now = new Date().toISOString();
    await db.batch([
      db
        .update(assignments)
        .set({ status: "已放弃", completedAt: now })
        .where(eq(assignments.id, assignment.id)),
      db
        .update(projects)
        .set({
          status: sql`CASE WHEN EXISTS (
            SELECT 1 FROM ${assignments}
            WHERE ${assignments.projectId} = ${projectId}
              AND ${assignments.status} IN ('待接受', '待审核')
          ) THEN '审核中' ELSE '待分配' END`,
          updatedAt: now,
        })
        .where(eq(projects.id, projectId)),
    ]);

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
