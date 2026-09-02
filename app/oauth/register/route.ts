import { getDb } from "@/db";
import { oauthClients } from "@/db/schema";
import { isAllowedRedirectUri } from "@/lib/oauth-protocol";
import { createOpaqueCredential, noStoreJson } from "@/lib/oauth-auth";
import { consumeOAuthRateLimit, oauthClientAddress } from "@/lib/oauth-rate-limit";
import { consumeHierarchicalLimits } from "@/lib/oauth-rate-policy.js";
import { readLimitedUtf8Body, RequestBodyTooLargeError } from "@/lib/limited-request-body";

const MAX_REGISTRATION_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    const address = oauthClientAddress(request);
    const withinLimits = await consumeHierarchicalLimits([
      () => consumeOAuthRateLimit(`register-ip:${address}`, 20, 60 * 60),
      () => consumeOAuthRateLimit("register-global", 1000, 60 * 60),
    ]);
    if (!withinLimits) {
      return noStoreJson({ error: "temporarily_unavailable" }, { status: 429, headers: { "Retry-After": "3600" } });
    }
    const body = await readLimitedUtf8Body(request, MAX_REGISTRATION_BYTES);
    const payload = JSON.parse(body) as Record<string, unknown>;
    const redirectUris = Array.isArray(payload.redirect_uris)
      ? [...new Set(payload.redirect_uris.filter((value): value is string => typeof value === "string"))]
      : [];
    const production = process.env.NODE_ENV === "production";
    if (
      redirectUris.length === 0 ||
      redirectUris.length > 10 ||
      redirectUris.some((uri) => uri.length > 2048) ||
      redirectUris.reduce((total, uri) => total + uri.length, 0) > 8192 ||
      redirectUris.some((uri) => !isAllowedRedirectUri(uri, production)) ||
      (payload.token_endpoint_auth_method && payload.token_endpoint_auth_method !== "none")
    ) {
      return noStoreJson({ error: "invalid_client_metadata" }, { status: 400 });
    }
    const clientName = typeof payload.client_name === "string"
      ? payload.client_name.trim().slice(0, 120)
      : "MCP client";
    const clientId = createOpaqueCredential("pb_client_");
    const db = await getDb();
    await db.insert(oauthClients).values({
      id: clientId,
      clientName: clientName || "MCP client",
      redirectUris: JSON.stringify(redirectUris),
    });
    return noStoreJson({
      client_id: clientId,
      client_name: clientName || "MCP client",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return noStoreJson({ error: "invalid_client_metadata" }, { status: 413 });
    }
    return noStoreJson({ error: "invalid_client_metadata" }, { status: 400 });
  }
}
