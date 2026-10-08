import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aiAccessLogs, projects, projectTags, projectVersions } from "@/db/schema";
import { AccessError } from "@/lib/auth";
import { OAUTH_SCOPE, requireOAuthMember } from "@/lib/oauth-auth";
import {
  decideMaterial,
  isMaterialKind,
  listAccessibleProjects,
  resolveProjectAccess,
  type MaterialKind,
  type ProjectAccess,
} from "@/lib/project-access";
import { listWorkVersions, workIdentity } from "@/lib/work-versions";
import { getArtifactStore } from "@/lib/storage";
import { canReadMcpResource } from "@/lib/mcp-resource-policy.js";

const MAX_INLINE_TEXT_BYTES = 1024 * 1024;
const OAUTH_SECURITY = [{ type: "oauth2", scopes: [OAUTH_SCOPE] }] as const;

export const PROJECT_READ_TOOLS = [
  {
    name: "find_my_research_works",
    title: "查找我已有的科研工作",
    description: "上传前判断新工作或后续版本。只检索当前登录账号自己的工作，按工作归组，搜索覆盖历史版本的标题、摘要、编号。空 query 可分页列出全部；有 nextPage 时继续读取，不能把一页未找到当作不存在。匹配后用 get_project 和 read_project_material 核对科学内容。",
    inputSchema: {
      type: "object", properties: {
        query: { type: "string", maxLength: 200 },
        page: { type: "integer", minimum: 1, maximum: 1000000 },
      }, additionalProperties: false,
    },
    securitySchemes: OAUTH_SECURITY,
    _meta: { securitySchemes: OAUTH_SECURITY },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_accessible_projects",
    title: "列出可访问的 PaperBee 项目",
    description: "列出当前登录成员可查看的内部项目，以及每类材料当前是否可读。最多返回最近更新的 50 个项目。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    securitySchemes: OAUTH_SECURITY,
    _meta: { securitySchemes: OAUTH_SECURITY },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_project",
    title: "读取 PaperBee 项目详情",
    description: "使用 PB 短编号或项目 UUID 读取项目元数据、标签、版本和材料可访问性。编号只用于定位，权限由当前登录成员决定。",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "例如 PB-8F3K2Q，或项目 UUID。" } },
      required: ["projectId"],
      additionalProperties: false,
    },
    securitySchemes: OAUTH_SECURITY,
    _meta: { securitySchemes: OAUTH_SECURITY },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "read_project_material",
    title: "读取 PaperBee 项目材料",
    description: "读取当前成员有权访问的一份材料。Markdown/TXT 可直接返回；PDF、DOCX 和复现包通过受保护资源返回。复现包不会被自动解压或执行。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "PB 短编号或项目 UUID。" },
        material: { type: "string", enum: ["description", "ai-review", "paper", "reproduction"] },
      },
      required: ["projectId", "material"],
      additionalProperties: false,
    },
    securitySchemes: OAUTH_SECURITY,
    _meta: { securitySchemes: OAUTH_SECURITY },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

