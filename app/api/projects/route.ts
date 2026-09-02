import { errorResponse, requireActiveMember } from "@/lib/auth";
import { createProjectFromForm, ProjectUploadError } from "@/lib/project-upload";

export async function POST(request: Request) {
  try {
    const member = await requireActiveMember();
    const result = await createProjectFromForm(await request.formData(), member.id);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectUploadError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return errorResponse(error);
  }
}
