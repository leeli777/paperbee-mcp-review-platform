import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { AccessError, errorResponse, requireActiveMember } from "@/lib/auth";
import { resolveProjectAccess } from "@/lib/project-access";
import { listWorkVersions, ownedProject, revisionFields } from "@/lib/work-versions";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const member = await requireActiveMember();
    const { project } = await resolveProjectAccess(member, (await params).id);
    return Response.json({ versions: await listWorkVersions(member.id, project) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

// Move this record only. Materials, assignments, reports and visibility remain attached to its ID.
export async function POST(request: Request, { params }: Context) {
  try {
    const member = await requireActiveMember();
    const source = await ownedProject(member.id, (await params).id);
    const payload = await request.json() as Record<string, unknown>;
    const fields = revisionFields(payload);
    if (payload.position !== undefined && !["earlier", "later"].includes(String(payload.position))) throw new AccessError("无效的版本位置", 400);
    if (typeof payload.targetProjectId !== "string" || !payload.targetProjectId.trim()) throw new AccessError("请填写同一工作的已有项目编号", 400);
    const target = await ownedProject(member.id, payload.targetProjectId.trim());
    const workId = target.workId ?? target.id;
    const db = await getDb();
    // Target identity is resolved inside the write, so regrouping it concurrently cannot attach to a stale group.
    const targetGroup = sql`(SELECT coalesce(work_id, id) FROM projects WHERE id = ${target.id} AND owner_member_id = ${member.id})`;
    const [updated] = await db.update(projects).set({
      ...fields,
      workId: targetGroup,
      workRevision: sql`CASE WHEN coalesce(${projects.workId}, ${projects.id}) = ${targetGroup}
        THEN ${projects.workRevision} ELSE (
          SELECT CASE WHEN ${payload.position === "earlier"} THEN coalesce(min(p.work_revision), 1) - 1 ELSE coalesce(max(p.work_revision), 0) + 1 END FROM projects p
          WHERE coalesce(p.work_id, p.id) = ${targetGroup}
        ) END`,
      updatedAt: new Date().toISOString(),
    }).where(sql`${projects.id} = ${source.id} AND ${projects.ownerMemberId} = ${member.id} AND ${targetGroup} IS NOT NULL`)
      .returning({ workId: projects.workId, workRevision: projects.workRevision });
    if (!updated) throw new AccessError("目标版本已变更，请刷新重试", 409);
    return Response.json({ ok: true, workId: updated.workId ?? workId, workRevision: updated.workRevision });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const member = await requireActiveMember();
    const source = await ownedProject(member.id, (await params).id);
    const db = await getDb();
    // Stabilize legacy null identities before detaching their anchor record.
    const workId = source.workId ?? source.id;
    const detachedId = crypto.randomUUID();
    await db.batch([
      db.update(projects).set({ workId }).where(sql`${projects.id} = ${workId} AND ${projects.workId} IS NULL`),
      db.update(projects).set({ workId: detachedId, workRevision: 1, updatedAt: new Date().toISOString() }).where(eq(projects.id, source.id)),
    ]);
    return Response.json({ ok: true, workId: detachedId });
  } catch (error) { return errorResponse(error); }
}
