import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aiAccessLogs, downloadLogs, members, projects, projectVersions } from "@/db/schema";
import { AccessError, errorResponse, requireActiveMember } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_LOGS = 200;

export async function GET() {
  try {
    const member = await requireActiveMember();
    if (member.role !== "admin") {
      throw new AccessError("只有管理员可以查看下载记录", 403);
    }

    const db = await getDb();
    const [downloadRows, aiRows] = await Promise.all([db
      .select({
        id: downloadLogs.id,
        downloadedAt: downloadLogs.downloadedAt,
        projectId: projects.id,
        projectCode: projects.publicCode,
        projectTitle: projects.title,
        versionNumber: projectVersions.versionNumber,
        artifactKind: projectVersions.artifactKind,
        fileName: projectVersions.fileName,
        memberId: members.id,
        memberName: members.name,
        memberEmail: members.email,
      })
      .from(downloadLogs)
      .innerJoin(projects, eq(downloadLogs.projectId, projects.id))
      .innerJoin(projectVersions, eq(downloadLogs.versionId, projectVersions.id))
      .innerJoin(members, eq(downloadLogs.memberId, members.id))
      .orderBy(desc(downloadLogs.downloadedAt))
      .limit(MAX_LOGS),
    db.select({
      id: aiAccessLogs.id,
      occurredAt: aiAccessLogs.createdAt,
      projectId: aiAccessLogs.projectId,
      projectCode: sql<string | null>`coalesce(${projects.publicCode}, ${aiAccessLogs.projectCodeSnapshot})`,
      projectTitle: sql<string | null>`coalesce(${projects.title}, ${aiAccessLogs.projectTitleSnapshot})`,
      versionNumber: projectVersions.versionNumber,
      artifactKind: aiAccessLogs.materialKind,
      fileName: sql<string | null>`coalesce(${projectVersions.fileName}, ${aiAccessLogs.fileNameSnapshot})`,
      memberId: members.id,
      memberName: members.name,
      memberEmail: members.email,
      action: aiAccessLogs.action,
      outcome: aiAccessLogs.outcome,
      denialReason: aiAccessLogs.denialReason,
    }).from(aiAccessLogs)
      .innerJoin(members, eq(aiAccessLogs.memberId, members.id))
      .leftJoin(projects, eq(aiAccessLogs.projectId, projects.id))
      .leftJoin(projectVersions, eq(aiAccessLogs.versionId, projectVersions.id))
      .orderBy(desc(aiAccessLogs.createdAt))
      .limit(MAX_LOGS)]);

    const logs = [
      ...downloadRows.map((row) => ({
        ...row,
        occurredAt: row.downloadedAt,
        source: "web" as const,
        action: "download",
        outcome: "success",
        denialReason: null,
      })),
      ...aiRows.map((row) => ({ ...row, source: "chatgpt_mcp" as const })),
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, MAX_LOGS);

    return Response.json(
      { logs, limit: MAX_LOGS },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