export async function callProjectReadTool(request: Request, name: string, args: Record<string, unknown>) {
  const member = await requireOAuthMember(request);
  if (name === "find_my_research_works") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const page = args.page ?? 1;
    if (query.length > 200 || typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new AccessError("无效的搜索或页码", 400);
    const rows = await (await getDb()).select({
      projectId: projects.id, projectCode: projects.publicCode, workId: workIdentity,
      workRevision: projects.workRevision, versionLabel: projects.versionLabel,
      title: projects.title, summary: projects.summary, field: projects.field,
      revisionSummary: projects.revisionSummary,
    }).from(projects).where(and(eq(projects.ownerMemberId, member.id),
      sql`NOT EXISTS (SELECT 1 FROM projects newer WHERE coalesce(newer.work_id, newer.id) = ${workIdentity}
        AND newer.owner_member_id = ${member.id} AND newer.work_revision > ${projects.workRevision})`,
      sql`EXISTS (SELECT 1 FROM projects p WHERE coalesce(p.work_id, p.id) = ${workIdentity} AND p.owner_member_id = ${member.id}
        AND (${query} = '' OR instr(lower(p.title), lower(${query})) > 0
          OR instr(lower(p.summary), lower(${query})) > 0 OR instr(lower(coalesce(p.public_code, '')), lower(${query})) > 0))`,
    )).orderBy(desc(projects.updatedAt), desc(projects.id)).limit(51).offset((page - 1) * 50);
    await recordAccess(member.id, { action: "find_my_research_works", outcome: "success" });
    return {
      content: [{ type: "text", text: `本页找到 ${Math.min(rows.length, 50)} 项自己的工作；请核对研究问题、核心方法及材料中的版本沿革，不能仅凭标题相似归组。` }],
      structuredContent: { projects: rows.slice(0, 50), page, nextPage: rows.length > 50 ? page + 1 : null },
    };
  }
  if (name === "list_accessible_projects") {
    const result = await listAccessibleProjects(member);
    await recordAccess(member.id, { action: "list_projects", outcome: "success" });
    const projects = result.projects.map((access) => projectSummary(member, access));
    return {
      content: [{ type: "text", text: projects.length ? `找到 ${projects.length} 个可访问项目。` : "当前没有可访问项目。" }],
      structuredContent: { projects, truncated: result.truncated },
    };
  }

  const identifier = requiredString(args.projectId, "缺少项目编号");
  let access;
  try {
    access = await resolveProjectAccess(member, identifier);
  } catch (error) {
    await recordAccess(member.id, {
      action: name === "get_project" ? "get_project" : "read_material",
      materialKind: typeof args.material === "string" ? args.material : undefined,
      outcome: "denied",
      denialReason: "project_unavailable",
    });
    throw error;
  }
  if (name === "get_project") {
    const tags = await (await getDb()).select({ name: projectTags.name }).from(projectTags)
      .where(eq(projectTags.projectId, access.project.id));
    const project = { ...projectSummary(member, access), summary: access.project.summary, reviewScope: access.project.reviewScope,
      aiDisclosure: access.project.aiDisclosure, recommendedJournals: splitCsv(access.project.recommendedJournals),
      aiSubmissionAdvice: access.project.aiSubmissionAdvice, tags: tags.map((tag) => tag.name),
      workVersions: await listWorkVersions(member.id, access.project) };
    await recordAccess(member.id, { projectId: access.project.id, action: "get_project", outcome: "success" });
    return { content: [{ type: "text", text: `项目 ${access.project.publicCode ?? access.project.id}：${access.project.title}` }], structuredContent: { project } };
  }

  if (name !== "read_project_material") throw new AccessError("未知读取工具", 404);
  const kindText = requiredString(args.material, "缺少材料类型");
  if (!isMaterialKind(kindText)) {
    await recordAccess(member.id, { projectId: access.project.id, action: "read_material", materialKind: kindText, outcome: "denied", denialReason: "invalid_material" });
    throw new AccessError("材料类型无效", 400);
  }
  return readMaterial(member, access, kindText);
}

export async function readProjectResource(request: Request, uri: string) {
  const member = await requireOAuthMember(request);
  const match = /^paperbee:\/\/projects\/([^/]+)\/materials\/(description|ai-review|paper|reproduction)$/.exec(uri);
  if (!match) {
    await recordAccess(member.id, { action: "read_resource", outcome: "denied", denialReason: "invalid_resource" });
    throw new AccessError("资源地址无效", 404);
  }
  const identifier = decodeURIComponent(match[1]);
  const kind = match[2] as MaterialKind;
  let access;
  try {
    access = await resolveProjectAccess(member, identifier);
  } catch (error) {
    await recordAccess(member.id, { action: "read_resource", materialKind: kind, outcome: "denied", denialReason: "project_unavailable" });
    throw error;
  }
  const artifact = await authorizeArtifact(member, access, kind, "read_resource");
  await ensureMcpResourceSize(member.id, access, artifact, kind, "read_resource");
  const object = await getArtifactStore().get(artifact.storageKey);
  if (!object) {
    await recordAccess(member.id, { projectId: access.project.id, versionId: artifact.id, action: "read_resource", materialKind: kind, outcome: "denied", denialReason: "storage_missing" });
    throw new AccessError("项目文件存储记录已丢失", 404);
  }
  const bytes = new Uint8Array(object.body);
  await recordAccess(member.id, {
    projectId: access.project.id, versionId: artifact.id, action: "read_resource",
    materialKind: kind, outcome: "success",
  });
  return { contents: [{ uri, name: artifact.fileName, mimeType: artifact.contentType, blob: toBase64(bytes) }] };
}

