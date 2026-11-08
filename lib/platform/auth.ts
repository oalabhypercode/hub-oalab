import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { hashPassword, symmetricDecrypt, symmetricEncrypt, verifyPassword } from "better-auth/crypto";
import QRCode from "qrcode";
import { secondFactorMethod } from "@/lib/hub-auth/second-factor";
import { banUntil, betterAuthSecret, isRecord, mergeMetadata, REST_TOKEN_SECONDS, restJwtSecret, SESSION_SECONDS, SESSION_UPDATE_SECONDS, sessionCookieName } from "./config";
import { sql, type Claims } from "./db";
import { signJwt } from "./jwt";
import { newSessionToken, signSessionToken, verifiedSessionToken } from "./session-cookie";
import { newTotpSecret, totpUri, verifyTotp } from "./totp";

/**
 * supabase-js's `auth` for the own platform, on the Better Auth tables Service OALab signs in with. The Hub keeps its
 * Supabase flow: a password creates an `aal1` session, the second factor (app or mail code) raises that session to
 * `aal2`, as Supabase's AAL and the access-token hook did. Sessions, cookie and factors are the ones Service OALab
 * reads, so one login still counts on hub. and service.oalab.de.
 *
 * Only what the Hub calls is answered; everything returns Supabase's `{ data, error }` shapes with its error codes.
 */

export type CookieToSet = { name: string; value: string; options: Record<string, unknown> };
export type CookieAdapter = {
  getAll(): { name: string; value: string }[] | Promise<{ name: string; value: string }[]>;
  setAll?(cookies: CookieToSet[]): void | Promise<void>;
};
export type RequestMeta = { ip?: string | null; userAgent?: string | null };

type UserRow = {
  id: string;
  email: string;
  email_confirmed_at: Date | null;
  last_sign_in_at: Date | null;
  banned_until: Date | null;
  created_at: Date;
  updated_at: Date;
  raw_app_meta_data: Record<string, unknown> | null;
  raw_user_meta_data: Record<string, unknown> | null;
};
type SessionRow = { session_id: string; token: string; expires_at: Date; aal: "aal1" | "aal2"; session_created_at: Date };
type Current = { session: SessionRow; user: UserRow };
export type Factor = { id: string; factor_type: "totp"; status: "verified" | "unverified"; friendly_name: string; created_at: string; updated_at: string };

const USER_COLUMNS = "u.id, u.email, u.email_confirmed_at, u.last_sign_in_at, u.banned_until, u.created_at, u.updated_at, u.raw_app_meta_data, u.raw_user_meta_data";
const LINK_HOURS = 24;
const ENROLL_MINUTES = 30;

type AuthErrorShape = { name: "AuthApiError"; code: string; message: string; status: number; __isAuthError: true };
const authError = (code: string, message: string, status = 400): AuthErrorShape => ({ name: "AuthApiError", code, message, status, __isAuthError: true });
const sessionMissing = () => authError("session_not_found", "Auth session missing!", 400);
const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const enrollIdentifier = (userId: string) => `hub-totp-enroll:${userId}`;
const linkIdentifier = (kind: string, token: string) => `hub-link:${kind}:${sha256(token)}`;

/** Supabase's user object, built from the shared `auth.users` row. */
export function supabaseUser(row: UserRow, factors?: Factor[]) {
  return {
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email,
    phone: "",
    email_confirmed_at: iso(row.email_confirmed_at),
    confirmed_at: iso(row.email_confirmed_at),
    last_sign_in_at: iso(row.last_sign_in_at),
    ...(row.banned_until ? { banned_until: iso(row.banned_until) } : {}),
    app_metadata: { provider: "email", providers: ["email"], ...(row.raw_app_meta_data ?? {}) },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    ...(factors?.length ? { factors } : {}),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
    is_anonymous: false,
  };
}
export type OwnUser = ReturnType<typeof supabaseUser>;

