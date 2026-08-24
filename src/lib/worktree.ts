// Isolate loop (Phase 9): pure directory-slug sanitization. Split out so the
// naming logic is testable without a live git/DB round trip.

/** Filesystem-safe directory slug: `/` and anything outside
 * alphanumeric/./_/- becomes `-`, repeats collapse, edges trim. Used for both
 * a user-typed new-branch name and an existing branch's `/`-containing name
 * (e.g. `feature/foo` -> `feature-foo`). */
export function sanitizeSlug(s: string): string {
  return s
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
