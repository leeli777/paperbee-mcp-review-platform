"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { SiteIdentity } from "@/lib/auth";
import { JOURNAL_OPTIONS } from "@/lib/journals";
import { normalizeMarkdownForPreview } from "@/lib/markdown-preview";
import { canClaimProject } from "@/lib/project-access-policy";
import { PROJECT_FIELDS } from "@/lib/project-fields";

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  researchField: string;
  status: string;
  lastSeenAt: string | null;
};

type Project = {
  id: string;
  publicCode: string;
  title: string;
  summary: string;
  field: string;
  status: string;
  reviewScope: string;
  aiDisclosure: string;
  recommendedJournals: string;
  aiSubmissionAdvice: string;
  ownerMemberId: string;
  ownerName: string;
  versionNumber: number | null;
  fileName: string | null;
  artifactKinds: string;
  artifactFiles: Record<string, string>;
  assignmentCount: number;
  hasActiveAssignment: boolean;
  activeReviewerName: string;
  myActiveAssignmentId: string | null;
  canAccessReviewMaterials: boolean;
  likeCount: number;
  likedByMe: boolean;
  tags: ProjectTag[];
  createdAt: string;
  updatedAt: string;
};

type ProjectTag = {
  id: string;
  projectId: string;
  name: string;
  likeCount: number;
  likedByMe: boolean;
};

type Assignment = {
  id: string;
  status: string;
  scope: string;
  dueDate: string | null;
  projectId: string;
  projectTitle: string;
  projectField: string;
  projectSummary: string;
  ownerName: string;
  reviewId: string | null;
};

type DownloadLog = {
  id: string;
  occurredAt: string;
  source: "web" | "chatgpt_mcp";
  action: string;
  outcome: string;
  denialReason: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectTitle: string | null;
  versionNumber: number | null;
  artifactKind: string | null;
  fileName: string | null;
  memberId: string;
  memberName: string;
  memberEmail: string;
};

type BootstrapData = {
  member: Member;
  projects: Project[];
  members: Member[];
  assignments: Assignment[];
};

type View = "overview" | "projects" | "reviews" | "members" | "downloads";

const PROJECT_MATERIALS = [
  { number: "1", kind: "description", label: "科研项目中文说明", note: "项目概览、证据、限制与审核重点", required: true },
  { number: "2", kind: "ai-review", label: "AI 预审摘要", note: "评分与风险提示；建议形成初步判断后再查看", required: false },
  { number: "3", kind: "paper", label: "论文", note: "作者提交的论文 PDF", required: false },
  { number: "4", kind: "reproduction", label: "完整复现包", note: "代码、环境、数据说明与运行步骤", required: false },
] as const;

function isRestrictedReviewMaterial(kind: string) {
  return kind === "paper" || kind === "reproduction";
}

async function fetchBootstrapData() {
  const response = await fetch("/api/bootstrap", { cache: "no-store" });
  const payload = (await response.json()) as BootstrapData & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "无法读取工作台数据");
  return payload;
}

async function fetchDownloadLogs() {
  const response = await fetch("/api/download-logs", { cache: "no-store" });
  const payload = (await response.json()) as { logs?: DownloadLog[]; limit?: number; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "无法读取访问审计");
  return { logs: payload.logs ?? [], limit: payload.limit ?? 200 };
}

const FIELD_OPTIONS = PROJECT_FIELDS;
const UPLOAD_AI_PROMPT = `你是科研项目整理助手。请阅读我接下来提供的项目资料，为参与内部审核的研究人员准备以下材料。只使用资料中真实存在的内容，不要编造结果、引文或复现情况；不确定的地方直接标为“尚未确认”。

请在一个新的 output 文件夹中生成：

1. 项目中文说明.md（必须）
请把它写成一份面向同行的中文研讨会式研究导读，让没有参与项目、但具备相关专业背景的审核者，像听一次 10–15 分钟的内部学术报告一样理解这项工作。

不要套用固定的五段式模板，也不要逐项回答清单。请根据项目自身的科学逻辑，自由选择章节、顺序和详略：开头尽快让读者知道研究问题和最重要的结论，随后围绕真正承重的物理图景、核心想法、推理链条和主要结果展开，说明这些结果在物理上意味着什么、由什么证据支持、适用边界在哪里。最后自然交代仍存在的局限、未解决问题，以及最值得真人审核者检查的关键环节。

必须单独包含一节“创新性说明”。这一节要明确区分已有理论、标准工具或已知结论，与本项目真正新增的结果；说明新增部分为什么有科学意义，同时诚实交代创新性的边界。不能仅凭没有检索到相同论文就断言首创；未完成充分文献核验时直接说明。

以帮助同行理解科学内容为目标，可以使用必要的公式、直观例子和关键数字，但不要写成申报书、合规清单、项目管理报告或流水账。不要堆砌运行日志、完整参数、文件清单、人员分工和冗长复现步骤；这些内容只有在理解或判断结果可靠性时必不可少才提。中文应自然清楚，专业术语在英文更准确时保留英文。不设置固定字数，以把项目讲清楚为准。

这份文件是研究导读，不是 AI 预审报告。不要加入评分表，也不要以投稿期刊、是否送审或是否继续修改为主线；这些判断放在单独的 AI 预审摘要中。

Markdown 排版要求（两份 .md 文件都必须遵守）：
- 文件使用 UTF-8 编码，采用标准 Markdown；一级标题只用于文档标题，正文从二级标题开始；标题、段落、列表、表格、公式块和代码块之间保留空行。
- 行内公式使用单个美元符号包围，例如 $E=mc^2$；独立公式使用成对的双美元符号，并让起止符号各自单独占一行。不要用代码块包裹公式，不要混用全角美元符号，不要留下未配对的美元符号。
- 公式使用通用 LaTeX/KaTeX 语法；避免依赖自定义宏、外部宏包或只在特定 TeX 模板中定义的命令。矩阵、分式、上下标、希腊字母和算符均使用规范 LaTeX 命令。
- 表格使用标准 Markdown 表格；较长公式不要塞进表格。代码使用带语言标记的 fenced code block，例如三个反引号后写 python。
- 不使用原始 HTML、脚本、iframe 或外部样式；不要引用本地绝对路径。生成后检查标题层级、列表缩进、代码围栏以及每一对公式定界符，确保网页渲染时不会断裂。

2. AI预审摘要.md（可选）
只有在你实际阅读了项目材料并能进行初步评价时才生成。它要比中文说明更短，约 500–1200 个汉字，供真人审核者参考，不代替独立同行评审。使用下面的固定结构：
- 一句话结论：建议进入审核、修改后审核，或暂不建议继续；
- 评分表：理论正确性与严谨性、创新性、科学意义、证据充分性、表述与结构、可复现性、综合评分，均采用 1–5 分；
- 最强贡献：不超过三点；
- 最大审稿风险：不超过三点；
- 建议真人审核者重点检查什么；
- 是否值得继续修改，以及不超过三项的最小修改建议；
- 候选期刊建议：从 PRL、PRD、PRC、PRA、PRX、EPJC、CPC、JHEP 或更合适的期刊中推荐 1–3 个，并简要说明匹配度和主要门槛；
- 注明使用的 AI 模型、生成日期、项目版本、实际读取的材料和未检查的部分。

报告开头必须标注“AI 预审，仅供参考”。没有实际检查的推导、代码、数据或文献不能声称已经验证；证据不足时降低评分并说明原因。

3. 论文.pdf（可选）
如果项目中已有论文稿件，就整理并导出为 PDF；没有稿件则跳过，不要为了凑齐材料而新编一篇论文。

4. 完整复现包.zip（可选）
如果已有可运行的代码和必要材料，就整理成复现包，并在根目录放一个简短 README，写明环境、入口命令和主要输出；资料不足则跳过。删除密码、令牌、个人隐私、缓存和无关大文件，不要放入无权分发的数据。

文件规范：中文说明和 AI 预审支持 MD、TXT、PDF 或 DOCX；论文只用 PDF；复现包使用 ZIP、TAR.GZ 或 TGZ；每个文件不超过 25 MB。文件名清晰，不使用“final_final”等含混名称。

完成后告诉我生成了哪些文件、跳过了哪些可选文件，以及哪些科学内容仍需我人工确认。不要声称完成了实际上没有执行的检查。`;
const STATUS_CLASS: Record<string, string> = {
  待分配: "status-amber",
  审核中: "status-blue",
  待修改: "status-coral",
  已通过: "status-green",
  已暂停: "status-neutral",
};