const isBanned = (row: Pick<UserRow, "banned_until">) => Boolean(row.banned_until && new Date(row.banned_until).getTime() > Date.now());

async function decrypt(value: string) {
  try {
    return await symmetricDecrypt({ key: betterAuthSecret(), data: value });
  } catch {
    return null;
  }
}
const encrypt = (value: string) => symmetricEncrypt({ key: betterAuthSecret(), data: value });

/** The base32 secret of an authenticator app; mail-code logins carry a random secret without the prefix. */
const appSecret = (plain: string | null) => (plain?.startsWith("base32:") ? plain.slice("base32:".length) : null);

/** Confirmed apps (`two_factors`) and an unfinished set-up (`verifications`), as Supabase lists a login's factors. */
export async function factorsOf(userId: string): Promise<Factor[]> {
  const [apps, pending] = await Promise.all([
    sql<{ id: string; secret: string }>("select id, secret from auth.two_factors where user_id = $1", [userId]),
    sql<{ id: string; created_at: Date }>("select id, created_at from auth.verifications where identifier = $1 and expires_at > now()", [enrollIdentifier(userId)]),
  ]);
  const factors: Factor[] = [];
  for (const row of apps.rows) {
    if (appSecret(await decrypt(row.secret))) factors.push({ id: row.id, factor_type: "totp", status: "verified", friendly_name: "oalab", created_at: "", updated_at: "" });
  }
  for (const row of pending.rows) {
    factors.push({ id: row.id, factor_type: "totp", status: "unverified", friendly_name: "oalab", created_at: iso(row.created_at)!, updated_at: iso(row.created_at)! });
  }
  return factors;
}

/**
 * Keeps Better Auth's view of the second factor in line with the Hub's choice, so Service OALab asks for the same
 * one: no method = no `two_factors` row; the mail code = a row with a random, never shown secret; an app = its row.
 */
export async function syncSecondFactor(userId: string) {
  const user = await sql<{ raw_app_meta_data: Record<string, unknown> | null }>("select raw_app_meta_data from auth.users where id = $1", [userId]);
  if (!user.rows[0]) return;
  const factors = await factorsOf(userId);
  const hasApp = factors.some((factor) => factor.status === "verified");
  const method = secondFactorMethod(user.rows[0].raw_app_meta_data, hasApp);
  if (method === null) {
    await sql("delete from auth.two_factors where user_id = $1", [userId]);
    await sql("update auth.users set two_factor_enabled = false, updated_at = now() where id = $1", [userId]);
    return;
  }
  const rows = await sql("select 1 from auth.two_factors where user_id = $1", [userId]);
  if (!rows.rowCount) await insertFactor(userId, randomUUID(), randomToken(32));
  await sql("update auth.users set two_factor_enabled = true, updated_at = now() where id = $1", [userId]);
}

async function insertFactor(userId: string, id: string, secret: string) {
  const backupCodes = Array.from({ length: 10 }, () => `${randomToken(5)}-${randomToken(5)}`);
  await sql("insert into auth.two_factors (id, user_id, secret, backup_codes, verified) values ($1, $2, $3, $4, true)", [
    id, userId, await encrypt(secret), await encrypt(JSON.stringify(backupCodes)),
  ]);
}

function randomToken(length: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");
}

async function verifyStoredPassword(hash: string, password: string) {
  try {
    return /^\$2[aby]\$/u.test(hash) ? await bcrypt.compare(password, hash) : await verifyPassword({ hash, password });
  } catch {
    return false;
  }
}

async function setPassword(userId: string, password: string) {
  const hash = await hashPassword(password);
  const updated = await sql("update auth.accounts set password = $2, updated_at = now() where user_id = $1 and provider_id = 'credential'", [userId, hash]);
  if (!updated.rowCount) {
    await sql("insert into auth.accounts (id, user_id, account_id, provider_id, password) values (gen_random_uuid(), $1, $1::text, 'credential', $2)", [userId, hash]);
  }
}

