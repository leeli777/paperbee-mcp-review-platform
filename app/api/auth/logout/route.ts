import { deleteCurrentSession, errorResponse, expiredSessionCookie } from "@/lib/auth";

export async function POST() {
  try {
    await deleteCurrentSession();
    const response = Response.json({ ok: true });
    response.headers.set("Set-Cookie", expiredSessionCookie());
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
