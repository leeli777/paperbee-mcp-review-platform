import { AccessError } from "@/lib/auth";
import { PROJECT_FIELDS } from "@/lib/project-fields";
import { callProjectReadTool, PROJECT_READ_TOOLS, readProjectResource } from "@/lib/mcp-project-reading";
import { oauthChallenge, oauthChallengeHeaders, OAuthBearerError } from "@/lib/oauth-auth";
import { createProjectFromForm, ProjectUploadError } from "@/lib/project-upload";
import {
  consumeUploadToken,
  requireUploadToken,
  UPLOAD_TOKEN_LIFETIME_MINUTES,
  UploadTokenError,
} from "@/lib/upload-token-auth";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_VERSION = "2.1.0";
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const NOAUTH_SECURITY = [{ type: "noauth" }] as const;

const FILE_SCHEMA = {
  type: "object",
  properties: {
    download_url: { type: "string" },
    file_id: { type: "string" },
    mime_type: { type: "string" },
    file_name: { type: "string" },
  },
  required: ["download_url", "file_id"],
  additionalProperties: false,
} as const;

const UPLOAD_TOOL = {
  name: "upload_research_project",
  title: "上传科研项目到 PaperBee",
  description:
    "把当前对话或 ChatGPT 文件库中真实存在的科研项目材料直接上传到 PaperBee。请把全部现有文件作为 materials 文件数组提交，PaperBee 会按文件名识别中文说明、AI 预审、论文和复现包。先用 find_my_research_works 判断是否已有同一工作，后续版本填写 targetProjectId，新工作省略；不确定归属时询问用户。中文说明必传，其他材料可选；不要传文件名字符串，也不要为了补齐可选项创建空文件。",
  inputSchema: {
    type: "object",
    $defs: { OpenAIFile: FILE_SCHEMA },
    properties: {
      uploadToken: {
        type: "string",
        description: "PaperBee 生成的六十分钟单次临时上传授权，以 pb_upload_ 开头。",
      },
      targetProjectId: { type: "string", description: "同一科研工作的任一已有版本的 PB 编号或 UUID。仅能追加到上传授权所属账号自己的工作；新工作省略。追加会创建独立版本，不覆盖旧材料。" },
      versionLabel: { type: "string", maxLength: 60, description: "实际稿件版本，例如 v0.3；不确定则留空。" },
      revisionSummary: { type: "string", maxLength: 1800, description: "相较前一稿的主要修改；新工作可留空。" },
      title: { type: "string", maxLength: 140 },
      field: {
        type: "string",
        enum: PROJECT_FIELDS,
      },
      summary: { type: "string", maxLength: 900 },
      aiDisclosure: { type: "string" },
      visibility: { type: "string", enum: ["internal", "private"], description: "internal 为成员可见，private 为仅上传者可见；省略时保持成员可见。" },
      recommendedJournals: {
        type: "array",
        items: { type: "string" },
      },
      aiSubmissionAdvice: { type: "string", maxLength: 1800 },
      materials: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        description:
          "当前对话或文件库中真实存在的项目文件对象数组。至少包含科研项目中文说明；可同时包含 AI 预审摘要、论文 PDF 和完整复现包。",
        items: { $ref: "#/$defs/OpenAIFile" },
      },
    },
    required: ["uploadToken", "title", "field", "materials"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["uploaded", "failed"] },
      projectId: { type: "string" },
      projectCode: { type: "string" },
      workId: { type: "string" },
      workRevision: { type: "number" },
      ownerName: { type: "string" },
      errorCode: { type: "string" },
      error: { type: "string" },
    },
    required: ["status"],
    additionalProperties: false,
  },
  securitySchemes: NOAUTH_SECURITY,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  _meta: {
    securitySchemes: NOAUTH_SECURITY,
    "openai/fileParams": ["materials"],
    "openai/toolInvocation/invoking": "正在上传科研材料…",
    "openai/toolInvocation/invoked": "科研材料已提交",
  },
} as const;

const CONNECTION_CHECK_TOOL = {
  name: "check_paperbee_connection",
  title: "检查 PaperBee 连接",
  description:
    "无需授权，检查 PaperBee MCP 和直接文件上传工具是否在线。上传前或遇到 Resource not found 时先调用此工具。",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["ok"] },
      serverVersion: { type: "string" },
      uploadMode: { type: "string", enum: ["direct_file_params"] },
      uploadTokenLifetimeMinutes: { type: "number" },
    },
    required: ["status", "serverVersion", "uploadMode", "uploadTokenLifetimeMinutes"],
    additionalProperties: false,
  },
  securitySchemes: NOAUTH_SECURITY,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  _meta: { securitySchemes: NOAUTH_SECURITY },
} as const;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type OpenAIFile = {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
};

const RESPONSE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
}

export async function GET() {
  return Response.json(
    {
      name: "PaperBee MCP",
      description: "在 ChatGPT 中连接此地址，然后使用 upload_research_project 直接上传生成的项目材料。",
      endpoint: "https://paperbee.asia/mcp",
    },
    { headers: RESPONSE_HEADERS },
  );
}

