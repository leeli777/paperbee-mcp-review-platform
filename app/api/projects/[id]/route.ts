import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  assignments,
  aiAccessLogs,
  downloadLogs,
  projectLikes,
  projects,
  projectTags,
  projectVersions,
  reviews,
  tagLikes,
} from "@/db/schema";
import { AccessError, errorResponse, requireActiveMember } from "@/lib/auth";
import { isProjectField } from "@/lib/project-fields";
import { isJournalOption } from "@/lib/journals";
import { getArtifactStore } from "@/lib/storage";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_STORAGE = 800 * 1024 * 1024;
type ArtifactKind = "description" | "paper" | "reproduction" | "ai-review";
const ARTIFACT_RULES: Record<ArtifactKind, { label: string; extensions: string[] }> = {
  description: { label: "科研项目中文说明", extensions: [".md", ".txt", ".pdf", ".docx"] },
  paper: { label: "论文", extensions: [".pdf"] },
  reproduction: { label: "完整复现包", extensions: [".zip", ".tar.gz", ".tgz"] },
  "ai-review": { label: "AI 预审摘要", extensions: [".md", ".txt", ".pdf", ".docx"] },
};

function optionalFile(value: FormDataEntryValue | null) {
  return value instanceof File && value.size > 0 ? value : null;
}

function acceptsFile(file: File, extensions: string[]) {
  const lowerName = file.name.toLowerCase();
  return extensions.some((extension) => lowerName.endsWith(extension));
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, "_");
}

import { resolveProjectAccess } from "@/lib/project-access";