async function userById(id: string) {
  if (!/^[0-9a-f-]{36}$/iu.test(id)) return null;
  return (await sql<UserRow>(`select ${USER_COLUMNS} from auth.users u where u.id = $1`, [id])).rows[0] ?? null;
}

async function userByEmail(email: string) {
  return (await sql<UserRow>(`select ${USER_COLUMNS} from auth.users u where u.email = lower(trim($1))`, [email])).rows[0] ?? null;
}

/** The claims PostgREST and the call sites see, the same fields Supabase's access token carried. */
function claimsOf(current: Current): Claims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "oalab-hub",
    aud: "authenticated",
    role: "authenticated",
    sub: current.user.id,
    email: current.user.email,
    phone: "",
    session_id: current.session.session_id,
    aal: current.session.aal,
    amr: [{ method: current.session.aal === "aal2" ? "totp" : "password", timestamp: Math.floor(new Date(current.session.session_created_at).getTime() / 1000) }],
    app_metadata: { provider: "email", providers: ["email"], ...(current.user.raw_app_meta_data ?? {}) },
    user_metadata: current.user.raw_user_meta_data ?? {},
    is_anonymous: false,
    iat: now,
    exp: now + REST_TOKEN_SECONDS,
  };
}

/** Tokens for PostgREST: the person's claims, anon without a session, service_role for the admin client. */
export function restToken(claims: Claims | null, role: "anon" | "service_role" = "anon") {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(claims ?? { iss: "oalab-hub", role, iat: now, exp: now + REST_TOKEN_SECONDS }, restJwtSecret());
}

function sessionOf(current: Current, factors?: Factor[]) {
  const claims = claimsOf(current);
  return {
    access_token: restToken(claims),
    refresh_token: "",
    token_type: "bearer",
    expires_in: REST_TOKEN_SECONDS,
    expires_at: claims.exp as number,
    user: supabaseUser(current.user, factors),
  };
}

/** The `auth` namespace of a cookie-bound client (server components, actions, routes, proxy). */
export class OwnSessionAuth {
  #loaded: Promise<Current | null> | null = null;
  readonly #cookies: CookieAdapter;
  readonly #domain: string | undefined;
  readonly #secure: boolean;
  readonly #meta: RequestMeta;

  constructor(cookies: CookieAdapter, options: { domain?: string; secure?: boolean }, meta: RequestMeta = {}) {
    this.#cookies = cookies;
    this.#domain = options.domain;
    this.#secure = options.secure !== false;
    this.#meta = meta;
  }

  /** Claims of the signed-in session, or null. Used for every PostgREST and catalog request of this client. */
  async currentClaims() {
    const current = await this.#current();
    return current ? claimsOf(current) : null;
  }

  #current(fresh = false) {
    if (fresh || !this.#loaded) this.#loaded = this.#load();
    return this.#loaded;
  }

