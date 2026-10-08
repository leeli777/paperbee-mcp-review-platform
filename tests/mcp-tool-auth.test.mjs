import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const nextHeadersStub = fileURLToPath(new URL("./stubs/next-headers.mjs", import.meta.url));
const cloudflareWorkersStub = fileURLToPath(new URL("./stubs/cloudflare-workers.mjs", import.meta.url));
let vite;
let post;

before(async () => {
  vite = await createServer({
    configFile: false,
    root: projectRoot,
    logLevel: "silent",
    resolve: {
      alias: [
        { find: "@", replacement: projectRoot },
        { find: "next/headers", replacement: nextHeadersStub },
        { find: "cloudflare:workers", replacement: cloudflareWorkersStub },
      ],
    },
    server: { middlewareMode: true },
    appType: "custom",
  });
  ({ POST: post } = await vite.ssrLoadModule("/app/mcp/route.ts"));
});

after(async () => {
  await vite?.close();
});

test("declares upload-token tools as anonymous and project reads as OAuth", async () => {
  const response = await post(new Request("https://paperbee.asia/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }));
  assert.equal(response.status, 200);

  const payload = await response.json();
  const tools = Object.fromEntries(payload.result.tools.map((tool) => [tool.name, tool]));
  const noauth = [{ type: "noauth" }];
  const oauth = [{ type: "oauth2", scopes: ["paperbee:read"] }];

  for (const name of ["check_paperbee_connection", "upload_research_project"]) {
    assert.deepEqual(tools[name].securitySchemes, noauth);
    assert.deepEqual(tools[name]._meta.securitySchemes, noauth);
  }
  for (const name of ["list_accessible_projects", "get_project", "read_project_material"]) {
    assert.deepEqual(tools[name].securitySchemes, oauth);
    assert.deepEqual(tools[name]._meta.securitySchemes, oauth);
  }
});

test("revision discovery requires OAuth and upload accepts an explicit existing project", async () => {
  const response = await post(new Request("https://paperbee.asia/mcp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  }));
  const payload = await response.json();
  const tools = Object.fromEntries(payload.result.tools.map(tool => [tool.name, tool]));
  assert.deepEqual(tools.find_my_research_works?.securitySchemes, [{ type: "oauth2", scopes: ["paperbee:read"] }]);
  assert.equal(tools.upload_research_project.inputSchema.properties.targetProjectId.type, "string");
  assert.equal(tools.upload_research_project.inputSchema.properties.versionLabel.maxLength, 60);
  const denied = await post(new Request("https://paperbee.asia/mcp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "find_my_research_works", arguments: {} } }),
  }));
  assert.equal((await denied.json()).result.isError, true);
});
