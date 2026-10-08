import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createBackup, restoreLocal, verifyBackup } from "./backup-lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [action, input, target] = process.argv.slice(2);
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");

function run(args, binary = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(root, ".wrangler/backup.log") },
    });
    const chunks = [];
    child.stdout.on("data", chunk => chunks.push(chunk));
    // Avoid printing secrets, filenames, or exported data from provider error output.
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolvePromise(binary ? Buffer.concat(chunks) : undefined) : reject(new Error(`Wrangler ${args.slice(0, 2).join(" ")} failed (${code}); inspect the local ignored backup log`)));
  });
}

try {
  if (!input || !["create", "verify", "restore-local"].includes(action)) throw new Error("Usage: node scripts/backup.mjs create|verify <directory> OR restore-local <directory> <new.sqlite>");
  const directory = resolve(input);
  let result;
  if (action === "create") {
    const config = JSON.parse(await readFile(join(root, "dist/server/wrangler.json"), "utf8"));
    const database = config.d1_databases?.find(binding => binding.binding === "DB");
    const artifacts = config.kv_namespaces?.find(binding => binding.binding === "ARTIFACTS");
    if (!database?.database_name || !artifacts?.id) throw new Error("Build first; missing production DB/ARTIFACTS bindings");
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(tmpdir(), "paperbee-export-"));
    try {
      let sequence = 0;
      result = await createBackup(directory, {
        exportDatabase: async () => {
          const output = join(temporary, `${++sequence}.sql`);
          await run(["d1", "export", database.database_name, "--remote", "--output", output]);
          return readFile(output, "utf8");
        },
        readArtifact: key => run(["kv", "key", "get", key, "--namespace-id", artifacts.id, "--remote"], true),
      });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  } else if (action === "verify") result = await verifyBackup(directory);
  else {
    if (!target) throw new Error("Supply a new local SQLite path; existing files are never overwritten");
    result = await restoreLocal(directory, resolve(target));
  }
  console.log(JSON.stringify({ action, ok: true, ...result }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Backup failed");
  process.exitCode = 1;
}
