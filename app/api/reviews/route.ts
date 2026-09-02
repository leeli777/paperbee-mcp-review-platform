import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assignments, projects, reviews } from "@/db/schema";
import { AccessError, errorResponse, requireActiveMember } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const member = await requireActiveMember();
    const payload = (await request.json()) as Record<string, string | undefined>;
    const required = ["assignmentId", "verdict", "correctness", "reproducibility", "dataAndEthics", "summary"];
    if (required.some((key) => !payload[key]?.trim())) {
      return Response.json({ error: "请完成全部必填审核项" }, { status: 400 });
    }

    const db = await getDb();
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.id, payload.assignmentId!),
          eq(assignments.reviewerMemberId, member.id),
        ),
      )
      .limit(1);
    if (!assignment) throw new AccessError("你无权提交此审核任务", 403);

    await db.batch([
      db.insert(reviews).values({
        id: crypto.randomUUID(),
        assignmentId: assignment.id,
        verdict: payload.verdict!,
        correctness: payload.correctness!,
        reproducibility: payload.reproducibility!,
        dataAndEthics: payload.dataAndEthics!,
        majorIssues: payload.majorIssues?.trim() ?? "",
        minorIssues: payload.minorIssues?.trim() ?? "",
        summary: payload.summary!,
      }),
      db
        .update(assignments)
        .set({ status: "已完成", completedAt: new Date().toISOString() })
        .where(eq(assignments.id, assignment.id)),
      db
        .update(projects)
        .set({ status: "待修改", updatedAt: new Date().toISOString() })
        .where(eq(projects.id, assignment.projectId)),
    ]);

    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败";
    if (message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: "此任务已经提交过审核报告" }, { status: 409 });
    }
    return errorResponse(error);
  }
}
