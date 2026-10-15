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
