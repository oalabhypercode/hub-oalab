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

/** The page that asks for the code from the e-mail (second factor). */
export const SECOND_FACTOR_PAGE = "/auth/mfa";

/**
 * Where Service OALab runs (lib/service-packages.ts). Its team pages need the code as well and send the login to the
 * hub's code page, which returns there afterwards. `OALAB_SERVICE_URL` sets another origin for local tests.
 */
export function serviceOrigin(env: Record<string, string | undefined> = process.env) {
  try {
    return new URL(env.OALAB_SERVICE_URL?.trim() || "https://service.oalab.de").origin;
  } catch {
    return "https://service.oalab.de";
  }
}

/** A page of Service OALab as destination: absolute, on its origin, without credentials. Null for anything else. */
export function serviceDestination(value: string | null | undefined, origin: string): string | null {
  if (!value || /[\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** After the code: back to Service OALab when it sent the login, otherwise a hub page as safeAuthRedirect allows. */
export function secondFactorDestination(value: string | null | undefined, origin: string): string {
  return serviceDestination(value, origin) ?? safeAuthRedirect(value);
}

/**
 * Where a session goes that still owes its code (password only, login with second factor): every page behind the
 * login and the sign-in pages lead to the code page, which returns to the requested page afterwards. Pages without
 * a login (the code page itself, errors, the preview) stay reachable.
 */
export function secondFactorRedirect(pathname: string, search: string, next: string | null | undefined, isPublic: boolean): string | null {
  if (pathname === SECOND_FACTOR_PAGE) return null;
  const destination = SIGN_IN_PAGES.has(pathname) ? safeAuthRedirect(next)
    : pathname === "/auth/update-password" || !isPublic ? `${pathname}${search}`
    : null;
  return destination === null ? null : `${SECOND_FACTOR_PAGE}?next=${encodeURIComponent(destination)}`;
}

/**
 * Who stays on the code page and where everyone else goes. Signed out → login; session already confirmed → its
 * destination. A login that wants the code stays, and so does every login Service OALab sent for its team pages,
 * even if the hub itself would not ask for the code.
 */
export function secondFactorPageRedirect(state: { signedIn: boolean; confirmed: boolean; wanted: boolean }, next: string | null | undefined, origin: string): string | null {
  if (!state.signedIn) return "/auth/login";
  if (state.confirmed) return secondFactorDestination(next, origin);
  if (state.wanted || serviceDestination(next, origin)) return null;
  return secondFactorDestination(next, origin);
}