async function requireManageableProject(projectId: string) {
  const member = await requireActiveMember();
  const db = await getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  await resolveProjectAccess(member, projectId);
  if (!project) throw new AccessError("项目不存在", 404);
  if (member.role !== "admin" && project.ownerMemberId !== member.id) {
    throw new AccessError("只有项目上传者或管理员可以管理此项目", 403);
  }

  return { db, member, project };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const uploadedKeys: string[] = [];
  try {
    const { id: projectId } = await params;
    const { db, member, project } = await requireManageableProject(projectId);
    const isMultipart = request.headers.get("content-type")?.includes("multipart/form-data");

    if (!isMultipart) {
      const payload = (await request.json()) as { field?: unknown; visibility?: unknown };
      if (payload.visibility !== undefined) {
        if (project.ownerMemberId !== member.id) throw new AccessError("只有作者可以修改项目可见性", 403);
        if (payload.visibility !== "internal" && payload.visibility !== "private") throw new AccessError("无效的项目可见性", 400);
        const updated = await db.update(projects).set({ visibility: payload.visibility, updatedAt: new Date().toISOString() })
          .where(sql`${projects.id} = ${projectId} AND (${payload.visibility} = 'internal' OR NOT EXISTS (
            SELECT 1 FROM assignments WHERE project_id = ${projectId} AND status IN ('待接受', '待审核')
          ))`).returning({ id: projects.id });
        if (!updated.length) throw new AccessError("请先结束进行中的审稿，再将项目设为私有", 409);
        return Response.json({ ok: true, visibility: payload.visibility });
      }
      const field = typeof payload.field === "string" ? payload.field.trim() : "";

      if (!isProjectField(field)) {
        return Response.json({ error: "请选择有效的项目分类" }, { status: 400 });
      }

      await db
        .update(projects)
        .set({ field, updatedAt: new Date().toISOString() })
        .where(eq(projects.id, projectId));

      return Response.json({ ok: true, field });
    }

    const form = await request.formData();
    const title = String(form.get("title") ?? "").trim();
    const summary = String(form.get("summary") ?? "").trim();
    const field = String(form.get("field") ?? "").trim();
    const aiDisclosure = String(form.get("aiDisclosure") ?? "未使用生成式 AI").trim();
    const recommendedJournals = form
      .getAll("recommendedJournals")
      .map((value) => String(value).trim())
      .filter(isJournalOption);
    const aiSubmissionAdvice = String(form.get("aiSubmissionAdvice") ?? "").trim();

    if (!title || title.length > 140) {
      return Response.json({ error: "请填写不超过 140 个字符的项目标题" }, { status: 400 });
    }
    if (summary.length > 900) {
      return Response.json({ error: "项目摘要不能超过 900 个字符" }, { status: 400 });
    }

    if (!isProjectField(field)) {
      return Response.json({ error: "请选择有效的项目分类" }, { status: 400 });
    }
    if (aiDisclosure.length > 120) {
      return Response.json({ error: "AI 使用情况不能超过 120 个字符" }, { status: 400 });
    }
    if (aiSubmissionAdvice.length > 1800) {
      return Response.json({ error: "AI 投稿建议不能超过 1800 个字符" }, { status: 400 });
    }

    const artifacts: { kind: ArtifactKind; file: File }[] = [];
    const candidates: [ArtifactKind, File | null][] = [
      ["description", optionalFile(form.get("descriptionFile"))],
      ["ai-review", optionalFile(form.get("aiReviewFile"))],
      ["paper", optionalFile(form.get("paperFile"))],
      ["reproduction", optionalFile(form.get("reproductionFile"))],
    ];
    for (const [kind, file] of candidates) {
      if (!file) continue;
      const rule = ARTIFACT_RULES[kind];
      if (file.size > MAX_FILE_SIZE) {
        return Response.json({ error: `${rule.label}不能超过 25 MB` }, { status: 413 });
      }
      if (!acceptsFile(file, rule.extensions)) {
        return Response.json({ error: `${rule.label}仅支持 ${rule.extensions.join("、")} 格式` }, { status: 400 });
      }
      artifacts.push({ kind, file });
    }

    const incomingBytes = artifacts.reduce((total, artifact) => total + artifact.file.size, 0);
    const [storageUsage] = await db
      .select({ totalBytes: sql<number>`coalesce(sum(${projectVersions.sizeBytes}), 0)` })
      .from(projectVersions);
    if (Number(storageUsage?.totalBytes ?? 0) + incomingBytes > MAX_TOTAL_STORAGE) {
      return Response.json({ error: "站点文件总量已达到 800 MB 试用上限，请先归档或删除旧版本" }, { status: 507 });
    }

    const [latest] = await db
      .select({ versionNumber: sql<number>`coalesce(max(${projectVersions.versionNumber}), 0)` })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, projectId));
    const nextVersion = Number(latest?.versionNumber ?? 0) + 1;
    const store = getArtifactStore();
    const versionRows = [];

    for (const artifact of artifacts) {
      const storageKey = `projects/${projectId}/v${nextVersion}/${artifact.kind}/${crypto.randomUUID()}`;
      const fileName = safeFileName(artifact.file.name);
      await store.put(storageKey, await artifact.file.arrayBuffer(), {
        projectId,
        uploaderId: member.id,
        artifactKind: artifact.kind,
        originalName: fileName,
      });
      uploadedKeys.push(storageKey);
      versionRows.push({
        id: crypto.randomUUID(),
        projectId,
        versionNumber: nextVersion,
        artifactKind: artifact.kind,
        fileName,
        storageKey,
        contentType: artifact.file.type || "application/octet-stream",
        sizeBytes: artifact.file.size,
        uploadedByMemberId: member.id,
      });
    }

    const updateProject = db.update(projects).set({
        title,
        summary,
        field,
        aiDisclosure,
        recommendedJournals: [...new Set(recommendedJournals)].join(","),
        aiSubmissionAdvice,
        ...(versionRows.length ? { status: "待修改" } : {}),
        updatedAt: new Date().toISOString(),
      }).where(eq(projects.id, projectId));
    if (versionRows.length) {
      await db.batch([updateProject, db.insert(projectVersions).values(versionRows)]);
    } else {
      await db.batch([updateProject]);
    }

    return Response.json({ ok: true, field, versionNumber: versionRows.length ? nextVersion : null });
  } catch (error) {
    if (uploadedKeys.length) {
      const store = getArtifactStore();
      await Promise.allSettled(uploadedKeys.map((key) => store.delete(key)));
    }
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const { db, project } = await requireManageableProject(projectId);
    const versions = await db
      .select({ storageKey: projectVersions.storageKey })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, projectId));

    await db.batch([
      db.update(aiAccessLogs).set({
        projectCodeSnapshot: project.visibility === "private" ? null : project.publicCode,
        projectTitleSnapshot: project.visibility === "private" ? null : project.title,
        fileNameSnapshot: project.visibility === "private" ? null : sql`coalesce(${aiAccessLogs.fileNameSnapshot}, (SELECT file_name FROM project_versions WHERE id = ${aiAccessLogs.versionId}))`,
        projectId: null,
        versionId: null,
      }).where(eq(aiAccessLogs.projectId, projectId)),
      db.delete(reviews).where(
        sql`${reviews.assignmentId} IN (
          SELECT ${assignments.id}
          FROM ${assignments}
          WHERE ${assignments.projectId} = ${projectId}
        )`,
      ),
      db.delete(tagLikes).where(
        sql`${tagLikes.tagId} IN (
          SELECT ${projectTags.id}
          FROM ${projectTags}
          WHERE ${projectTags.projectId} = ${projectId}
        )`,
      ),
      db.delete(downloadLogs).where(eq(downloadLogs.projectId, projectId)),
      db.delete(projectLikes).where(eq(projectLikes.projectId, projectId)),
      db.delete(projectTags).where(eq(projectTags.projectId, projectId)),
      db.delete(assignments).where(eq(assignments.projectId, projectId)),
      db.delete(projectVersions).where(eq(projectVersions.projectId, projectId)),
      db.delete(projects).where(eq(projects.id, projectId)),
    ]);

    const store = getArtifactStore();
    await Promise.allSettled(versions.map(({ storageKey }) => store.delete(storageKey)));

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
