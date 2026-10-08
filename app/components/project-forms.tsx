"use client";

import { useState, type FormEvent } from "react";
import { JOURNAL_OPTIONS } from "@/lib/journals";
import { PROJECT_FIELDS as FIELD_OPTIONS } from "@/lib/project-fields";
import type { Project } from "./types";
import { Modal } from "./ui";
import { UPLOAD_AI_PROMPT, buildAiGenerateAndUploadPrompt } from "./project-prompts";

export function ProjectVisibility({ project, onUpdated }: { project: Project; onUpdated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div>
    <button className="secondary-button" disabled={busy || (project.visibility === "internal" && project.hasActiveAssignment)} onClick={async () => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility: project.visibility === "private" ? "internal" : "private" }) });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "修改可见性失败");
        await onUpdated();
        setBusy(false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "修改可见性失败");
        setBusy(false);
      }
    }}>{busy ? "保存中…" : project.visibility === "private" ? "设为成员可见" : "设为仅自己可见"}</button>
    {project.hasActiveAssignment && <small>审稿结束后可设为私有</small>}
    {error && <p role="alert">{error}</p>}
  </div>;
}


export function EditProjectModal({ project, deleting, onClose, onDelete, onUpdated }: {
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


export function ProjectModal({ onClose, onCreated, targetProject }: { onClose: () => void; onCreated: () => void; targetProject?: Project | null }) {
  const [targetCode, setTargetCode] = useState(targetProject?.publicCode ?? "");
  const [revisionMode, setRevisionMode] = useState(Boolean(targetProject));
  const [uploadMode, setUploadMode] = useState<"manual" | "ai">("manual");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);
  const copyPrompt = async () => {
    setSubmitting(true);
    setFormError("");
    try {
      if (revisionMode && !targetCode.trim()) throw new Error("请填写已有工作的项目编号");
      let prompt = UPLOAD_AI_PROMPT;
      if (uploadMode === "ai") {
        const response = await fetch("/api/upload-tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "六十分钟 AI 上传" }),
        });
        const payload = (await response.json()) as { token?: string; error?: string };
        if (!response.ok || !payload.token) throw new Error(payload.error ?? "无法生成临时上传授权");
        prompt = buildAiGenerateAndUploadPrompt(payload.token, revisionMode ? targetCode.trim() : "");
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
    <Modal title={revisionMode ? "上传后续版本" : "上传科研工作"} subtitle="新工作独立建项；后续版本保留旧稿并归入同一工作" onClose={onClose} wide>
      <form className="modal-form" onSubmit={submit}>
        <div className="upload-mode-switch" role="tablist" aria-label="上传方式">
          <button type="button" role="tab" aria-selected={uploadMode === "manual"} className={uploadMode === "manual" ? "active" : ""} onClick={() => { setUploadMode("manual"); setFormError(""); }}>手动上传</button>
          <button type="button" role="tab" aria-selected={uploadMode === "ai"} className={uploadMode === "ai" ? "active" : ""} onClick={() => { setUploadMode("ai"); setFormError(""); }}>AI 生成并上传</button>
        </div>
        <label><span>工作归属</span><select value={revisionMode ? "revision" : "new"} onChange={(event) => { setRevisionMode(event.target.value === "revision"); setPromptCopied(false); }}><option value="new">新工作（AI 上传时先核查已有工作）</option><option value="revision">已有工作的后续版本</option></select></label>
        {revisionMode && <label><span>已有项目编号 *</span><input name="targetProjectId" required value={targetCode} onChange={(event) => { setTargetCode(event.target.value); setPromptCopied(false); }} placeholder="PB-XXXXXX" /><small>填写自己工作中任一已有版本的编号。旧版材料与审稿记录会保留。</small></label>}
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
        <label><span>项目标题 *</span><input name="title" required maxLength={140} defaultValue={targetProject?.title} placeholder="例如：量子纠缠见证的数值验证" /></label>
        <label><span>稿件版本名称（可选）</span><input name="versionLabel" maxLength={60} placeholder="例如 v0.3、第二轮修订" /></label>
        {revisionMode && <label><span>本版修改说明</span><textarea name="revisionSummary" maxLength={1800} rows={3} placeholder="相较前一稿的主要变化" /></label>}
        <label><span>项目可见性</span><select name="visibility" defaultValue="private"><option value="private">仅自己可见</option><option value="internal">成员可见，可由他人审稿</option></select><small>私有项目及全部材料仅你可访问；之后可在项目详情中修改。</small></label>
        <div className="form-row"><label><span>研究领域 *</span><select name="field" required defaultValue={targetProject?.field ?? ""}><option value="" disabled>选择领域</option>{FIELD_OPTIONS.map((field) => <option key={field}>{field}</option>)}</select></label><label><span>AI 使用情况</span><select name="aiDisclosure" defaultValue="AI 辅助写作与代码"><option>未使用生成式 AI</option><option>AI 辅助写作与代码</option><option>AI 主导生成，人工全面核验</option></select></label></div>
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