async function readMaterial(member: Awaited<ReturnType<typeof requireOAuthMember>>, access: ProjectAccess, kind: MaterialKind) {
  const artifact = await authorizeArtifact(member, access, kind, "read_material");
  const resourceUri = `paperbee://projects/${encodeURIComponent(access.project.publicCode ?? access.project.id)}/materials/${kind}`;
  const isText = /\.(md|txt)$/i.test(artifact.fileName);
  if (isText && artifact.sizeBytes <= MAX_INLINE_TEXT_BYTES) {
    const object = await getArtifactStore().get(artifact.storageKey);
    if (!object) {
      await recordAccess(member.id, { projectId: access.project.id, versionId: artifact.id, action: "read_material", materialKind: kind, outcome: "denied", denialReason: "storage_missing" });
      throw new AccessError("项目文件存储记录已丢失", 404);
    }
    const text = new TextDecoder().decode(object.body);
    await recordAccess(member.id, { projectId: access.project.id, versionId: artifact.id, action: "read_material", materialKind: kind, outcome: "success" });
    return {
      content: [{ type: "text", text }],
      structuredContent: { projectId: access.project.publicCode ?? access.project.id, material: kind, fileName: artifact.fileName, delivery: "inline_text" },
    };
  }
  await ensureMcpResourceSize(member.id, access, artifact, kind, "read_material");
  await recordAccess(member.id, { projectId: access.project.id, versionId: artifact.id, action: "read_material", materialKind: kind, outcome: "success" });
  return {
    content: [{ type: "resource_link", uri: resourceUri, name: artifact.fileName, mimeType: artifact.contentType, description: "PaperBee 受保护项目材料；读取时会再次验证当前成员权限。" }],
    structuredContent: { projectId: access.project.publicCode ?? access.project.id, material: kind, fileName: artifact.fileName, delivery: "protected_resource", resourceUri },
  };
}

async function ensureMcpResourceSize(
  memberId: string,
  access: ProjectAccess,
  artifact: ProjectAccess["artifacts"][MaterialKind],
  kind: MaterialKind,
  action: string,
) {
  if (canReadMcpResource(artifact.sizeBytes)) return;
  await recordAccess(memberId, {
    projectId: access.project.id,
    versionId: artifact.id,
    action,
    materialKind: kind,
    outcome: "denied",
    denialReason: "mcp_resource_too_large",
  });
  throw new AccessError("该材料超过 8 MB 的 MCP 安全读取上限，请在 PaperBee 网页中下载", 413);
}

async function authorizeArtifact(
  member: Awaited<ReturnType<typeof requireOAuthMember>>,
  access: ProjectAccess,
  kind: MaterialKind,
  action: string,
) {
  const artifact = access.artifacts[kind];
  const decision = decideMaterial(member, access, kind);
  if (!artifact || !decision.allowed) {
    await recordAccess(member.id, {
      projectId: access.project.id,
      versionId: artifact?.id,
      action,
      materialKind: kind,
      outcome: "denied",
      denialReason: artifact ? decision.reason ?? "forbidden" : "material_missing",
    });
    throw new AccessError(artifact ? "无权访问该项目材料" : "该项目未上传这类材料", artifact ? 403 : 404);
  }
  return artifact;
}

function projectSummary(member: Awaited<ReturnType<typeof requireOAuthMember>>, access: ProjectAccess) {
  const latestVersion = Math.max(0, ...Object.values(access.artifacts).map((artifact) => artifact.versionNumber));
  return {
    projectId: access.project.publicCode ?? access.project.id,
    workId: access.project.workId ?? access.project.id,
    workRevision: access.project.workRevision,
    versionLabel: access.project.versionLabel,
    revisionSummary: access.project.revisionSummary,
    ownedByMe: access.project.ownerMemberId === member.id,
    title: access.project.title,
    field: access.project.field,
    status: access.project.status,
    version: latestVersion,
    updatedAt: access.project.updatedAt,
    materials: Object.fromEntries(Object.entries(access.artifacts).map(([kind, artifact]) => [kind, {
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      readable: isMaterialKind(kind) ? decideMaterial(member, access, kind).allowed : false,
    }])),
  };
}

async function recordAccess(memberId: string, values: {
  projectId?: string;
  versionId?: string;
  action: string;
  materialKind?: string;
  outcome: "success" | "denied";
  denialReason?: string;
}) {
  const db = await getDb();
  const [[project], [version]] = await Promise.all([
    values.projectId
      ? db.select({ code: projects.publicCode, title: projects.title }).from(projects).where(eq(projects.id, values.projectId)).limit(1)
      : Promise.resolve([]),
    values.versionId
      ? db.select({ fileName: projectVersions.fileName }).from(projectVersions).where(eq(projectVersions.id, values.versionId)).limit(1)
      : Promise.resolve([]),
  ]);
  await db.insert(aiAccessLogs).values({
    id: crypto.randomUUID(),
    memberId,
    projectId: values.projectId,
    versionId: values.versionId,
    channel: "chatgpt_mcp",
    action: values.action,
    materialKind: values.materialKind,
    outcome: values.outcome,
    denialReason: values.denialReason,
    projectCodeSnapshot: project?.code,
    projectTitleSnapshot: project?.title,
    fileNameSnapshot: version?.fileName,
  });
}

function requiredString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new AccessError(message, 400);
  return value.trim();
}

function splitCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toBase64(bytes: Uint8Array) {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  const chunks: string[] = [];
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}