export async function POST(request: Request) {
  let message: JsonRpcRequest;
  try {
    message = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }

  if (message.jsonrpc !== "2.0" || !message.method) {
    return rpcError(message.id ?? null, -32600, "Invalid Request", 400);
  }

  if (message.method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: RESPONSE_HEADERS });
  }

  if (message.method === "initialize") {
    return rpcResult(message.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
      serverInfo: { name: "paperbee", title: "PaperBee", version: SERVER_VERSION },
      instructions:
        "上传仍使用一次性上传授权。读取项目请先连接 PaperBee 账号，再使用 list_accessible_projects、get_project 或 read_project_material；每次读取都会按当前成员重新检查权限。",
    });
  }

  if (message.method === "ping") return rpcResult(message.id, {});
  if (message.method === "tools/list") {
    return rpcResult(message.id, { tools: [CONNECTION_CHECK_TOOL, UPLOAD_TOOL, ...PROJECT_READ_TOOLS] });
  }
  if (message.method === "resources/list") {
    return rpcResult(message.id, { resources: [] });
  }
  if (message.method === "resources/read") {
    try {
      const uri = String(message.params?.uri ?? "");
      return rpcResult(message.id, await readProjectResource(request, uri));
    } catch (error) {
      return projectReadError(message.id, error);
    }
  }

  if (message.method === "tools/call") {
    const name = String(message.params?.name ?? "");
    const args = asRecord(message.params?.arguments);
    if (name === CONNECTION_CHECK_TOOL.name) {
      return rpcResult(message.id, {
        content: [
          {
            type: "text",
            text: `PaperBee 连接正常（服务 ${SERVER_VERSION}，直接文件上传可用）。`,
          },
        ],
        structuredContent: {
          status: "ok",
          serverVersion: SERVER_VERSION,
          uploadMode: "direct_file_params",
          uploadTokenLifetimeMinutes: UPLOAD_TOKEN_LIFETIME_MINUTES,
        },
      });
    }
    if (PROJECT_READ_TOOLS.some((tool) => tool.name === name)) {
      try {
        return rpcResult(message.id, await callProjectReadTool(request, name, args));
      } catch (error) {
        return projectReadError(message.id, error);
      }
    }
    if (name !== UPLOAD_TOOL.name) return rpcError(message.id, -32602, "Unknown tool", 404);
    const result = await uploadProject(args);
    return rpcResult(message.id, result);
  }

  return rpcError(message.id, -32601, "Method not found", 404);
}

async function uploadProject(args: Record<string, unknown>) {
  try {
    const uploadToken = requiredString(args.uploadToken, "缺少临时上传授权");
    const member = await requireUploadToken(
      new Request("https://paperbee.asia/mcp", {
        headers: { Authorization: `Bearer ${uploadToken}` },
      }),
    );
    const form = new FormData();
    form.set("title", requiredString(args.title, "缺少项目标题"));
    form.set("field", requiredString(args.field, "缺少项目分类"));
    setOptionalString(form, "targetProjectId", args.targetProjectId);
    setOptionalString(form, "versionLabel", args.versionLabel);
    setOptionalString(form, "revisionSummary", args.revisionSummary);
    setOptionalString(form, "summary", args.summary);
    setOptionalString(form, "aiDisclosure", args.aiDisclosure);
    setOptionalString(form, "visibility", args.visibility);
    setOptionalString(form, "aiSubmissionAdvice", args.aiSubmissionAdvice);
    if (Array.isArray(args.recommendedJournals)) {
      for (const journal of args.recommendedJournals) {
        if (typeof journal === "string") form.append("recommendedJournals", journal);
      }
    }

    const classifiedFiles = classifyMaterials(args.materials);
    for (const [field, source] of classifiedFiles) {
      form.set(field, await downloadOpenAIFile(source));
    }

    const result = await createProjectFromForm(form, member.memberId);
    await consumeUploadToken(member.tokenId);
    return {
      content: [
        {
          type: "text",
          text: `项目已成功上传到 PaperBee。项目编号：${result.projectCode}；projectId：${result.projectId}`,
        },
      ],
      structuredContent: {
        projectId: result.projectId,
        projectCode: result.projectCode,
        workId: result.workId,
        workRevision: result.workRevision,
        ownerName: member.memberName,
        status: "uploaded",
      },
    };
  } catch (error) {
    const message =
      error instanceof ProjectUploadError || error instanceof AccessError || error instanceof Error
        ? error.message
        : "上传失败";
    const errorCode = error instanceof UploadTokenError
      ? error.code
      : error instanceof ProjectUploadError
        ? "INVALID_REQUEST"
        : "INTERNAL_ERROR";
    return {
      isError: true,
      content: [{ type: "text", text: `PaperBee 上传失败：${message}` }],
      structuredContent: { status: "failed", errorCode, error: message },
    };
  }
}

