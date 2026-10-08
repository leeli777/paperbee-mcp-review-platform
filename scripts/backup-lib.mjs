import { createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function openSnapshot(sql, path = ":memory:") {
  const db = new DatabaseSync(path);
  try {
    // D1 exports may list children before parents; validate all foreign keys after import.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(sql);
    db.exec("PRAGMA foreign_keys = ON");
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error("Database integrity check failed");
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Database foreign key check failed");
    return db;
  } catch (error) { db.close(); throw error; }
}

function inventory(sql) {
  const db = openSnapshot(sql);
  try {
    return db.prepare("SELECT storage_key AS key, size_bytes AS size FROM project_versions ORDER BY storage_key").all();
  } finally { db.close(); }
}

export async function createBackup(directory, { exportDatabase, readArtifact }) {
  // A fresh private directory keeps partial exports separate from completed snapshots.
  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, "artifacts"), { mode: 0o700 });
  const before = await exportDatabase();
  const rows = inventory(before);
  const artifacts = [];
  for (const row of rows) {
    const bytes = await readArtifact(row.key);
    if (!bytes || bytes.length !== row.size) throw new Error("Missing artifact or size mismatch; backup incomplete");
    const file = `artifacts/${hash(row.key)}.bin`;
    await writeFile(join(directory, file), bytes, { mode: 0o600, flag: "wx" });
    artifacts.push({ ...row, file, sha256: hash(bytes) });
  }
  const after = await exportDatabase();
  if (JSON.stringify(inventory(after)) !== JSON.stringify(rows)) throw new Error("Material inventory changed during backup; retry into a new directory");
  await writeFile(join(directory, "database.sql"), after, { mode: 0o600, flag: "wx" });
  const manifest = { version: 1, createdAt: new Date().toISOString(), database: { file: "database.sql", sha256: hash(after) }, artifacts };
  // Manifest is written last: without it, a partial snapshot can never pass verification.
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
  return verifyBackup(directory);
}

export async function verifyBackup(directory) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || manifest.database?.file !== "database.sql" || !Array.isArray(manifest.artifacts)) throw new Error("Invalid backup manifest");
  const sql = await readFile(join(directory, "database.sql"), "utf8");
  if (hash(sql) !== manifest.database.sha256) throw new Error("Database checksum mismatch");
  const expected = inventory(sql);
  if (expected.length !== manifest.artifacts.length) throw new Error("Material inventory mismatch");
  for (const [index, row] of manifest.artifacts.entries()) {
    if (row.key !== expected[index].key || row.size !== expected[index].size || row.file !== `artifacts/${hash(row.key)}.bin`) throw new Error("Invalid material manifest entry");
    const bytes = await readFile(join(directory, row.file));
    if (bytes.length !== row.size || hash(bytes) !== row.sha256) throw new Error("Artifact checksum mismatch");
  }
  return { artifactCount: expected.length, databaseSha256: manifest.database.sha256 };
}

export async function restoreLocal(directory, target) {
  const checked = await verifyBackup(directory);
  // Refuse to overwrite an existing database; this command never writes to Cloudflare.
  const file = await open(target, "wx", 0o600);
  await file.close();
  const db = openSnapshot(await readFile(join(directory, "database.sql"), "utf8"), target);
  db.close();
  return checked;
}
