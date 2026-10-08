import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("admin manages member permissions without breaking identity or history", { timeout: 90_000 }, async (t) => {
  const port = 41_000 + (process.pid % 7_000);
  const base = `http://127.0.0.1:${port}`;
  const persistencePath = await mkdtemp(join(tmpdir(), "paperbee-members-e2e-"));
  const child = spawn(join(root, "node_modules/.bin/vinext"), ["dev", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: root,
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: join(persistencePath, "wrangler.log"),
      MINIFLARE_REGISTRY_PATH: join(persistencePath, "registry"),
      PAPERBEE_TEST_PERSIST_PATH: persistencePath,
      PAPERBEE_TEST_SETUP_TOKEN: "member-management-setup-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-12_000); });
  child.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-12_000); });

  try {
    await waitForServer(`${base}/.well-known/oauth-protected-resource`, child, () => logs);
    const rejectedSetup = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setupToken: "member-management-setup-token",
        name: "Wrong Owner",
        email: `wrong-owner-${process.pid}@test.local`,
        password: "Wrong-owner-pass-12345",
      }),
    });
    assert.equal(rejectedSetup.status, 400);

    const siteOwner = {
      email: "owner@example.com",
      password: "Site-owner-pass-12345",
      name: "FHL",
      role: "admin",
    };
    const siteOwnerSetup = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setupToken: "member-management-setup-token",
        name: siteOwner.name,
        email: siteOwner.email,
        password: siteOwner.password,
      }),
    });
    assert.equal(siteOwnerSetup.status, 201);
    const siteOwnerCookie = siteOwnerSetup.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(siteOwnerCookie);

    const suffix = `${Date.now()}-${process.pid}`;
    const managed = {
      email: `managed-${suffix}@test.local`,
      password: "Managed-pass-12345",
      name: "Managed Member",
      role: "member",
    };
    const disposable = {
      email: `disposable-${suffix}@test.local`,
      password: "Disposable-pass-12345",
      name: "Disposable Member",
      role: "member",
    };
    const raceAdmin = {
      email: `race-admin-${suffix}@test.local`,
      password: "Race-admin-pass-12345",
      name: "Race Admin",
      role: "admin",
    };
    const targetAdmin = {
      email: `target-admin-${suffix}@test.local`,
      password: "Target-admin-pass-12345",
      name: "Target Admin",
      role: "admin",
    };
    await createMember(base, managed, siteOwnerCookie);
    await createMember(base, disposable, siteOwnerCookie);

    const afterCreate = await jsonFetch(`${base}/api/bootstrap`, { headers: { cookie: siteOwnerCookie } });
    const managedId = afterCreate.members.find((member) => member.email === managed.email)?.id;
    const disposableId = afterCreate.members.find((member) => member.email === disposable.email)?.id;
    const siteOwnerRecord = afterCreate.members.find((member) => member.email === siteOwner.email);
    assert.ok(managedId);
    assert.ok(disposableId);
    assert.ok(siteOwnerRecord);
    assert.equal(siteOwnerRecord.role, "admin");
    assert.equal(siteOwnerRecord.status, "active");

    const managedLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(managed),
    });
    assert.equal(managedLogin.status, 200);
    const managedCookie = managedLogin.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(managedCookie);
    await createMember(base, raceAdmin, siteOwnerCookie);
    await createMember(base, targetAdmin, siteOwnerCookie);
    const withRaceAdmin = await jsonFetch(`${base}/api/bootstrap`, { headers: { cookie: siteOwnerCookie } });
    const raceAdminId = withRaceAdmin.members.find((member) => member.email === raceAdmin.email)?.id;
    const targetAdminId = withRaceAdmin.members.find((member) => member.email === targetAdmin.email)?.id;
    assert.ok(raceAdminId);
    assert.ok(targetAdminId);
    const raceAdminLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(raceAdmin),
    });
    const raceAdminCookie = raceAdminLogin.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(raceAdminCookie);

    await t.test("non-admin members cannot change permissions", async () => {
      const response = await fetch(`${base}/api/members/${managedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: managedCookie },
        body: JSON.stringify({ role: "admin" }),
      });
      assert.equal(response.status, 403);
    });

    await t.test("admin can update member profile, role, and status", async () => {
      const response = await fetch(`${base}/api/members/${managedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: raceAdminCookie },
        body: JSON.stringify({
          name: "Updated Researcher",
          researchField: "粒子物理",
          role: "reviewer",
          status: "active",
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      const bootstrap = await jsonFetch(`${base}/api/bootstrap`, { headers: { cookie: raceAdminCookie } });
      const updated = bootstrap.members.find((member) => member.id === managedId);
      assert.equal(updated?.name, "Updated Researcher");
      assert.equal(updated?.researchField, "粒子物理");
      assert.equal(updated?.role, "reviewer");
      assert.equal(updated?.status, "active");
    });

    await t.test("an active account cannot be moved back to the legacy invited state", async () => {
      const response = await fetch(`${base}/api/members/${disposableId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: raceAdminCookie },
        body: JSON.stringify({ status: "invited" }),
      });
      assert.equal(response.status, 400);
    });

    await t.test("only the site owner can manage administrator accounts and grant admin role", async () => {
      const adminCanManageMember = await fetch(`${base}/api/members/${managedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: raceAdminCookie },
        body: JSON.stringify({ researchField: "普通管理员可管理" }),
      });
      assert.equal(adminCanManageMember.status, 200);

      const adminEdit = await fetch(`${base}/api/members/${targetAdminId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: raceAdminCookie },
        body: JSON.stringify({ name: targetAdmin.name }),
      });
      assert.equal(adminEdit.status, 403);

      const adminDelete = await fetch(`${base}/api/members/${targetAdminId}`, {
        method: "DELETE",
        headers: { cookie: raceAdminCookie },
      });
      assert.equal(adminDelete.status, 403);

      const adminPromotion = await fetch(`${base}/api/members/${managedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: raceAdminCookie },
        body: JSON.stringify({ role: "admin" }),
      });
      assert.equal(adminPromotion.status, 403);

      const adminCreation = await fetch(`${base}/api/members`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: raceAdminCookie },
        body: JSON.stringify({
          email: `forbidden-admin-${suffix}@test.local`,
          password: "Forbidden-admin-pass-12345",
          name: "Forbidden Admin",
          role: "admin",
        }),
      });
      assert.equal(adminCreation.status, 403);

      const ownerRecreation = await fetch(`${base}/api/members`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: siteOwnerCookie },
        body: JSON.stringify(siteOwner),
      });
      assert.equal(ownerRecreation.status, 409);

      const ownerEdit = await fetch(`${base}/api/members/${targetAdminId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: siteOwnerCookie },
        body: JSON.stringify({ researchField: "由站点管理员管理" }),
      });
      assert.equal(ownerEdit.status, 200);
      const ownerDelete = await fetch(`${base}/api/members/${targetAdminId}`, {
        method: "DELETE",
        headers: { cookie: siteOwnerCookie },
      });
      assert.equal(ownerDelete.status, 200);
    });

    await t.test("the protected site owner account cannot be changed or deleted", async () => {
      for (const payload of [{ role: "member" }, { status: "disabled" }, { name: "Changed" }]) {
        const changed = await fetch(`${base}/api/members/${siteOwnerRecord.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: siteOwnerCookie },
          body: JSON.stringify(payload),
        });
        assert.equal(changed.status, 409);
      }
      const deleted = await fetch(`${base}/api/members/${siteOwnerRecord.id}`, {
        method: "DELETE",
        headers: { cookie: siteOwnerCookie },
      });
      assert.equal(deleted.status, 409);
    });

    const uploadCredential = await jsonFetch(`${base}/api/upload-tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: managedCookie },
      body: JSON.stringify({ name: "member-management-test" }),
    });
    const clientId = await registerClient(base);
    const oauthPair = await issuePair(base, clientId, managed);
    const pendingAuthorizationCode = await issueAuthorizationCode(base, clientId, managed);

    await t.test("disabling a member invalidates login, upload, and OAuth credentials", async () => {
      const response = await fetch(`${base}/api/members/${managedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: raceAdminCookie },
        body: JSON.stringify({ status: "disabled" }),
      });
      assert.equal(response.status, 200);

      const login = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(managed),
      });
      assert.equal(login.status, 401);

      const mcpRead = await rpcResponse(
        base,
        "tools/call",
        { name: "list_accessible_projects", arguments: {} },
        oauthPair.access_token,
      );
      assert.equal(mcpRead.status, 401);

      const codeExchange = await exchangeAuthorizationCode(base, clientId, pendingAuthorizationCode);
      assert.equal(codeExchange.status, 400);
      assert.deepEqual(await codeExchange.json(), { error: "invalid_grant" });

      const upload = await fetch(`${base}/api/external/projects`, {
        method: "POST",
        headers: { authorization: `Bearer ${uploadCredential.token}` },
        body: new FormData(),
      });
      assert.equal(upload.status, 401);
      assert.match(JSON.stringify(await upload.json()), /撤销|已使用/);
    });

    await jsonFetch(`${base}/api/members/${managedId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: raceAdminCookie },
      body: JSON.stringify({ status: "active" }),
    });
    const relogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(managed),
    });
    const reloginCookie = relogin.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(reloginCookie);

    await t.test("old credentials stay revoked after the member is re-enabled", async () => {
      const oldSession = await fetch(`${base}/api/bootstrap`, { headers: { cookie: managedCookie } });
      assert.equal(oldSession.status, 403);
      const oldUpload = await fetch(`${base}/api/external/projects`, {
        method: "POST",
        headers: { authorization: `Bearer ${uploadCredential.token}` },
        body: new FormData(),
      });
      assert.equal(oldUpload.status, 401);
      const oldAccess = await rpcResponse(
        base,
        "tools/call",
        { name: "list_accessible_projects", arguments: {} },
        oauthPair.access_token,
      );
      assert.equal(oldAccess.status, 401);
      const oldRefresh = await fetch(`${base}/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: oauthPair.refresh_token,
          resource: "https://paperbee.asia/mcp",
        }),
      });
      assert.equal(oldRefresh.status, 400);
      assert.deepEqual(await oldRefresh.json(), { error: "invalid_grant" });
    });
    const projectForm = new FormData();
    projectForm.set("title", `Member history ${suffix}`);
    projectForm.set("field", "量子信息");
    projectForm.set("descriptionFile", new File(["# 成员历史"], "中文说明.md", { type: "text/markdown" }));
    await jsonFetch(`${base}/api/projects`, { method: "POST", headers: { cookie: reloginCookie }, body: projectForm });

    await t.test("members with retained history cannot be hard-deleted", async () => {
      const response = await fetch(`${base}/api/members/${managedId}`, {
        method: "DELETE",
        headers: { cookie: raceAdminCookie },
      });
      assert.equal(response.status, 409);
      assert.match(JSON.stringify(await response.json()), /停用/);
    });

    await t.test("an unused account can be deleted but an admin cannot delete themselves", async () => {
      const selfDelete = await fetch(`${base}/api/members/${raceAdminId}`, {
        method: "DELETE",
        headers: { cookie: raceAdminCookie },
      });
      assert.equal(selfDelete.status, 409);

      const deleted = await fetch(`${base}/api/members/${disposableId}`, {
        method: "DELETE",
        headers: { cookie: raceAdminCookie },
      });
      assert.equal(deleted.status, 200);
      assert.deepEqual(await deleted.json(), { ok: true });
      const bootstrap = await jsonFetch(`${base}/api/bootstrap`, { headers: { cookie: raceAdminCookie } });
      assert.equal(bootstrap.members.some((member) => member.id === disposableId), false);

      const ownerDelete = await fetch(`${base}/api/members/${raceAdminId}`, {
        method: "DELETE",
        headers: { cookie: siteOwnerCookie },
      });
      assert.equal(ownerDelete.status, 200);
    });
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

