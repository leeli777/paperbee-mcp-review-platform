import { errorResponse, requireActiveMember } from "@/lib/auth";
import { isMaterialKind, requireMaterialAccess } from "@/lib/project-access";
import { getArtifactStore } from "@/lib/storage";

const PREVIEWABLE_KINDS = ["description", "paper", "ai-review"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await requireActiveMember();
    const { id } = await params;
    const requestedKind = new URL(request.url).searchParams.get("kind") ?? "description";
    if (!isMaterialKind(requestedKind) || !PREVIEWABLE_KINDS.includes(requestedKind)) {
      return Response.json({ error: "该材料不支持在线预览" }, { status: 400 });
    }
    const { artifact } = await requireMaterialAccess(member, id, requestedKind);
    const lowerName = artifact.fileName.toLowerCase();
    const isPdf = lowerName.endsWith(".pdf");
    const isMarkdown = lowerName.endsWith(".md") || lowerName.endsWith(".txt");
    if (!isPdf && !isMarkdown) {
      return Response.json({ error: "该文件格式暂不支持在线预览，请下载查看" }, { status: 415 });
    }

    const object = await getArtifactStore().get(artifact.storageKey);
    if (!object) return Response.json({ error: "项目文件存储记录已丢失" }, { status: 404 });
    const encoded = encodeURIComponent(artifact.fileName).replace(/'/g, "%27");

    return new Response(object.body, {
      headers: {
        "Content-Type": isPdf ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Length": String(object.size),
        "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
