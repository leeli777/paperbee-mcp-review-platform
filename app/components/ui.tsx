"use client";

const STATUS_CLASS: Record<string, string> = {
  待分配: "status-amber",
  审核中: "status-blue",
  待修改: "status-coral",
  已通过: "status-green",
  已暂停: "status-neutral",
};

export function Modal({ title, subtitle, onClose, children, wide = false, reader = false }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; wide?: boolean; reader?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className={`modal ${wide ? "modal-wide" : ""} ${reader ? "modal-reader" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button onClick={onClose} aria-label="关闭">×</button></div>{children}</section></div>;
}


export function MetricCard({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) { return <article className={`metric-card metric-${tone}`}><div><span>{label}</span><b>{value}</b></div><p><i />{note}</p><span className="metric-shape" /></article>; }

export function Status({ status }: { status: string }) { return <span className={`status ${STATUS_CLASS[status] ?? (status === "已完成" ? "status-green" : "status-neutral")}`}><i />{status}</span>; }

export function EmptyProjects({ onNewProject }: { onNewProject: () => void }) { return <div className="empty-state embedded"><span className="empty-document">＋</span><h2>暂无项目</h2><p>上传项目保存到自己的空间，需要同行审稿时再设为成员可见。</p><button className="secondary-button" onClick={onNewProject}>上传第一个项目</button></div>; }

export function LoadingState() { return <div className="loading-grid"><span /><span /><span /><span /><div /></div>; }

export function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="panel empty-state"><span className="error-mark">!</span><h2>工作台暂时无法载入</h2><p>{message}</p><button className="secondary-button" onClick={retry}>重试</button></div>; }
