import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    siteUserId: text("site_user_id"),
    passwordHash: text("password_hash"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("member"),
    researchField: text("research_field").notNull().default("待补充"),
    status: text("status").notNull().default("invited"),
    oauthCredentialVersion: integer("oauth_credential_version").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at"),
  },
  (table) => [
    uniqueIndex("idx_members_email").on(table.email),
    uniqueIndex("idx_members_site_user_id").on(table.siteUserId),
    index("idx_members_status").on(table.status),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_sessions_token_hash").on(table.tokenHash),
    index("idx_sessions_member").on(table.memberId),
    index("idx_sessions_expires").on(table.expiresAt),
  ],
);

export const uploadTokens = sqliteTable(
  "upload_tokens",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: text("last_used_at"),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_upload_tokens_hash").on(table.tokenHash),
    index("idx_upload_tokens_member").on(table.memberId),
    index("idx_upload_tokens_expiry").on(table.expiresAt),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    publicCode: text("public_code"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    field: text("field").notNull(),
    ownerMemberId: text("owner_member_id")
      .notNull()
      .references(() => members.id),
    status: text("status").notNull().default("待分配"),
    reviewScope: text("review_scope").notNull(),
    aiDisclosure: text("ai_disclosure").notNull().default("未使用生成式 AI"),
    recommendedJournals: text("recommended_journals").notNull().default(""),
    aiSubmissionAdvice: text("ai_submission_advice").notNull().default(""),
    visibility: text("visibility").notNull().default("internal"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_projects_public_code").on(table.publicCode),
    index("idx_projects_field_status").on(table.field, table.status),
    index("idx_projects_owner").on(table.ownerMemberId),
  ],
);

export const projectTags = sqliteTable(
  "project_tags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdByMemberId: text("created_by_member_id")
      .notNull()
      .references(() => members.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_project_tags_project_normalized").on(
      table.projectId,
      table.normalizedName,
    ),
    index("idx_project_tags_project").on(table.projectId),
  ],
);

export const projectLikes = sqliteTable(
  "project_likes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_project_likes_project_member").on(table.projectId, table.memberId),
    index("idx_project_likes_project").on(table.projectId),
  ],
);

export const tagLikes = sqliteTable(
  "tag_likes",
  {
    id: text("id").primaryKey(),
    tagId: text("tag_id")
      .notNull()
      .references(() => projectTags.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_tag_likes_tag_member").on(table.tagId, table.memberId),
    index("idx_tag_likes_tag").on(table.tagId),
  ],
);

export const projectVersions = sqliteTable(
  "project_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    versionNumber: integer("version_number").notNull().default(1),
    artifactKind: text("artifact_kind").notNull().default("description"),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByMemberId: text("uploaded_by_member_id")
      .notNull()
      .references(() => members.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_versions_project_number_kind").on(
      table.projectId,
      table.versionNumber,
      table.artifactKind,
    ),
    index("idx_versions_project_created").on(table.projectId, table.createdAt),
  ],
);

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    reviewerMemberId: text("reviewer_member_id")
      .notNull()
      .references(() => members.id),
    assignedByMemberId: text("assigned_by_member_id")
      .notNull()
      .references(() => members.id),
    scope: text("scope").notNull(),
    dueDate: text("due_date"),
    status: text("status").notNull().default("待接受"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_assignments_project_reviewer").on(table.projectId, table.reviewerMemberId),
    uniqueIndex("idx_assignments_project_active")
      .on(table.projectId)
      .where(sql`${table.status} IN ('待接受', '待审核')`),
    index("idx_assignments_reviewer_status").on(table.reviewerMemberId, table.status),
  ],
);

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id")
    .notNull()
    .unique()
    .references(() => assignments.id),
  verdict: text("verdict").notNull(),
  correctness: text("correctness").notNull(),
  reproducibility: text("reproducibility").notNull(),
  dataAndEthics: text("data_and_ethics").notNull(),
  majorIssues: text("major_issues").notNull().default(""),
  minorIssues: text("minor_issues").notNull().default(""),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const downloadLogs = sqliteTable(
  "download_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    versionId: text("version_id")
      .notNull()
      .references(() => projectVersions.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    downloadedAt: text("downloaded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_download_logs_project_time").on(table.projectId, table.downloadedAt)],
);

export const oauthClients = sqliteTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    clientName: text("client_name").notNull(),
    redirectUris: text("redirect_uris").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_oauth_clients_created").on(table.createdAt)],
);

export const oauthAuthorizationCodes = sqliteTable(
  "oauth_authorization_codes",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    memberId: text("member_id").notNull().references(() => members.id),
    clientId: text("client_id").notNull().references(() => oauthClients.id),
    redirectUri: text("redirect_uri").notNull(),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    credentialVersion: integer("credential_version").notNull().default(0),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_oauth_codes_hash").on(table.codeHash),
    index("idx_oauth_codes_expiry").on(table.expiresAt),
    index("idx_oauth_codes_client").on(table.clientId),
  ],
);

export const oauthTokenFamilies = sqliteTable(
  "oauth_token_families",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id),
    clientId: text("client_id").notNull().references(() => oauthClients.id),
    credentialVersion: integer("credential_version").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_oauth_families_member").on(table.memberId),
    index("idx_oauth_families_client").on(table.clientId),
  ],
);

export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull().references(() => oauthTokenFamilies.id),
    tokenHash: text("token_hash").notNull(),
    tokenType: text("token_type").notNull(),
    memberId: text("member_id").notNull().references(() => members.id),
    clientId: text("client_id").notNull().references(() => oauthClients.id),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_oauth_tokens_hash").on(table.tokenHash),
    index("idx_oauth_tokens_expiry").on(table.expiresAt),
    index("idx_oauth_tokens_member").on(table.memberId),
    index("idx_oauth_tokens_family").on(table.familyId),
  ],
);

export const aiAccessLogs = sqliteTable(
  "ai_access_logs",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id),
    projectId: text("project_id").references(() => projects.id),
    versionId: text("version_id").references(() => projectVersions.id),
    channel: text("channel").notNull().default("chatgpt_mcp"),
    action: text("action").notNull(),
    materialKind: text("material_kind"),
    outcome: text("outcome").notNull(),
    denialReason: text("denial_reason"),
    projectCodeSnapshot: text("project_code_snapshot"),
    projectTitleSnapshot: text("project_title_snapshot"),
    fileNameSnapshot: text("file_name_snapshot"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_ai_access_logs_project_time").on(table.projectId, table.createdAt),
    index("idx_ai_access_logs_member_time").on(table.memberId, table.createdAt),
  ],
);

export const oauthRateLimits = sqliteTable(
  "oauth_rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(1),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("idx_oauth_rate_limits_expiry").on(table.expiresAt)],
);
