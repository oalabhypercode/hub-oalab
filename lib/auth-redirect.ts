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
