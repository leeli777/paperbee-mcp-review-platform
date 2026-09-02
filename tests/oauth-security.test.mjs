import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedCimdClientId,
  isAllowedRedirectUri,
  normalizeProjectCode,
  validateCimdClientMetadata,
  validateTrustedChatGptCimdFallback,
  verifyPkceS256,
} from "../lib/oauth-protocol.js";
import * as projectAccessPolicy from "../lib/project-access-policy.js";
import { canReadMcpResource, MAX_MCP_RESOURCE_BYTES } from "../lib/mcp-resource-policy.js";
import { consumeHierarchicalLimits } from "../lib/oauth-rate-policy.js";

test("normalizes valid public project codes without accepting lookalike characters", () => {
  assert.equal(normalizeProjectCode(" pb-8f3k2q "), "PB-8F3K2Q");
  assert.equal(normalizeProjectCode("PB-8F3I2Q"), null);
  assert.equal(normalizeProjectCode("PB-8F3O2Q"), null);
  assert.equal(normalizeProjectCode("8F3K2Q"), null);
  assert.equal(normalizeProjectCode("PB-8F3K2Q7"), null);
});

test("accepts secure redirects in production and loopback HTTP only in development", () => {
  assert.equal(isAllowedRedirectUri("https://chatgpt.com/oauth/callback", true), true);
  assert.equal(isAllowedRedirectUri("https://example.com/callback#fragment", true), false);
  assert.equal(isAllowedRedirectUri("https://user@example.com/callback", true), false);
  assert.equal(isAllowedRedirectUri("http://127.0.0.1:5173/callback", true), false);
  assert.equal(isAllowedRedirectUri("http://127.0.0.1:5173/callback", false), true);
  assert.equal(isAllowedRedirectUri("http://localhost:5173/callback", false), true);
  assert.equal(isAllowedRedirectUri("http://example.com/callback", false), false);
});

test("accepts only OpenAI-hosted ChatGPT CIMD client identifiers", () => {
  assert.equal(isAllowedCimdClientId("https://chatgpt.com/oauth/client.json"), true);
  assert.equal(isAllowedCimdClientId("https://chatgpt.com/oauth/callback-123/client.json"), true);
  assert.equal(isAllowedCimdClientId("https://chatgpt.com.evil.example/oauth/client.json"), false);
  assert.equal(isAllowedCimdClientId("https://chatgpt.com/oauth/client.json?next=https://evil.example"), false);
  assert.equal(isAllowedCimdClientId("http://chatgpt.com/oauth/client.json"), false);
});

test("validates CIMD metadata against the requested client and redirect URI", () => {
  const clientId = "https://chatgpt.com/oauth/client.json";
  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const metadata = {
    client_id: clientId,
    client_name: "ChatGPT",
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
  assert.deepEqual(validateCimdClientMetadata(metadata, clientId, redirectUri), { clientName: "ChatGPT" });
  assert.equal(validateCimdClientMetadata({ ...metadata, client_id: "https://evil.example/client.json" }, clientId, redirectUri), null);
  assert.equal(validateCimdClientMetadata({ ...metadata, redirect_uris: ["https://evil.example/callback"] }, clientId, redirectUri), null);
  assert.equal(validateCimdClientMetadata({ ...metadata, token_endpoint_auth_methods_supported: ["private_key_jwt"] }, clientId, redirectUri), null);
});

test("falls back only to exact ChatGPT CIMD and callback pairs when edge fetching is blocked", () => {
  assert.deepEqual(
    validateTrustedChatGptCimdFallback(
      "https://chatgpt.com/oauth/client.json",
      "https://chatgpt.com/connector_platform_oauth_redirect",
    ),
    { clientName: "ChatGPT" },
  );
  assert.deepEqual(
    validateTrustedChatGptCimdFallback(
      "https://chatgpt.com/oauth/callback_123/client.json",
      "https://chatgpt.com/connector/oauth/callback_123",
    ),
    { clientName: "ChatGPT" },
  );
  assert.equal(
    validateTrustedChatGptCimdFallback(
      "https://chatgpt.com/oauth/callback_123/client.json",
      "https://chatgpt.com/connector/oauth/callback_456",
    ),
    null,
  );
  assert.equal(
    validateTrustedChatGptCimdFallback(
      "https://chatgpt.com.evil.example/oauth/callback_123/client.json",
      "https://chatgpt.com/connector/oauth/callback_123",
    ),
    null,
  );
});

test("verifies an RFC 7636 S256 proof and rejects malformed or incorrect verifiers", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.equal(await verifyPkceS256(verifier, challenge), true);
  assert.equal(await verifyPkceS256(`${verifier}x`, challenge), false);
  assert.equal(await verifyPkceS256("too-short", challenge), false);
  assert.equal(await verifyPkceS256(verifier, `${challenge}=`), false);
});

