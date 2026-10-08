import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projectLikes } from "@/db/schema";
import { errorResponse, requireActiveMember } from "@/lib/auth";

import { resolveProjectAccess } from "@/lib/project-access";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await requireActiveMember();
    const { id: projectId } = await params;
    const db = await getDb();
    await resolveProjectAccess(member, projectId);

    const [existing] = await db
      .select({ id: projectLikes.id })
      .from(projectLikes)
      .where(
        and(
          eq(projectLikes.projectId, projectId),
          eq(projectLikes.memberId, member.id),
        ),
      )
      .limit(1);

    if (existing) {
      await db.delete(projectLikes).where(eq(projectLikes.id, existing.id));
      return Response.json({ liked: false });
    }

    await db.insert(projectLikes).values({
      id: crypto.randomUUID(),
      projectId,
      memberId: member.id,
    });
    return Response.json({ liked: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
