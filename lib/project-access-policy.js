const MATERIAL_KINDS = new Set(["description", "ai-review", "paper", "reproduction"]);
const RESTRICTED_KINDS = new Set(["paper", "reproduction"]);

export function canClaimProject(context) {
  return !context.hasActiveAssignment;
}

export function canAssignReviewer(context) {
  return context.reviewerMemberId !== context.ownerMemberId;
}

export function materialDecision(context) {
  if (!MATERIAL_KINDS.has(context.kind)) {
    return { allowed: false, reason: "invalid_material" };
  }
  if (!context.active) {
    return { allowed: false, reason: "inactive_member" };
  }
  if (!RESTRICTED_KINDS.has(context.kind) || !context.hasActiveAssignment) {
    return { allowed: true, reason: null };
  }
  const allowed =
    context.role === "admin" ||
    context.memberId === context.ownerMemberId ||
    context.memberId === context.reviewerMemberId;
  return { allowed, reason: allowed ? null : "assigned_to_another_reviewer" };
}