  async #load(): Promise<Current | null> {
    const cookies = await this.#cookies.getAll();
    const value = cookies.find((cookie) => cookie.name === sessionCookieName(this.#secure))?.value;
    const token = verifiedSessionToken(value, betterAuthSecret());
    if (!token) return null;
    const row = (await sql<SessionRow & UserRow>(
      `select s.id as session_id, s.token, s.expires_at, s.aal, s.created_at as session_created_at, ${USER_COLUMNS}
       from auth.sessions s join auth.users u on u.id = s.user_id where s.token = $1`,
      [token],
    )).rows[0];
    if (!row || new Date(row.expires_at).getTime() <= Date.now() || isBanned(row)) return null;
    const current: Current = {
      session: { session_id: row.session_id, token: row.token, expires_at: row.expires_at, aal: row.aal, session_created_at: row.session_created_at },
      user: row,
    };
    // Better Auth's renewal: a day after the last one the session runs for another 30 days (only where cookies can be set).
    const remaining = new Date(row.expires_at).getTime() - Date.now();
    if (this.#cookies.setAll && remaining < (SESSION_SECONDS - SESSION_UPDATE_SECONDS) * 1000) {
      const renewed = await sql<{ expires_at: Date }>(
        "update auth.sessions set expires_at = now() + make_interval(secs => $2), updated_at = now() where id = $1 returning expires_at",
        [row.session_id, SESSION_SECONDS],
      );
      if (renewed.rows[0]) {
        current.session.expires_at = renewed.rows[0].expires_at;
        await this.#writeCookie(row.token);
      }
    }
    return current;
  }

  async #writeCookie(token: string | null) {
    if (!this.#cookies.setAll) return;
    try {
      await this.#cookies.setAll([{
        name: sessionCookieName(this.#secure),
        value: token ? signSessionToken(token, betterAuthSecret()) : "",
        options: { ...(this.#domain ? { domain: this.#domain } : {}), httpOnly: true, path: "/", sameSite: "lax", secure: this.#secure, maxAge: token ? SESSION_SECONDS : 0 },
      }]);
    } catch {
      // Server components cannot set cookies; the proxy renews them on the next request.
    }
  }

  async #createSession(user: UserRow): Promise<Current> {
    const token = newSessionToken();
    const created = (await sql<{ session_id: string; expires_at: Date; session_created_at: Date }>(
      `insert into auth.sessions (id, user_id, token, expires_at, ip_address, user_agent, aal)
       values (gen_random_uuid(), $1, $2, now() + make_interval(secs => $3), $4, $5, 'aal1')
       returning id as session_id, expires_at, created_at as session_created_at`,
      [user.id, token, SESSION_SECONDS, this.#meta.ip ?? null, this.#meta.userAgent?.slice(0, 512) ?? null],
    )).rows[0];
    const signedIn = (await sql<{ last_sign_in_at: Date }>("update auth.users set last_sign_in_at = now() where id = $1 returning last_sign_in_at", [user.id])).rows[0];
    await this.#writeCookie(token);
    const current: Current = {
      session: { session_id: created.session_id, token, expires_at: created.expires_at, aal: "aal1", session_created_at: created.session_created_at },
      user: { ...user, last_sign_in_at: signedIn?.last_sign_in_at ?? new Date() },
    };
    this.#loaded = Promise.resolve(current);
    return current;
  }

  async #raise(current: Current) {
    await sql("update auth.sessions set aal = 'aal2', aal2_at = now(), updated_at = now() where id = $1", [current.session.session_id]);
    current.session.aal = "aal2";
  }

  async getClaims() {
    const current = await this.#current();
    if (!current) return { data: null, error: null };
    return { data: { claims: claimsOf(current), header: { alg: "HS256", typ: "JWT" }, signature: new Uint8Array() }, error: null };
  }

  async getUser() {
    const current = await this.#current();
    if (!current) return { data: { user: null }, error: sessionMissing() };
    return { data: { user: supabaseUser(current.user, await factorsOf(current.user.id)) }, error: null };
  }

  async getSession() {
    const current = await this.#current();
    return { data: { session: current ? sessionOf(current) : null }, error: null };
  }

  async signInWithPassword(input: { email: string; password: string }) {
    const user = (await sql<UserRow & { password: string | null }>(
      `select ${USER_COLUMNS}, (select a.password from auth.accounts a where a.user_id = u.id and a.provider_id = 'credential' order by a.created_at limit 1) as password
       from auth.users u where u.email = lower(trim($1))`,
      [String(input?.email ?? "")],
    )).rows[0];
    const fail = (error: AuthErrorShape) => ({ data: { user: null, session: null }, error });
    if (!user?.password || !(await verifyStoredPassword(user.password, String(input?.password ?? "")))) return fail(authError("invalid_credentials", "Invalid login credentials"));
    if (!user.email_confirmed_at) return fail(authError("email_not_confirmed", "Email not confirmed"));
    if (isBanned(user)) return fail(authError("user_banned", "User is banned"));
    const current = await this.#createSession(user);
    const factors = await factorsOf(user.id);
    return { data: { user: supabaseUser(current.user, factors), session: sessionOf(current, factors) }, error: null };
  }

