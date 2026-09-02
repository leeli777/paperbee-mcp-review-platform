import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { members, oauthAuthorizationCodes } from "@/db/schema";
import { hashSessionToken, verifyPassword } from "@/lib/credentials";
import { consumeOAuthRateLimit, oauthClientAddress } from "@/lib/oauth-rate-limit";
import { consumeHierarchicalLimits } from "@/lib/oauth-rate-policy.js";
import { readLimitedUtf8Body, RequestBodyTooLargeError } from "@/lib/limited-request-body";
import {
  AUTHORIZATION_CODE_TTL_SECONDS,
  createOpaqueCredential,
  validateAuthorizationRequest,
} from "@/lib/oauth-auth";

export async function POST(request: Request) {
  let authorization;
  try {
    const form = new URLSearchParams(await readLimitedUtf8Body(request, 16 * 1024));
    authorization = await validateAuthorizationRequest(form);
    if (String(form.get("decision") ?? "") !== "approve") {
      return redirectWith(authorization.redirectUri, { error: "access_denied", state: authorization.state });
    }
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (email.length > 254 || password.length > 1024) {
      return new Response("邮箱或密码不正确", { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const address = oauthClientAddress(request);
    const withinLimits = await consumeHierarchicalLimits([
      () => consumeOAuthRateLimit(`login-ip:${address}`, 30, 15 * 60),
      () => consumeOAuthRateLimit(`login-account:${email}`, 10, 15 * 60),
      () => consumeOAuthRateLimit("login-global", 5000, 15 * 60),
    ]);
    if (!withinLimits) {
      return new Response("登录尝试过多，请稍后再试", { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "900" } });
    }
    const db = await getDb();
    const [member] = await db.select().from(members).where(and(
      eq(members.email, email),
      eq(members.status, "active"),
    )).limit(1);
    const validPassword = await verifyPassword(password, member?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!member?.passwordHash || !validPassword) {
      return new Response("邮箱或密码不正确", { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const code = createOpaqueCredential("pb_code_");
    await db.insert(oauthAuthorizationCodes).values({
      id: crypto.randomUUID(),
      codeHash: await hashSessionToken(code),
      memberId: member.id,
      clientId: authorization.clientId,
      redirectUri: authorization.redirectUri,
      resource: authorization.resource,
      scope: authorization.scope,
      codeChallenge: authorization.codeChallenge,
      credentialVersion: member.oauthCredentialVersion,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString(),
    });
    return redirectWith(authorization.redirectUri, { code, state: authorization.state });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response("授权请求过大", { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    return new Response("授权请求无效", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function redirectWith(uri: string, values: Record<string, string>) {
  const target = new URL(uri);
  for (const [name, value] of Object.entries(values)) if (value) target.searchParams.set(name, value);
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}
