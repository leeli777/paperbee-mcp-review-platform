import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createBackup, verifyBackup, restoreLocal } from "../scripts/backup-lib.mjs";

const sql = `CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');
CREATE TABLE project_versions(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), storage_key TEXT NOT NULL, size_bytes INTEGER NOT NULL);
INSERT INTO project_versions VALUES ('v', 'p', 'projects/p/file', 3);`;

test("backs up binary materials and restores a checked local database", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperbee-backup-test-"));
  try {
    const dir = join(root, "backup");
    await createBackup(dir, { exportDatabase: async () => sql, readArtifact: async () => Buffer.from([0, 255, 10]) });
    assert.equal((await verifyBackup(dir)).artifactCount, 1);
    const target = join(root, "restored.sqlite");
    await restoreLocal(dir, target);
    const db = new DatabaseSync(target);
    assert.equal(db.prepare("SELECT count(*) AS n FROM projects").get().n, 1);
    db.close();
    await assert.rejects(restoreLocal(dir, target), /exist/i);
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    await writeFile(join(dir, manifest.artifacts[0].file), "bad");
    await assert.rejects(verifyBackup(dir), /checksum/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects missing materials and changing inventory without producing a valid backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperbee-backup-test-"));
  try {
    await assert.rejects(createBackup(join(root, "missing"), { exportDatabase: async () => sql, readArtifact: async () => null }), /missing/i);
    let exports = 0;
    await assert.rejects(createBackup(join(root, "changing"), {
      exportDatabase: async () => ++exports === 1 ? sql : sql + "DELETE FROM project_versions;",
      readArtifact: async () => Buffer.from([1, 2, 3]),
    }), /changed/i);
    await assert.rejects(verifyBackup(join(root, "changing")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restores D1 exports whose child tables precede parent tables", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperbee-backup-order-"));
  const dump = `CREATE TABLE project_versions(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), storage_key TEXT NOT NULL, size_bytes INTEGER NOT NULL);
INSERT INTO project_versions VALUES ('v','p','projects/p/file',3);
CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');`;
  try {
    const dir = join(root, "backup");
    await createBackup(dir, { exportDatabase: async () => dump, readArtifact: async () => Buffer.from([1,2,3]) });
    await restoreLocal(dir, join(root, "restored.sqlite"));
    await assert.rejects(createBackup(join(root, "invalid"), { exportDatabase: async () => dump.replace("INSERT INTO projects VALUES ('p');", ""), readArtifact: async () => Buffer.from([1,2,3]) }), /foreign key/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