  /** `global` (Supabase's default) ends every session of the login, `local` this one, `others` all but this one. */
  async signOut(options: { scope?: "global" | "local" | "others" } = {}) {
    const current = await this.#current();
    const scope = options.scope ?? "global";
    if (current) {
      if (scope === "local") await sql("delete from auth.sessions where id = $1", [current.session.session_id]);
      else if (scope === "others") await sql("delete from auth.sessions where user_id = $1 and id <> $2", [current.user.id, current.session.session_id]);
      else await sql("delete from auth.sessions where user_id = $1", [current.user.id]);
    }
    if (scope !== "others") {
      await this.#writeCookie(null);
      this.#loaded = Promise.resolve(null);
    }
    return { error: null };
  }

  /** A confirmed mail code (`oalab_mail_code_sessions`) raises the session to aal2, as the access-token hook did. */
  async refreshSession() {
    const current = await this.#current(true);
    if (!current) return { data: { session: null, user: null }, error: sessionMissing() };
    if (current.session.aal !== "aal2") {
      const confirmed = await sql(
        "select 1 from public.oalab_mail_code_sessions where session_id = $1 and user_id = $2 and verified_at > now() - interval '30 days'",
        [current.session.session_id, current.user.id],
      );
      if (confirmed.rowCount) await this.#raise(current);
    }
    const factors = await factorsOf(current.user.id);
    return { data: { session: sessionOf(current, factors), user: supabaseUser(current.user, factors) }, error: null };
  }

  async updateUser(attributes: { password?: string; data?: Record<string, unknown>; email?: string }) {
    const current = await this.#current();
    if (!current) return { data: { user: null }, error: sessionMissing() };
    if (attributes.email !== undefined) return { data: { user: null }, error: authError("email_change_not_supported", "Changing the e-mail address is not supported.", 422) };
    const factors = await factorsOf(current.user.id);
    if (attributes.password !== undefined) {
      if (factors.some((factor) => factor.status === "verified") && current.session.aal !== "aal2") {
        return { data: { user: null }, error: authError("insufficient_aal", "AAL2 session is required to update email or password when MFA is enabled.", 401) };
      }
      const old = await sql<{ password: string | null }>("select password from auth.accounts where user_id = $1 and provider_id = 'credential' limit 1", [current.user.id]);
      if (old.rows[0]?.password && (await verifyStoredPassword(old.rows[0].password, attributes.password))) {
        return { data: { user: null }, error: authError("same_password", "New password should be different from the old password.", 422) };
      }
      await setPassword(current.user.id, attributes.password);
    }
    if (attributes.data !== undefined) {
      const merged = mergeMetadata(current.user.raw_user_meta_data, attributes.data);
      await sql("update auth.users set raw_user_meta_data = $2, updated_at = now() where id = $1", [current.user.id, merged]);
      current.user.raw_user_meta_data = merged;
    }
    return { data: { user: supabaseUser(current.user, factors) }, error: null };
  }

