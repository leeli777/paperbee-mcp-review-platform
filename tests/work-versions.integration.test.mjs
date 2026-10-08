import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("groups research revisions, preserves access and materials, and supports explicit upload targeting", { timeout: 120_000 }, async () => {
  const port = 39_000 + (process.pid % 3_000);
  const base = `http://127.0.0.1:${port}`;
  const persistencePath = await mkdtemp(join(tmpdir(), "paperbee-versions-e2e-"));
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
    const admin = await jsonFetch(`${base}/api/bootstrap`);
    const other = { email: `versions-${process.pid}@test.local`, password: "Version-test-password", name: "Other researcher", role: "member" };
    await createMember(base, other);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(other) });
    const otherCookie = login.headers.get("set-cookie").split(";", 1)[0];
    async function upload(title, fields = {}, cookie = "") {
      const form = new FormData();
      form.set("title", title);
      form.set("field", "量子信息");
      form.set("descriptionFile", new File([title], "description.md"));
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      return jsonFetch(`${base}/api/projects`, { method: "POST", headers: { cookie }, body: form });
    }
    const first = await upload("Original research", { visibility: "internal", versionLabel: "v0.1" });
    const second = await upload("Renamed research", { visibility: "internal", targetProjectId: first.projectCode, versionLabel: "v0.2", revisionSummary: "Corrected derivation" });
    assert.equal(second.workId, first.workId);
    assert.equal(second.workRevision, 2);
    let list = await jsonFetch(`${base}/api/bootstrap?scope=shared`);
    assert.equal(list.pagination.total, 1, "list counts works, not uploaded revisions");
    assert.equal(list.projects[0].id, second.projectId);
    assert.equal(list.projects[0].workVersionCount, 2);
    const history = await jsonFetch(`${base}/api/projects/${second.projectId}/work-versions`);
    assert.deepEqual(history.versions.map(p => p.id), [second.projectId, first.projectId]);
    assert.equal(history.versions[0].revisionSummary, "Corrected derivation");
    assert.equal((await jsonFetch(`${base}/api/bootstrap?projectId=${first.projectId}`)).projects[0].id, first.projectId);
    assert.equal((await jsonFetch(`${base}/api/bootstrap?q=Original`)).projects[0].id, second.projectId, "old titles still find work");
    const oldContent = await fetch(`${base}/api/projects/${first.projectId}/download?kind=description`);
    assert.equal(await oldContent.text(), "Original research");

    const privateVersion = await upload("PRIVATE_REVISION_TITLE", { targetProjectId: first.projectId, visibility: "private" });
    const visibleToOther = await jsonFetch(`${base}/api/bootstrap?scope=shared`, { headers: { cookie: otherCookie } });
    assert.equal(visibleToOther.projects[0].id, second.projectId);
    assert.equal(visibleToOther.projects[0].workVersionCount, 2);
    const otherHistory = await jsonFetch(`${base}/api/projects/${first.projectId}/work-versions`, { headers: { cookie: otherCookie } });
    assert.equal(otherHistory.versions.length, 2);
    assert.equal(JSON.stringify(otherHistory).includes("PRIVATE_REVISION_TITLE"), false);
    assert.equal((await fetch(`${base}/api/bootstrap?projectId=${privateVersion.projectId}`, { headers: { cookie: otherCookie } })).status, 404);
    const badForm = new FormData();
    badForm.set("title", "Unauthorized revision"); badForm.set("field", "量子信息");
    badForm.set("descriptionFile", new File(["bad"], "description.md"));
    badForm.set("targetProjectId", first.projectId);
    assert.equal((await fetch(`${base}/api/projects`, { method: "POST", headers: { cookie: otherCookie }, body: badForm })).status, 403);

    const legacy = await upload("Existing separately uploaded manuscript");
    await jsonFetch(`${base}/api/projects/${legacy.projectId}/assign`, { method: "POST", headers: { "content-type": "application/json", cookie: otherCookie }, body: JSON.stringify({ action: "claim" }) });
    const task = (await jsonFetch(`${base}/api/bootstrap`, { headers: { cookie: otherCookie } })).assignments.find(a => a.projectId === legacy.projectId);
    await jsonFetch(`${base}/api/reviews`, { method: "POST", headers: { "content-type": "application/json", cookie: otherCookie }, body: JSON.stringify({ assignmentId: task.id, verdict: "建议通过", correctness: "范围内未发现实质问题", reproducibility: "不在审核范围", dataAndEthics: "不在审核范围", summary: "Preserved report" }) });
    const reportId = (await jsonFetch(`${base}/api/bootstrap`, { headers: { cookie: otherCookie } })).assignments.find(a => a.id === task.id).reviewId;
    const attach = await jsonFetch(`${base}/api/projects/${legacy.projectId}/work-versions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetProjectId: first.projectCode, versionLabel: "v0.0 imported", revisionSummary: "Historical manuscript" }),
    });
    assert.equal(attach.workId, first.workId);
    assert.equal((await jsonFetch(`${base}/api/bootstrap`, { headers: { cookie: otherCookie } })).assignments.find(a => a.id === task.id).reviewId, reportId);
    assert.equal((await jsonFetch(`${base}/api/projects/${first.projectId}/work-versions`)).versions.length, 4);
    await jsonFetch(`${base}/api/projects/${legacy.projectId}/work-versions`, { method: "DELETE" });
    assert.equal((await jsonFetch(`${base}/api/projects/${first.projectId}/work-versions`)).versions.length, 3);
    const forbiddenMerge = await fetch(`${base}/api/projects/${legacy.projectId}/work-versions`, { method: "POST", headers: { "content-type": "application/json", cookie: otherCookie }, body: JSON.stringify({ targetProjectId: first.projectId }) });
    assert.equal(forbiddenMerge.status, 403);
    const newOther = await upload("Different owner", {}, otherCookie);
    assert.equal((await fetch(`${base}/api/projects/${legacy.projectId}/work-versions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetProjectId: newOther.projectId }) })).status, 403);
    await jsonFetch(`${base}/api/projects/${first.projectId}`, { method: "DELETE" });
    assert.equal((await jsonFetch(`${base}/api/projects/${second.projectId}/work-versions`)).versions.length, 2, "deleting original does not orphan remaining revisions");
    const concurrent = await Promise.all([
      upload("Concurrent revision A", { targetProjectId: second.projectId }),
      upload("Concurrent revision B", { targetProjectId: second.projectId }),
    ]);
    assert.notEqual(concurrent[0].workRevision, concurrent[1].workRevision);
    const older = await upload("Imported earliest version");
    await jsonFetch(`${base}/api/projects/${older.projectId}/work-versions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetProjectId: second.projectId, position: "earlier" }) });
    const ordered = await jsonFetch(`${base}/api/projects/${second.projectId}/work-versions`);
    assert.equal(ordered.versions.at(-1).id, older.projectId);
    const minted = await jsonFetch(`${base}/api/upload-tokens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Version test" }) });
    const externalForm = new FormData();
    externalForm.set("title", "External revision"); externalForm.set("field", "量子信息");
    externalForm.set("descriptionFile", new File(["external"], "description.md"));
    externalForm.set("targetProjectId", second.projectCode);
    const external = await jsonFetch(`${base}/api/external/projects`, { method: "POST", headers: { Authorization: `Bearer ${minted.token}` }, body: externalForm });
    assert.equal(external.workId, first.workId);
    assert.equal((await fetch(`${base}/api/external/projects`, { method: "POST", headers: { Authorization: `Bearer ${minted.token}` }, body: externalForm })).status, 401);
    assert.ok(admin.member.id);
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


test("work migration preserves old project identifiers and review references", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY, title TEXT NOT NULL); INSERT INTO projects VALUES ('old-a','Manuscript A'),('old-b','Manuscript B'); CREATE TABLE kept_reviews(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), body TEXT); INSERT INTO kept_reviews VALUES ('review','old-a','Existing report');");
    db.exec(await readFile(join(root, "drizzle/0008_normal_lord_hawal.sql"), "utf8"));
    const old = db.prepare("SELECT * FROM projects WHERE id='old-a'").get();
    assert.equal(old.work_id, null);
    assert.equal(old.work_revision, 1);
    assert.equal(old.title, "Manuscript A");
    assert.equal(db.prepare("SELECT body FROM kept_reviews WHERE project_id='old-a'").get().body, "Existing report");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally { db.close(); }
});
