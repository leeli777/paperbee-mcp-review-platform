import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const enableProductionRoutes = process.env.PAPERBEE_ENABLE_PRODUCTION_ROUTES === "true";

const localBindingConfig = {
  name: "paperbee",
  main: "./worker/index.ts",
  compatibility_date: "2026-08-09",
  compatibility_flags: ["nodejs_compat"],
  workers_dev: false,
  preview_urls: false,
  routes: enableProductionRoutes
    ? [
        { pattern: "paperbee.asia", custom_domain: true },
        { pattern: "widget.paperbee.asia", custom_domain: true },
      ]
    : [],
  d1_databases: [
    {
      binding: "DB",
      database_name: "paperbee-db",
      database_id:
        process.env.CLOUDFLARE_D1_DATABASE_ID ??
        "00000000-0000-0000-0000-000000000000",
    },
  ],
  kv_namespaces: [
    {
      binding: "ARTIFACTS",
      id:
        process.env.CLOUDFLARE_KV_NAMESPACE_ID ??
        "00000000000000000000000000000000",
    },
  ],
  observability: { enabled: true },
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
        persistState: process.env.PAPERBEE_TEST_PERSIST_PATH
          ? { path: process.env.PAPERBEE_TEST_PERSIST_PATH }
          : true,
      }),
    ],
  };
});