  /** The links of `admin.generateLink`: one use, then a fresh `aal1` session like Supabase's verify endpoint. */
  async verifyOtp(input: { type?: string; token_hash?: string }) {
    const fail = () => ({ data: { user: null, session: null }, error: authError("otp_expired", "Email link is invalid or has expired", 403) });
    const kinds = input?.type === "recovery" ? ["recovery"] : ["signup", "magiclink"];
    if (!input?.token_hash) return fail();
    const used = (await sql<{ value: string; expires_at: Date }>(
      "delete from auth.verifications where identifier = any($1::text[]) returning value, expires_at",
      [kinds.map((kind) => linkIdentifier(kind, input.token_hash!))],
    )).rows[0];
    if (!used || new Date(used.expires_at).getTime() < Date.now()) return fail();
    let userId = "";
    try {
      userId = String((JSON.parse(used.value) as { userId?: unknown }).userId ?? "");
    } catch {
      return fail();
    }
    const user = (await sql<UserRow>(
      `update auth.users u set email_confirmed_at = coalesce(u.email_confirmed_at, now()), email_verified = true, updated_at = now()
       where u.id = $1 returning ${USER_COLUMNS}`,
      [userId],
    )).rows[0];
    if (!user) return fail();
    if (isBanned(user)) return { data: { user: null, session: null }, error: authError("user_banned", "User is banned") };
    const current = await this.#createSession(user);
    const factors = await factorsOf(user.id);
    return { data: { user: supabaseUser(current.user, factors), session: sessionOf(current, factors) }, error: null };
  }

  async exchangeCodeForSession() {
    return { data: { session: null, user: null }, error: authError("flow_state_not_found", "No code exchange on this platform.", 404) };
  }

  readonly mfa = {
    getAuthenticatorAssuranceLevel: async () => {
      const current = await this.#current();
      if (!current) return { data: { currentLevel: null, nextLevel: null, currentAuthenticationMethods: [] }, error: null };
      const hasApp = (await factorsOf(current.user.id)).some((factor) => factor.status === "verified");
      return { data: { currentLevel: current.session.aal, nextLevel: hasApp ? "aal2" : current.session.aal, currentAuthenticationMethods: [] }, error: null };
    },

    /** Starts an app: the secret waits in `verifications` until a code from the app confirms it. */
    enroll: async (input: { factorType?: string; friendlyName?: string; issuer?: string }) => {
      const current = await this.#current();
      if (!current) return { data: null, error: sessionMissing() };
      const secret = newTotpSecret();
      const id = randomUUID();
      await sql("delete from auth.verifications where identifier = $1", [enrollIdentifier(current.user.id)]);
      await sql("insert into auth.verifications (id, identifier, value, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))", [
        id, enrollIdentifier(current.user.id), await encrypt(secret), ENROLL_MINUTES,
      ]);
      const uri = totpUri(input?.issuer || "oalab", current.user.email, secret);
      const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return { data: { id, type: "totp", friendly_name: input?.friendlyName ?? "", totp: { qr_code: `data:image/svg+xml;utf-8,${svg}`, secret, uri } }, error: null };
    },

    /** A code from the app: confirms an unfinished set-up or checks a confirmed app, and raises the session to aal2. */
    challengeAndVerify: async (input: { factorId: string; code: string }) => {
      const current = await this.#current();
      if (!current) return { data: null, error: sessionMissing() };
      const wrong = () => ({ data: null, error: authError("mfa_verification_failed", "Invalid TOTP code entered", 422) });
      const code = String(input?.code ?? "");
      const pending = (await sql<{ value: string }>(
        "select value from auth.verifications where id = $1 and identifier = $2 and expires_at > now()",
        [input?.factorId, enrollIdentifier(current.user.id)],
      ).catch(() => ({ rows: [] as { value: string }[] }))).rows[0];
      if (pending) {
        const secret = await decrypt(pending.value);
        if (!secret || !verifyTotp(secret, code)) return wrong();
        // One factor per login (Better Auth): the app replaces a mail-code row or an earlier app.
        await sql("delete from auth.two_factors where user_id = $1", [current.user.id]);
        await insertFactor(current.user.id, input.factorId, `base32:${secret}`);
        await sql("update auth.users set two_factor_enabled = true, updated_at = now() where id = $1", [current.user.id]);
        await sql("delete from auth.verifications where id = $1", [input.factorId]);
      } else {
        const row = (await sql<{ secret: string }>(
          "select secret from auth.two_factors where id = $1 and user_id = $2",
          [input?.factorId, current.user.id],
        ).catch(() => ({ rows: [] as { secret: string }[] }))).rows[0];
        const secret = appSecret(row ? await decrypt(row.secret) : null);
        if (!secret) return { data: null, error: authError("mfa_factor_not_found", "Factor not found", 404) };
        if (!verifyTotp(secret, code)) return wrong();
      }
      await this.#raise(current);
      const claims = claimsOf(current);
      return { data: { access_token: restToken(claims), token_type: "bearer", expires_in: REST_TOKEN_SECONDS, refresh_token: "", user: supabaseUser(current.user) }, error: null };
    },
  };
}

