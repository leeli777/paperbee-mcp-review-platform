import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("paginates and searches projects without leaking another owner’s private space", { timeout: 90_000 }, async () => {
  const port = 36_000 + (process.pid % 3_000);
  const base = `http://127.0.0.1:${port}`;
  const persistencePath = await mkdtemp(join(tmpdir(), "paperbee-pagination-e2e-"));
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
    const owner = { email: `pagination-${process.pid}@test.local`, password: "Pagination-test-password", name: "Pagination owner", role: "member" };
    await jsonFetch(`${base}/api/bootstrap`);
    await createMember(base, owner);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(owner) });
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];
    const ids = [];
    for (let index = 0; index < 27; index++) {
      const form = new FormData();
      form.set("title", `Pagination project ${index}`);
      form.set("field", index === 0 ? "理论物理" : "量子信息");
      form.set("descriptionFile", new File(["Pagination fixture"], "description.md"));
      const created = await jsonFetch(`${base}/api/projects`, { method: "POST", body: form });
      ids.push(created.projectId);
    }
    const secret = new FormData();
    secret.set("title", "Private pagination secret");
    secret.set("field", "量子信息");
    secret.set("visibility", "private");
    secret.set("descriptionFile", new File(["private"], "description.md"));
    const privateProject = await jsonFetch(`${base}/api/projects`, { method: "POST", headers: { cookie }, body: secret });
    const first = await jsonFetch(`${base}/api/bootstrap?scope=shared`);
    assert.equal(first.projects.length, 24);
    assert.equal(first.pagination.total, 27);
    assert.equal(first.pagination.totalPages, 2);
    assert.equal(first.stats.accessible, 27);
    const second = await jsonFetch(`${base}/api/bootstrap?scope=shared&page=2`);
    assert.equal(second.projects.length, 3);
    assert.equal(new Set([...first.projects, ...second.projects].map(p => p.id)).size, 27);
    assert.equal(second.projects.some(p => p.id === privateProject.projectId), false);
    const search = await jsonFetch(`${base}/api/bootstrap?scope=shared&q=Pagination%20project%200`);
    assert.equal(search.pagination.total, 1);
    assert.equal(search.projects[0].id, ids[0]);
    const field = await jsonFetch(`${base}/api/bootstrap?scope=shared&field=${encodeURIComponent("理论物理")}`);
    assert.equal(field.pagination.total, 1);
    await jsonFetch(`${base}/api/projects/${ids[0]}/tags`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "needle-tag" }) });
    assert.equal((await jsonFetch(`${base}/api/bootstrap?q=needle-tag`)).projects[0].id, ids[0]);
    const own = await jsonFetch(`${base}/api/bootstrap?scope=mine`, { headers: { cookie } });
    assert.equal(own.projects.length, 1);
    assert.equal(own.projects[0].id, privateProject.projectId);
    assert.equal(own.stats.mine, 1);
    const hidden = await jsonFetch(`${base}/api/bootstrap?q=Private%20pagination%20secret`);
    assert.equal(hidden.pagination.total, 0);
    assert.equal(hidden.projects.length, 0);
    const overflow = await jsonFetch(`${base}/api/bootstrap?page=999`);
    assert.equal(overflow.pagination.page, 2);
    for (const query of ["page=-1", "page=1.5", "scope=invalid", "field=invalid"]) {
      assert.equal((await fetch(`${base}/api/bootstrap?${query}`)).status, 400);
    }
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

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  return payload;
}
