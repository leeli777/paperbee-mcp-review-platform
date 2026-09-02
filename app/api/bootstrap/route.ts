import { desc, eq, inArray, sql } from "drizzle-orm";
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
import { errorResponse, requireActiveMember } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const member = await requireActiveMember();
    const db = await getDb();

    const projectRows = await db
      .select({
        id: projects.id,
        publicCode: projects.publicCode,
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
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));

    const activeAssignmentRows = await db
      .select({
        id: assignments.id,
        projectId: assignments.projectId,
        reviewerMemberId: assignments.reviewerMemberId,
      })
      .from(assignments)
      .where(inArray(assignments.status, ["待接受", "待审核"]));

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
      .orderBy(desc(projectTags.createdAt));

    const versionRows = await db
      .select({
        projectId: projectVersions.projectId,
        artifactKind: projectVersions.artifactKind,
        fileName: projectVersions.fileName,
        versionNumber: projectVersions.versionNumber,
      })
      .from(projectVersions)
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
      .where(eq(assignments.reviewerMemberId, member.id))
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
      members: memberRows,
      assignments: myAssignments,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
