// „Lokal immer Admin“ (Omed, 14.11.2026): `npm run dev:admin` signs every request without a session in as the admin named
// in `.env.local`, with no password, so the hub on localhost opens straight in the workspace. Off unless ALL of these
// hold, so this public repository carries no open door:
// - HUB_LOCAL_ADMIN_EMAIL is set. `.env*` never goes into git (.gitignore) and the hosted hub never has it.
// - NODE_ENV is "development": only `next dev`; every build runs as production.
// - HUB_LOCAL_ADMIN_BIND is "127.0.0.1": set only by `npm run dev:admin`, which binds the dev server to loopback, so no
//   other device can reach it. Never put it into an env file.
// - The request's own Host is localhost, *.localhost or 127.0.0.1.
// Self-contained, so `node --test` can load it.

export type LocalAdminEnvironment = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOST = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.localhost|127\.0\.0\.1)$/u;

/** The admin's address when this request may sign in without a password, else null. */
export function localAdminEmail(host: string | null | undefined, env: LocalAdminEnvironment = process.env): string | null {
  const email = env.HUB_LOCAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || env.NODE_ENV !== "development" || env.HUB_LOCAL_ADMIN_BIND !== "127.0.0.1") return null;
  const hostname = (host ?? "").trim().toLowerCase().replace(/:\d+$/u, "");
  return LOOPBACK_HOST.test(hostname) ? email : null;
}
