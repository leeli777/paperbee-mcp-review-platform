import { errorResponse } from "@/lib/auth";
import { createProjectFromForm, ProjectUploadError } from "@/lib/project-upload";
import { consumeUploadToken, requireUploadToken } from "@/lib/upload-token-auth";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const member = await requireUploadToken(request);
    const result = await createProjectFromForm(await request.formData(), member.memberId);
    await consumeUploadToken(member.tokenId);
    return withCors(Response.json({ ...result, ownerName: member.memberName }, { status: 201 }));
  } catch (error) {
    if (error instanceof ProjectUploadError) {
      return withCors(Response.json({ error: error.message }, { status: error.status }));
    }
    return withCors(errorResponse(error));
  }
}

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}
