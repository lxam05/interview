/**
 * Sites we never store or fetch, whatever a search returns. Matching is on
 * the host and every parent domain, so regional variants (glassdoor.ie,
 * uk.indeed.com) are covered. docs/sources.md explains each entry; change
 * both together.
 */
export const EXCLUDED_DOMAINS: Record<string, string> = {
  // Terms forbid automated collection.
  glassdoor: "Glassdoor's terms forbid collection",
  indeed: "Indeed's terms forbid automated collection",
  linkedin: "LinkedIn's terms forbid automated collection",
  // Not reviewed yet: link-out only until its terms are read.
  jointaro: "Taro's terms have not been reviewed",
  // People-lookup and contact databases: personal data, never relevant.
  rocketreach: "people-lookup site (personal data)",
  zoominfo: "people-lookup site (personal data)",
  apollo: "people-lookup site (personal data)",
  contactout: "people-lookup site (personal data)",
  signalhire: "people-lookup site (personal data)",
  lusha: "people-lookup site (personal data)",
};

/** The reason a URL is excluded, or null if it may be used. */
export function exclusionReason(raw: string): string | null {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  // "uk.indeed.com" -> labels ["uk", "indeed", "com"]; any label that is a
  // site name in the list counts, but never the final TLD on its own.
  const labels = host.split(".").slice(0, -1);
  for (const label of labels) {
    if (label in EXCLUDED_DOMAINS) return EXCLUDED_DOMAINS[label];
  }
  return null;
}
