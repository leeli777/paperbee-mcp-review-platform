declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ARTIFACTS: KVNamespace;
    SETUP_TOKEN?: string;
  }
}
