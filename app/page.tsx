import type { Metadata } from "next";
import { getSiteIdentity, isSetupRequired } from "@/lib/auth";
import { AuthGate } from "./auth-gate";
import { PaperBeeApp } from "./paperbee-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PaperBee · 内部科研审核工作台",
  description: "面向课题组与学院的私有科研项目审核、复现与版本协作空间。",
};

export default async function Home() {
  const identity = await getSiteIdentity();

  if (!identity) {
    const setupRequired = await isSetupRequired();
    return (
      <main className="signin-shell">
        <section className="signin-card">
          <div className="brand brand-large" aria-label="PaperBee">
            <span className="bee-mark" aria-hidden="true">
              <i />
              <b />
            </span>
            <span>PaperBee</span>
          </div>
          <div className="signin-copy">
            <span className="eyebrow">内部科研审核工作台</span>
            <h1>让每个结论，在提交前经得起复现与追问。</h1>
            <p>
              项目、版本、审核任务与报告集中留痕。只有管理员创建的成员账号可以访问和下载研究材料。
            </p>
          </div>
          <AuthGate setupRequired={setupRequired} />
        </section>
        <div className="signin-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="paper-stack">
            <span />
            <span />
            <span />
          </div>
        </div>
      </main>
    );
  }

  return <PaperBeeApp identity={identity} />;
}
