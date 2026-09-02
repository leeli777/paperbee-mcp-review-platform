import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { runtimeSchemaStatements } from "./runtime-schema";
import { generateProjectCode } from "@/lib/project-codes";

let schemaReady: Promise<void> | null = null;

export async function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB`.",
    );
  }

  schemaReady ??= (async () => {
    await env.DB.batch(
      runtimeSchemaStatements.map((statement) => env.DB.prepare(statement)),
    );
    const memberColumns = await env.DB
      .prepare("PRAGMA table_info(members)")
      .all<{ name: string }>();
    if (!memberColumns.results.some((column) => column.name === "password_hash")) {
      await env.DB.prepare("ALTER TABLE members ADD password_hash text").run();
    }
    if (!memberColumns.results.some((column) => column.name === "oauth_credential_version")) {
      await env.DB.prepare("ALTER TABLE members ADD oauth_credential_version integer DEFAULT 0 NOT NULL").run();
    }
    const versionColumns = await env.DB
      .prepare("PRAGMA table_info(project_versions)")
      .all<{ name: string }>();
    if (!versionColumns.results.some((column) => column.name === "artifact_kind")) {
      await env.DB.prepare(
        "ALTER TABLE project_versions ADD artifact_kind text DEFAULT 'description' NOT NULL",
      ).run();
    }
    const projectColumns = await env.DB
      .prepare("PRAGMA table_info(projects)")
      .all<{ name: string }>();
    if (!projectColumns.results.some((column) => column.name === "public_code")) {
      await env.DB.prepare("ALTER TABLE projects ADD public_code text").run();
    }
    if (!projectColumns.results.some((column) => column.name === "recommended_journals")) {
      await env.DB.prepare(
        "ALTER TABLE projects ADD recommended_journals text DEFAULT '' NOT NULL",
      ).run();
    }
    if (!projectColumns.results.some((column) => column.name === "ai_submission_advice")) {
      await env.DB.prepare(
        "ALTER TABLE projects ADD ai_submission_advice text DEFAULT '' NOT NULL",
      ).run();
    }
    const codeColumns = await env.DB.prepare("PRAGMA table_info(oauth_authorization_codes)").all<{ name: string }>();
    if (!codeColumns.results.some((column) => column.name === "credential_version")) {
      await env.DB.prepare("ALTER TABLE oauth_authorization_codes ADD credential_version integer DEFAULT 0 NOT NULL").run();
    }
    const auditColumns = await env.DB.prepare("PRAGMA table_info(ai_access_logs)").all<{ name: string }>();
    for (const column of ["project_code_snapshot", "project_title_snapshot", "file_name_snapshot"]) {
      if (!auditColumns.results.some((entry) => entry.name === column)) {
        await env.DB.prepare(`ALTER TABLE ai_access_logs ADD ${column} text`).run();
      }
    }
    await env.DB.prepare(`
      INSERT OR IGNORE INTO oauth_token_families
        (id, member_id, client_id, credential_version, revoked_at, created_at)
      SELECT t.family_id, t.member_id, t.client_id, m.oauth_credential_version,
        max(t.revoked_at), min(t.created_at)
      FROM oauth_tokens t
      JOIN members m ON m.id = t.member_id
      GROUP BY t.family_id, t.member_id, t.client_id, m.oauth_credential_version
    `).run();
    await backfillProjectCodes(env.DB);
    await env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_public_code ON projects(public_code)",
    ).run();
    const assignmentIndexes = await env.DB
      .prepare("PRAGMA index_list(assignments)")
      .all<{ name: string; unique: number }>();
    const legacyAssignmentIndex = assignmentIndexes.results.find(
      (index) => index.name === "idx_assignments_project_reviewer",
    );
    if (legacyAssignmentIndex?.unique) {
      await env.DB.batch([
        env.DB.prepare("DROP INDEX idx_assignments_project_reviewer"),
        env.DB.prepare(
          "CREATE INDEX idx_assignments_project_reviewer ON assignments(project_id, reviewer_member_id)",
        ),
      ]);
    }
    await env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_project_active ON assignments(project_id) WHERE status IN ('待接受', '待审核')",
    ).run();
    await env.DB.batch([
      env.DB.prepare("DROP INDEX IF EXISTS idx_versions_project_number"),
      env.DB.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_project_number_kind ON project_versions(project_id, version_number, artifact_kind)",
      ),
    ]);
  })();
  await schemaReady;

  return drizzle(env.DB, { schema });
}

export async function backfillProjectCodes(db: D1Database) {
  const rows = await db
    .prepare("SELECT id, public_code FROM projects")
    .all<{ id: string; public_code: string | null }>();
  const used = new Set(rows.results.flatMap((row) => row.public_code ? [row.public_code] : []));
  for (const row of rows.results) {
    if (row.public_code) continue;
    let code = generateProjectCode();
    while (used.has(code)) code = generateProjectCode();
    await db.prepare("UPDATE projects SET public_code = ? WHERE id = ? AND public_code IS NULL")
      .bind(code, row.id)
      .run();
    used.add(code);
  }
}
