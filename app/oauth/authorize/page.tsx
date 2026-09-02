import { validateAuthorizationRequest } from "@/lib/oauth-auth";

export const dynamic = "force-dynamic";

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(name, value);
  }

  let authorization;
  try {
    authorization = await validateAuthorizationRequest(params);
  } catch {
    authorization = null;
  }
  if (!authorization) {
    return (
      <main className="signin-shell oauth-shell"><section className="signin-card oauth-card"><div className="signin-copy"><span className="eyebrow">无法授权</span><h1>授权请求无效</h1><p>请返回发起连接的应用，移除此连接后重新添加 PaperBee。</p></div></section></main>
    );
  }
  const redirectOrigin = new URL(authorization.redirectUri).origin;
  return (
      <main className="signin-shell oauth-shell">
        <section className="signin-card oauth-card">
          <div className="brand brand-large" aria-label="PaperBee"><span className="bee-mark" aria-hidden="true"><i /><b /></span><span>PaperBee</span></div>
          <div className="signin-copy">
            <span className="eyebrow">安全连接</span>
            <h1>授权外部应用读取 PaperBee</h1>
            <p><b>{authorization.clientName}</b> 请求代表你的成员账号读取当前有权访问的项目与材料。</p>
            <p><small>回调域名：<b>{redirectOrigin}</b> · 此客户端名称未经 PaperBee 验证</small></p>
          </div>
          <form className="signin-form" action="/oauth/authorize/decision" method="post">
            {["client_id", "redirect_uri", "resource", "scope", "state", "code_challenge", "code_challenge_method", "response_type"].map((name) => (
              <input key={name} type="hidden" name={name} value={params.get(name) ?? ""} />
            ))}
            <div className="oauth-permission"><b>允许的操作</b><p>列出项目、读取项目详情，并按照 PaperBee 当前权限规则读取材料。</p><small>项目编号只用于定位；PaperBee 会在每次读取时重新检查权限。</small></div>
            <label><span>PaperBee 邮箱</span><input name="email" type="email" required autoComplete="email" /></label>
            <label><span>密码</span><input name="password" type="password" required autoComplete="current-password" /></label>
            <div className="oauth-actions">
              <button className="secondary-button" name="decision" value="deny">拒绝</button>
              <button className="primary-button" name="decision" value="approve">登录并授权</button>
            </div>
          </form>
        </section>
      </main>
  );
}
