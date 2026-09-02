import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { members, oauthClients, oauthTokenFamilies, oauthTokens } from "@/db/schema";
import { hashSessionToken } from "@/lib/credentials";
import {
  isAllowedCimdClientId,
  validateCimdClientMetadata,
  validateTrustedChatGptCimdFallback,
} from "@/lib/oauth-protocol.js";

export const OAUTH_ISSUER = "https://paperbee.asia";
export const MCP_RESOURCE = "https://paperbee.asia/mcp";
export const OAUTH_SCOPE = "paperbee:read";
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;

export type OAuthMember = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
};

export class OAuthBearerError extends Error {
  status = 401;
}

export function oauthChallenge(error = "invalid_token", description = "PaperBee access token is missing, expired, or invalid") {
  const safe = (value: string) => value.replace(/["\\\r\n]/g, " ");
  return `Bearer resource_metadata="${OAUTH_ISSUER}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPE}", error="${safe(error)}", error_description="${safe(description)}"`;
}

export function oauthChallengeHeaders() {
  return {
    "WWW-Authenticate": oauthChallenge(),
    "Cache-Control": "no-store",
  };
}

export async function requireOAuthMember(request: Request, requiredScope = OAUTH_SCOPE): Promise<OAuthMember> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer pb_access_")) throw new OAuthBearerError("需要连接 PaperBee");
  const token = authorization.slice("Bearer ".length);
  const db = await getDb();
  const [record] = await db
    .select({
      id: members.id,
      email: members.email,
      name: members.name,
      role: members.role,
      status: members.status,
      scope: oauthTokens.scope,
      credentialVersion: oauthTokenFamilies.credentialVersion,
      currentCredentialVersion: members.oauthCredentialVersion,
    })
    .from(oauthTokens)
    .innerJoin(members, eq(oauthTokens.memberId, members.id))
    .innerJoin(oauthTokenFamilies, eq(oauthTokens.familyId, oauthTokenFamilies.id))
    .where(and(
      eq(oauthTokens.tokenHash, await hashSessionToken(token)),
      eq(oauthTokens.tokenType, "access"),
      eq(oauthTokens.resource, MCP_RESOURCE),
      gt(oauthTokens.expiresAt, new Date().toISOString()),
      isNull(oauthTokens.revokedAt),
      isNull(oauthTokenFamilies.revokedAt),
      eq(oauthTokenFamilies.credentialVersion, members.oauthCredentialVersion),
      eq(members.status, "active"),
    ))
    .limit(1);
  if (!record || !record.scope.split(/\s+/).includes(requiredScope)) {
    throw new OAuthBearerError("PaperBee 授权无效或已过期");
  }
  return record;
}

export function createOpaqueCredential(prefix: "pb_client_" | "pb_code_" | "pb_access_" | "pb_refresh_") {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${prefix}${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

export type AuthorizationRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  resource: string;
  scope: string;
  state: string;
  codeChallenge: string;
};

export async function validateAuthorizationRequest(values: URLSearchParams | FormData): Promise<AuthorizationRequest> {
  const read = (name: string) => String(values.get(name) ?? "");
  const clientId = read("client_id");
  const redirectUri = read("redirect_uri");
  const resource = read("resource");
  const scope = read("scope");
  const state = read("state");
  const codeChallenge = read("code_challenge");
  if (
    read("response_type") !== "code" ||
    read("code_challenge_method") !== "S256" ||
    resource !== MCP_RESOURCE ||
    scope !== OAUTH_SCOPE ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
    state.length > 1024
  ) {
    throw new Error("授权请求无效");
  }
  const client = await resolveOAuthClient(clientId, redirectUri);
  return { clientId, clientName: client.clientName, redirectUri, resource, scope, state, codeChallenge };
}

async function resolveOAuthClient(clientId: string, redirectUri: string) {
  const db = await getDb();
  const [registered] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).limit(1);
  if (registered) {
    const registeredUris = JSON.parse(registered.redirectUris) as unknown;
    if (!Array.isArray(registeredUris) || !registeredUris.includes(redirectUri)) {
      throw new Error("回调地址未注册");
    }
    return { clientName: registered.clientName };
  }

  if (!isAllowedCimdClientId(clientId)) throw new Error("授权客户端无效");
  const trustedFallback = validateTrustedChatGptCimdFallback(clientId, redirectUri);
  const acceptCimdClient = async (client: { clientName: string }) => {
    await db.insert(oauthClients).values({
      id: clientId,
      clientName: client.clientName,
      redirectUris: JSON.stringify([redirectUri]),
    }).onConflictDoNothing();
    return client;
  };
  try {
    const response = await fetch(clientId, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || declaredSize > 16 * 1024) {
      if (trustedFallback) return acceptCimdClient(trustedFallback);
      throw new Error("授权客户端元数据无效");
    }
    const body = await response.text();
    if (body.length <= 16 * 1024) {
      const metadata = validateCimdClientMetadata(JSON.parse(body), clientId, redirectUri);
      if (metadata) return acceptCimdClient(metadata);
    }
  } catch {
    if (trustedFallback) return acceptCimdClient(trustedFallback);
    throw new Error("授权客户端元数据无效");
  }
  if (trustedFallback) return acceptCimdClient(trustedFallback);
  throw new Error("授权客户端元数据无效");
}

export function noStoreJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}
