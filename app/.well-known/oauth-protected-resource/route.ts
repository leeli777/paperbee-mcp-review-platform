import { MCP_RESOURCE, OAUTH_ISSUER, OAUTH_SCOPE, noStoreJson } from "@/lib/oauth-auth";

export async function GET() {
  return noStoreJson({
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: [OAUTH_SCOPE],
    resource_documentation: `${OAUTH_ISSUER}/#chatgpt`,
  });
}
