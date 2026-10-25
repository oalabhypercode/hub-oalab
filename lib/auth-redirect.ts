/** Accept only same-origin destinations belonging to the authenticated app. */
export function safeAuthRedirect(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || /[\\\u0000-\u001f]/.test(value)) {
    return "/dashboard";
  }

  try {
    const destination = new URL(value, "https://wola.local");
    const allowed = destination.pathname === "/dashboard" ||
      destination.pathname.startsWith("/dashboard/") ||
      destination.pathname === "/auth/update-password";

    return destination.origin === "https://wola.local" && allowed
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

/** Pages that only ask for a login. Someone already signed in (e.g. coming from Service OALab) skips them. */
const SIGN_IN_PAGES = new Set(["/", "/auth/login", "/auth/sign-up"]);

/** Where a signed-in visitor of a sign-in page goes instead: the requested `next` page or the dashboard. */
export function signedInRedirect(pathname: string, next: string | null | undefined): string | null {
  return SIGN_IN_PAGES.has(pathname) ? safeAuthRedirect(next) : null;
}

/** The page that asks for the code from the authenticator app. */
export const SECOND_FACTOR_PAGE = "/auth/mfa";

/**
 * Where a session goes that still owes its authenticator code (password only, login with second factor): every page
 * behind the login and the sign-in pages lead to the code page, which returns to the requested page afterwards.
 * Pages without a login (the code page itself, errors, the preview) stay reachable.
 */
export function secondFactorRedirect(pathname: string, search: string, next: string | null | undefined, isPublic: boolean): string | null {
  if (pathname === SECOND_FACTOR_PAGE) return null;
  const destination = SIGN_IN_PAGES.has(pathname) ? safeAuthRedirect(next)
    : pathname === "/auth/update-password" || !isPublic ? `${pathname}${search}`
    : null;
  return destination === null ? null : `${SECOND_FACTOR_PAGE}?next=${encodeURIComponent(destination)}`;
}

/** The code page without an open code request: signed in goes on to its destination, signed out to the login. */
export function settledSecondFactorRedirect(signedIn: boolean, next: string | null | undefined): string {
  return signedIn ? safeAuthRedirect(next) : "/auth/login";
}
