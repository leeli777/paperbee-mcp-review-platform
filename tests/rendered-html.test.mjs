import assert from "node:assert/strict";
import { access, readFile as readRawFile, readdir } from "node:fs/promises";
import test from "node:test";

// Source-contract tests follow the extracted components as well as the app shell.
async function readFile(path, encoding) {
  const source = await readRawFile(path, encoding);
  if (!String(path).endsWith("/app/paperbee-app.tsx")) return source;
  const components = await Promise.all(["project-forms.tsx", "project-prompts.ts", "ui.tsx", "types.ts"].map(name => readRawFile(new URL(`../app/components/${name}`, import.meta.url), "utf8")));
  return [source, ...components].join("\n");
}

const projectRoot = new URL("../", import.meta.url);

test("builds the PaperBee private workspace shell", async () => {
  const [page, app, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /getSiteIdentity/);
  assert.match(page, /AuthGate/);
  assert.match(app, /PaperBee/);
  assert.match(app, /私有工作区/);
  assert.match(layout, /内部科研审核工作台/);
  assert.doesNotMatch(`${page}${app}${layout}`, /codex-preview|Your site is taking shape/);
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/client/og.png", import.meta.url));
});

test("keeps downloads behind server authorization", async () => {
  const [downloadRoute, logRoute, storage, hosting, page, packageJson, app] = await Promise.all([
    readFile(new URL("../app/api/projects/[id]/download/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/download-logs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(downloadRoute, /requireActiveMember/);
  assert.match(downloadRoute, /Cache-Control[\s\S]*private, no-store/);
  assert.match(downloadRoute, /downloadLogs/);
  assert.match(logRoute, /member\.role !== "admin"/);
  assert.match(logRoute, /只有管理员可以查看下载记录/);
  assert.match(logRoute, /Cache-Control[\s\S]*private, no-store/);
  assert.match(logRoute, /\.limit\(MAX_LOGS\)/);
  assert.match(app, /data\?\.member\.role === "admin"[\s\S]*下载记录/);
  assert.match(app, /fetch\("\/api\/download-logs"/);
  assert.match(app, /移动端主导航/);
  assert.match(storage, /ARTIFACTS/);
  assert.match(storage, /getWithMetadata/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(page, /getSiteIdentity/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("../public/favicon.svg", import.meta.url)));
  assert.ok(projectRoot);
});

test("keeps password hashing within the Cloudflare Workers PBKDF2 limit", async () => {
  const credentials = await readFile(new URL("../lib/credentials.ts", import.meta.url), "utf8");
  assert.match(credentials, /PASSWORD_ITERATIONS = 100_000/);
  assert.doesNotMatch(credentials, /PASSWORD_ITERATIONS = 120_000/);
});

test("supports password rotation for an authenticated member", async () => {
  const passwordRoute = await readFile(
    new URL("../app/api/auth/password/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(passwordRoute, /requireActiveMember/);
  assert.match(passwordRoute, /hashPassword/);
  assert.match(passwordRoute, /delete\(sessions\)/);
  assert.match(passwordRoute, /sessionCookie/);
});

test("lets administrators edit member permissions and delete unused accounts", async () => {
  const [app, runtimeSchema] = await Promise.all([
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/runtime-schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /编辑权限/);
  assert.match(app, /删除成员/);
  assert.match(app, /method: "PATCH"/);
  assert.match(app, /method: "DELETE"/);
  assert.match(app, /\/api\/members\/\$\{member\.id\}/);
  assert.match(app, /name="role"/);
  assert.match(app, /name="status"/);
  assert.match(app, /defaultValue=\{member\.status\}/);
  assert.match(app, /站点管理员/);
  assert.match(app, /isSiteOwner/);
  assert.match(app, /仅站点管理员可管理/);
  assert.match(app, /allowAdminRole/);
  assert.match(runtimeSchema, /keep_active_admin_on_update/);
  assert.match(runtimeSchema, /keep_active_admin_on_delete/);
});

test("enforces the four-part project upload specification", async () => {
  const [app, projectRoute, projectUpload, downloadRoute, schema] = await Promise.all([
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-upload.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/download/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /项目中文说明\.md/);
  assert.match(app, /中文研讨会式研究导读/);
  assert.match(app, /自由选择章节、顺序和详略/);
  assert.match(app, /必须单独包含一节“创新性说明”/);
  assert.match(app, /主要结果展开，说明这些结果在物理上意味着什么/);
  assert.match(app, /不设置固定字数，以把项目讲清楚为准/);
  assert.match(app, /研究导读，不是 AI 预审报告/);
  assert.doesNotMatch(app, /通常约 1000–2500 个汉字/);
  assert.doesNotMatch(app, /重点讲清：[\s\S]*这个项目研究什么问题；/);
  assert.doesNotMatch(app, /作者与分工/);
  assert.match(app, /复制材料整理提示词/);
  assert.match(app, /descriptionFile[\s\S]*required/);
  assert.match(app, /paperFile/);
  assert.match(app, /reproductionFile/);
  assert.match(app, /aiReviewFile/);
  assert.match(app, /AI 预审，仅供参考/);
  assert.match(app, /理论正确性与严谨性、创新性、科学意义/);
  assert.match(app, /2\. AI预审摘要\.md[\s\S]*3\. 论文\.pdf[\s\S]*4\. 完整复现包\.zip/);
  assert.match(app, /Markdown 排版要求/);
  assert.match(app, /行内公式使用单个美元符号/);
  assert.match(app, /独立公式使用成对的双美元符号/);
  assert.match(app, /通用 LaTeX\/KaTeX 语法/);
  assert.match(app, /不使用原始 HTML/);
  assert.match(projectRoute, /createProjectFromForm/);
  assert.match(projectUpload, /if \(!description\)/);
  assert.match(projectUpload, /artifactKind: artifact\.kind/);
  assert.match(projectUpload, /kind: "ai-review"/);
  assert.match(downloadRoute, /searchParams\.get\("kind"\)/);
  assert.match(downloadRoute, /isMaterialKind/);
  assert.match(schema, /artifactKind/);

  const promptBlock = app.slice(
    app.indexOf("const UPLOAD_AI_PROMPT"),
    app.indexOf("export function buildAiGenerateAndUploadPrompt"),
  );
  assert.doesNotMatch(promptBlock, /PaperBee/);

  const projectModal = app.slice(
    app.indexOf("function ProjectModal"),
    app.indexOf("export const UPLOAD_AI_PROMPT"),
  );
  assert.doesNotMatch(projectModal, /name="reviewScope"/);
  assert.match(projectModal, /项目摘要（可选）/);
  assert.doesNotMatch(projectModal, /<textarea name="summary"[^>]*required/);
  assert.match(projectUpload, /const reviewScope = "审核项目全部内容"/);
  assert.match(projectUpload, /if \(!title \|\| !field\)/);
});

test("uses Beijing time for the dashboard greeting and date", async () => {
  const app = await readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8");
  assert.match(app, /beijingGreeting\(\)/);
  assert.match(app, /timeZone: "Asia\/Shanghai"/);
  assert.match(app, /return "晚上好"/);
});

test("lets uploaders and admins manage project classification and deletion", async () => {
  const [app, projectRoute, projectFields] = await Promise.all([
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-fields.ts", import.meta.url), "utf8"),
  ]);

  assert.match(projectRoute, /export async function PATCH/);
  assert.match(projectRoute, /export async function DELETE/);
  assert.match(projectRoute, /member\.role !== "admin" && project\.ownerMemberId !== member\.id/);
  assert.match(projectRoute, /isProjectField/);
  assert.match(projectRoute, /delete\(reviews\)/);
  assert.match(projectRoute, /delete\(downloadLogs\)/);
  assert.match(projectRoute, /delete\(assignments\)/);
  assert.match(projectRoute, /delete\(projectVersions\)/);
  assert.match(projectRoute, /delete\(tagLikes\)/);
  assert.match(projectRoute, /delete\(projectLikes\)/);
  assert.match(projectRoute, /delete\(projectTags\)/);
  assert.match(projectRoute, /delete\(projects\)/);
  assert.match(projectRoute, /store\.delete\(storageKey\)/);
  assert.match(app, /method: "PATCH"/);
  assert.match(app, /method: "DELETE"/);
  assert.match(app, /window\.confirm/);
  assert.match(app, /删除项目/);
  assert.match(app, /const canManage = currentMember\.role === "admin" \|\| currentMember\.id === project\.ownerMemberId/);
  assert.match(app, /<EditProjectModal[\s\S]*onDelete=\{deleteProject\}/);
  assert.match(app, /function EditProjectModal\([\s\S]*onDelete:[\s\S]*onClick=\{\(\) => onDelete\(project\)\}/);
  assert.match(projectFields, /粒子与核物理/);
});

test("lets project owners edit metadata and publish replacement files as a new version", async () => {
  const [app, projectRoute, downloadRoute] = await Promise.all([
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/download/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /function EditProjectModal/);
  assert.match(app, /编辑项目/);
  assert.match(app, /项目资料按版本保存/);
  assert.match(app, /旧文件及其下载记录不会被覆盖/);
  assert.match(app, /method: "PATCH"[\s\S]*new FormData/);
  assert.match(projectRoute, /requireManageableProject/);
  assert.match(projectRoute, /multipart\/form-data/);
  assert.match(projectRoute, /title,[\s\S]*summary,[\s\S]*field,[\s\S]*aiDisclosure/);
  assert.match(projectRoute, /coalesce\(max\([^)]*versionNumber/);
  assert.match(projectRoute, /versionNumber: nextVersion/);
  assert.match(projectRoute, /insert\(projectVersions\)\.values\(versionRows\)/);
  assert.match(projectRoute, /versionRows\.length \? \{ status: "待修改" \}/);
  assert.match(projectRoute, /Promise\.allSettled\(uploadedKeys\.map/);
  assert.match(downloadRoute, /requireMaterialAccess/);
});

test("supports collaborative tags and one-like-per-member reactions", async () => {
  const [app, bootstrap, tagRoute, projectLikeRoute, tagLikeRoute, schema, migration] = await Promise.all([
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bootstrap/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/tags/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/like/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tags/[id]/like/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_many_stick.sql", import.meta.url), "utf8"),
  ]);

  assert.match(tagRoute, /requireActiveMember/);
  assert.match(tagRoute, /MAX_TAGS_PER_PROJECT/);
  assert.match(tagRoute, /normalizedName: normalizeTagName/);
  assert.match(projectLikeRoute, /eq\(projectLikes\.memberId, member\.id\)/);
  assert.match(projectLikeRoute, /delete\(projectLikes\)/);
  assert.match(tagLikeRoute, /eq\(tagLikes\.memberId, member\.id\)/);
  assert.match(tagLikeRoute, /delete\(tagLikes\)/);
  assert.match(schema, /idx_project_tags_project_normalized/);
  assert.match(schema, /idx_project_likes_project_member/);
  assert.match(schema, /idx_tag_likes_tag_member/);
  assert.match(bootstrap, /likedByMe/);
  assert.match(bootstrap, /tags: \(tagsByProject/);
  assert.match(app, /所有成员均可添加和点赞/);
  assert.match(app, /添加标签，如 QCD、非微扰/);
  assert.match(app, /project\.likedByMe/);
  assert.match(migration, /CREATE TABLE `project_tags`/);
  assert.match(migration, /CREATE TABLE `project_likes`/);
  assert.match(migration, /CREATE TABLE `tag_likes`/);
});

test("keeps project cards concise and moves operational details behind a detail view", async () => {
  const app = await readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8");
  const projectsView = app.slice(
    app.indexOf("function ProjectsView"),
    app.indexOf("function ProjectDetailModal"),
  );
  const detailView = app.slice(
    app.indexOf("function ProjectDetailModal"),
    app.indexOf("function ProjectTagList"),
  );

  assert.match(projectsView, /project\.title/);
  assert.match(projectsView, /project\.field/);
  assert.match(projectsView, /ProjectTagList/);
  assert.match(projectsView, /project\.likeCount/);
  assert.match(projectsView, /compact-journal-advice/);
  assert.match(projectsView, /project\.recommendedJournals/);
  assert.match(projectsView, /project\.aiSubmissionAdvice/);
  assert.match(projectsView, /onOpenProject/);
  assert.doesNotMatch(projectsView, /project\.summary/);
  assert.doesNotMatch(projectsView, /project\.reviewScope/);
  assert.doesNotMatch(projectsView, /project-management/);
  assert.doesNotMatch(projectsView, /下载材料/);
  assert.match(detailView, /project\.summary/);
  assert.match(detailView, /project\.reviewScope/);
  assert.match(detailView, /AI 投稿建议/);
  assert.match(detailView, /project-management/);
  assert.match(detailView, /预览材料/);
  assert.match(detailView, /下载材料/);
});

test("keeps AI submission advice optional during project upload", async () => {
  const [app, projectUpload, schema] = await Promise.all([
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-upload.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /AI 投稿建议（可选）/);
  assert.match(app, /PRL、PRD、PRC、PRA、PRX、EPJC、CPC、JHEP/);
  assert.match(app, /name="recommendedJournals"/);
  assert.match(app, /name="aiSubmissionAdvice"/);
  assert.doesNotMatch(app, /name="aiSubmissionAdvice"[^>]*required/);
  assert.match(projectUpload, /getAll\("recommendedJournals"\)/);
  assert.match(projectUpload, /aiSubmissionAdvice/);
  assert.match(schema, /recommendedJournals/);
  assert.match(schema, /aiSubmissionAdvice/);
});

test("previews authenticated PDF and Markdown materials while keeping download separate", async () => {
  const [app, previewRoute, bootstrap, packageJson, markdownPreview] = await Promise.all([
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/preview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bootstrap/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    import(new URL("../lib/markdown-preview.js", import.meta.url)),
  ]);

  assert.match(previewRoute, /requireActiveMember/);
  assert.match(previewRoute, /requireMaterialAccess/);
  assert.match(previewRoute, /Content-Disposition[\s\S]*inline/);
  assert.match(previewRoute, /Cache-Control[\s\S]*private, no-store/);
  assert.match(previewRoute, /application\/pdf/);
  assert.match(previewRoute, /text\/plain; charset=utf-8/);
  assert.match(bootstrap, /artifactFilesByProject/);
  assert.match(app, /function PreviewModal/);
  assert.match(app, /className="preview-workspace"/);
  assert.match(app, /className="preview-sidebar"/);
  assert.match(app, /点击切换阅读/);
  assert.match(app, /setSelectedKind\(material\.kind\)/);
  assert.match(app, /科研项目中文说明/);
  assert.match(app, /AI 预审摘要/);
  assert.match(app, /完整复现包/);
  assert.match(app, /不支持在线预览/);
  assert.match(app, /<iframe className="pdf-preview"/);
  assert.match(app, /ReactMarkdown/);
  assert.match(app, /remarkGfm/);
  assert.match(app, /remarkMath/);
  assert.match(app, /rehypeSanitize/);
  assert.match(app, /rehypeKatex/);
  assert.match(app, /normalizeMarkdownForPreview\(content\)/);
  assert.match(app, /外部图片未自动加载/);
  assert.doesNotMatch(app, />预览<\/button>/);
  assert.match(packageJson, /"react-markdown"/);
  assert.match(packageJson, /"katex"/);

  const source = [
    "普通的 [参考说明] 不应改变。",
    "",
    String.raw`\[`,
    String.raw`e^+e^-\to\gamma^*\to q\bar q`,
    String.raw`\]`,
    "",
    String.raw`行内写法 \(C_{xz}=C_{zx}\) 也应兼容。`,
    "",
    String.raw`[ C_{yz}=-C_{zy}=-\sqrt{2}\frac{\sin\theta\cos\theta}{1+\cos^2\theta} ]`,
    "",
    "`\\(代码里的公式符号\\)`",
    "",
    "```tex",
    String.raw`\[ fenced_code \]`,
    "```",
  ].join("\n");
  const normalized = markdownPreview.normalizeMarkdownForPreview(source);
  assert.match(normalized, /\$\$[\s\S]*e\^\+e\^-\\to\\gamma\^\*\\to q\\bar q[\s\S]*\$\$/);
  assert.match(normalized, /\$C_\{xz\}=C_\{zx\}\$/);
  assert.match(normalized, /\$\$[\s\S]*C_\{yz\}=-C_\{zy\}=-\\sqrt/);
  assert.match(normalized, /普通的 \[参考说明\] 不应改变/);
  assert.match(normalized, /`\\\(代码里的公式符号\\\)`/);
  assert.match(normalized, /```tex\n\\\[ fenced_code \\\]\n```/);
});

test("supports exclusive project claiming, abandonment, and reviewer-only research materials", async () => {
  const [app, assignmentRoute, downloadRoute, previewRoute, bootstrap, schema, migration, accessService] = await Promise.all([
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/assign/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/download/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/preview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bootstrap/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_clammy_shinko_yamashiro.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-access.ts", import.meta.url), "utf8"),
  ]);

  assert.match(assignmentRoute, /payload\.action === "claim"/);
  assert.match(assignmentRoute, /export async function DELETE/);
  assert.match(assignmentRoute, /canAssignReviewer/);
  assert.match(assignmentRoute, /inArray\(assignments\.status, ACTIVE_ASSIGNMENT_STATUSES\)/);
  assert.match(assignmentRoute, /status: "已放弃"/);
  assert.match(schema, /idx_assignments_project_active/);
  assert.match(migration, /CREATE UNIQUE INDEX `idx_assignments_project_active`/);

  for (const route of [downloadRoute, previewRoute]) {
    assert.match(route, /requireMaterialAccess/);
  }
  assert.match(accessService, /materialDecision/);
  assert.match(accessService, /reviewerMemberId/);
  assert.match(bootstrap, /canAccessReviewMaterials/);
  assert.match(bootstrap, /myActiveAssignmentId/);
  assert.match(app, /canClaimProject/);
  assert.match(app, /接取项目/);
  assert.match(app, /放弃审核/);
  assert.match(app, /仅审稿人可下载/);
  assert.match(app, /仅审稿人可查看/);
  assert.match(app, /中文说明和 AI 预审仍可访问/);
});

test("provides short-lived single-use upload tokens inside the new-project flow", async () => {
  const [app, tokenRoute, revokeRoute, externalRoute, openApiRoute, mcpRoute, tokenAuth, projectRoute, projectUpload, schema, runtimeSchema, migration, viteConfig] = await Promise.all([
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/upload-tokens/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/upload-tokens/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/external/projects/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/external/openapi/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/mcp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/upload-token-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-upload.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/runtime-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_small_cable.sql", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);

  assert.match(tokenRoute, /requireActiveMember/);
  assert.match(tokenRoute, /pb_upload_/);
  assert.match(tokenRoute, /hashSessionToken\(token\)/);
  assert.match(tokenAuth, /UPLOAD_TOKEN_LIFETIME_MINUTES = 60/);
  assert.match(tokenRoute, /MAX_ACTIVE_TOKENS = 5/);
  assert.match(tokenRoute, /member\.role !== "admin"/);
  assert.match(tokenRoute, /private, no-store/);
  assert.match(revokeRoute, /eq\(uploadTokens\.memberId, member\.id\)/);
  assert.match(revokeRoute, /revokedAt/);
  assert.match(tokenAuth, /Authorization/);
  assert.match(tokenAuth, /isNull\(uploadTokens\.revokedAt\)/);
  assert.match(tokenAuth, /TOKEN_EXPIRED/);
  assert.match(tokenAuth, /TOKEN_REVOKED/);
  assert.match(tokenAuth, /ACCOUNT_INACTIVE/);

  assert.match(externalRoute, /requireUploadToken/);
  assert.match(externalRoute, /consumeUploadToken/);
  assert.match(externalRoute, /createProjectFromForm/);
  assert.match(externalRoute, /multipart|formData/);
  assert.match(externalRoute, /Access-Control-Allow-Origin/);
  assert.match(externalRoute, /export async function OPTIONS/);
  assert.match(openApiRoute, /openapi: "3\.1\.0"/);
  assert.match(openApiRoute, /multipart\/form-data/);
  assert.match(openApiRoute, /uploadResearchProject/);
  assert.match(mcpRoute, /upload_research_project/);
  assert.match(mcpRoute, /check_paperbee_connection/);
  assert.match(mcpRoute, /errorCode/);
  assert.match(mcpRoute, /uploadTokenLifetimeMinutes/);
  assert.match(mcpRoute, /uploadMode: "direct_file_params"/);
  assert.match(mcpRoute, /tools: \[CONNECTION_CHECK_TOOL, UPLOAD_TOOL, \.\.\.PROJECT_READ_TOOLS\]/);
  assert.match(mcpRoute, /"openai\/fileParams"/);
  assert.match(mcpRoute, /"openai\/fileParams": \["materials"\]/);
  assert.match(mcpRoute, /materials:[\s\S]*type: "array"/);
  assert.match(mcpRoute, /outputSchema/);
  assert.match(viteConfig, /pattern: "widget\.paperbee\.asia", custom_domain: true/);
  assert.match(mcpRoute, /enum: PROJECT_FIELDS/);
  assert.match(openApiRoute, /enum: PROJECT_FIELDS/);
  assert.match(mcpRoute, /项目中文说明\|中文说明\|物理导读\|研究导读/);
  assert.match(mcpRoute, /download_url/);
  assert.match(mcpRoute, /createProjectFromForm/);
  assert.match(mcpRoute, /consumeUploadToken/);
  assert.match(mcpRoute, /MAX_FILE_SIZE/);
  assert.match(projectRoute, /createProjectFromForm/);
  assert.match(projectUpload, /MAX_FILE_SIZE/);
  assert.match(projectUpload, /MAX_TOTAL_STORAGE/);
  assert.match(schema, /uploadTokens/);
  assert.match(runtimeSchema, /CREATE TABLE IF NOT EXISTS upload_tokens/);
  assert.match(migration, /CREATE TABLE `upload_tokens`/);

  assert.match(app, /手动上传/);
  assert.match(app, /AI 生成并上传/);
  assert.match(app, /复制 AI 上传提示词/);
  assert.match(app, /buildAiGenerateAndUploadPrompt/);
  assert.match(app, /六十分钟临时授权/);
  assert.doesNotMatch(app, /function UploadAccessModal/);
  assert.doesNotMatch(app, /<textarea readOnly value=\{UPLOAD_AI_PROMPT\}/);
  assert.match(app, /https:\/\/paperbee\.asia\/mcp/);
  assert.match(app, /upload_research_project/);
  assert.match(app, /不要调用 prepare_research_upload/);
  assert.match(app, /直接调用 upload_research_project/);
  assert.doesNotMatch(app, /prepare_research_upload 调用成功后会显示一个文件选择面板/);
  assert.match(app, /项目中文说明\(4\)\.md/);
  assert.match(app, /不要把 File Library 文件 ID、文件名字符串或 sandbox 路径冒充文件对象/);
  assert.match(app, /不要使用 curl/);
  assert.match(app, /不要自行读取文件并转成 Base64/);
  assert.match(app, /不要在输出、日志或聊天总结中打印上传密钥/);
});

test("keeps a token-protected manual browser fallback", async () => {
  const [page, form] = await Promise.all([
    readFile(new URL("../app/ai-upload/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ai-upload/upload-form.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AI 浏览器上传/);
  assert.match(form, /name="uploadToken" type="password"/);
  assert.match(form, /data\.delete\("uploadToken"\)/);
  assert.match(form, /Authorization: `Bearer \$\{token\}`/);
  assert.match(form, /\/api\/external\/projects/);
  assert.match(form, /name="descriptionFile"[\s\S]*required/);
  assert.match(form, /projectId/);
  assert.doesNotMatch(form, /searchParams|location\.search|URLSearchParams/);
});

test("persists public project codes, OAuth credentials, and AI access audits", async () => {
  const [schema, runtimeSchema, dbIndex, projectUpload] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/runtime-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-upload.ts", import.meta.url), "utf8"),
  ]);
  const migrationNames = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^000[67]_.*\.sql$/.test(name));

  assert.match(schema, /publicCode: text\("public_code"\)/);
  assert.match(schema, /export const oauthClients/);
  assert.match(schema, /export const oauthAuthorizationCodes/);
  assert.match(schema, /export const oauthTokens/);
  assert.match(schema, /export const oauthTokenFamilies/);
  assert.match(schema, /oauthCredentialVersion/);
  assert.match(schema, /export const aiAccessLogs/);
  assert.match(schema, /tokenHash: text\("token_hash"\)/);
  assert.match(schema, /tokenType: text\("token_type"\)/);
  assert.match(schema, /revokedAt: text\("revoked_at"\)/);
  assert.match(schema, /outcome: text\("outcome"\)/);
  assert.match(runtimeSchema, /CREATE TABLE IF NOT EXISTS oauth_clients/);
  assert.match(runtimeSchema, /CREATE TABLE IF NOT EXISTS oauth_authorization_codes/);
  assert.match(runtimeSchema, /CREATE TABLE IF NOT EXISTS oauth_tokens/);
  assert.match(runtimeSchema, /CREATE TABLE IF NOT EXISTS ai_access_logs/);
  assert.match(dbIndex, /backfillProjectCodes/);
  assert.match(projectUpload, /createUniqueProjectCode/);
  assert.match(projectUpload, /publicCode/);
  assert.equal(migrationNames.length, 2);
});

test("exposes an OAuth 2.1 authorization-code and rotating-refresh flow for MCP reads", async () => {
  const [protectedMetadata, authorizationMetadata, register, authorizePage, decision, token, oauthAuth] = await Promise.all([
    readFile(new URL("../app/.well-known/oauth-protected-resource/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/.well-known/oauth-authorization-server/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/oauth/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/oauth/authorize/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/oauth/authorize/decision/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/oauth/token/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/oauth-auth.ts", import.meta.url), "utf8"),
  ]);

  assert.match(oauthAuth, /MCP_RESOURCE = "https:\/\/paperbee\.asia\/mcp"/);
  assert.match(oauthAuth, /OAUTH_SCOPE = "paperbee:read"/);
  assert.match(protectedMetadata, /resource: MCP_RESOURCE/);
  assert.match(protectedMetadata, /scopes_supported: \[OAUTH_SCOPE\]/);
  assert.match(authorizationMetadata, /oauth\/authorize/);
  assert.match(authorizationMetadata, /oauth\/token/);
  assert.match(authorizationMetadata, /oauth\/register/);
  assert.match(authorizationMetadata, /code_challenge_methods_supported/);
  assert.match(authorizationMetadata, /"S256"/);
  assert.match(authorizationMetadata, /token_endpoint_auth_methods_supported/);
  assert.match(authorizationMetadata, /"none"/);
  assert.doesNotMatch(authorizationMetadata, /authorization_response_iss_parameter_supported:\s*true/);
  assert.match(register, /isAllowedRedirectUri/);
  assert.match(register, /redirectUris: JSON\.stringify/);
  assert.match(authorizePage, /授权外部应用读取 PaperBee/);
  assert.match(authorizePage, /回调域名/);
  assert.match(authorizePage, /未经 PaperBee 验证/);
  assert.match(authorizePage, /name="password"/);
  assert.match(decision, /verifyPassword/);
  assert.match(decision, /oauthAuthorizationCodes/);
  assert.match(decision, /codeChallenge/);
  assert.match(token, /grant_type/);
  assert.match(token, /authorization_code/);
  assert.match(token, /refresh_token/);
  assert.match(token, /verifyPkceS256/);
  assert.match(token, /consumedAt/);
  assert.match(token, /familyId/);
  assert.match(token, /oauthTokenFamilies/);
  assert.match(token, /ACCESS_TOKEN_TTL_SECONDS/);
  assert.match(token, /REFRESH_TOKEN_TTL_SECONDS/);
  assert.match(oauthAuth, /Bearer pb_access_/);
  assert.match(oauthAuth, /eq\(members\.status, "active"\)/);
  assert.match(oauthAuth, /eq\(oauthTokens\.resource, MCP_RESOURCE\)/);
  assert.match(oauthAuth, /WWW-Authenticate/);
  assert.match(oauthAuth, /error_description/);
});

test("serves OAuth-protected project reads through the same material policy as the website", async () => {
  const [mcp, reader, accessService, downloadRoute, previewRoute] = await Promise.all([
    readFile(new URL("../app/mcp/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/mcp-project-reading.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/download/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/preview/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(reader, /list_accessible_projects/);
  assert.match(reader, /get_project/);
  assert.match(reader, /read_project_material/);
  assert.match(reader, /securitySchemes/);
  assert.match(reader, /type: "oauth2"/);
  assert.match(reader, /OAUTH_SCOPE/);
  assert.match(mcp, /resources\/read/);
  assert.match(mcp, /mcp\/www_authenticate/);
  assert.match(mcp, /resources: \{ listChanged: false, subscribe: false \}/);
  assert.match(mcp, /result: \{[\s\S]*isError: true[\s\S]*mcp\/www_authenticate/);
  assert.match(mcp, /tools: \[CONNECTION_CHECK_TOOL, UPLOAD_TOOL, \.\.\.PROJECT_READ_TOOLS\]/);
  assert.match(reader, /requireOAuthMember/);
  assert.match(reader, /paperbee:\/\/projects\//);
  assert.match(reader, /type: "resource_link"/);
  assert.match(reader, /blob: toBase64/);
  assert.match(reader, /aiAccessLogs/);
  assert.match(reader, /outcome: "denied"/);
  assert.match(reader, /outcome: "success"/);
  assert.match(accessService, /normalizeProjectCode/);
  assert.match(accessService, /materialDecision/);
  assert.match(accessService, /MAX_PROJECT_RESULTS = 50/);
  assert.match(downloadRoute, /requireMaterialAccess/);
  assert.match(previewRoute, /requireMaterialAccess/);
});

test("shows public project codes and unifies browser and ChatGPT access auditing", async () => {
  const [bootstrap, auditRoute, projectRoute, passwordRoute, app, readme] = await Promise.all([
    readFile(new URL("../app/api/bootstrap/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/download-logs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/paperbee-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(bootstrap, /publicCode: projects\.publicCode/);
  assert.match(auditRoute, /aiAccessLogs/);
  assert.match(auditRoute, /source: "chatgpt_mcp"/);
  assert.match(auditRoute, /source: "web"/);
  assert.match(auditRoute, /outcome/);
  assert.doesNotMatch(projectRoute, /delete\(aiAccessLogs\)/);
  assert.match(projectRoute, /projectCodeSnapshot/);
  assert.match(projectRoute, /projectId: null/);
  assert.match(passwordRoute, /oauthTokens/);
  assert.match(passwordRoute, /revokedAt/);
  assert.match(app, /publicCode: string/);
  assert.match(app, /navigator\.clipboard\.writeText\(project\.publicCode\)/);
  assert.match(app, /project-code-inline/);
  assert.match(app, /项目编号只用于定位/);
  assert.match(app, /访问审计/);
  assert.match(app, /通过 ChatGPT/);
  assert.match(readme, /OAuth 2\.1/);
  assert.match(readme, /list_accessible_projects/);
  assert.match(readme, /read_project_material/);
  assert.match(readme, /双账号/);
});
