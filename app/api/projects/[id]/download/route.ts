import { getDb } from "@/db";
import { downloadLogs } from "@/db/schema";
import { errorResponse, requireActiveMember } from "@/lib/auth";
import { isMaterialKind, requireMaterialAccess } from "@/lib/project-access";
import { getArtifactStore } from "@/lib/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await requireActiveMember();
    const { id } = await params;
    const requestedKind = new URL(request.url).searchParams.get("kind") ?? "description";
    if (!isMaterialKind(requestedKind)) {
      return Response.json({ error: "材料类型无效" }, { status: 400 });
    }
    const { artifact } = await requireMaterialAccess(member, id, requestedKind);
    const object = await getArtifactStore().get(artifact.storageKey);
    if (!object) return Response.json({ error: "项目文件存储记录已丢失" }, { status: 404 });

    await (await getDb()).insert(downloadLogs).values({
      id: crypto.randomUUID(),
      projectId: artifact.projectId,
      versionId: artifact.id,
      memberId: member.id,
    });

    const encoded = encodeURIComponent(artifact.fileName).replace(/'/g, "%27");
    return new Response(object.body, {
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