export function PaperBeeApp({ identity }: { identity: SiteIdentity }) {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [assignProject, setAssignProject] = useState<Project | null>(null);
  const [materialProject, setMaterialProject] = useState<Project | null>(null);
  const [previewProject, setPreviewProject] = useState<Project | null>(null);
  const [detailProjectId, setDetailProjectId] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [reviewAssignment, setReviewAssignment] = useState<Assignment | null>(null);
  const [search, setSearch] = useState("");
  const [fieldFilter, setFieldFilter] = useState("全部领域");
  const [downloadLogs, setDownloadLogs] = useState<DownloadLog[]>([]);
  const [downloadLogLimit, setDownloadLogLimit] = useState(200);
  const [downloadLogsLoading, setDownloadLogsLoading] = useState(false);
  const [downloadLogsError, setDownloadLogsError] = useState("");
  const [projectActionId, setProjectActionId] = useState("");
  const [socialActionKey, setSocialActionKey] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await fetchBootstrapData();
      setData(payload);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取工作台数据");
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadDataSilently = useCallback(async () => {
    const payload = await fetchBootstrapData();
    setData(payload);
    setError("");
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetchBootstrapData()
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setError("");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "无法读取工作台数据");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadDownloadLogs = useCallback(async () => {
    setDownloadLogsLoading(true);
    setDownloadLogsError("");
    try {
      const payload = await fetchDownloadLogs();
      setDownloadLogs(payload.logs);
      setDownloadLogLimit(payload.limit);
    } catch (caught) {
      setDownloadLogsError(caught instanceof Error ? caught.message : "无法读取访问审计");
    } finally {
      setDownloadLogsLoading(false);
    }
  }, []);

  const filteredProjects = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (data?.projects ?? []).filter((project) => {
      const matchesText =
        !normalized ||
        project.title.toLowerCase().includes(normalized) ||
        project.summary.toLowerCase().includes(normalized) ||
        project.ownerName.toLowerCase().includes(normalized);
      const matchesTag = project.tags.some((tag) => tag.name.toLowerCase().includes(normalized));
      const matchesField = fieldFilter === "全部领域" || project.field === fieldFilter;
      return (matchesText || matchesTag) && matchesField;
    });
  }, [data?.projects, fieldFilter, search]);

  const visibleAssignments = (data?.assignments ?? []).filter((assignment) => assignment.status !== "已放弃");
  const pendingReviews = visibleAssignments.filter((assignment) => assignment.status !== "已完成");
  const activeMembers = (data?.members ?? []).filter((member) => member.status === "active");
  const detailProject = data?.projects.find((project) => project.id === detailProjectId) ?? null;
  const editProject = data?.projects.find((project) => project.id === editProjectId) ?? null;

  const refreshWithNotice = async (message: string) => {
    await loadData();
    setNotice(message);
  };

  const updateProjectField = async (project: Project, field: string) => {
    if (field === project.field) return;
    setProjectActionId(project.id);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法修改项目分类");
      await refreshWithNotice("项目分类已更新");
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "无法修改项目分类");
    } finally {
      setProjectActionId("");
    }
  };

  const deleteProject = async (project: Project) => {
    const confirmed = window.confirm(
      `确定永久删除“${project.title}”吗？项目材料、审核任务、审核报告和下载记录都会一并删除，且无法恢复。`,
    );
    if (!confirmed) return;

    setProjectActionId(project.id);
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法删除项目");
      if (materialProject?.id === project.id) setMaterialProject(null);
      if (previewProject?.id === project.id) setPreviewProject(null);
      if (assignProject?.id === project.id) setAssignProject(null);
      if (detailProjectId === project.id) setDetailProjectId("");
      if (editProjectId === project.id) setEditProjectId("");
      await refreshWithNotice("项目已删除");
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "无法删除项目");
    } finally {
      setProjectActionId("");
    }
  };

  const runSocialAction = async (key: string, url: string, body?: object) => {
    setSocialActionKey(key);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "操作失败");
      await reloadDataSilently();
      return true;
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "操作失败");
      return false;
    } finally {
      setSocialActionKey("");
    }
  };

  const addProjectTag = (project: Project, name: string) =>
    runSocialAction(`add-tag:${project.id}`, `/api/projects/${project.id}/tags`, { name });

  const toggleProjectLike = (project: Project) =>
    runSocialAction(`project-like:${project.id}`, `/api/projects/${project.id}/like`);

  const toggleTagLike = (tag: ProjectTag) =>
    runSocialAction(`tag-like:${tag.id}`, `/api/tags/${tag.id}/like`);

  const claimProject = async (project: Project) => {
    setProjectActionId(project.id);
    try {
      const response = await fetch(`/api/projects/${project.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim" }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法接取项目");
      await refreshWithNotice("项目已接取，论文和复现包现由你负责审核");
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "无法接取项目");
    } finally {
      setProjectActionId("");
    }
  };

  const abandonProject = async (projectId: string, projectTitle: string) => {
    if (!window.confirm(`确定放弃“${projectTitle}”的审核任务吗？放弃后其他成员可以重新接取。`)) return;
    setProjectActionId(projectId);
    try {
      const response = await fetch(`/api/projects/${projectId}/assign`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法放弃项目");
      if (reviewAssignment?.projectId === projectId) setReviewAssignment(null);
      await refreshWithNotice("已放弃审核，项目重新开放接取");
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "无法放弃项目");
    } finally {
      setProjectActionId("");
    }
  };

  const navigation: { id: View; label: string; count?: number }[] = [
    { id: "overview", label: "工作台" },
    { id: "projects", label: "项目池", count: data?.projects.length },
    { id: "reviews", label: "待我审核", count: pendingReviews.length },
    { id: "members", label: "成员", count: data?.members.length },
    ...(data?.member.role === "admin" ? [{ id: "downloads" as const, label: "访问审计" }] : []),
  ];
  const navigate = (nextView: View) => {
    setView(nextView);
    if (nextView === "downloads") void loadDownloadLogs();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="bee-mark" aria-hidden="true"><i /><b /></span>
          <span>PaperBee</span>
        </div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">研</span>
          <span><b>学院科研审核组</b><small>内部空间</small></span>
          <span className="chevron">⌄</span>
        </div>
        <nav aria-label="主导航">
          <p className="nav-label">空间</p>
          {navigation.map((item, index) => (
            <button
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <span className={`nav-symbol nav-symbol-${index}`} aria-hidden="true" />
              <span>{item.label}</span>
              {typeof item.count === "number" && <em>{item.count}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="privacy-dot" />
          <span><b>私有工作区</b><small>文件仅限成员账号访问</small></span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="bee-mark" aria-hidden="true"><i /><b /></span>
            <b>PaperBee</b>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="通知"><span className="bell" /><i /></button>
            <div className="user-chip">
              <span>{initials(data?.member.name ?? identity.displayName)}</span>
              <div><b>{data?.member.name ?? identity.displayName}</b><small>{roleLabel(data?.member.role ?? "member")}</small></div>
            </div>
            <button className="account-button" onClick={() => setShowPasswordForm(true)}>修改密码</button>
            <button className="account-button" onClick={logout}>退出</button>
          </div>
        </header>

        <nav className="mobile-nav" aria-label="移动端主导航">
          {navigation.map((item) => (
            <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => navigate(item.id)}>
              <span>{item.label}</span>
              {typeof item.count === "number" && <em>{item.count}</em>}
            </button>
          ))}
        </nav>

        <div className="content">
          {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
          {error && <ErrorState message={error} retry={loadData} />}
          {!error && loading && <LoadingState />}
          {!error && !loading && data && (
            <>
              {view === "overview" && (
                <Overview
                  data={data}
                  pendingReviews={pendingReviews}
                  activeMembers={activeMembers}
                  onNewProject={() => setShowProjectForm(true)}
                  onNavigate={setView}
                  onDownload={setMaterialProject}
                />
              )}
              {view === "projects" && (
                <ProjectsView
                  projects={filteredProjects}
                  search={search}
                  fieldFilter={fieldFilter}
                  onSearch={setSearch}
                  onFieldFilter={setFieldFilter}
                  onNewProject={() => setShowProjectForm(true)}
                  onOpenProject={(project) => setDetailProjectId(project.id)}
                  socialActionKey={socialActionKey}
                  onLikeProject={toggleProjectLike}
                  onLikeTag={toggleTagLike}
                />
              )}
              {view === "reviews" && (
                <ReviewsView
                  assignments={visibleAssignments}
                  projectActionId={projectActionId}
                  onReview={setReviewAssignment}
                  onAbandon={abandonProject}
                />
              )}
              {view === "members" && (
                <MembersView
                  members={data.members}
                  isAdmin={data.member.role === "admin"}
                  onInvite={() => setShowInviteForm(true)}
                />
              )}
              {view === "downloads" && data.member.role === "admin" && (
                <DownloadLogsView
                  logs={downloadLogs}
                  limit={downloadLogLimit}
                  loading={downloadLogsLoading}
                  error={downloadLogsError}
                  onRetry={loadDownloadLogs}
                />
              )}
            </>
          )}
        </div>
      </main>

      {showProjectForm && (
        <ProjectModal
          onClose={() => setShowProjectForm(false)}
          onCreated={() => {
            setShowProjectForm(false);
            void refreshWithNotice("项目已安全上传");
          }}
        />
      )}
      {showInviteForm && (
        <InviteModal
          onClose={() => setShowInviteForm(false)}
          onInvited={() => {
            setShowInviteForm(false);
            void refreshWithNotice("邀请已加入成员列表");
          }}
        />
      )}
      {showPasswordForm && (
        <PasswordModal
          onClose={() => setShowPasswordForm(false)}
          onChanged={() => {
            setShowPasswordForm(false);
            setNotice("密码已更新，其他登录会话已退出");
          }}
        />
      )}
      {assignProject && data && (
        <AssignModal
          project={assignProject}
          members={data.members.filter((member) => member.status === "active" && member.id !== assignProject.ownerMemberId)}
          onClose={() => setAssignProject(null)}
          onAssigned={() => {
            setAssignProject(null);
            void refreshWithNotice("审核任务已分配");
          }}
        />
      )}
      {detailProject && data && (
        <ProjectDetailModal
          project={detailProject}
          members={data.members}
          currentMember={data.member}
          projectActionId={projectActionId}
          socialActionKey={socialActionKey}
          onClose={() => setDetailProjectId("")}
          onPreview={(project) => {
            setDetailProjectId("");
            setPreviewProject(project);
          }}
          onEdit={(project) => {
            setDetailProjectId("");
            setEditProjectId(project.id);
          }}
          onDownload={(project) => {
            setDetailProjectId("");
            setMaterialProject(project);
          }}
          onAssign={(project) => {
            setDetailProjectId("");
            setAssignProject(project);
          }}
          onClaim={claimProject}
          onAbandon={(project) => abandonProject(project.id, project.title)}
          onFieldChange={updateProjectField}
          onDelete={deleteProject}
          onAddTag={addProjectTag}
          onLikeProject={toggleProjectLike}
          onLikeTag={toggleTagLike}
        />
      )}
      {editProject && (
        <EditProjectModal
          project={editProject}
          deleting={projectActionId === editProject.id}
          onClose={() => setEditProjectId("")}
          onDelete={deleteProject}
          onUpdated={() => {
            setEditProjectId("");
            void refreshWithNotice("项目已更新");
          }}
        />
      )}
      {materialProject && (
        <MaterialsModal project={materialProject} onClose={() => setMaterialProject(null)} />
      )}
      {previewProject && (
        <PreviewModal key={previewProject.id} project={previewProject} onClose={() => setPreviewProject(null)} />
      )}
      {reviewAssignment && (
        <ReviewModal
          assignment={reviewAssignment}
          onClose={() => setReviewAssignment(null)}
          onSubmitted={() => {
            setReviewAssignment(null);
            void refreshWithNotice("审核报告已提交并留痕");
          }}
        />
      )}
    </div>
  );
}

function Overview({
  data,
  pendingReviews,
  activeMembers,
  onNewProject,
  onNavigate,
  onDownload,
}: {
  data: BootstrapData;
  pendingReviews: Assignment[];
  activeMembers: Member[];
  onNewProject: () => void;
  onNavigate: (view: View) => void;
  onDownload: (project: Project) => void;
}) {
  const underReview = data.projects.filter((project) => project.status === "审核中").length;
  const passed = data.projects.filter((project) => project.status === "已通过").length;
  return (
    <>
      <section className="page-heading">
        <div>
          <span className="eyebrow">内部空间 · {formatDate(new Date().toISOString(), true)}</span>
          <h1>{beijingGreeting()}，{shortName(data.member.name)}</h1>
          <p>这里汇总了正在推进的项目、审核任务与最新版本。</p>
        </div>
        <button className="primary-button" onClick={onNewProject}><span>＋</span>上传新项目</button>
      </section>

      <section className="metric-grid">
        <MetricCard label="全部项目" value={data.projects.length} note="内部可见" tone="ink" />
        <MetricCard label="审核中" value={underReview} note={underReview ? "等待审核报告" : "暂无进行中任务"} tone="blue" />
        <MetricCard label="待我审核" value={pendingReviews.length} note={pendingReviews.length ? "请关注截止日期" : "当前已清空"} tone="amber" />
        <MetricCard label="已通过" value={passed} note={`${activeMembers.length} 位活跃成员`} tone="green" />
      </section>

      <section className="dashboard-grid">
        <div className="panel recent-panel">
          <div className="panel-heading">
            <div><h2>最近项目</h2><p>按最后更新时间排序</p></div>
            <button className="text-button" onClick={() => onNavigate("projects")}>查看全部 <span>→</span></button>
          </div>
          {data.projects.length === 0 ? (
            <EmptyProjects onNewProject={onNewProject} />
          ) : (
            <div className="project-table">
              <div className="project-table-head"><span>项目</span><span>领域</span><span>状态</span><span>版本</span><span /></div>
              {data.projects.slice(0, 5).map((project) => (
                <div className="project-row" key={project.id}>
                  <div className="project-title-cell"><span className="document-icon">P</span><div><b>{project.title}</b><small>{project.ownerName} · {formatDate(project.updatedAt)}</small></div></div>
                  <span className="field-label">{project.field}</span>
                  <Status status={project.status} />
                  <span className="version">v{project.versionNumber ?? 1}</span>
                  <button className="row-action" onClick={() => onDownload(project)} aria-label={`下载 ${project.title}`}>↓</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel workflow-panel">
          <div className="panel-heading"><div><h2>审核流程</h2><p>清晰的责任边界</p></div><span className="private-badge">PRIVATE</span></div>
          <ol className="workflow-list">
            <li className="done"><span>1</span><div><b>提交固定版本</b><small>论文、代码与数据打包留痕</small></div></li>
            <li className="active"><span>2</span><div><b>分配审核范围</b><small>明确审核者只对检查项负责</small></div></li>
            <li><span>3</span><div><b>结构化审核</b><small>正确性、复现性与数据伦理</small></div></li>
            <li><span>4</span><div><b>修改并归档</b><small>保留问题、答复与版本关系</small></div></li>
          </ol>
          <div className="security-note"><span className="shield">✓</span><p><b>下载受控并记录</b><small>任何项目文件都没有公开永久链接。</small></p></div>
        </div>
      </section>
    </>
  );
}

function ProjectsView({ projects, search, fieldFilter, onSearch, onFieldFilter, onNewProject, onOpenProject, socialActionKey, onLikeProject, onLikeTag }: {
  projects: Project[];
  search: string;
  fieldFilter: string;
  onSearch: (value: string) => void;
  onFieldFilter: (value: string) => void;
  onNewProject: () => void;
  onOpenProject: (project: Project) => void;
  socialActionKey: string;
  onLikeProject: (project: Project) => Promise<boolean>;
  onLikeTag: (tag: ProjectTag) => Promise<boolean>;
}) {
  return (
    <>
      <section className="page-heading compact">
        <div><span className="eyebrow">项目资料库</span><h1>项目池</h1><p>所有材料均为内部版本，下载行为会被记录。</p></div>
        <button className="primary-button" onClick={onNewProject}><span>＋</span>上传新项目</button>
      </section>
      <div className="filter-bar">
        <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索项目、作者、摘要或标签" /></label>
        <select value={fieldFilter} onChange={(event) => onFieldFilter(event.target.value)}><option>全部领域</option>{FIELD_OPTIONS.map((field) => <option key={field}>{field}</option>)}</select>
      </div>
      {projects.length === 0 ? <div className="panel"><EmptyProjects onNewProject={onNewProject} /></div> : (
        <div className="project-card-grid">
          {projects.map((project) => (
            <article
              className="project-card compact-project-card"
              key={project.id}
            >
              <button
                className="project-card-open"
                onClick={() => onOpenProject(project)}
                aria-label={`查看项目详情：${project.title}`}
              >
                <span className="field-pill">{project.field}</span>
                <span className="project-code-inline">{project.publicCode}</span>
                <h2>{project.title}</h2>
                {(project.recommendedJournals || project.aiSubmissionAdvice) && (
                  <div className="compact-journal-advice">
                    <span>AI 投稿建议</span>
                    {project.recommendedJournals && <b>{project.recommendedJournals.split(",").join(" · ")}</b>}
                    {project.aiSubmissionAdvice && <p>{project.aiSubmissionAdvice}</p>}
                  </div>
                )}
              </button>
              <ProjectTagList
                project={project}
                busyKey={socialActionKey}
                onLikeTag={onLikeTag}
              />
              <div className="compact-card-like">
                <button
                  className={`like-button ${project.likedByMe ? "liked" : ""}`}
                  disabled={socialActionKey === `project-like:${project.id}`}
                  onClick={() => onLikeProject(project)}
                  aria-pressed={project.likedByMe}
                  aria-label={`${project.likedByMe ? "取消点赞" : "点赞"} ${project.title}`}
                >
                  <span aria-hidden="true">♥</span>{project.likeCount}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function ProjectDetailModal({ project, members, currentMember, projectActionId, socialActionKey, onClose, onPreview, onEdit, onDownload, onAssign, onClaim, onAbandon, onFieldChange, onDelete, onAddTag, onLikeProject, onLikeTag }: {
  project: Project;
  members: Member[];
  currentMember: Member;
  projectActionId: string;
  socialActionKey: string;
  onClose: () => void;
  onPreview: (project: Project) => void;
  onEdit: (project: Project) => void;
  onDownload: (project: Project) => void;
  onAssign: (project: Project) => void;
  onClaim: (project: Project) => void;
  onAbandon: (project: Project) => void;
  onFieldChange: (project: Project, field: string) => void;
  onDelete: (project: Project) => void;
  onAddTag: (project: Project, name: string) => Promise<boolean>;
  onLikeProject: (project: Project) => Promise<boolean>;
  onLikeTag: (tag: ProjectTag) => Promise<boolean>;
}) {
  const canManage = currentMember.role === "admin" || currentMember.id === project.ownerMemberId;
  const actionPending = projectActionId === project.id;
  const [codeCopied, setCodeCopied] = useState(false);
  const copyProjectCode = async () => {
    await navigator.clipboard.writeText(project.publicCode);
    setCodeCopied(true);
    window.setTimeout(() => setCodeCopied(false), 1600);
  };

  return (
    <Modal title={project.title} subtitle="项目详情与内部审核操作" onClose={onClose} wide>
      <div className="project-detail">
        <div className="project-detail-top"><span className="field-pill">{project.field}</span><Status status={project.status} /></div>
        <p className="project-detail-summary">{project.summary || "未填写项目摘要，请下载中文说明查看项目内容。"}</p>
        <dl className="project-detail-meta"><div><dt>作者</dt><dd>{project.ownerName}</dd></div><div><dt>当前版本</dt><dd>v{project.versionNumber ?? 1}</dd></div><div><dt>审核者</dt><dd>{project.activeReviewerName || "未分配"}</dd></div></dl>
        <div className="project-code-box"><div><span>项目编号</span><b>{project.publicCode}</b><small>项目编号只用于定位，访问仍需登录并通过权限检查。</small></div><button className="secondary-button" onClick={copyProjectCode}>{codeCopied ? "已复制" : "复制编号"}</button></div>
        {project.hasActiveAssignment && !project.canAccessReviewMaterials && (
          <div className="material-access-note">
            <b>审核材料已锁定</b>
            <p>论文和完整复现包仅限当前审稿人、上传者及管理员查看；中文说明和 AI 预审仍可访问。</p>
          </div>
        )}
        {(project.recommendedJournals || project.aiSubmissionAdvice) && (
          <div className="journal-advice">
            <span>AI 投稿建议 · 仅供参考</span>
            {project.recommendedJournals && <b>{project.recommendedJournals.split(",").join(" · ")}</b>}
            {project.aiSubmissionAdvice && <p>{project.aiSubmissionAdvice}</p>}
          </div>
        )}
        <div className="scope-box"><span>审核范围</span><p>{project.reviewScope}</p></div>
        <ProjectTags project={project} busyKey={socialActionKey} onAddTag={onAddTag} onLikeTag={onLikeTag} />
        {canManage && (
          <div className="project-management">
            <label>
              <span>项目分类</span>
              <select
                aria-label={`修改 ${project.title} 的项目分类`}
                value={project.field}
                disabled={actionPending}
                onChange={(event) => onFieldChange(project, event.target.value)}
              >
                {FIELD_OPTIONS.map((field) => <option key={field}>{field}</option>)}
              </select>
            </label>
            <button className="danger-button" disabled={actionPending} onClick={() => onDelete(project)}>
              {actionPending ? "处理中…" : "删除项目"}
            </button>
          </div>
        )}
        <div className="project-detail-actions">
          <button className="secondary-button" onClick={() => onPreview(project)}>预览材料</button>
          <button className="secondary-button" onClick={() => onDownload(project)}>下载材料</button>
          {canManage && <button className="secondary-button" onClick={() => onEdit(project)}>编辑项目</button>}
          {canClaimProject({ hasActiveAssignment: project.hasActiveAssignment }) && (
            <button className="primary-button" disabled={actionPending} onClick={() => onClaim(project)}>
              {actionPending ? "正在接取…" : "接取项目"}
            </button>
          )}
          {project.myActiveAssignmentId && (
            <button className="danger-button" disabled={actionPending} onClick={() => onAbandon(project)}>
              {actionPending ? "处理中…" : "放弃审核"}
            </button>
          )}
          {canManage && !project.hasActiveAssignment && members.length > 0 && <button className="text-button" onClick={() => onAssign(project)}>指定审稿人 →</button>}
          <button
            className={`like-button ${project.likedByMe ? "liked" : ""}`}
            disabled={socialActionKey === `project-like:${project.id}`}
            onClick={() => onLikeProject(project)}
            aria-pressed={project.likedByMe}
            aria-label={`${project.likedByMe ? "取消点赞" : "点赞"} ${project.title}`}
          >
            <span aria-hidden="true">♥</span>{project.likeCount}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ProjectTagList({ project, busyKey, onLikeTag }: {
  project: Project;
  busyKey: string;
  onLikeTag: (tag: ProjectTag) => Promise<boolean>;
}) {
  return (
    <div className="tag-list">
      {project.tags.length === 0 && <span className="tag-empty">暂无标签</span>}
      {project.tags.map((tag) => (
        <button
          className={`research-tag ${tag.likedByMe ? "liked" : ""}`}
          key={tag.id}
          disabled={busyKey === `tag-like:${tag.id}`}
          onClick={() => onLikeTag(tag)}
          aria-pressed={tag.likedByMe}
          aria-label={`${tag.likedByMe ? "取消点赞" : "点赞"}标签 ${tag.name}`}
        >
          <span>#{tag.name}</span><em>♥ {tag.likeCount}</em>
        </button>
      ))}
    </div>
  );
}

function ProjectTags({ project, busyKey, onAddTag, onLikeTag }: {
  project: Project;
  busyKey: string;
  onAddTag: (project: Project, name: string) => Promise<boolean>;
  onLikeTag: (tag: ProjectTag) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const adding = busyKey === `add-tag:${project.id}`;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (await onAddTag(project, name)) setName("");
  };

  return (
    <div className="project-tags">
      <div className="project-tags-heading"><span>同行标签</span><small>所有成员均可添加和点赞</small></div>
      <ProjectTagList project={project} busyKey={busyKey} onLikeTag={onLikeTag} />
      <form className="tag-form" onSubmit={submit}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={24}
          placeholder="添加标签，如 QCD、非微扰"
          aria-label={`为 ${project.title} 添加标签`}
        />
        <button disabled={adding || !name.trim()}>{adding ? "添加中…" : "＋ 添加"}</button>
      </form>
    </div>
  );
}

function ReviewsView({ assignments, projectActionId, onReview, onAbandon }: {
  assignments: Assignment[];
  projectActionId: string;
  onReview: (assignment: Assignment) => void;
  onAbandon: (projectId: string, projectTitle: string) => void;
}) {
  return (
    <>
      <section className="page-heading compact"><div><span className="eyebrow">我的任务</span><h1>待我审核</h1><p>审核报告只覆盖任务中明确列出的范围。</p></div></section>
      {assignments.length === 0 ? (
        <div className="panel empty-state"><span className="empty-check">✓</span><h2>当前没有审核任务</h2><p>可以到项目池自行接取，也可以等待项目作者或管理员指定。</p></div>
      ) : (
        <div className="review-list">
          {assignments.map((assignment) => (
            <article className="review-card" key={assignment.id}>
              <div className="review-main"><div className="review-meta"><span className="field-pill">{assignment.projectField}</span><span>{assignment.ownerName} 提交</span></div><h2>{assignment.projectTitle}</h2><p>{assignment.projectSummary}</p><div className="scope-box"><span>你负责的范围</span><p>{assignment.scope}</p></div></div>
              <div className="review-side"><Status status={assignment.status} /><p><span>截止日期</span><b>{assignment.dueDate ? formatDate(assignment.dueDate, true) : "未设置"}</b></p>{assignment.reviewId ? <span className="completed-label">报告已归档</span> : <div className="review-actions"><button className="primary-button" onClick={() => onReview(assignment)}>开始审核</button><button className="text-button danger-text" disabled={projectActionId === assignment.projectId} onClick={() => onAbandon(assignment.projectId, assignment.projectTitle)}>{projectActionId === assignment.projectId ? "处理中…" : "放弃任务"}</button></div>}</div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function MembersView({ members, isAdmin, onInvite }: { members: Member[]; isAdmin: boolean; onInvite: () => void }) {
  return (
    <>
      <section className="page-heading compact"><div><span className="eyebrow">访问控制</span><h1>成员</h1><p>只有管理员创建的账号才能进入工作区。</p></div>{isAdmin && <button className="primary-button" onClick={onInvite}><span>＋</span>创建成员</button>}</section>
      <div className="panel member-panel">
        <div className="member-table-head"><span>成员</span><span>研究方向</span><span>角色</span><span>状态</span></div>
        {members.map((member) => (
          <div className="member-row" key={member.id}><div className="member-person"><span>{initials(member.name)}</span><div><b>{member.name}</b><small>{member.email}</small></div></div><span>{member.researchField}</span><span>{roleLabel(member.role)}</span><span className={`member-status ${member.status}`}>{member.status === "active" ? "已加入" : member.status === "invited" ? "待登录" : "已停用"}</span></div>
        ))}
      </div>
    </>
  );
}

function DownloadLogsView({ logs, limit, loading, error, onRetry }: {
  logs: DownloadLog[];
  limit: number;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <>
      <section className="page-heading compact">
        <div><span className="eyebrow">管理员审计</span><h1>访问审计</h1><p>查看最近 {limit} 次网页下载及 ChatGPT 读取结果，仅空间管理员可访问。</p></div>
      </section>
      {loading ? <LoadingState /> : error ? (
        <ErrorState message={error} retry={onRetry} />
      ) : logs.length === 0 ? (
        <div className="panel empty-state"><span className="empty-document">↓</span><h2>还没有访问记录</h2><p>网页下载或 ChatGPT 读取发生后，记录会显示在这里。</p></div>
      ) : (
        <div className="panel download-log-panel">
          <div className="download-log-head"><span>成员</span><span>来源</span><span>项目与操作</span><span>结果</span><span>时间</span></div>
          {logs.map((log) => (
            <div className="download-log-row" key={log.id}>
              <div className="member-person"><span>{initials(log.memberName)}</span><div><b>{log.memberName}</b><small>{log.memberEmail}</small></div></div>
              <span className={`audit-source ${log.source}`}>{log.source === "chatgpt_mcp" ? "通过 ChatGPT" : "网页"}</span>
              <div className="download-file"><b>{log.projectCode || log.projectTitle || "项目列表"}{log.projectTitle && log.projectCode ? ` · ${log.projectTitle}` : ""}</b><small>{auditActionLabel(log.action, log.artifactKind, log.fileName)}</small></div>
              <span className={`audit-outcome ${log.outcome}`}>{log.outcome === "success" ? "成功" : "拒绝"}</span>
              <time dateTime={normalizeDatabaseDate(log.occurredAt)}>{formatDateTime(log.occurredAt)}</time>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function EditProjectModal({ project, deleting, onClose, onDelete, onUpdated }: {
  project: Project;
  deleting: boolean;
  onClose: () => void;
  onDelete: (project: Project) => void;
  onUpdated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const selectedJournals = new Set(project.recommendedJournals.split(",").filter(Boolean));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: new FormData(event.currentTarget),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法更新项目");
      onUpdated();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "无法更新项目");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="编辑项目" subtitle={`${project.title} · 当前 v${project.versionNumber ?? 1}`} onClose={onClose} wide>
      <form className="modal-form" onSubmit={submit}>
        <div className="version-safety-note">
          <b>项目资料按版本保存</b>
          <p>标题、摘要和投稿建议会直接更新；只要选择了新文件，所选材料就会组成下一个版本，旧文件及其下载记录不会被覆盖，项目状态会转为“待修改”。</p>
        </div>
        <label><span>项目标题 *</span><input name="title" required maxLength={140} defaultValue={project.title} /></label>
        <div className="form-row">
          <label><span>研究领域 *</span><select name="field" required defaultValue={project.field}>{FIELD_OPTIONS.map((field) => <option key={field}>{field}</option>)}</select></label>
          <label><span>AI 使用情况</span><select name="aiDisclosure" defaultValue={project.aiDisclosure}><option>未使用生成式 AI</option><option>AI 辅助写作与代码</option><option>AI 主导生成，人工全面核验</option></select></label>
        </div>
        <label><span>项目摘要（可选）</span><textarea name="summary" rows={3} maxLength={900} defaultValue={project.summary} /></label>
        <section className="journal-advice-form" aria-labelledby="edit-journal-advice-title">
          <div><b id="edit-journal-advice-title">AI 投稿建议（可选）</b><small>可以更新候选期刊和建议理由。</small></div>
          <div className="journal-options" role="group" aria-label="AI 建议的候选期刊">
            {JOURNAL_OPTIONS.map((journal) => (
              <label className="journal-choice" key={journal}>
                <input type="checkbox" name="recommendedJournals" value={journal} defaultChecked={selectedJournals.has(journal)} />
                <span>{journal}</span>
              </label>
            ))}
          </div>
          <label className="journal-advice-text"><span>建议理由或其他期刊</span><textarea name="aiSubmissionAdvice" rows={3} maxLength={1800} defaultValue={project.aiSubmissionAdvice} /></label>
        </section>
        <div className="artifact-upload-grid">
          <label className="file-drop"><span className="upload-mark">1</span><b>更新中文说明</b><small>MD、TXT、PDF 或 DOCX · 不更新可留空</small><input name="descriptionFile" type="file" accept=".md,.txt,.pdf,.docx" /></label>
          <label className="file-drop"><span className="upload-mark">2</span><b>更新 AI 预审</b><small>MD、TXT、PDF 或 DOCX · 不更新可留空</small><input name="aiReviewFile" type="file" accept=".md,.txt,.pdf,.docx" /></label>
          <label className="file-drop"><span className="upload-mark">3</span><b>更新论文</b><small>PDF · 不更新可留空</small><input name="paperFile" type="file" accept=".pdf" /></label>
          <label className="file-drop"><span className="upload-mark">4</span><b>更新复现包</b><small>ZIP、TAR.GZ 或 TGZ · 不更新可留空</small><input name="reproductionFile" type="file" accept=".zip,.tar.gz,.tgz" /></label>
        </div>
        {formError && <p className="form-error">{formError}</p>}
        <div className="modal-actions">
          <button type="button" className="danger-button edit-delete-button" disabled={submitting || deleting} onClick={() => onDelete(project)}>{deleting ? "正在删除…" : "删除项目"}</button>
          <button type="button" className="secondary-button" disabled={deleting} onClick={onClose}>取消</button>
          <button className="primary-button" disabled={submitting || deleting}>{submitting ? "正在保存…" : "保存修改"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [uploadMode, setUploadMode] = useState<"manual" | "ai">("manual");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);
  const copyPrompt = async () => {
    setSubmitting(true);
    setFormError("");
    try {
      let prompt = UPLOAD_AI_PROMPT;
      if (uploadMode === "ai") {
        const response = await fetch("/api/upload-tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "六十分钟 AI 上传" }),
        });
        const payload = (await response.json()) as { token?: string; error?: string };
        if (!response.ok || !payload.token) throw new Error(payload.error ?? "无法生成临时上传授权");
        prompt = buildAiGenerateAndUploadPrompt(payload.token);
      }
      await navigator.clipboard.writeText(prompt);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 2200);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "自动复制失败，请重新点击复制");
    } finally {
      setSubmitting(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true); setFormError("");
    try {
      const response = await fetch("/api/projects", { method: "POST", body: new FormData(event.currentTarget) });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "上传失败");
      onCreated();
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "上传失败"); }
    finally { setSubmitting(false); }
  };
  return (
    <Modal title="上传新项目" subtitle="选择自己上传，或让能读取项目文件的 AI 整理并直接提交" onClose={onClose} wide>
      <form className="modal-form" onSubmit={submit}>
        <div className="upload-mode-switch" role="tablist" aria-label="上传方式">
          <button type="button" role="tab" aria-selected={uploadMode === "manual"} className={uploadMode === "manual" ? "active" : ""} onClick={() => { setUploadMode("manual"); setFormError(""); }}>手动上传</button>
          <button type="button" role="tab" aria-selected={uploadMode === "ai"} className={uploadMode === "ai" ? "active" : ""} onClick={() => { setUploadMode("ai"); setFormError(""); }}>AI 生成并上传</button>
        </div>
        <section className="upload-spec" aria-labelledby="upload-spec-title">
          <div className="upload-spec-heading"><div><span className="eyebrow">上传规范</span><h3 id="upload-spec-title">准备四类项目材料</h3></div><span>单文件 ≤ 25 MB</span></div>
          <ol>
            <li><b>科研项目中文说明</b><em>必须</em><small>按项目自己的科学逻辑，写成面向同行的研讨会式研究导读，并单独说明创新性。</small></li>
            <li><b>AI 预审摘要</b><em className="optional">可选</em><small>比中文说明更短，包含各维度评分、贡献、风险与审核重点；仅供参考。</small></li>
            <li><b>论文</b><em className="optional">可选</em><small>PDF；没有成稿时可以不上传，禁止为了凑齐材料而编造内容。</small></li>
            <li><b>完整复现包</b><em className="optional">可选</em><small>ZIP、TAR.GZ 或 TGZ；应含 README、代码、环境、数据说明、运行命令和预期输出。</small></li>
          </ol>
          <div className="ai-prompt-box">
            <div>
              <b>{uploadMode === "manual" ? "让 AI 只整理材料" : "让 AI 整理并自动上传"}</b>
              <small>{uploadMode === "manual" ? "提示词只要求生成规范的 output，完成后由你选择文件上传。" : "复制时自动加入六十分钟临时授权；成功上传一次后立即失效。"}</small>
            </div>
            <button type="button" className="secondary-button" disabled={submitting} onClick={copyPrompt}>{submitting ? "正在准备…" : promptCopied ? "已复制" : uploadMode === "manual" ? "复制材料整理提示词" : "复制 AI 上传提示词"}</button>
          </div>
        </section>
        {uploadMode === "manual" ? <>
        <label><span>项目标题 *</span><input name="title" required maxLength={140} placeholder="例如：量子纠缠见证的数值验证" /></label>
        <div className="form-row"><label><span>研究领域 *</span><select name="field" required defaultValue=""><option value="" disabled>选择领域</option>{FIELD_OPTIONS.map((field) => <option key={field}>{field}</option>)}</select></label><label><span>AI 使用情况</span><select name="aiDisclosure" defaultValue="AI 辅助写作与代码"><option>未使用生成式 AI</option><option>AI 辅助写作与代码</option><option>AI 主导生成，人工全面核验</option></select></label></div>
        <label><span>项目摘要（可选）</span><textarea name="summary" rows={3} maxLength={900} placeholder="可简要说明研究问题和目前完成度，也可以留空" /></label>
        <section className="journal-advice-form" aria-labelledby="journal-advice-title">
          <div><b id="journal-advice-title">AI 投稿建议（可选）</b><small>记录 AI 建议的候选期刊和理由，仅供真人判断，不影响上传。</small></div>
          <div className="journal-options" role="group" aria-label="AI 建议的候选期刊">
            {JOURNAL_OPTIONS.map((journal) => (
              <label className="journal-choice" key={journal}>
                <input type="checkbox" name="recommendedJournals" value={journal} />
                <span>{journal}</span>
              </label>
            ))}
          </div>
          <label className="journal-advice-text">
            <span>建议理由或其他期刊</span>
            <textarea name="aiSubmissionAdvice" rows={3} maxLength={1800} placeholder="例如：AI 建议优先考虑 PRD；工作属于专业方向内的方法贡献，PRL 风格突破性不足。可留空。" />
          </label>
        </section>
        <div className="artifact-upload-grid">
          <label className="file-drop required-file"><span className="upload-mark">1</span><b>科研项目中文说明 *</b><small>让审核者快速读懂项目 · 必须上传</small><input name="descriptionFile" type="file" required accept=".md,.txt,.pdf,.docx" /></label>
          <label className="file-drop"><span className="upload-mark">2</span><b>AI 预审摘要</b><small>MD、TXT、PDF 或 DOCX · 可选</small><input name="aiReviewFile" type="file" accept=".md,.txt,.pdf,.docx" /></label>
          <label className="file-drop"><span className="upload-mark">3</span><b>论文</b><small>PDF · 可选</small><input name="paperFile" type="file" accept=".pdf" /></label>
          <label className="file-drop"><span className="upload-mark">4</span><b>完整复现包</b><small>ZIP、TAR.GZ 或 TGZ · 可选</small><input name="reproductionFile" type="file" accept=".zip,.tar.gz,.tgz" /></label>
        </div>
        </> : (
          <section className="ai-upload-note">
            <b>复制后直接交给 AI</b>
            <p>提示词不会在网页上展示，其中已经合并了材料生成规范、项目字段、PaperBee 工具和临时授权。首次使用前，在 ChatGPT 的插件或连接器设置中添加 https://paperbee.asia/mcp；之后 AI 可以把当前对话生成的文件直接交给网站。</p>
            <p>授权从复制时开始计时，有效六十分钟，只能成功上传一个项目，也不能读取或下载站内内容。</p>
          </section>
        )}
        {formError && <p className="form-error">{formError}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>{uploadMode === "manual" ? "取消" : "关闭"}</button>{uploadMode === "manual" && <button className="primary-button" disabled={submitting}>{submitting ? "正在安全上传…" : "提交项目"}</button>}</div>
      </form>
    </Modal>
  );
}

function MaterialsModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const available = new Set(project.artifactKinds.split(",").filter(Boolean));

  return (
    <Modal title="下载项目材料" subtitle={`${project.title} · 下载行为会被记录`} onClose={onClose}>
      <div className="materials-list">
        {PROJECT_MATERIALS.map((material) => {
          const isAvailable = available.has(material.kind) || (material.kind === "description" && !project.artifactKinds);
          const isLocked = isRestrictedReviewMaterial(material.kind) && !project.canAccessReviewMaterials;
          const fileName = project.artifactFiles[material.kind] ?? "";
          return (
            <div className="material-row" key={material.kind}>
              <span className="material-number">{material.number}</span>
              <div><b>{material.label}</b><small>{fileName || material.note}</small></div>
              {isLocked ? (
                <span className="material-locked">仅审稿人可下载</span>
              ) : isAvailable ? (
                <a className="secondary-button" href={`/api/projects/${project.id}/download?kind=${material.kind}`}>下载</a>
              ) : (
                <span className="material-missing">{material.required ? "记录缺失" : "未上传"}</span>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function PreviewModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const available = new Set(project.artifactKinds.split(",").filter(Boolean));
  const firstSelection = PROJECT_MATERIALS.find((material) => {
    const fileName = project.artifactFiles[material.kind] ?? "";
    const isAvailable = available.has(material.kind) || (material.kind === "description" && !project.artifactKinds);
    const isLocked = isRestrictedReviewMaterial(material.kind) && !project.canAccessReviewMaterials;
    return isAvailable && !isLocked && /\.(pdf|md|txt)$/i.test(fileName);
  }) ?? PROJECT_MATERIALS.find((material) => available.has(material.kind) && (!isRestrictedReviewMaterial(material.kind) || project.canAccessReviewMaterials)) ?? PROJECT_MATERIALS[0];
  const [selectedKind, setSelectedKind] = useState<string>(firstSelection.kind);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(() => /\.(md|txt)$/i.test(project.artifactFiles[firstSelection.kind] ?? ""));
  const [previewError, setPreviewError] = useState("");
  const selectedMaterial = PROJECT_MATERIALS.find((material) => material.kind === selectedKind) ?? PROJECT_MATERIALS[0];
  const fileName = project.artifactFiles[selectedMaterial.kind] ?? "";
  const isLocked = isRestrictedReviewMaterial(selectedMaterial.kind) && !project.canAccessReviewMaterials;
  const isAvailable = (available.has(selectedMaterial.kind) || (selectedMaterial.kind === "description" && !project.artifactKinds)) && !isLocked;
  const isPreviewable = /\.(pdf|md|txt)$/i.test(fileName);
  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  const previewUrl = `/api/projects/${project.id}/preview?kind=${encodeURIComponent(selectedMaterial.kind)}`;

  useEffect(() => {
    if (!isAvailable || !isPreviewable || isPdf) return;
    let cancelled = false;
    void fetch(previewUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "无法读取预览内容");
        }
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setPreviewError(caught instanceof Error ? caught.message : "无法读取预览内容");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAvailable, isPdf, isPreviewable, previewUrl]);

  return (
    <Modal title={selectedMaterial.label} subtitle={`${project.title}${fileName ? ` · ${fileName}` : ""}`} onClose={onClose} reader>
      <div className="preview-workspace">
        <aside className="preview-sidebar" aria-label="项目材料">
          <div className="preview-sidebar-heading"><b>项目材料</b><small>点击切换阅读</small></div>
          <nav>
            {PROJECT_MATERIALS.map((material) => {
              const materialFileName = project.artifactFiles[material.kind] ?? "";
              const materialAvailable = available.has(material.kind) || (material.kind === "description" && !project.artifactKinds);
              const materialLocked = isRestrictedReviewMaterial(material.kind) && !project.canAccessReviewMaterials;
              const materialPreviewable = /\.(pdf|md|txt)$/i.test(materialFileName);
              return (
                <button
                  key={material.kind}
                  className={selectedKind === material.kind ? "active" : ""}
                  disabled={!materialAvailable || materialLocked}
                  onClick={() => {
                    setSelectedKind(material.kind);
                    setContent("");
                    setPreviewError("");
                    setLoading(/\.(md|txt)$/i.test(materialFileName));
                  }}
                  aria-current={selectedKind === material.kind ? "page" : undefined}
                >
                  <span>{material.number}</span>
                  <span><b>{material.label}</b><small>{materialLocked ? "仅审稿人可查看" : !materialAvailable ? "未上传" : materialPreviewable ? materialFileName : "不支持在线预览"}</small></span>
                </button>
              );
            })}
          </nav>
        </aside>
        <main className="preview-shell">
          {isLocked ? (
            <div className="preview-state restricted"><b>该材料已锁定</b><p>论文和完整复现包仅限当前审稿人、上传者及管理员查看。</p></div>
          ) : !isAvailable ? (
            <div className="preview-state"><b>该材料尚未上传</b></div>
          ) : !isPreviewable ? (
            <div className="preview-state unsupported">
              <span className="archive-mark">ZIP</span>
              <b>{selectedMaterial.label}不支持在线预览</b>
              <p>压缩包和 DOCX 需要下载后使用本地工具打开。</p>
              <a className="secondary-button" href={`/api/projects/${project.id}/download?kind=${selectedMaterial.kind}`}>下载{selectedMaterial.label}</a>
            </div>
          ) : isPdf ? (
            <iframe className="pdf-preview" src={previewUrl} title={`${selectedMaterial.label} PDF 预览`} />
          ) : loading ? (
            <div className="preview-state">正在排版文档…</div>
          ) : previewError ? (
            <div className="preview-state error"><b>无法预览</b><p>{previewError}</p></div>
          ) : (
            <article className="markdown-preview">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeSanitize, rehypeKatex]}
                components={{
                  a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
                  img: ({ alt }) => <span className="blocked-image">[外部图片未自动加载：{alt || "未命名图片"}]</span>,
                }}
              >
                {normalizeMarkdownForPreview(content)}
              </ReactMarkdown>
            </article>
          )}
        </main>
      </div>
    </Modal>
  );
}

function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [submitting, setSubmitting] = useState(false); const [formError, setFormError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setFormError(""); const values = Object.fromEntries(new FormData(event.currentTarget)); try { const response = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "邀请失败"); onInvited(); } catch (caught) { setFormError(caught instanceof Error ? caught.message : "邀请失败"); } finally { setSubmitting(false); } };
  return <Modal title="创建成员账号" subtitle="请通过安全渠道把初始密码告知对方" onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-row"><label><span>姓名 *</span><input name="name" required /></label><label><span>邮箱 *</span><input name="email" type="email" required /></label></div><label><span>初始密码 *</span><input name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="至少 12 个字符" /></label><div className="form-row"><label><span>角色</span><select name="role" defaultValue="reviewer"><option value="member">成员</option><option value="reviewer">审核者</option><option value="admin">管理员</option></select></label><label><span>研究方向</span><input name="researchField" placeholder="例如：量子信息" /></label></div>{formError && <p className="form-error">{formError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={submitting}>{submitting ? "正在创建…" : "创建账号"}</button></div></form></Modal>;
}

function buildAiGenerateAndUploadPrompt(token: string) {
  return `${UPLOAD_AI_PROMPT}

生成上述材料后，请继续上传到我的内部科研审核网站。不要只告诉我如何操作，也不要使用 curl。先调用已经连接的 PaperBee 工具 check_paperbee_connection；连接正常后，把当前对话中真实存在的项目文件作为 materials 文件数组，直接调用 upload_research_project。不要调用 prepare_research_upload，不要等待或尝试打开文件选择面板，也不要把 File Library 文件 ID、文件名字符串或 sandbox 路径冒充文件对象。PaperBee MCP 地址是 https://paperbee.asia/mcp 。临时授权从现在起六十分钟内有效，并会在首次成功上传后立即失效。

调用工具时，把下面的临时授权作为 uploadToken 提交：
${token}

必填文字字段：
- title：项目标题
- field：研究领域，必须从以下选一项：${FIELD_OPTIONS.join("、")}

可选文字字段：
- summary：项目摘要，最多 900 字
- aiDisclosure：未使用生成式 AI / AI 辅助写作与代码 / AI 主导生成，人工全面核验
- recommendedJournals：可重复提交，候选值包括 PRL、PRD、PRC、PRA、PRX、EPJC、CPC、JHEP
- aiSubmissionAdvice：AI 投稿建议，最多 1800 字

PaperBee 会按文件名自动识别各文件用途：
- 项目中文说明.md、项目中文说明(4).md、中文物理导读.md 等 → 科研项目中文说明（必需；接受 MD、TXT、PDF、DOCX）
- AI预审摘要.md → AI 预审摘要（可选）
- 论文.pdf、paper.pdf 或 manuscript.pdf → 论文（可选）
- 完整复现包.zip、reproduction.zip 等 → 完整复现包（可选；ZIP、TAR.GZ 或 TGZ）

每个文件不超过 25 MB，最多四个。只上传真实存在的文件，不要为了补齐可选材料而生成空文件。如果当前只有包含上述材料的 output.zip，可以原样解压，确认其中真实文件后再把解压出的文件对象传给 upload_research_project；不要把整个 output.zip 冒充完整复现包。不要自行读取文件并转成 Base64，也不要把 sandbox 路径当成公网网址。

如果当前会话找不到 check_paperbee_connection 或 upload_research_project 工具，或者连接检查无法返回服务版本，不要退回 curl、浏览器表单、文件选择面板或直接传 File Library ID，也不要声称上传成功；请明确告诉我需要刷新 https://paperbee.asia/mcp 插件并新开对话，然后重新复制一次提示词以取得新授权。如果直接上传被 OpenAI 文件安全检查拦截，或者当前文件无法解析成受控文件对象，只重试一次；仍失败就停止并请我把四个文件或 output.zip 附加到当前对话，不要重新生成科研内容。工具返回失败时，读取 structuredContent 中的 errorCode 和 error：TOKEN_EXPIRED 表示需要重新复制提示词，TOKEN_REVOKED 表示授权已使用或撤销，TOKEN_INVALID 表示授权无效；不要猜测或伪造新授权。不要在输出、日志或聊天总结中打印上传密钥，也不要把它写入项目文件。

上传成功后告诉我项目标题、已上传的文件、跳过的可选文件和 projectId。`;
}

function PasswordModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.password !== values.confirmPassword) {
      setFormError("两次输入的密码不一致");
      setSubmitting(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "密码修改失败");
      onChanged();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "密码修改失败");
    } finally {
      setSubmitting(false);
    }
  };
  return <Modal title="修改密码" subtitle="保存后会退出此账号在其他设备上的登录" onClose={onClose}><form className="modal-form" onSubmit={submit}><label><span>新密码 *</span><input name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="至少 12 个字符" /></label><label><span>再次输入 *</span><input name="confirmPassword" type="password" required minLength={12} autoComplete="new-password" /></label>{formError && <p className="form-error">{formError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={submitting}>{submitting ? "正在更新…" : "保存新密码"}</button></div></form></Modal>;
}

function AssignModal({ project, members, onClose, onAssigned }: { project: Project; members: Member[]; onClose: () => void; onAssigned: () => void }) {
  const [submitting, setSubmitting] = useState(false); const [formError, setFormError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setFormError(""); const values = Object.fromEntries(new FormData(event.currentTarget)); try { const response = await fetch(`/api/projects/${project.id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "分配失败"); onAssigned(); } catch (caught) { setFormError(caught instanceof Error ? caught.message : "分配失败"); } finally { setSubmitting(false); } };
  return <Modal title="指定审稿人" subtitle={project.title} onClose={onClose}><form className="modal-form" onSubmit={submit}><label><span>审稿人 *</span><select name="reviewerMemberId" required defaultValue=""><option value="" disabled>选择成员</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.researchField}</option>)}</select></label><label><span>审核范围 *</span><textarea name="scope" required rows={4} defaultValue={project.reviewScope} /></label><label><span>截止日期</span><input name="dueDate" type="date" /></label>{formError && <p className="form-error">{formError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={submitting}>{submitting ? "正在指定…" : "确认指定"}</button></div></form></Modal>;
}

function ReviewModal({ assignment, onClose, onSubmitted }: { assignment: Assignment; onClose: () => void; onSubmitted: () => void }) {
  const [submitting, setSubmitting] = useState(false); const [formError, setFormError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setFormError(""); const values = { assignmentId: assignment.id, ...Object.fromEntries(new FormData(event.currentTarget)) }; try { const response = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "提交失败"); onSubmitted(); } catch (caught) { setFormError(caught instanceof Error ? caught.message : "提交失败"); } finally { setSubmitting(false); } };
  return <Modal title="提交审核报告" subtitle={assignment.projectTitle} onClose={onClose} wide><form className="modal-form" onSubmit={submit}><div className="scope-box"><span>本次审核范围</span><p>{assignment.scope}</p></div><div className="form-row"><label><span>审核结论 *</span><select name="verdict" required defaultValue=""><option value="" disabled>选择结论</option><option>建议通过</option><option>小修后通过</option><option>需要重大修改</option><option>暂不建议继续</option></select></label><label><span>正确性检查 *</span><select name="correctness" required defaultValue=""><option value="" disabled>选择结果</option><option>范围内未发现实质问题</option><option>存在可修正问题</option><option>存在重大问题</option><option>未能完成检查</option></select></label></div><div className="form-row"><label><span>复现性 *</span><select name="reproducibility" required defaultValue=""><option value="" disabled>选择结果</option><option>完整复现</option><option>部分复现</option><option>无法复现</option><option>不在审核范围</option></select></label><label><span>数据与伦理 *</span><select name="dataAndEthics" required defaultValue=""><option value="" disabled>选择结果</option><option>范围内未发现风险</option><option>需要补充来源说明</option><option>存在敏感或合规风险</option><option>不在审核范围</option></select></label></div><label><span>审核摘要 *</span><textarea name="summary" required rows={3} placeholder="概括采用的方法、完成的检查和总体判断" /></label><label><span>主要问题</span><textarea name="majorIssues" rows={3} placeholder="逐条说明会影响结论的问题；没有可填写“无”" /></label><label><span>次要问题</span><textarea name="minorIssues" rows={2} placeholder="格式、表述、补充检查等建议" /></label>{formError && <p className="form-error">{formError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>保存后再说</button><button className="primary-button" disabled={submitting}>{submitting ? "正在归档…" : "提交并归档"}</button></div></form></Modal>;
}

function Modal({ title, subtitle, onClose, children, wide = false, reader = false }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; wide?: boolean; reader?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className={`modal ${wide ? "modal-wide" : ""} ${reader ? "modal-reader" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button onClick={onClose} aria-label="关闭">×</button></div>{children}</section></div>;
}

function MetricCard({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) { return <article className={`metric-card metric-${tone}`}><div><span>{label}</span><b>{value}</b></div><p><i />{note}</p><span className="metric-shape" /></article>; }
function Status({ status }: { status: string }) { return <span className={`status ${STATUS_CLASS[status] ?? (status === "已完成" ? "status-green" : "status-neutral")}`}><i />{status}</span>; }
function EmptyProjects({ onNewProject }: { onNewProject: () => void }) { return <div className="empty-state embedded"><span className="empty-document">＋</span><h2>还没有内部项目</h2><p>上传第一个固定版本，然后为它分配清晰的审核范围。</p><button className="secondary-button" onClick={onNewProject}>上传第一个项目</button></div>; }
function LoadingState() { return <div className="loading-grid"><span /><span /><span /><span /><div /></div>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="panel empty-state"><span className="error-mark">!</span><h2>工作台暂时无法载入</h2><p>{message}</p><button className="secondary-button" onClick={retry}>重试</button></div>; }
async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }
function initials(name: string) { const clean = name.trim(); if (!clean) return "PB"; const parts = clean.split(/\s+/); return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : clean.slice(0, 2).toUpperCase(); }
function shortName(name: string) { return name.length > 6 ? name.slice(0, 4) : name; }
function roleLabel(role: string) { return role === "admin" ? "空间管理员" : role === "reviewer" ? "审核成员" : "研究成员"; }
function artifactKindLabel(kind: string) { return kind === "description" ? "中文说明" : kind === "ai-review" ? "AI 预审" : kind === "paper" ? "论文" : kind === "reproduction" ? "复现包" : kind; }
function auditActionLabel(action: string, kind: string | null, fileName: string | null) {
  const material = kind ? artifactKindLabel(kind) : "";
  const suffix = fileName ? ` · ${fileName}` : "";
  if (action === "download") return `下载${material ? ` ${material}` : ""}${suffix}`;
  if (action === "list_projects") return "列出可访问项目";
  if (action === "get_project") return "读取项目详情";
  if (action === "read_resource") return `读取受保护资源${material ? ` · ${material}` : ""}${suffix}`;
  return `读取材料${material ? ` · ${material}` : ""}${suffix}`;
}
function beijingGreeting(value = new Date()) { const hourPart = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Shanghai" }).formatToParts(value).find((part) => part.type === "hour"); const hour = Number(hourPart?.value ?? 12); if (hour < 5) return "夜深了"; if (hour < 11) return "早上好"; if (hour < 13) return "中午好"; if (hour < 18) return "下午好"; return "晚上好"; }
function normalizeDatabaseDate(value: string) { return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value; }
function formatDate(value: string, full = false) { const date = new Date(normalizeDatabaseDate(value)); if (Number.isNaN(date.valueOf())) return value; return new Intl.DateTimeFormat("zh-CN", full ? { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Shanghai" } : { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(date); }
function formatDateTime(value: string) { const date = new Date(normalizeDatabaseDate(value)); if (Number.isNaN(date.valueOf())) return value; return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Shanghai" }).format(date); }
