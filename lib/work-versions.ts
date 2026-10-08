import { and, desc, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { AccessError } from "@/lib/auth";
import { normalizeProjectCode } from "@/lib/oauth-protocol";
import { visibleProjects } from "@/lib/project-access";

export const workIdentity = sql<string>`coalesce(${projects.workId}, ${projects.id})`;

export function revisionFields(input: { versionLabel?: unknown; revisionSummary?: unknown }) {
  const versionLabel = typeof input.versionLabel === "string" ? input.versionLabel.trim() : "";
  const revisionSummary = typeof input.revisionSummary === "string" ? input.revisionSummary.trim() : "";
  if (versionLabel.length > 60 || revisionSummary.length > 1800) throw new AccessError("版本名称最多 60 字，修改说明最多 1800 字", 400);
  return { versionLabel, revisionSummary };
}

export async function ownedProject(memberId: string, identifier: string) {
  const db = await getDb();
  const [project] = await db.select().from(projects).where(and(
    eq(projects.ownerMemberId, memberId),
    or(eq(projects.id, identifier), eq(projects.publicCode, normalizeProjectCode(identifier) ?? identifier)),
  )).limit(1);
  if (!project) throw new AccessError("只能关联自己上传的已有工作；请检查项目编号", 403);
  return project;
}

export async function listWorkVersions(memberId: string, project: typeof projects.$inferSelect) {
  return (await getDb()).select({
    id: projects.id, publicCode: projects.publicCode, title: projects.title,
    workId: workIdentity, workRevision: projects.workRevision,
    versionLabel: projects.versionLabel, revisionSummary: projects.revisionSummary,
    visibility: projects.visibility, status: projects.status, createdAt: projects.createdAt,
  }).from(projects).where(and(
    eq(workIdentity, project.workId ?? project.id), visibleProjects({ id: memberId }),
  )).orderBy(desc(projects.workRevision), desc(projects.createdAt), desc(projects.id));
}
