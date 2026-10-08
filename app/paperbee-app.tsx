"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { SiteIdentity } from "@/lib/auth";
import { normalizeMarkdownForPreview } from "@/lib/markdown-preview";
import { canClaimProject } from "@/lib/project-access-policy";
import { PROJECT_FIELDS } from "@/lib/project-fields";
import { isSiteOwner } from "@/lib/site-owner";
import type { Member, Project, ProjectTag, Assignment, DownloadLog, BootstrapData, View } from "./components/types";
import { WorkVersions } from "./components/work-versions";
import { ProjectVisibility, EditProjectModal, ProjectModal } from "./components/project-forms";
import { Modal, MetricCard, Status, EmptyProjects, LoadingState, ErrorState } from "./components/ui";

const PROJECT_MATERIALS = [
  { number: "1", kind: "description", label: "科研项目中文说明", note: "项目概览、证据、限制与审核重点", required: true },
  { number: "2", kind: "ai-review", label: "AI 预审摘要", note: "评分与风险提示；建议形成初步判断后再查看", required: false },
  { number: "3", kind: "paper", label: "论文", note: "作者提交的论文 PDF", required: false },
  { number: "4", kind: "reproduction", label: "完整复现包", note: "代码、环境、数据说明与运行步骤", required: false },
] as const;

function isRestrictedReviewMaterial(kind: string) {
  return kind === "paper" || kind === "reproduction";
}

