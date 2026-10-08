import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projects, projectVersions } from "@/db/schema";
import { isJournalOption } from "@/lib/journals";
import { isProjectField } from "@/lib/project-fields";
import { ownedProject, revisionFields } from "@/lib/work-versions";
import { createUniqueProjectCode } from "@/lib/project-codes";
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

export class ProjectUploadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function createProjectFromForm(form: FormData, memberId: string) {
  const uploadedKeys: string[] = [];
  try {
    const targetProjectId = String(form.get("targetProjectId") ?? "").trim();
    const target = targetProjectId ? await ownedProject(memberId, targetProjectId) : null;
    const revision = revisionFields({ versionLabel: form.get("versionLabel"), revisionSummary: form.get("revisionSummary") });
    const visibility = String(form.get("visibility") ?? "internal");
    if (!["internal", "private"].includes(visibility)) throw new ProjectUploadError("无效的项目可见性");
    const title = String(form.get("title") ?? "").trim();
    const summary = String(form.get("summary") ?? "").trim();
    const field = String(form.get("field") ?? "").trim();
    const reviewScope = "审核项目全部内容";
    const aiDisclosure = String(form.get("aiDisclosure") ?? "未使用生成式 AI").trim();
    const recommendedJournals = form
      .getAll("recommendedJournals")
      .map((value) => String(value).trim())
      .filter(isJournalOption);
    const aiSubmissionAdvice = String(form.get("aiSubmissionAdvice") ?? "").trim();
    const artifacts: { kind: ArtifactKind; file: File }[] = [];
    const description = optionalFile(form.get("descriptionFile"));
    const paper = optionalFile(form.get("paperFile"));
    const reproduction = optionalFile(form.get("reproductionFile"));
    const aiReview = optionalFile(form.get("aiReviewFile"));

    if (!title || !field) throw new ProjectUploadError("请填写项目标题和研究领域");
    if (title.length > 140) throw new ProjectUploadError("项目标题不能超过 140 个字符");
    if (!isProjectField(field)) throw new ProjectUploadError("请选择有效的项目分类");
    if (!description) throw new ProjectUploadError("请上传科研项目中文说明");
    if (summary.length > 900) throw new ProjectUploadError("项目摘要不能超过 900 个字符");
    if (aiSubmissionAdvice.length > 1800) {
      throw new ProjectUploadError("AI 投稿建议不能超过 1800 个字符");
    }

    artifacts.push({ kind: "description", file: description });
    if (aiReview) artifacts.push({ kind: "ai-review", file: aiReview });
    if (paper) artifacts.push({ kind: "paper", file: paper });
    if (reproduction) artifacts.push({ kind: "reproduction", file: reproduction });

    for (const artifact of artifacts) {
      const rule = ARTIFACT_RULES[artifact.kind];
      if (artifact.file.size > MAX_FILE_SIZE) {
        throw new ProjectUploadError(`${rule.label}不能超过 25 MB`, 413);
      }
      if (!acceptsFile(artifact.file, rule.extensions)) {
        throw new ProjectUploadError(`${rule.label}仅支持 ${rule.extensions.join("、")} 格式`);
      }
    }

    const incomingBytes = artifacts.reduce((total, artifact) => total + artifact.file.size, 0);
    const db = await getDb();
    const [storageUsage] = await db
      .select({ totalBytes: sql<number>`coalesce(sum(${projectVersions.sizeBytes}), 0)` })
      .from(projectVersions);
    const currentTotal = Number(storageUsage?.totalBytes ?? 0);
    if (currentTotal + incomingBytes > MAX_TOTAL_STORAGE) {
      throw new ProjectUploadError("站点文件总量已达到 800 MB 试用上限，请先归档或删除旧版本", 507);
    }

    const projectId = crypto.randomUUID();
    const publicCode = await createUniqueProjectCode(db);
    const store = getArtifactStore();
    const versionRows = [];
    for (const artifact of artifacts) {
      const storageKey = `projects/${projectId}/v1/${artifact.kind}/${crypto.randomUUID()}`;
      const fileName = safeFileName(artifact.file.name);
      await store.put(storageKey, await artifact.file.arrayBuffer(), {
        projectId,
        uploaderId: memberId,
        artifactKind: artifact.kind,
        originalName: fileName,
      });
      uploadedKeys.push(storageKey);
      versionRows.push({
        id: crypto.randomUUID(),
        projectId,
        versionNumber: 1,
        artifactKind: artifact.kind,
        fileName,
        storageKey,
        contentType: artifact.file.type || "application/octet-stream",
        sizeBytes: artifact.file.size,
        uploadedByMemberId: memberId,
      });
    }

    const [createdRows] = await db.batch([
      db.insert(projects).values({
        id: projectId,
        publicCode,
        ...revision,
        workId: target ? sql`(SELECT coalesce(work_id, id) FROM projects WHERE id = ${target.id} AND owner_member_id = ${memberId})` : projectId,
        workRevision: target ? sql`(SELECT (
          SELECT coalesce(max(p.work_revision), 0) + 1 FROM projects p
          WHERE coalesce(p.work_id, p.id) = coalesce(t.work_id, t.id)
        ) FROM projects t WHERE t.id = ${target.id} AND t.owner_member_id = ${memberId})` : 1,
        title,
        summary,
        field,
        ownerMemberId: memberId,
        visibility,
        status: "待分配",
        reviewScope,
        aiDisclosure,
        recommendedJournals: [...new Set(recommendedJournals)].join(","),
        aiSubmissionAdvice,
      }).returning({ workId: projects.workId, workRevision: projects.workRevision }),
      db.insert(projectVersions).values(versionRows),
    ]);
    const created = createdRows[0];
    return { projectId, projectCode: publicCode, workId: created.workId, workRevision: created.workRevision };
  } catch (error) {
    if (uploadedKeys.length) {
      const store = getArtifactStore();
      await Promise.allSettled(uploadedKeys.map((key) => store.delete(key)));
    }
    throw error;
  }
}

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
