import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { uploadTokens } from "@/db/schema";
import { errorResponse, requireActiveMember } from "@/lib/auth";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await requireActiveMember();
    const { id } = await params;
    const db = await getDb();
    await db
      .update(uploadTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(uploadTokens.id, id), eq(uploadTokens.memberId, member.id)));
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
