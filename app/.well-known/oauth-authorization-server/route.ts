import { OAUTH_ISSUER, OAUTH_SCOPE, noStoreJson } from "@/lib/oauth-auth";

export async function GET() {
  return noStoreJson({
    issuer: OAUTH_ISSUER,
    authorization_endpoint: `${OAUTH_ISSUER}/oauth/authorize`,
    token_endpoint: `${OAUTH_ISSUER}/oauth/token`,
    registration_endpoint: `${OAUTH_ISSUER}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [OAUTH_SCOPE],
  });
}
