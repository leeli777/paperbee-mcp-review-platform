import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  assignments,
  members,
  projectLikes,
  projects,
  projectTags,
  projectVersions,
  reviews,
  tagLikes,
} from "@/db/schema";
import { AccessError, errorResponse, requireActiveMember } from "@/lib/auth";

import { workIdentity } from "@/lib/work-versions";
import { visibleProjects } from "@/lib/project-access";

import { parseProjectList, PROJECT_PAGE_SIZE } from "@/lib/project-list";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const member = await requireActiveMember();
    const db = await getDb();

    const query = parseProjectList(request.url);
    const visible = visibleProjects(member);
    const requestedId = new URL(request.url).searchParams.get("projectId");
    const scopeFilter = and(visible,
      query.scope === "mine" ? eq(projects.ownerMemberId, member.id) : undefined,
      query.scope === "shared" ? eq(projects.visibility, "internal") : undefined,
    );
    // Only visible revisions participate in grouping, filtering, counts and choosing a representative.
    const peerVisible = sql`(p.visibility = 'internal' OR (p.visibility = 'private' AND p.owner_member_id = ${member.id}))
      AND (${query.scope} != 'shared' OR p.visibility = 'internal')
      AND (${query.scope} != 'mine' OR p.owner_member_id = ${member.id})`;
    const filter = requestedId ? and(visible, eq(projects.id, requestedId)) : and(scopeFilter,
      sql`NOT EXISTS (SELECT 1 FROM projects p WHERE coalesce(p.work_id, p.id) = ${workIdentity}
        AND ${peerVisible} AND (p.work_revision > ${projects.workRevision}
          OR (p.work_revision = ${projects.workRevision} AND p.id > ${projects.id})))`,
      query.field || query.search ? sql`EXISTS (
        SELECT 1 FROM projects p JOIN members m ON m.id = p.owner_member_id
        WHERE coalesce(p.work_id, p.id) = ${workIdentity} AND ${peerVisible}
          AND (${query.field} = '' OR p.field = ${query.field})
          AND (${query.search} = '' OR instr(lower(p.title), lower(${query.search})) > 0
            OR instr(lower(p.summary), lower(${query.search})) > 0
            OR instr(lower(m.name), lower(${query.search})) > 0
            OR instr(lower(coalesce(p.public_code, '')), lower(${query.search})) > 0
            OR EXISTS (SELECT 1 FROM project_tags t WHERE t.project_id = p.id AND instr(lower(t.name), lower(${query.search})) > 0))
      )` : undefined,
    );
    const [[totals], [counts]] = await Promise.all([
      db.select({ total: sql<number>`count(*)` }).from(projects)
        .innerJoin(members, eq(projects.ownerMemberId, members.id)).where(filter),
      db.select({
        accessible: sql<number>`count(distinct ${workIdentity})`,
        shared: sql<number>`count(distinct CASE WHEN ${projects.visibility} = 'internal' THEN ${workIdentity} END)`,
        mine: sql<number>`count(distinct CASE WHEN ${projects.ownerMemberId} = ${member.id} THEN ${workIdentity} END)`,
        underReview: sql<number>`coalesce(sum(${projects.status} = '审核中'), 0)`,
        passed: sql<number>`coalesce(sum(${projects.status} = '已通过'), 0)`,
      }).from(projects).where(visible),
    ]);
    const total = Number(totals.total);
    if (requestedId && !total) throw new AccessError("项目不存在或不可访问", 404);
    const totalPages = Math.max(1, Math.ceil(total / PROJECT_PAGE_SIZE));
    const page = Math.min(query.page, totalPages);

    const projectRows = await db
      .select({
        id: projects.id,
        visibility: projects.visibility,
        publicCode: projects.publicCode,
        workId: workIdentity,
        workRevision: projects.workRevision,
        versionLabel: projects.versionLabel,
        revisionSummary: projects.revisionSummary,
        workVersionCount: sql<number>`(SELECT count(*) FROM projects p WHERE coalesce(p.work_id, p.id) = ${workIdentity}
          AND (p.visibility = 'internal' OR (p.visibility = 'private' AND p.owner_member_id = ${member.id})))`,
        title: projects.title,
        summary: projects.summary,
        field: projects.field,
        status: projects.status,
        reviewScope: projects.reviewScope,
        aiDisclosure: projects.aiDisclosure,
        recommendedJournals: projects.recommendedJournals,
        aiSubmissionAdvice: projects.aiSubmissionAdvice,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        ownerMemberId: projects.ownerMemberId,
        ownerName: members.name,
        versionNumber: sql<number | null>`max(${projectVersions.versionNumber})`,
        fileName: sql<string | null>`max(${projectVersions.fileName})`,
        artifactKinds: sql<string>`coalesce(group_concat(distinct ${projectVersions.artifactKind}), '')`,
        assignmentCount: sql<number>`(
          select count(*) from ${assignments}
          where ${assignments.projectId} = ${projects.id}
            and ${assignments.status} in ('待接受', '待审核')
        )`,
        likeCount: sql<number>`(
          select count(*) from ${projectLikes}
          where ${projectLikes.projectId} = ${projects.id}
        )`,
        likedByMe: sql<number>`case when exists (
          select 1 from ${projectLikes}
          where ${projectLikes.projectId} = ${projects.id}
            and ${projectLikes.memberId} = ${member.id}
        ) then 1 else 0 end`,
      })
      .from(projects)
      .innerJoin(members, eq(projects.ownerMemberId, members.id))
      .leftJoin(projectVersions, eq(projects.id, projectVersions.projectId))
      .where(filter)
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt), desc(projects.id))
      .limit(PROJECT_PAGE_SIZE)
      .offset((page - 1) * PROJECT_PAGE_SIZE);
    const projectIds = projectRows.map((project) => project.id);

    const activeAssignmentRows = await db
      .select({
        id: assignments.id,
        projectId: assignments.projectId,
        reviewerMemberId: assignments.reviewerMemberId,
      })
      .from(assignments)
      .where(and(inArray(assignments.projectId, projectIds), inArray(assignments.status, ["待接受", "待审核"])));

    const tagRows = await db
      .select({
        id: projectTags.id,
        projectId: projectTags.projectId,
        name: projectTags.name,
        likeCount: sql<number>`(
          select count(*) from ${tagLikes}
          where ${tagLikes.tagId} = ${projectTags.id}
        )`,
        likedByMe: sql<number>`case when exists (
          select 1 from ${tagLikes}
          where ${tagLikes.tagId} = ${projectTags.id}
            and ${tagLikes.memberId} = ${member.id}
        ) then 1 else 0 end`,
      })
      .from(projectTags)
      .where(inArray(projectTags.projectId, projectIds))
      .orderBy(desc(projectTags.createdAt));

    const versionRows = await db
      .select({
        projectId: projectVersions.projectId,
        artifactKind: projectVersions.artifactKind,
        fileName: projectVersions.fileName,
        versionNumber: projectVersions.versionNumber,
      })
      .from(projectVersions)
      .where(inArray(projectVersions.projectId, projectIds))
      .orderBy(desc(projectVersions.versionNumber), desc(projectVersions.createdAt));

    const artifactFilesByProject = new Map<string, Record<string, string>>();
    for (const version of versionRows) {
      const files = artifactFilesByProject.get(version.projectId) ?? {};
      if (!files[version.artifactKind]) files[version.artifactKind] = version.fileName;
      artifactFilesByProject.set(version.projectId, files);
    }

    const tagsByProject = new Map<string, typeof tagRows>();
    for (const tag of tagRows) {
      const current = tagsByProject.get(tag.projectId) ?? [];
      current.push(tag);
      tagsByProject.set(tag.projectId, current);
    }

    const memberRows = await db
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        role: members.role,
        researchField: members.researchField,
        status: members.status,
        lastSeenAt: members.lastSeenAt,
      })
      .from(members)
      .orderBy(desc(members.createdAt));

    const activeAssignmentByProject = new Map(
      activeAssignmentRows.map((assignment) => [assignment.projectId, assignment]),
    );
    const memberNameById = new Map(memberRows.map((row) => [row.id, row.name]));
    const projectsWithSocialData = projectRows.map((project) => {
      const activeAssignment = activeAssignmentByProject.get(project.id);
      const canAccessReviewMaterials =
        !activeAssignment ||
        member.role === "admin" ||
        project.ownerMemberId === member.id ||
        activeAssignment.reviewerMemberId === member.id;
      return {
        ...project,
        likedByMe: Boolean(project.likedByMe),
        artifactFiles: artifactFilesByProject.get(project.id) ?? {},
        tags: (tagsByProject.get(project.id) ?? []).map((tag) => ({
          ...tag,
          likedByMe: Boolean(tag.likedByMe),
        })),
        hasActiveAssignment: Boolean(activeAssignment),
        activeReviewerName: activeAssignment
          ? memberNameById.get(activeAssignment.reviewerMemberId) ?? "已指定成员"
          : "",
        myActiveAssignmentId:
          activeAssignment?.reviewerMemberId === member.id ? activeAssignment.id : null,
        canAccessReviewMaterials,
      };
    });

    const myAssignments = await db
      .select({
        id: assignments.id,
        status: assignments.status,
        scope: assignments.scope,
        dueDate: assignments.dueDate,
        projectId: projects.id,
        projectTitle: projects.title,
        projectField: projects.field,
        projectSummary: projects.summary,
        ownerName: members.name,
        reviewId: reviews.id,
      })
      .from(assignments)
      .innerJoin(projects, eq(assignments.projectId, projects.id))
      .innerJoin(members, eq(projects.ownerMemberId, members.id))
      .leftJoin(reviews, eq(assignments.id, reviews.assignmentId))
      .where(and(eq(assignments.reviewerMemberId, member.id), visibleProjects(member)))
      .orderBy(desc(assignments.createdAt));

    return Response.json({
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        researchField: member.researchField,
      },
      projects: projectsWithSocialData,
      pagination: { page, pageSize: PROJECT_PAGE_SIZE, total, totalPages },
      stats: counts,
      members: memberRows,
      assignments: myAssignments,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
