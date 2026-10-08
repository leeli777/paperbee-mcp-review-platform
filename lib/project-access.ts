import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { assignments, projects, projectVersions } from "@/db/schema";
import { AccessError } from "@/lib/auth";
import { normalizeProjectCode } from "@/lib/oauth-protocol";
import { materialDecision } from "@/lib/project-access-policy";

export const MAX_PROJECT_RESULTS = 50;
export const MATERIAL_KINDS = ["description", "ai-review", "paper", "reproduction"] as const;
export type MaterialKind = typeof MATERIAL_KINDS[number];

export type AccessMember = { id: string; role: string; status: string };
export type ProjectArtifact = {
  id: string;
  projectId: string;
  versionNumber: number;
  artifactKind: string;
  fileName: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
};

export type ProjectAccess = {
  project: typeof projects.$inferSelect;
  activeReviewerMemberId: string | null;
  artifacts: Record<string, ProjectArtifact>;
  canReadRestrictedMaterials: boolean;
};

export function isMaterialKind(value: string): value is MaterialKind {
  return MATERIAL_KINDS.includes(value as MaterialKind);
}

export function visibleProjects(member: Pick<AccessMember, "id">) {
  return or(eq(projects.visibility, "internal"), and(eq(projects.visibility, "private"), eq(projects.ownerMemberId, member.id)));
}

export async function resolveProjectAccess(member: AccessMember, identifier: string): Promise<ProjectAccess> {
  const db = await getDb();
  const code = normalizeProjectCode(identifier);
  const [project] = await db.select().from(projects).where(and(
    visibleProjects(member),
    code ? or(eq(projects.publicCode, code), eq(projects.id, identifier)) : eq(projects.id, identifier),
  )).limit(1);
  if (!project) throw new AccessError("项目不存在或不可访问", 404);

  const [assignmentRows, versionRows] = await Promise.all([
    db.select({ reviewerMemberId: assignments.reviewerMemberId })
      .from(assignments)
      .where(and(eq(assignments.projectId, project.id), inArray(assignments.status, ["待接受", "待审核"])))
      .limit(1),
    db.select({
      id: projectVersions.id,
      projectId: projectVersions.projectId,
      versionNumber: projectVersions.versionNumber,
      artifactKind: projectVersions.artifactKind,
      fileName: projectVersions.fileName,
      storageKey: projectVersions.storageKey,
      contentType: projectVersions.contentType,
      sizeBytes: projectVersions.sizeBytes,
    }).from(projectVersions)
      .where(eq(projectVersions.projectId, project.id))
      .orderBy(desc(projectVersions.versionNumber), desc(projectVersions.createdAt)),
  ]);
  return composeProjectAccess(member, project, assignmentRows[0]?.reviewerMemberId ?? null, versionRows);
}

export async function listAccessibleProjects(member: AccessMember) {
  const db = await getDb();
  const projectRows = await db.select().from(projects)
    .where(visibleProjects(member))
    .orderBy(desc(projects.updatedAt))
    .limit(MAX_PROJECT_RESULTS + 1);
  const truncated = projectRows.length > MAX_PROJECT_RESULTS;
  const visibleRows = projectRows.slice(0, MAX_PROJECT_RESULTS);
  if (!visibleRows.length) return { projects: [] as ProjectAccess[], truncated };
  const ids = visibleRows.map((project) => project.id);
  const [assignmentRows, versionRows] = await Promise.all([
    db.select({ projectId: assignments.projectId, reviewerMemberId: assignments.reviewerMemberId })
      .from(assignments)
      .where(and(inArray(assignments.projectId, ids), inArray(assignments.status, ["待接受", "待审核"]))),
    db.select({
      id: projectVersions.id,
      projectId: projectVersions.projectId,
      versionNumber: projectVersions.versionNumber,
      artifactKind: projectVersions.artifactKind,
      fileName: projectVersions.fileName,
      storageKey: projectVersions.storageKey,
      contentType: projectVersions.contentType,
      sizeBytes: projectVersions.sizeBytes,
    }).from(projectVersions)
      .where(inArray(projectVersions.projectId, ids))
      .orderBy(desc(projectVersions.versionNumber), desc(projectVersions.createdAt)),
  ]);
  const reviewerByProject = new Map(assignmentRows.map((row) => [row.projectId, row.reviewerMemberId]));
  const versionsByProject = new Map<string, ProjectArtifact[]>();
  for (const version of versionRows) {
    const current = versionsByProject.get(version.projectId) ?? [];
    current.push(version);
    versionsByProject.set(version.projectId, current);
  }
  return {
    projects: visibleRows.map((project) => composeProjectAccess(
      member,
      project,
      reviewerByProject.get(project.id) ?? null,
      versionsByProject.get(project.id) ?? [],
    )),
    truncated,
  };
}

export async function requireMaterialAccess(member: AccessMember, identifier: string, kind: MaterialKind) {
  const access = await resolveProjectAccess(member, identifier);
  const artifact = access.artifacts[kind];
  if (!artifact) throw new AccessError("该项目未上传这类材料", 404);
  const decision = decideMaterial(member, access, kind);
  if (!decision.allowed) {
    throw new AccessError("项目已有审稿人，该材料仅对审稿人、上传者及管理员开放", 403);
  }
  return { ...access, artifact };
}

export function decideMaterial(member: AccessMember, access: ProjectAccess, kind: MaterialKind) {
  return materialDecision({
    active: member.status === "active",
    role: member.role,
    memberId: member.id,
    ownerMemberId: access.project.ownerMemberId,
    reviewerMemberId: access.activeReviewerMemberId,
    hasActiveAssignment: Boolean(access.activeReviewerMemberId),
    kind,
  });
}

function composeProjectAccess(
  member: AccessMember,
  project: typeof projects.$inferSelect,
  reviewerMemberId: string | null,
  versions: ProjectArtifact[],
): ProjectAccess {
  const artifacts: Record<string, ProjectArtifact> = {};
  for (const version of versions) if (!artifacts[version.artifactKind]) artifacts[version.artifactKind] = version;
  const provisional: ProjectAccess = {
    project,
    activeReviewerMemberId: reviewerMemberId,
    artifacts,
    canReadRestrictedMaterials: false,
  };
  provisional.canReadRestrictedMaterials = decideMaterial(member, provisional, "paper").allowed;
  return provisional;
}
