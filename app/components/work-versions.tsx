"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Project } from "./types";

type WorkVersion = Pick<Project, "id" | "publicCode" | "title" | "workRevision" | "versionLabel" | "revisionSummary" | "visibility" | "status" | "createdAt">;

export function WorkVersions({ project, isOwner, onOpen, onUpload, onUpdated }: {
  project: Project;
  isOwner: boolean;
  onOpen: (id: string) => void;
  onUpload: (project: Project) => void;
  onUpdated: () => Promise<void>;
}) {
  const [versions, setVersions] = useState<WorkVersion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/projects/${project.id}/work-versions`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { error?: string; versions: WorkVersion[] };
        if (!response.ok) throw new Error(payload.error ?? "无法读取版本列表");
        setVersions(payload.versions); setError("");
      }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "无法读取版本列表"); });
    return () => controller.abort();
  }, [project.id, project.updatedAt, refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    if (!fields.targetProjectId) fields.targetProjectId = project.publicCode;
    await mutate("POST", fields);
  }
  async function mutate(method: "POST" | "DELETE", body?: Record<string, FormDataEntryValue>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}/work-versions`, {
        method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "版本归组失败");
      await onUpdated();
      setRefresh(value => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "版本归组失败"); }
    finally { setBusy(false); }
  }
  return <section className="work-versions" aria-label="同一工作的版本">
    <div className="work-versions-heading"><div><b>同一工作的版本</b><small>每版独立保留材料、审稿记录和可见性；只显示你有权查看的版本。</small></div>{isOwner && <button type="button" className="secondary-button" onClick={() => onUpload(project)}>＋ 上传后续版本</button>}</div>
    <ol className="work-version-list">
      {versions.map((version, index) => <li key={version.id} className={version.id === project.id ? "current" : ""}>
        <button type="button" onClick={() => onOpen(version.id)} disabled={version.id === project.id || busy}>
          <b>{version.versionLabel || "未命名版本"}{index === 0 && versions.length > 1 ? " · 最新可见版" : ""}{version.id === project.id ? " · 当前查看" : ""}</b>
          <span>{version.title}</span><small>{version.publicCode} · {version.visibility === "private" ? "仅自己可见" : "成员可见"} · {version.status}</small>
        </button>
        {version.revisionSummary && <p>{version.revisionSummary}</p>}
      </li>)}
    </ol>
    {isOwner && <details><summary>版本管理：命名、归组或拆分</summary>
      <form className="modal-form" onSubmit={save} key={`${project.id}-${project.updatedAt}`}>
        <label><span>本版名称</span><input name="versionLabel" maxLength={60} defaultValue={project.versionLabel} placeholder="例如 v0.2、初稿" /></label>
        <label><span>本版修改说明</span><textarea name="revisionSummary" maxLength={1800} rows={2} defaultValue={project.revisionSummary} /></label>
        <label><span>归入已有工作（可选）</span><input name="targetProjectId" placeholder="同一工作另一篇文章的 PB 编号" /><small>仅移动当前这一版，不改动文件、审稿任务和可见性；留空只保存版本说明。</small></label>
        <label><span>归组后的版本位置</span><select name="position" defaultValue="earlier"><option value="earlier">作为已有工作的早期版本</option><option value="later">作为已有工作的最新版本</option></select></label>
        <div className="work-version-actions"><button className="secondary-button" disabled={busy}>{busy ? "保存中…" : "保存版本归属"}</button>
          {versions.length > 1 && <button type="button" className="text-button" disabled={busy} onClick={() => { if (window.confirm("将当前版本拆为独立工作？材料与审核记录不会删除。")) void mutate("DELETE"); }}>将此版拆为独立工作</button>}</div>
      </form>
    </details>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