async function fetchBootstrapData(query = "", signal?: AbortSignal) {
  const response = await fetch(`/api/bootstrap?${query}`, { cache: "no-store", signal });
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
export function PaperBeeApp({ identity }: { identity: SiteIdentity }) {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<Project | null>(null);
  const [extraProjects, setExtraProjects] = useState<Project[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [assignProject, setAssignProject] = useState<Project | null>(null);
  const [materialProject, setMaterialProject] = useState<Project | null>(null);
  const [previewProject, setPreviewProject] = useState<Project | null>(null);
  const [detailProjectId, setDetailProjectId] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [reviewAssignment, setReviewAssignment] = useState<Assignment | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loadedQuery, setLoadedQuery] = useState("");
  const requestSequence = useRef(0);
  const [fieldFilter, setFieldFilter] = useState("全部领域");
  const [downloadLogs, setDownloadLogs] = useState<DownloadLog[]>([]);
  const [downloadLogLimit, setDownloadLogLimit] = useState(200);
  const [downloadLogsLoading, setDownloadLogsLoading] = useState(false);
  const [downloadLogsError, setDownloadLogsError] = useState("");
  const [projectActionId, setProjectActionId] = useState("");
  const [socialActionKey, setSocialActionKey] = useState("");

  const queryString = useMemo(() => {
    const isList = view === "projects" || view === "space";
    return new URLSearchParams({
      scope: view === "space" ? "mine" : view === "projects" ? "shared" : "all",
      page: String(isList ? page : 1),
      q: isList ? debouncedSearch : "",
      field: isList && fieldFilter !== "全部领域" ? fieldFilter : "",
    }).toString();
  }, [view, page, debouncedSearch, fieldFilter]);

  const queryLoading = loadedQuery !== queryString;
  const currentQuery = useRef(queryString);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadData = useCallback(async () => {
    const query = currentQuery.current;
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const payload = await fetchBootstrapData(query);
      if (sequence !== requestSequence.current) return;
      setData(payload);
      setLoadedQuery(query);
      setError("");
    } catch (caught) {
      if (sequence === requestSequence.current) setError(caught instanceof Error ? caught.message : "无法读取工作台数据");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  const reloadDataSilently = useCallback(async () => {
    const query = currentQuery.current;
    const sequence = ++requestSequence.current;
    try {
      const payload = await fetchBootstrapData(query);
      if (sequence !== requestSequence.current) return;
      setData(payload);
      setLoadedQuery(query);
      setError("");
    } catch (caught) {
      if (sequence === requestSequence.current) setError(caught instanceof Error ? caught.message : "无法刷新工作台数据");
      throw caught;
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    currentQuery.current = queryString;
    let cancelled = false;
    const controller = new AbortController();
    const sequence = ++requestSequence.current;

    void fetchBootstrapData(queryString, controller.signal)
      .then((payload) => {
        if (cancelled || sequence !== requestSequence.current) return;
        setData(payload);
        setError("");
      })
      .catch((caught: unknown) => {
        if (cancelled || sequence !== requestSequence.current) return;
        setError(caught instanceof Error ? caught.message : "无法读取工作台数据");
      })
      .finally(() => {
        if (!cancelled && sequence === requestSequence.current) { setLoading(false); setLoadedQuery(queryString); }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [queryString]);

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

  const filteredProjects = data?.projects ?? [];

  const visibleAssignments = (data?.assignments ?? []).filter((assignment) => assignment.status !== "已放弃");
  const pendingReviews = visibleAssignments.filter((assignment) => assignment.status !== "已完成");
  const activeMembers = (data?.members ?? []).filter((member) => member.status === "active");
  const detailProject = data?.projects.find((project) => project.id === detailProjectId) ?? extraProjects.find(project => project.id === detailProjectId) ?? null;
  const editProject = data?.projects.find((project) => project.id === editProjectId) ?? extraProjects.find(project => project.id === editProjectId) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const ids = [...new Set([detailProjectId, editProjectId].filter(id => id && !data?.projects.some(project => project.id === id)))];
    if (ids.length) {
      Promise.all(ids.map(id => fetchBootstrapData(new URLSearchParams({ projectId: id }).toString(), controller.signal)))
        .then(results => setExtraProjects(results.flatMap(result => result.projects)))
        .catch(caught => { if (!controller.signal.aborted) { setExtraProjects([]); setDetailProjectId(""); setEditProjectId(""); setNotice(caught instanceof Error ? caught.message : "无法读取该版本"); } });
    }
    return () => controller.abort();
  }, [data, detailProjectId, editProjectId]);

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

  const deleteMember = async (member: Member) => {
    if (!window.confirm(`确定删除成员“${member.name}”吗？已有项目、审核或审计记录的成员只能停用。`)) return;
    try {
      const response = await fetch(`/api/members/${member.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法删除成员");
      await refreshWithNotice("成员已删除");
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "无法删除成员");
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
    { id: "projects", label: "项目池", count: data?.stats.shared },
    { id: "space", label: "我的空间", count: data?.stats.mine },
    { id: "reviews", label: "待我审核", count: pendingReviews.length },
    { id: "members", label: "成员", count: data?.members.length },
    ...(data?.member.role === "admin" ? [{ id: "downloads" as const, label: "访问审计" }] : []),
  ];
  const navigate = (nextView: View) => {
    setPage(1);
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
          {navigation.map((item) => (
            <button
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <span className={`nav-symbol nav-symbol-${({ overview: 0, projects: 1, space: 1, reviews: 2, members: 3, downloads: 4 })[item.id]}`} aria-hidden="true" />
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
              <div><b>{data?.member.name ?? identity.displayName}</b><small>{roleLabel(data?.member.role ?? "member", data?.member.email)}</small></div>
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
                  onNewProject={() => { setUploadTarget(null); setShowProjectForm(true); }}
                  onNavigate={navigate}
                  onDownload={setMaterialProject}
                />
              )}
              {(view === "projects" || view === "space") && (
                <ProjectsView
                  pagination={data.pagination}
                  onPage={setPage}
                  loading={queryLoading}
                  personal={view === "space"}
                  projects={filteredProjects}
                  search={search}
                  fieldFilter={fieldFilter}
                  onSearch={(value) => { setPage(1); setSearch(value); }}
                  onFieldFilter={(value) => { setPage(1); setFieldFilter(value); }}
                  onNewProject={() => { setUploadTarget(null); setShowProjectForm(true); }}
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
                  currentMember={data.member}
                  onInvite={() => setShowInviteForm(true)}
                  onEdit={setEditMember}
                  onDelete={deleteMember}
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
          targetProject={uploadTarget}
          onClose={() => setShowProjectForm(false)}
          onCreated={() => {
            setShowProjectForm(false);
            void refreshWithNotice("项目已安全上传");
          }}
        />
      )}
      {showInviteForm && (
        <InviteModal
          allowAdminRole={Boolean(data && isSiteOwner(data.member.email))}
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
      {editMember && (
        <EditMemberModal
          member={editMember}
          allowAdminRole={Boolean(data && isSiteOwner(data.member.email))}
          onClose={() => setEditMember(null)}
          onSaved={() => {
            setEditMember(null);
            void refreshWithNotice("成员权限已更新");
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
          key={detailProject.id}
          onOpenVersion={setDetailProjectId}
          onUploadVersion={(project) => { setDetailProjectId(""); setUploadTarget(project); setShowProjectForm(true); }}
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
          onVisibilityChanged={loadData}
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
  const underReview = data.stats.underReview;
  const passed = data.stats.passed;
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
        <MetricCard label="全部项目" value={data.stats.accessible} note="你可访问的项目" tone="ink" />
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

function ProjectsView({ pagination, onPage, loading, personal, projects, search, fieldFilter, onSearch, onFieldFilter, onNewProject, onOpenProject, socialActionKey, onLikeProject, onLikeTag }: {
  pagination: BootstrapData["pagination"];
  onPage: (page: number) => void;
  loading: boolean;
  personal: boolean;
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
    <div aria-busy={loading}>
      <section className="page-heading compact">
        <div><span className="eyebrow">项目资料库</span><h1>{personal ? "我的空间" : "项目池"}</h1><p>{personal ? "管理你上传的项目；私有项目仅自己可见，成员可见项目可由他人审稿。" : "浏览成员共享的科研项目，接取他人的项目参与审稿。"}</p></div>
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
                <span className="project-code-inline">{project.publicCode} · {project.visibility === "private" ? "仅自己可见" : "成员可见"}</span>
                <h2>{project.title}</h2>
                <span className="work-version-badge">{project.versionLabel || "未命名版本"} · {project.workVersionCount ?? 1} 个可见版本</span>
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
      <nav className="pagination-controls" aria-label="项目分页">
        <button className="secondary-button" disabled={loading || pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>上一页</button>
        <span role="status">{loading ? "正在加载…" : `第 ${pagination.page} / ${pagination.totalPages} 页 · 共 ${pagination.total} 项工作`}</span>
        <button className="secondary-button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>下一页</button>
      </nav>
    </div>
  );
}

function ProjectDetailModal({ onOpenVersion, onUploadVersion, onVisibilityChanged, project, members, currentMember, projectActionId, socialActionKey, onClose, onPreview, onEdit, onDownload, onAssign, onClaim, onAbandon, onFieldChange, onDelete, onAddTag, onLikeProject, onLikeTag }: {
  project: Project;
  members: Member[];
  currentMember: Member;
  onVisibilityChanged: () => Promise<void>;
  onOpenVersion: (id: string) => void;
  onUploadVersion: (project: Project) => void;
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
        <dl className="project-detail-meta"><div><dt>可见性</dt><dd>{project.visibility === "private" ? "仅自己可见" : "成员可见"}</dd></div><div><dt>作者</dt><dd>{project.ownerName}</dd></div><div><dt>稿件版本</dt><dd>{project.versionLabel || "未命名"} · 文件 v{project.versionNumber ?? 1}</dd></div><div><dt>审核者</dt><dd>{project.activeReviewerName || "未分配"}</dd></div></dl>
        <WorkVersions project={project} isOwner={currentMember.id === project.ownerMemberId} onOpen={onOpenVersion} onUpload={onUploadVersion} onUpdated={onVisibilityChanged} />
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
          {project.ownerMemberId === currentMember.id && <ProjectVisibility project={project} onUpdated={onVisibilityChanged} />}
          {canClaimProject({ hasActiveAssignment: project.hasActiveAssignment, memberId: currentMember.id, ownerMemberId: project.ownerMemberId, visibility: project.visibility }) && (
            <button className="primary-button" disabled={actionPending} onClick={() => onClaim(project)}>
              {actionPending ? "正在接取…" : "接取项目"}
            </button>
          )}
          {project.myActiveAssignmentId && (
            <button className="danger-button" disabled={actionPending} onClick={() => onAbandon(project)}>
              {actionPending ? "处理中…" : "放弃审核"}
            </button>
          )}
          {canManage && project.visibility === "internal" && !project.hasActiveAssignment && members.length > 0 && <button className="text-button" onClick={() => onAssign(project)}>指定审稿人 →</button>}
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

function MembersView({ members, currentMember, onInvite, onEdit, onDelete }: {
  members: Member[];
  currentMember: Member;
  onInvite: () => void;
  onEdit: (member: Member) => void;
  onDelete: (member: Member) => void;
}) {
  const isAdmin = currentMember.role === "admin";
  const currentIsSiteOwner = isSiteOwner(currentMember.email);
  return (
    <>
      <section className="page-heading compact"><div><span className="eyebrow">访问控制</span><h1>成员</h1><p>只有管理员创建的账号才能进入工作区。</p></div>{isAdmin && <button className="primary-button" onClick={onInvite}><span>＋</span>创建成员</button>}</section>
      <div className="panel member-panel">
        <div className="member-table-head"><span>成员</span><span>研究方向</span><span>角色</span><span>状态</span>{isAdmin && <span>操作</span>}</div>
        {members.map((member) => {
          const protectedOwner = isSiteOwner(member.email);
          const protectedAdmin = member.role === "admin" && !currentIsSiteOwner;
          return <div className="member-row" key={member.id}>
            <div className="member-person"><span>{initials(member.name)}</span><div><b>{member.name}</b><small>{member.email}</small></div></div>
            <span>{member.researchField}</span>
            <span>{roleLabel(member.role, member.email)}</span>
            <span className={`member-status ${member.status}`}>{member.status === "active" ? "已加入" : member.status === "invited" ? "待登录" : "已停用"}</span>
            {isAdmin && (protectedOwner || protectedAdmin ? (
              <span className="member-owner-lock">{protectedOwner ? "最高权限 · 受保护" : "仅站点管理员可管理"}</span>
            ) : (
              <div className="member-actions">
                <button className="text-button" onClick={() => onEdit(member)}>编辑权限</button>
                <button className="text-button danger-text" onClick={() => onDelete(member)}>删除成员</button>
              </div>
            ))}
          </div>
        })}
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

function InviteModal({ allowAdminRole, onClose, onInvited }: { allowAdminRole: boolean; onClose: () => void; onInvited: () => void }) {
  const [submitting, setSubmitting] = useState(false); const [formError, setFormError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSubmitting(true); setFormError(""); const values = Object.fromEntries(new FormData(event.currentTarget)); try { const response = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "邀请失败"); onInvited(); } catch (caught) { setFormError(caught instanceof Error ? caught.message : "邀请失败"); } finally { setSubmitting(false); } };
  return <Modal title="创建成员账号" subtitle="请通过安全渠道把初始密码告知对方" onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-row"><label><span>姓名 *</span><input name="name" required /></label><label><span>邮箱 *</span><input name="email" type="email" required /></label></div><label><span>初始密码 *</span><input name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="至少 12 个字符" /></label><div className="form-row"><label><span>角色</span><select name="role" defaultValue="reviewer"><option value="member">成员</option><option value="reviewer">审核者</option>{allowAdminRole && <option value="admin">管理员</option>}</select></label><label><span>研究方向</span><input name="researchField" placeholder="例如：量子信息" /></label></div>{formError && <p className="form-error">{formError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={submitting}>{submitting ? "正在创建…" : "创建账号"}</button></div></form></Modal>;
}

function EditMemberModal({ member, allowAdminRole, onClose, onSaved }: { member: Member; allowAdminRole: boolean; onClose: () => void; onSaved: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(`/api/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法更新成员");
      onSaved();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "无法更新成员");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Modal title="编辑成员权限" subtitle={member.email} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-row">
          <label><span>姓名 *</span><input name="name" required maxLength={120} defaultValue={member.name} /></label>
          <label><span>研究方向</span><input name="researchField" maxLength={120} defaultValue={member.researchField} /></label>
        </div>
        <div className="form-row">
          <label><span>角色</span><select name="role" defaultValue={member.role}><option value="member">研究成员</option><option value="reviewer">审核成员</option>{allowAdminRole && <option value="admin">空间管理员</option>}</select></label>
          <label><span>状态</span><select name="status" defaultValue={member.status}>{member.status === "invited" && <option value="invited">待登录</option>}<option value="active">启用</option><option value="disabled">停用</option></select></label>
        </div>
        <p className="member-security-note">停用后，该成员的网页登录会话、AI 上传授权和 ChatGPT OAuth 连接会立即失效。</p>
        {formError && <p className="form-error">{formError}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={submitting}>{submitting ? "正在保存…" : "保存成员设置"}</button></div>
      </form>
    </Modal>
  );
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







function initials(name: string) { const clean = name.trim(); if (!clean) return "PB"; const parts = clean.split(/\s+/); return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : clean.slice(0, 2).toUpperCase(); }
function shortName(name: string) { return name.length > 6 ? name.slice(0, 4) : name; }
function roleLabel(role: string, email?: string) { return email && isSiteOwner(email) ? "站点管理员" : role === "admin" ? "空间管理员" : role === "reviewer" ? "审核成员" : "研究成员"; }
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

async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }
