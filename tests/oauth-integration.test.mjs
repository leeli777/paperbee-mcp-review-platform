import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("runs the OAuth, MCP, revocation, isolation, and audit flow against workerd", { timeout: 90_000 }, async () => {
  const port = 32_000 + (process.pid % 8_000);
  const base = `http://127.0.0.1:${port}`;
  const persistencePath = await mkdtemp(join(tmpdir(), "paperbee-oauth-e2e-"));
  const child = spawn(join(root, "node_modules/.bin/vinext"), ["dev", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: root,
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: join(persistencePath, "wrangler.log"),
      MINIFLARE_REGISTRY_PATH: join(persistencePath, "registry"),
      PAPERBEE_TEST_PERSIST_PATH: persistencePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-12_000); });
  child.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-12_000); });

  try {
    await waitForServer(`${base}/.well-known/oauth-protected-resource`, child, () => logs);
    const authorizationMetadata = await jsonFetch(`${base}/.well-known/oauth-authorization-server`);
    assert.equal(authorizationMetadata.client_id_metadata_document_supported, true);
    const cimdAuthorizationUrl = new URL(`${base}/oauth/authorize`);
    cimdAuthorizationUrl.search = new URLSearchParams({
      client_id: "https://chatgpt.com/oauth/client.json",
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      resource: "https://paperbee.asia/mcp",
      scope: "paperbee:read",
      state: "integration-test",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      response_type: "code",
    });
    const cimdAuthorizationPage = await fetch(cimdAuthorizationUrl);
    assert.equal(cimdAuthorizationPage.status, 200);
    assert.match(await cimdAuthorizationPage.text(), /授权外部应用读取 PaperBee/);
    cimdAuthorizationUrl.searchParams.set("client_id", "https://chatgpt.com/oauth/callback_123/client.json");
    cimdAuthorizationUrl.searchParams.set("redirect_uri", "https://chatgpt.com/connector/oauth/callback_123");
    const callbackCimdAuthorizationPage = await fetch(cimdAuthorizationUrl);
    assert.equal(callbackCimdAuthorizationPage.status, 200);
    assert.match(await callbackCimdAuthorizationPage.text(), /授权外部应用读取 PaperBee/);
    const suffix = `${Date.now()}-${process.pid}`;
    const reviewer = { email: `reviewer-${suffix}@test.local`, password: "Reviewer-pass-1234" };
    const ordinary = { email: `member-${suffix}@test.local`, password: "Member-pass-123456" };
    const ip = `198.51.100.${(process.pid % 200) + 1}`;

    const oversizedRegistration = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
      body: streamText("x".repeat(17 * 1024)),
      duplex: "half",
    });
    assert.equal(oversizedRegistration.status, 413);

    await jsonFetch(`${base}/api/bootstrap`);
    await createMember(base, { ...reviewer, name: "Reviewer", role: "reviewer" });
    await createMember(base, { ...ordinary, name: "Member", role: "member" });

    const ownerLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ordinary),
    });
    assert.equal(ownerLogin.status, 200);
    const ownerCookie = ownerLogin.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(ownerCookie);

    const ownerProjectForm = new FormData();
    ownerProjectForm.set("title", `Owner claim integration ${suffix}`);
    ownerProjectForm.set("summary", "Uploader claims their own review task");
    ownerProjectForm.set("field", "量子信息");
    ownerProjectForm.set("descriptionFile", new File(["# 上传者自审测试"], "项目中文说明.md", { type: "text/markdown" }));
    const ownerProject = await jsonFetch(`${base}/api/projects`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: ownerProjectForm,
    });

    const ownerClaim = await fetch(`${base}/api/projects/${ownerProject.projectId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ action: "claim" }),
    });
    assert.equal(ownerClaim.status, 201);
    assert.deepEqual(await ownerClaim.json(), { ok: true });

    const ownerBootstrap = await jsonFetch(`${base}/api/bootstrap`, { headers: { cookie: ownerCookie } });
    const claimedProject = ownerBootstrap.projects.find((entry) => entry.id === ownerProject.projectId);
    assert.equal(claimedProject?.hasActiveAssignment, true);
    assert.ok(claimedProject?.myActiveAssignmentId);

    const duplicateClaim = await fetch(`${base}/api/projects/${ownerProject.projectId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ action: "claim" }),
    });
    assert.equal(duplicateClaim.status, 409);

    const abandonClaim = await fetch(`${base}/api/projects/${ownerProject.projectId}/assign`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });
    assert.equal(abandonClaim.status, 200);

    const adminBootstrap = await jsonFetch(`${base}/api/bootstrap`);
    const ownerMemberId = adminBootstrap.members.find((entry) => entry.email === ordinary.email)?.id;
    assert.ok(ownerMemberId);
    const designateOwner = await fetch(`${base}/api/projects/${ownerProject.projectId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewerMemberId: ownerMemberId, scope: "全部材料" }),
    });
    assert.equal(designateOwner.status, 403);

    await jsonFetch(`${base}/api/projects/${ownerProject.projectId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });

    const cimdPair = await issueCimdPair(base, ordinary, ip);
    assert.match(cimdPair.access_token, /^pb_access_/);
    const bootstrap = await jsonFetch(`${base}/api/bootstrap`);
    const reviewerId = bootstrap.members.find((member) => member.email === reviewer.email)?.id;
    assert.ok(reviewerId);

    const form = new FormData();
    form.set("title", `OAuth integration ${suffix}`);
    form.set("summary", "Automated authorization boundary test");
    form.set("field", "量子信息");
    form.set("descriptionFile", new File(["# 中文说明\n允许内部成员阅读。"], "项目中文说明.md", { type: "text/markdown" }));
    form.set("paperFile", new File(["%PDF-1.4\n%%EOF"], "论文.pdf", { type: "application/pdf" }));
    const project = await jsonFetch(`${base}/api/projects`, { method: "POST", body: form });
    await jsonFetch(`${base}/api/projects/${project.projectId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewerMemberId: reviewerId, scope: "全部材料" }),
    });

    const clientId = await registerClient(base, ip);
    const reviewerPair = await issuePair(base, clientId, reviewer, ip);
    const ordinaryPair = await issuePair(base, clientId, ordinary, ip);
    const reviewerPaper = await callMaterial(base, reviewerPair.access_token, project.projectCode, "paper");
    const ordinaryPaper = await callMaterial(base, ordinaryPair.access_token, project.projectCode, "paper");
    const ordinaryDescription = await callMaterial(base, ordinaryPair.access_token, project.projectCode, "description");
    assert.equal(reviewerPaper.result.isError ?? false, false);
    assert.equal(reviewerPaper.result.structuredContent.delivery, "protected_resource");
    assert.equal(ordinaryPaper.result.isError, true);
    assert.match(ordinaryPaper.result.content[0].text, /无权访问/);
    assert.equal(ordinaryDescription.result.structuredContent.delivery, "inline_text");

    const resource = await rpc(base, "resources/read", { uri: reviewerPaper.result.structuredContent.resourceUri }, reviewerPair.access_token);
    assert.match(resource.result.contents[0].blob, /^[A-Za-z0-9+/]+=*$/);

    const replayPair = await issuePair(base, clientId, reviewer, ip);
    const refreshBody = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: replayPair.refresh_token, resource: "https://paperbee.asia/mcp" });
    const refreshes = await Promise.all([
      fetch(`${base}/oauth/token`, { method: "POST", body: refreshBody }),
      fetch(`${base}/oauth/token`, { method: "POST", body: refreshBody }),
    ]);
    assert.deepEqual(refreshes.map((response) => response.status).sort(), [200, 400]);
    const refreshPayloads = await Promise.all(refreshes.map((response) => response.json()));
    const replayAccess = refreshPayloads.find((payload) => payload.access_token)?.access_token;
    assert.ok(replayAccess);
    assert.equal((await rpcResponse(base, "tools/call", { name: "list_accessible_projects", arguments: {} }, replayAccess)).status, 401);

    const passwordPair = await issuePair(base, clientId, ordinary, ip);
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ordinary),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    await jsonFetch(`${base}/api/auth/password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ password: "Member-pass-Changed-789" }),
    });
    assert.equal((await rpcResponse(base, "tools/call", { name: "list_accessible_projects", arguments: {} }, passwordPair.access_token)).status, 401);

    const challenge = await rpcResponse(base, "tools/call", { name: "list_accessible_projects", arguments: {} });
    const challengeBody = await challenge.json();
    assert.equal(challenge.status, 401);
    assert.equal(challengeBody.result.isError, true);
    assert.match(challengeBody.result._meta["mcp/www_authenticate"][0], /error_description=/);

    await jsonFetch(`${base}/api/projects/${project.projectId}`, { method: "DELETE" });
    const audit = await jsonFetch(`${base}/api/download-logs`);
    assert.ok(audit.logs.some((row) => row.source === "chatgpt_mcp" && row.projectCode === project.projectCode));
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    }
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(persistencePath, { recursive: true, force: true });
  }
});

async function waitForServer(url, child, getLogs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`dev server exited early\n${getLogs()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      if (attempt === 119) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`dev server did not become ready\n${getLogs()}`);
}

async function createMember(base, member) {
  await jsonFetch(`${base}/api/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(member),
  });
}

async function registerClient(base, ip) {
  const registration = await jsonFetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ client_name: "PaperBee automated E2E", redirect_uris: ["https://chatgpt.com/callback"], token_endpoint_auth_method: "none" }),
  });
  return registration.client_id;
}

async function issuePair(base, clientId, account, ip) {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const form = new URLSearchParams({
    decision: "approve", email: account.email, password: account.password,
    client_id: clientId, redirect_uri: "https://chatgpt.com/callback",
    resource: "https://paperbee.asia/mcp", scope: "paperbee:read", state: "e2e",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256", response_type: "code",
  });
  const decision = await fetch(`${base}/oauth/authorize/decision`, { method: "POST", headers: { "CF-Connecting-IP": ip }, body: form, redirect: "manual" });
  assert.equal(decision.status, 302);
  const code = new URL(decision.headers.get("location")).searchParams.get("code");
  assert.ok(code);
  return jsonFetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: "https://chatgpt.com/callback", resource: "https://paperbee.asia/mcp" }),
  });
}

async function issueCimdPair(base, account, ip) {
  const clientId = "https://chatgpt.com/oauth/callback_123/client.json";
  const redirectUri = "https://chatgpt.com/connector/oauth/callback_123";
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const form = new URLSearchParams({
    decision: "approve", email: account.email, password: account.password,
    client_id: clientId, redirect_uri: redirectUri,
    resource: "https://paperbee.asia/mcp", scope: "paperbee:read", state: "cimd-e2e",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256", response_type: "code",
  });
  const decision = await fetch(`${base}/oauth/authorize/decision`, {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
    body: form,
    redirect: "manual",
  });
  assert.equal(decision.status, 302);
  const code = new URL(decision.headers.get("location")).searchParams.get("code");
  assert.ok(code);
  return jsonFetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier,
      redirect_uri: redirectUri, resource: "https://paperbee.asia/mcp",
    }),
  });
}

async function callMaterial(base, token, projectId, material) {
  return rpc(base, "tools/call", { name: "read_project_material", arguments: { projectId, material } }, token);
}

async function rpc(base, method, params, token) {
  const response = await rpcResponse(base, method, params, token);
  const payload = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(payload));
  return payload;
}

function rpcResponse(base, method, params, token) {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

function streamText(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  return payload;
}
