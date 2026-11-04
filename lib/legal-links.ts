/**
 * Imprint and privacy policy of the hub (§ 5 DDG, Art. 13 DSGVO). Since November 2026 both are pages of the hub
 * itself, public and reachable from every page in at most two clicks: the footers of sign-in, registration and error
 * pages, the account menu in the sidebar, "Mehr" on phones, the profile and every mail. Self-contained, so the
 * server, the mails and `node --test` share it.
 */
export const LEGAL_PATHS = { imprint: "/impressum", privacy: "/datenschutz" } as const;

/** The hub's public address for links in mails: NEXT_PUBLIC_SITE_URL when it is an https origin, else hub.oalab.de. */
function mailOrigin(env: Readonly<Record<string, string | undefined>>) {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ?? "";
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(configured) ? configured : "https://hub.oalab.de";
}

/** Absolute addresses of both pages for the mail footers, which cannot link relative. */
export function legalMailLinks(env: Readonly<Record<string, string | undefined>> = process.env) {
  const origin = mailOrigin(env);
  return { imprint: `${origin}${LEGAL_PATHS.imprint}`, privacy: `${origin}${LEGAL_PATHS.privacy}` };
}
