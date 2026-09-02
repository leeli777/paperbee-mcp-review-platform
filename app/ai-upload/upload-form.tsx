"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { JOURNAL_OPTIONS } from "@/lib/journals";
import { PROJECT_FIELDS } from "@/lib/project-fields";

type UploadResult = {
  projectId?: string;
  ownerName?: string;
  error?: string;
};

export function AiBrowserUpload() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const token = String(data.get("uploadToken") ?? "").trim();
    data.delete("uploadToken");

    try {
      const response = await fetch("/api/external/projects", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: data,
      });
      const payload = (await response.json()) as UploadResult;
      if (!response.ok || !payload.projectId) throw new Error(payload.error ?? "上传失败");
      setResult(payload);
      form.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上传失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="ai-bridge-shell">
      <header className="ai-bridge-header">
        <Link className="brand brand-large" href="/" aria-label="返回 PaperBee">
          <span className="bee-mark" aria-hidden="true"><i /><b /></span>
          <span>PaperBee</span>
        </Link>
        <span>AI 浏览器备用上传</span>
      </header>

      <section className="ai-bridge-card">
        {result?.projectId ? (
          <div className="ai-bridge-success" role="status">
            <span>✓</span>
            <p><b>项目已经上传</b><small>projectId：{result.projectId}</small>{result.ownerName && <small>上传者：{result.ownerName}</small>}</p>
          </div>
        ) : (
          <>
            <div className="ai-bridge-intro">
              <span className="eyebrow">Browser fallback</span>
              <h1>提交已经生成的项目材料</h1>
              <p>此页面用于命令容器无法访问 PaperBee 时，由 AI 的云端浏览器完成上传。必须持有网站生成的单次临时授权。</p>
            </div>

            <form className="ai-bridge-form" onSubmit={submit}>
              <section className="ai-bridge-security">
                <label><span>临时上传授权 *</span><input name="uploadToken" type="password" required autoComplete="off" placeholder="pb_upload_…" /></label>
                <p>授权不会写入网址，也不会随项目文件保存；六十分钟后或首次成功上传后立即失效。</p>
              </section>

              <label><span>项目标题 *</span><input name="title" required maxLength={140} /></label>
              <div className="form-row">
                <label><span>研究领域 *</span><select name="field" required defaultValue=""><option value="" disabled>选择领域</option>{PROJECT_FIELDS.map((field) => <option key={field}>{field}</option>)}</select></label>
                <label><span>AI 使用情况</span><select name="aiDisclosure" defaultValue="AI 辅助写作与代码"><option>未使用生成式 AI</option><option>AI 辅助写作与代码</option><option>AI 主导生成，人工全面核验</option></select></label>
              </div>
              <label><span>项目摘要（可选）</span><textarea name="summary" rows={3} maxLength={900} /></label>

              <section className="journal-advice-form">
                <div><b>AI 投稿建议（可选）</b><small>可以选择一个或多个候选期刊，并填写理由。</small></div>
                <div className="journal-options" role="group" aria-label="AI 建议的候选期刊">
                  {JOURNAL_OPTIONS.map((journal) => <label className="journal-choice" key={journal}><input type="checkbox" name="recommendedJournals" value={journal} /><span>{journal}</span></label>)}
                </div>
                <label className="journal-advice-text"><span>建议理由或其他期刊</span><textarea name="aiSubmissionAdvice" rows={3} maxLength={1800} /></label>
              </section>

              <div className="artifact-upload-grid">
                <label className="file-drop required-file"><span className="upload-mark">1</span><b>科研项目中文说明 *</b><small>MD、TXT、PDF 或 DOCX</small><input name="descriptionFile" type="file" required accept=".md,.txt,.pdf,.docx" /></label>
                <label className="file-drop"><span className="upload-mark">2</span><b>AI 预审摘要</b><small>MD、TXT、PDF 或 DOCX · 可选</small><input name="aiReviewFile" type="file" accept=".md,.txt,.pdf,.docx" /></label>
                <label className="file-drop"><span className="upload-mark">3</span><b>论文</b><small>PDF · 可选</small><input name="paperFile" type="file" accept=".pdf" /></label>
                <label className="file-drop"><span className="upload-mark">4</span><b>完整复现包</b><small>ZIP、TAR.GZ 或 TGZ · 可选</small><input name="reproductionFile" type="file" accept=".zip,.tar.gz,.tgz" /></label>
              </div>

              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button ai-bridge-submit" disabled={submitting}>{submitting ? "正在安全上传…" : "上传项目"}</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
