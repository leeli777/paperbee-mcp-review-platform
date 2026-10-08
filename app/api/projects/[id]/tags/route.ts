import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projectTags } from "@/db/schema";
import { errorResponse, requireActiveMember } from "@/lib/auth";
import {
  cleanTagName,
  isValidTagName,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_PROJECT,
  normalizeTagName,
} from "@/lib/tags";

import { resolveProjectAccess } from "@/lib/project-access";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await requireActiveMember();
    const { id: projectId } = await params;
    const payload = (await request.json()) as { name?: unknown };
    const name = cleanTagName(typeof payload.name === "string" ? payload.name : "");

    if (!isValidTagName(name)) {
      return Response.json(
        { error: `标签应为 1–${MAX_TAG_LENGTH} 个字符，且不能包含尖括号` },
        { status: 400 },
      );
    }

    const db = await getDb();
    await resolveProjectAccess(member, projectId);

    const [{ value: tagCount }] = await db
      .select({ value: count() })
      .from(projectTags)
      .where(eq(projectTags.projectId, projectId));
    if (tagCount >= MAX_TAGS_PER_PROJECT) {
      return Response.json(
        { error: `每个项目最多添加 ${MAX_TAGS_PER_PROJECT} 个标签` },
        { status: 409 },
      );
    }

    await db.insert(projectTags).values({
      id: crypto.randomUUID(),
      projectId,
      name,
      normalizedName: normalizeTagName(name),
      createdByMemberId: member.id,
    });

    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "添加标签失败";
    if (message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: "这个项目已经有同名标签" }, { status: 409 });
    }
    return errorResponse(error);
  }
}