async function createMember(base, member, cookie) {
  await jsonFetch(`${base}/api/members`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(member),
  });
}

async function registerClient(base) {
  const response = await jsonFetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.71" },
    body: JSON.stringify({
      client_name: "Member management E2E",
      redirect_uris: ["https://chatgpt.com/callback"],
      token_endpoint_auth_method: "none",
    }),
  });
  return response.client_id;
}

async function issuePair(base, clientId, account) {
  const code = await issueAuthorizationCode(base, clientId, account);
  const response = await exchangeAuthorizationCode(base, clientId, code);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function issueAuthorizationCode(base, clientId, account) {
  const decision = await fetch(`${base}/oauth/authorize/decision`, {
    method: "POST",
    headers: { "CF-Connecting-IP": "198.51.100.72" },
    body: new URLSearchParams({
      decision: "approve",
      email: account.email,
      password: account.password,
      client_id: clientId,
      redirect_uri: "https://chatgpt.com/callback",
      resource: "https://paperbee.asia/mcp",
      scope: "paperbee:read",
      state: "member-management",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      response_type: "code",
    }),
    redirect: "manual",
  });
  assert.equal(decision.status, 302);
  const code = new URL(decision.headers.get("location")).searchParams.get("code");
  assert.ok(code);
  return code;
}

function exchangeAuthorizationCode(base, clientId, code) {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  return fetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: "https://chatgpt.com/callback",
      resource: "https://paperbee.asia/mcp",
    }),
  });
}

function rpcResponse(base, method, params, token) {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  return payload;
}
