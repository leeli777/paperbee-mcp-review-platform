const PROJECT_CODE_PATTERN = /^PB-[A-HJ-NP-Z2-9]{6}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export function normalizeProjectCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return PROJECT_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function isAllowedRedirectUri(value, production = true) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  if (production || url.protocol !== "http:") return false;
  return url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost";
}

export function isAllowedCimdClientId(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.origin === "https://chatgpt.com" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/oauth\/(?:[A-Za-z0-9_-]+\/)?client\.json$/.test(url.pathname)
  );
}

export function validateCimdClientMetadata(metadata, clientId, redirectUri) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  if (metadata.client_id !== clientId) return null;
  if (!Array.isArray(metadata.redirect_uris) || !metadata.redirect_uris.includes(redirectUri)) return null;
  if (!metadata.redirect_uris.every((uri) => typeof uri === "string" && isAllowedRedirectUri(uri, true))) return null;
  if (!Array.isArray(metadata.grant_types) || !metadata.grant_types.includes("authorization_code")) return null;
  if (!Array.isArray(metadata.response_types) || !metadata.response_types.includes("code")) return null;
  const authMethods = Array.isArray(metadata.token_endpoint_auth_methods_supported)
    ? metadata.token_endpoint_auth_methods_supported
    : [metadata.token_endpoint_auth_method];
  if (!authMethods.includes("none")) return null;
  const clientName = typeof metadata.client_name === "string" ? metadata.client_name.trim().slice(0, 120) : "ChatGPT";
  return { clientName: clientName || "ChatGPT" };
}

export function validateTrustedChatGptCimdFallback(clientId, redirectUri) {
  let client;
  let redirect;
  try {
    client = new URL(clientId);
    redirect = new URL(redirectUri);
  } catch {
    return null;
  }
  if (!isAllowedCimdClientId(clientId) || redirect.origin !== "https://chatgpt.com") return null;
  if (redirect.username || redirect.password || redirect.search || redirect.hash) return null;
  if (client.pathname === "/oauth/client.json") {
    return redirect.pathname === "/connector_platform_oauth_redirect" ? { clientName: "ChatGPT" } : null;
  }
  const callbackId = client.pathname.match(/^\/oauth\/([A-Za-z0-9_-]+)\/client\.json$/)?.[1];
  return callbackId && redirect.pathname === `/connector/oauth/${callbackId}` ? { clientName: "ChatGPT" } : null;
}

export async function verifyPkceS256(verifier, expectedChallenge) {
  if (
    typeof verifier !== "string" ||
    typeof expectedChallenge !== "string" ||
    !PKCE_VERIFIER_PATTERN.test(verifier) ||
    !/^[A-Za-z0-9_-]{43}$/.test(expectedChallenge)
  ) {
    return false;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const actual = base64Url(new Uint8Array(digest));
  return constantTimeTextEqual(actual, expectedChallenge);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function constantTimeTextEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}