/** `auth` of the admin client (service role): user management on the shared tables. No cookie, no session. */
export const ownAdminAuth = {
  async getUser() {
    return { data: { user: null }, error: sessionMissing() };
  },
  async getClaims() {
    return { data: null, error: null };
  },
  admin: {
    async getUserById(id: string) {
      const user = await userById(String(id ?? ""));
      return user ? { data: { user: supabaseUser(user, await factorsOf(user.id)) }, error: null } : { data: { user: null }, error: authError("user_not_found", "User not found", 404) };
    },

    async listUsers(options: { page?: number; perPage?: number } = {}) {
      const perPage = Math.min(Math.max(Math.trunc(options.perPage ?? 50), 1), 1000);
      const page = Math.max(Math.trunc(options.page ?? 1), 1);
      const [rows, total] = await Promise.all([
        sql<UserRow>(`select ${USER_COLUMNS} from auth.users u order by u.created_at, u.id limit $1 offset $2`, [perPage, (page - 1) * perPage]),
        sql<{ total: number }>("select count(*)::int as total from auth.users"),
      ]);
      const count = total.rows[0]?.total ?? 0;
      const lastPage = Math.max(Math.ceil(count / perPage), 1);
      return { data: { users: rows.rows.map((row) => supabaseUser(row)), aud: "authenticated", nextPage: page < lastPage ? page + 1 : null, lastPage, total: count }, error: null };
    },

    async createUser(attributes: { email: string; password?: string; email_confirm?: boolean; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }) {
      const email = String(attributes?.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+$/u.test(email)) return { data: { user: null }, error: authError("validation_failed", "Unable to validate email address: invalid format", 400) };
      if (await userByEmail(email)) return { data: { user: null }, error: authError("email_exists", "A user with this email address has already been registered", 422) };
      const userMetadata = isRecord(attributes.user_metadata) ? attributes.user_metadata : {};
      const appMetadata = { provider: "email", providers: ["email"], ...(isRecord(attributes.app_metadata) ? attributes.app_metadata : {}) };
      const name = typeof userMetadata.full_name === "string" ? userMetadata.full_name.slice(0, 200) : "";
      const user = (await sql<UserRow>(
        `insert into auth.users as u (id, email, email_verified, name, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, case when $2 then now() end) returning ${USER_COLUMNS}`,
        [email, attributes.email_confirm === true, name, appMetadata, userMetadata],
      )).rows[0];
      if (attributes.password) await setPassword(user.id, attributes.password);
      await syncSecondFactor(user.id);
      return { data: { user: supabaseUser(user) }, error: null };
    },

    async deleteUser(id: string) {
      const user = (await sql<UserRow>(`delete from auth.users u where u.id = $1 returning ${USER_COLUMNS}`, [id])).rows[0];
      return user ? { data: { user: supabaseUser(user) }, error: null } : { data: { user: null }, error: authError("user_not_found", "User not found", 404) };
    },

    async updateUserById(id: string, attributes: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown>; ban_duration?: string; password?: string; email_confirm?: boolean }) {
      const user = await userById(String(id ?? ""));
      if (!user) return { data: { user: null }, error: authError("user_not_found", "User not found", 404) };
      const until = attributes.ban_duration === undefined ? undefined : banUntil(String(attributes.ban_duration));
      if (attributes.ban_duration !== undefined && until === undefined) return { data: { user: null }, error: authError("validation_failed", "Invalid ban duration", 400) };
      const appMetadata = attributes.app_metadata === undefined ? user.raw_app_meta_data : mergeMetadata(user.raw_app_meta_data, attributes.app_metadata);
      const userMetadata = attributes.user_metadata === undefined ? user.raw_user_meta_data : mergeMetadata(user.raw_user_meta_data, attributes.user_metadata);
      const updated = (await sql<UserRow>(
        `update auth.users u set raw_app_meta_data = $2, raw_user_meta_data = $3,
           banned_until = case when $4 then $5::timestamptz else u.banned_until end,
           email_confirmed_at = case when $6 then coalesce(u.email_confirmed_at, now()) else u.email_confirmed_at end,
           email_verified = u.email_verified or $6, updated_at = now()
         where u.id = $1 returning ${USER_COLUMNS}`,
        [user.id, appMetadata ?? {}, userMetadata ?? {}, until !== undefined, until ?? null, attributes.email_confirm === true],
      )).rows[0];
      // A ban ends the running sessions at once (Supabase refused their next refresh).
      if (until) await sql("delete from auth.sessions where user_id = $1", [user.id]);
      if (attributes.password) await setPassword(user.id, attributes.password);
      if (attributes.app_metadata !== undefined) await syncSecondFactor(user.id);
      return { data: { user: supabaseUser(updated, await factorsOf(user.id)) }, error: null };
    },

    /** Sign-up and password links: a one-time token in `verifications`, answered by `verifyOtp`. */
    async generateLink(input: { type: string; email: string; password?: string; options?: { data?: Record<string, unknown>; redirectTo?: string } }) {
      const fail = (error: AuthErrorShape) => ({ data: { properties: null, user: null }, error });
      const kind = input?.type === "signup" ? "signup" : input?.type === "recovery" ? "recovery" : input?.type === "magiclink" ? "magiclink" : null;
      if (!kind) return fail(authError("validation_failed", "Unsupported link type", 400));
      let user: UserRow | null = await userByEmail(String(input.email ?? ""));
      if (kind === "signup") {
        if (user?.email_confirmed_at) return fail(authError("email_exists", "A user with this email address has already been registered", 422));
        if (!user) {
          const created = await ownAdminAuth.admin.createUser({ email: input.email, password: input.password, email_confirm: false, user_metadata: input.options?.data });
          if (created.error) return fail(created.error);
          user = await userById(created.data.user!.id);
        } else {
          if (input.password) await setPassword(user.id, input.password);
          if (input.options?.data) await sql("update auth.users set raw_user_meta_data = $2, updated_at = now() where id = $1", [user.id, mergeMetadata(user.raw_user_meta_data, input.options.data)]);
          user = await userById(user.id);
        }
      }
      if (!user) return fail(authError("user_not_found", "User with this email not found", 404));
      const token = randomBytes(32).toString("hex");
      await sql("insert into auth.verifications (id, identifier, value, expires_at) values (gen_random_uuid(), $1, $2, now() + make_interval(hours => $3))", [
        linkIdentifier(kind, token), JSON.stringify({ userId: user.id }), LINK_HOURS,
      ]);
      return {
        data: { properties: { action_link: "", email_otp: "", hashed_token: token, redirect_to: input.options?.redirectTo ?? "", verification_type: kind }, user: supabaseUser(user) },
        error: null,
      };
    },

    mfa: {
      async listFactors(input: { userId: string }) {
        const factors = await factorsOf(String(input?.userId ?? ""));
        return { data: { factors, all: factors, totp: factors.filter((factor) => factor.status === "verified") }, error: null };
      },
      async deleteFactor(input: { userId: string; id: string }) {
        await sql("delete from auth.two_factors where id = $1 and user_id = $2", [input.id, input.userId]);
        await sql("delete from auth.verifications where id = $1 and identifier = $2", [input.id, enrollIdentifier(input.userId)]);
        await syncSecondFactor(input.userId);
        return { data: { id: input.id }, error: null };
      },
    },
  },
};
