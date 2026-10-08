import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projectTags, tagLikes } from "@/db/schema";
import { errorResponse, requireActiveMember } from "@/lib/auth";

import { resolveProjectAccess } from "@/lib/project-access";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await requireActiveMember();
    const { id: tagId } = await params;
    const db = await getDb();
    const [tag] = await db
      .select({ id: projectTags.id, projectId: projectTags.projectId })
      .from(projectTags)
      .where(eq(projectTags.id, tagId))
      .limit(1);
    if (!tag) return Response.json({ error: "标签不存在" }, { status: 404 });

    await resolveProjectAccess(member, tag.projectId);

    const [existing] = await db
      .select({ id: tagLikes.id })
      .from(tagLikes)
      .where(and(eq(tagLikes.tagId, tagId), eq(tagLikes.memberId, member.id)))
      .limit(1);

    if (existing) {
      await db.delete(tagLikes).where(eq(tagLikes.id, existing.id));
      return Response.json({ liked: false });
    }

    await db.insert(tagLikes).values({
      id: crypto.randomUUID(),
      tagId,
      memberId: member.id,
    });
    return Response.json({ liked: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