async function downloadOpenAIFile(source: OpenAIFile) {
  let url: URL;
  try {
    url = new URL(source.download_url);
  } catch {
    throw new ProjectUploadError("ChatGPT 提供的文件下载地址无效");
  }
  if (url.protocol !== "https:") {
    throw new ProjectUploadError("文件下载地址必须使用 HTTPS");
  }

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new ProjectUploadError(`无法从 ChatGPT 取得文件（HTTP ${response.status}）`, 502);
  }
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_FILE_SIZE) {
    await response.body.cancel();
    throw new ProjectUploadError("单个文件不能超过 25 MB", 413);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FILE_SIZE) {
      await reader.cancel();
      throw new ProjectUploadError("单个文件不能超过 25 MB", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const fallbackName = source.file_id.replace(/[^a-zA-Z0-9_-]/g, "_") || "chatgpt-file";
  return new File([bytes], source.file_name || fallbackName, {
    type: source.mime_type || response.headers.get("content-type") || "application/octet-stream",
  });
}

function parseOpenAIFile(value: unknown, errorMessage: string): OpenAIFile {
  const file = asRecord(value);
  if (typeof file.download_url !== "string" || typeof file.file_id !== "string") {
    throw new ProjectUploadError(errorMessage);
  }
  return {
    download_url: file.download_url,
    file_id: file.file_id,
    mime_type: typeof file.mime_type === "string" ? file.mime_type : undefined,
    file_name: typeof file.file_name === "string" ? file.file_name : undefined,
  };
}

function classifyMaterials(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProjectUploadError("请把科研项目中文说明作为 materials 文件参数提交，不能只传文件名");
  }
  if (value.length > 4) throw new ProjectUploadError("项目材料最多上传四个文件");

  const classified = new Map<string, OpenAIFile>();
  const unclassified: OpenAIFile[] = [];
  for (const entry of value) {
    const source = parseOpenAIFile(entry, "ChatGPT 文件参数无效，请传递文件对象而不是文件名");
    const kind = inferMaterialField(source.file_name ?? "");
    if (!kind) {
      unclassified.push(source);
      continue;
    }
    if (classified.has(kind)) {
      throw new ProjectUploadError(`检测到重复的${materialFieldLabel(kind)}文件`);
    }
    classified.set(kind, source);
  }

  for (const source of unclassified) {
    const name = source.file_name ?? source.file_id;
    const lowerName = name.toLowerCase();
    if (!classified.has("descriptionFile") && /\.(md|txt|docx)$/i.test(lowerName)) {
      classified.set("descriptionFile", source);
    } else if (!classified.has("paperFile") && lowerName.endsWith(".pdf")) {
      classified.set("paperFile", source);
    } else {
      throw new ProjectUploadError(`无法判断文件“${name}”的材料类型，请使用包含“项目中文说明”“AI预审”“论文”或“复现包”的文件名`);
    }
  }

  if (!classified.has("descriptionFile")) {
    throw new ProjectUploadError("缺少科研项目中文说明；请确认文件名包含“项目中文说明”并作为 materials 文件对象提交");
  }
  return [...classified.entries()] as Array<[string, OpenAIFile]>;
}

function inferMaterialField(fileName: string) {
  const name = fileName.toLowerCase().replace(/[\s_-]+/g, "");
  if (/ai预审|预审摘要|aireview/.test(name)) return "aiReviewFile";
  if (/项目中文说明|中文说明|物理导读|研究导读/.test(name)) return "descriptionFile";
  if (/完整复现包|复现包|reproduction|replication/.test(name) || /\.(zip|tar\.gz|tgz)$/i.test(fileName)) {
    return "reproductionFile";
  }
  if (/论文|paper|manuscript/.test(name) && fileName.toLowerCase().endsWith(".pdf")) return "paperFile";
  return "";
}

function materialFieldLabel(field: string) {
  return field === "descriptionFile"
    ? "科研项目中文说明"
    : field === "aiReviewFile"
      ? "AI 预审摘要"
      : field === "paperFile"
        ? "论文"
        : "完整复现包";
}

function requiredString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new ProjectUploadError(message);
  return value.trim();
}

function setOptionalString(form: FormData, name: string, value: unknown) {
  if (typeof value === "string" && value.trim()) form.set(name, value.trim());
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers: RESPONSE_HEADERS });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, status: number) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status, headers: RESPONSE_HEADERS },
  );
}

function projectReadError(id: JsonRpcRequest["id"], error: unknown) {
  if (error instanceof OAuthBearerError) {
    const challenge = oauthChallenge("invalid_token", error.message);
    return Response.json(
      {
        jsonrpc: "2.0",
        id: id ?? null,
        result: {
          isError: true,
          content: [{ type: "text", text: error.message }],
          _meta: { "mcp/www_authenticate": [challenge] },
        },
      },
      { status: 401, headers: { ...RESPONSE_HEADERS, ...oauthChallengeHeaders() } },
    );
  }
  if (error instanceof AccessError) {
    return rpcResult(id, {
      isError: true,
      content: [{ type: "text", text: error.message }],
    });
  }
  return rpcError(id, -32603, "读取项目时发生内部错误", 500);
}