test("bounds binary MCP resources before loading or base64 encoding them", () => {
  assert.equal(canReadMcpResource(MAX_MCP_RESOURCE_BYTES), true);
  assert.equal(canReadMcpResource(MAX_MCP_RESOURCE_BYTES + 1), false);
  assert.equal(canReadMcpResource(-1), false);
});

test("stops hierarchical rate limiting before a failed narrow bucket can consume a global bucket", async () => {
  const consumed = [];
  const allowed = await consumeHierarchicalLimits([
    async () => { consumed.push("ip"); return false; },
    async () => { consumed.push("account"); return true; },
    async () => { consumed.push("global"); return true; },
  ]);
  assert.equal(allowed, false);
  assert.deepEqual(consumed, ["ip"]);
});

const ordinary = { active: true, role: "member", memberId: "member-b", ownerMemberId: "owner", reviewerMemberId: "reviewer" };

test("allows an uploader to claim their own unassigned project", () => {
  assert.equal(typeof projectAccessPolicy.canClaimProject, "function");
  assert.equal(projectAccessPolicy.canClaimProject({
    hasActiveAssignment: false,
  }), true);
  assert.equal(projectAccessPolicy.canClaimProject({
    hasActiveAssignment: true,
  }), false);
});

test("still prevents assigning an uploader as reviewer of their own project", () => {
  assert.equal(typeof projectAccessPolicy.canAssignReviewer, "function");
  assert.equal(projectAccessPolicy.canAssignReviewer({
    reviewerMemberId: "owner",
    ownerMemberId: "owner",
  }), false);
  assert.equal(projectAccessPolicy.canAssignReviewer({
    reviewerMemberId: "reviewer",
    ownerMemberId: "owner",
  }), true);
});

test("allows active members to read overview materials regardless of assignment", () => {
  for (const kind of ["description", "ai-review"]) {
    assert.deepEqual(projectAccessPolicy.materialDecision({ ...ordinary, hasActiveAssignment: true, kind }), {
      allowed: true,
      reason: null,
    });
  }
});

test("allows every active member to read restricted materials before assignment", () => {
  for (const kind of ["paper", "reproduction"]) {
    assert.deepEqual(projectAccessPolicy.materialDecision({ ...ordinary, hasActiveAssignment: false, kind }), {
      allowed: true,
      reason: null,
    });
  }
});

test("limits assigned paper and reproduction to reviewer, owner, and admin", () => {
  for (const kind of ["paper", "reproduction"]) {
    assert.equal(projectAccessPolicy.materialDecision({ ...ordinary, hasActiveAssignment: true, kind }).allowed, false);
    assert.equal(projectAccessPolicy.materialDecision({ ...ordinary, memberId: "reviewer", hasActiveAssignment: true, kind }).allowed, true);
    assert.equal(projectAccessPolicy.materialDecision({ ...ordinary, memberId: "owner", hasActiveAssignment: true, kind }).allowed, true);
    assert.equal(projectAccessPolicy.materialDecision({ ...ordinary, role: "admin", hasActiveAssignment: true, kind }).allowed, true);
  }
});

test("rejects inactive members and unknown material kinds", () => {
  assert.deepEqual(projectAccessPolicy.materialDecision({ ...ordinary, active: false, hasActiveAssignment: false, kind: "description" }), {
    allowed: false,
    reason: "inactive_member",
  });
  assert.deepEqual(projectAccessPolicy.materialDecision({ ...ordinary, hasActiveAssignment: false, kind: "secrets" }), {
    allowed: false,
    reason: "invalid_material",
  });
});
