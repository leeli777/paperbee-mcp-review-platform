"use client";

import { FormEvent, useState } from "react";
import { SITE_OWNER_EMAIL } from "@/lib/site-owner";

export function AuthGate({ setupRequired }: { setupRequired: boolean }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));

    try {
      const response = await fetch(setupRequired ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "登录失败");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="signin-form" onSubmit={submit}>
      {setupRequired && (
        <>
          <p className="setup-note">首次使用：创建站点管理员。安装码只在这一步使用。</p>
          <label>
            <span>安装码</span>
            <input name="setupToken" type="password" required autoComplete="one-time-code" />
          </label>
          <label>
            <span>管理员姓名</span>
            <input name="name" required maxLength={80} autoComplete="name" />
          </label>
        </>
      )}
      <label>
        <span>邮箱</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={setupRequired ? SITE_OWNER_EMAIL : undefined}
          readOnly={setupRequired}
        />
      </label>
      <label>
        <span>密码</span>
        <input
          name="password"
          type="password"
          required
          minLength={setupRequired ? 12 : undefined}
          autoComplete={setupRequired ? "new-password" : "current-password"}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button signin-button" disabled={submitting}>
        {submitting ? "正在验证…" : setupRequired ? "创建管理员并进入" : "登录工作区"}
      </button>
      <p className="signin-note">
        {setupRequired ? "请设置至少 12 个字符的密码。" : "账号由 PaperBee 管理员创建。"}
      </p>
    </form>
  );
}
