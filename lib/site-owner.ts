export const SITE_OWNER_EMAIL = "owner@example.com";

export function isSiteOwner(email: string) {
  return email.trim().toLowerCase() === SITE_OWNER_EMAIL;
}
