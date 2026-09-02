import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { members, oauthAuthorizationCodes, oauthTokenFamilies, oauthTokens } from "@/db/schema";
import { hashSessionToken } from "@/lib/credentials";
import { verifyPkceS256 } from "@/lib/oauth-protocol";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  MCP_RESOURCE,
  OAUTH_SCOPE,
  REFRESH_TOKEN_TTL_SECONDS,
  createOpaqueCredential,
  noStoreJson,
} from "@/lib/oauth-auth";

export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthError("invalid_request");
  }
  const clientId = form.get("client_id") ?? "";
  const db = await getDb();

  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const resource = form.get("resource") ?? "";
    const [record] = await db.select().from(oauthAuthorizationCodes).where(and(
      eq(oauthAuthorizationCodes.codeHash, await hashSessionToken(code)),
      eq(oauthAuthorizationCodes.clientId, clientId),
    )).limit(1);
    if (
      !record || record.consumedAt || record.expiresAt <= new Date().toISOString() ||
      record.redirectUri !== redirectUri || record.resource !== resource || resource !== MCP_RESOURCE ||
      record.scope !== OAUTH_SCOPE || !(await verifyPkceS256(verifier, record.codeChallenge))
    ) {
      return oauthError("invalid_grant");
    }
    const consumed = await db.update(oauthAuthorizationCodes)
      .set({ consumedAt: new Date().toISOString() })
      .where(and(eq(oauthAuthorizationCodes.id, record.id), isNull(oauthAuthorizationCodes.consumedAt)))
      .returning({ id: oauthAuthorizationCodes.id });
    if (!consumed.length) return oauthError("invalid_grant");
    const familyId = crypto.randomUUID();
    await db.insert(oauthTokenFamilies).values({
      id: familyId,
      memberId: record.memberId,
      clientId,
      credentialVersion: record.credentialVersion,
    });
    return issueTokenPair(db, {
      memberId: record.memberId,
      clientId,
      resource: record.resource,
      scope: record.scope,
      familyId,
    });
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token") ?? "";
    const resource = form.get("resource") ?? "";
    const [record] = await db.select({
      id: oauthTokens.id,
      familyId: oauthTokens.familyId,
      memberId: oauthTokens.memberId,
      clientId: oauthTokens.clientId,
      resource: oauthTokens.resource,
      scope: oauthTokens.scope,
      expiresAt: oauthTokens.expiresAt,
      consumedAt: oauthTokens.consumedAt,
      revokedAt: oauthTokens.revokedAt,
      familyRevokedAt: oauthTokenFamilies.revokedAt,
      credentialVersion: oauthTokenFamilies.credentialVersion,
      currentCredentialVersion: members.oauthCredentialVersion,
    }).from(oauthTokens)
      .innerJoin(oauthTokenFamilies, eq(oauthTokens.familyId, oauthTokenFamilies.id))
      .innerJoin(members, eq(oauthTokens.memberId, members.id))
      .where(and(
      eq(oauthTokens.tokenHash, await hashSessionToken(refreshToken)),
      eq(oauthTokens.tokenType, "refresh"),
      eq(oauthTokens.clientId, clientId),
    )).limit(1);
    if (!record || record.resource !== resource || resource !== MCP_RESOURCE || record.expiresAt <= new Date().toISOString()) {
      return oauthError("invalid_grant");
    }
    if (record.consumedAt || record.revokedAt || record.familyRevokedAt || record.credentialVersion !== record.currentCredentialVersion) {
      await revokeFamily(db, record.familyId);
      return oauthError("invalid_grant");
    }
    const consumed = await db.update(oauthTokens)
      .set({ consumedAt: new Date().toISOString() })
      .where(and(eq(oauthTokens.id, record.id), isNull(oauthTokens.consumedAt)))
      .returning({ id: oauthTokens.id });
    if (!consumed.length) {
      await revokeFamily(db, record.familyId);
      return oauthError("invalid_grant");
    }
    return issueTokenPair(db, {
      memberId: record.memberId,
      clientId,
      resource: record.resource,
      scope: record.scope,
      familyId: record.familyId,
    });
  }

  return oauthError("unsupported_grant_type");
}

async function revokeFamily(db: Awaited<ReturnType<typeof getDb>>, familyId: string) {
  const now = new Date().toISOString();
  await db.batch([
    db.update(oauthTokenFamilies).set({ revokedAt: now }).where(eq(oauthTokenFamilies.id, familyId)),
    db.update(oauthTokens).set({ revokedAt: now }).where(eq(oauthTokens.familyId, familyId)),
  ]);
}

async function issueTokenPair(
  db: Awaited<ReturnType<typeof getDb>>,
  binding: { memberId: string; clientId: string; resource: string; scope: string; familyId: string },
) {
  const accessToken = createOpaqueCredential("pb_access_");
  const refreshToken = createOpaqueCredential("pb_refresh_");
  const now = Date.now();
  await db.insert(oauthTokens).values([
    {
      id: crypto.randomUUID(), familyId: binding.familyId, tokenHash: await hashSessionToken(accessToken),
      tokenType: "access", memberId: binding.memberId, clientId: binding.clientId,
      resource: binding.resource, scope: binding.scope,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
    {
      id: crypto.randomUUID(), familyId: binding.familyId, tokenHash: await hashSessionToken(refreshToken),
      tokenType: "refresh", memberId: binding.memberId, clientId: binding.clientId,
      resource: binding.resource, scope: binding.scope,
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
  ]);
  return noStoreJson({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: binding.scope,
  });
}

function oauthError(error: string, status = 400) {
  return noStoreJson({ error }, { status });
}
