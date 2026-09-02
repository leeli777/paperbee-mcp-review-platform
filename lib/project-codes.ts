import { eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { projects } from "@/db/schema";

const PROJECT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateProjectCode() {
  const random = crypto.getRandomValues(new Uint8Array(6));
  let code = "PB-";
  for (const byte of random) code += PROJECT_CODE_ALPHABET[byte % PROJECT_CODE_ALPHABET.length];
  return code;
}

export async function createUniqueProjectCode(db: Awaited<ReturnType<typeof getDb>>) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generateProjectCode();
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.publicCode, code))
      .limit(1);
    if (!existing) return code;
  }
  throw new Error("暂时无法生成项目编号，请重试");
}
