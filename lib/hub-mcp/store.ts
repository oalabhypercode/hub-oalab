import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/platform/db";
import { usesOwnPlatform } from "@/lib/platform/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCESS_TOKEN_SECONDS, CODE_SECONDS, mcpEnabled, REFRESH_TOKEN_SECONDS, REQUEST_SECONDS, ROTATION_GRACE_SECONDS, type HubScope } from "./config";
import { newSecret, secretHash } from "./oauth";

// What the Claude connector keeps: the admin's open question (consent page) and the one-time code in the shared
// `auth.verifications` (hashed, short-lived, like the hub's other links), the connections in hub_claude_connections
// (migration service-oalab 202611160004; only checksums of the keys). All of it as the app role on the server; no
// login reads any of it through PostgREST.

/** The connector runs only on the own platform and with its switch on. */
export const connectorReady = () => mcpEnabled() && usesOwnPlatform();

const SECRET = /^[A-Za-z0-9_-]{43}$/;
const requestIdentifier = (token: string) => `hub-mcp-request:${secretHash(token)}`;
const codeIdentifier = (code: string) => `hub-mcp-code:${secretHash(code)}`;
const knownScope = (value: unknown): value is HubScope => value === "hub:read" || value === "hub:write";

export type PendingRequest = { clientId: string; clientName: string; redirectUri: string; state: string | null; codeChallenge: string; scopes: HubScope[] };
export type CodeGrant = PendingRequest & { userId: string };

function readPending(value: string): PendingRequest | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const scopes = Array.isArray(parsed.scopes) ? parsed.scopes.filter(knownScope) : [];
    if (typeof parsed.clientId !== "string" || typeof parsed.redirectUri !== "string" || typeof parsed.codeChallenge !== "string" || !scopes.length) return null;
    return {
      clientId: parsed.clientId,
      clientName: typeof parsed.clientName === "string" ? parsed.clientName : "Claude",
      redirectUri: parsed.redirectUri,
      state: typeof parsed.state === "string" ? parsed.state : null,
      codeChallenge: parsed.codeChallenge,
      scopes,
    };
  } catch {
    return null;
  }
}

/** Keeps a checked authorization request until the admin answers; the returned key goes into the consent page's address. */
export async function savePendingRequest(request: PendingRequest) {
  const token = newSecret();
  await sql("delete from auth.verifications where identifier like 'hub-mcp-%' and expires_at < now() - interval '1 day'");
  await sql("insert into auth.verifications (id, identifier, value, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))", [
    randomUUID(), requestIdentifier(token), JSON.stringify(request), REQUEST_SECONDS,
  ]);
  return token;
}

export async function readPendingRequest(token: string) {
  if (!SECRET.test(token)) return null;
  const row = (await sql<{ value: string }>("select value from auth.verifications where identifier = $1 and expires_at > now()", [requestIdentifier(token)])).rows[0];
  return row ? readPending(row.value) : null;
}

/** Answers the request once: whoever takes it first (allow or refuse), the second gets null. */
export async function takePendingRequest(token: string) {
  if (!SECRET.test(token)) return null;
  const row = (await sql<{ value: string; expires_at: Date }>("delete from auth.verifications where identifier = $1 returning value, expires_at", [requestIdentifier(token)])).rows[0];
  return row && new Date(row.expires_at).getTime() > Date.now() ? readPending(row.value) : null;
}

/** The one-time code for Claude after „Erlauben“, five minutes long. */
export async function issueCode(grant: CodeGrant) {
  const code = newSecret();
  await sql("insert into auth.verifications (id, identifier, value, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))", [
    randomUUID(), codeIdentifier(code), JSON.stringify(grant), CODE_SECONDS,
  ]);
  return code;
}

export async function takeCode(code: string): Promise<CodeGrant | null> {
  if (!SECRET.test(code)) return null;
  const row = (await sql<{ value: string; expires_at: Date }>("delete from auth.verifications where identifier = $1 returning value, expires_at", [codeIdentifier(code)])).rows[0];
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  const pending = readPending(row.value);
  const userId = (() => {
    try {
      return String((JSON.parse(row.value) as { userId?: unknown }).userId ?? "");
    } catch {
      return "";
    }
  })();
  return pending && /^[0-9a-f-]{36}$/i.test(userId) ? { ...pending, userId } : null;
}

/** Still an active hub admin, not banned: the same as is_hub_admin() in the database, checked on every use. */
const ACTIVE_ADMIN = `exists (
  select 1 from auth.users u join public.hub_profiles p on p.user_id = u.id
  where u.id = c.user_id and p.status = 'active' and coalesce(u.raw_app_meta_data ->> 'app_role', '') = 'oalab_admin'
    and (u.banned_until is null or u.banned_until <= now())
)`;

export type Keys = { access: string; refresh: string };

/**
 * A new connection after the code exchange; one per admin and app, so a new „Erlauben“ replaces the old one. Null
 * when the admin is no active admin any more.
 */
export async function connect(grant: { userId: string; clientId: string; clientName: string; scopes: HubScope[] }): Promise<Keys | null> {
  const keys = { access: newSecret(), refresh: newSecret() };
  await sql("delete from public.hub_claude_connections where refresh_expires_at < now() - interval '7 days'");
  const saved = await sql(
    `insert into public.hub_claude_connections as c (user_id, client_id, client_name, scopes, access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at)
     select $1, $2, $3, $4, $5, now() + make_interval(secs => $6), $7, now() + make_interval(secs => $8)
     where exists (select 1 from auth.users u join public.hub_profiles p on p.user_id = u.id
       where u.id = $1 and p.status = 'active' and coalesce(u.raw_app_meta_data ->> 'app_role', '') = 'oalab_admin'
         and (u.banned_until is null or u.banned_until <= now()))
     on conflict (user_id, client_id) do update set client_name = excluded.client_name, scopes = excluded.scopes,
       access_token_hash = excluded.access_token_hash, access_expires_at = excluded.access_expires_at,
       refresh_token_hash = excluded.refresh_token_hash, refresh_expires_at = excluded.refresh_expires_at,
       previous_refresh_hash = null, rotated_at = null, created_at = now(), last_used_at = null
     returning c.id`,
    [grant.userId, grant.clientId, grant.clientName.slice(0, 120), grant.scopes, secretHash(keys.access), ACCESS_TOKEN_SECONDS, secretHash(keys.refresh), REFRESH_TOKEN_SECONDS],
  );
  return saved.rowCount ? keys : null;
}

export type Rotation = { ok: true; keys: Keys; scopes: HubScope[]; userId: string } | { ok: false; reused?: { userId: string; clientName: string } };

/**
 * A refresh: new keys for the old refresh key, in one statement, so two racing refreshes cannot both win. A refresh
 * key that was already replaced ends the connection (somebody else may hold it), unless the replacement is only
 * seconds old (Claude asking twice at once).
 */
export async function rotate(refreshToken: string, clientId: string | null): Promise<Rotation> {
  if (!SECRET.test(refreshToken)) return { ok: false };
  const hash = secretHash(refreshToken);
  const keys = { access: newSecret(), refresh: newSecret() };
  const rotated = (await sql<{ user_id: string; scopes: string[] }>(
    `update public.hub_claude_connections c set access_token_hash = $3, access_expires_at = now() + make_interval(secs => $4),
       refresh_token_hash = $5, refresh_expires_at = now() + make_interval(secs => $6), previous_refresh_hash = c.refresh_token_hash, rotated_at = now()
     where c.refresh_token_hash = $1 and ($2::text is null or c.client_id = $2) and c.refresh_expires_at > now() and ${ACTIVE_ADMIN}
     returning c.user_id, c.scopes`,
    [hash, clientId, secretHash(keys.access), ACCESS_TOKEN_SECONDS, secretHash(keys.refresh), REFRESH_TOKEN_SECONDS],
  )).rows[0];
  if (rotated) return { ok: true, keys, scopes: rotated.scopes.filter(knownScope), userId: rotated.user_id };

  // Expired, or no longer an admin: the connection is gone for good.
  await sql("delete from public.hub_claude_connections where refresh_token_hash = $1", [hash]);
  const reused = (await sql<{ user_id: string; client_name: string }>(
    `delete from public.hub_claude_connections where previous_refresh_hash = $1 and rotated_at < now() - make_interval(secs => $2)
     returning user_id, client_name`,
    [hash, ROTATION_GRACE_SECONDS],
  )).rows[0];
  return reused ? { ok: false, reused: { userId: reused.user_id, clientName: reused.client_name } } : { ok: false };
}

export type Connection = { id: string; userId: string; email: string; clientName: string; scopes: HubScope[] };

/** The connection behind an access key, if it is valid and its admin still is one. */
export async function authenticate(accessToken: string): Promise<Connection | null> {
  if (!SECRET.test(accessToken)) return null;
  const row = (await sql<{ id: string; user_id: string; email: string; client_name: string; scopes: string[]; stale: boolean }>(
    `select c.id, c.user_id, u.email, c.client_name, c.scopes,
       (c.last_used_at is null or c.last_used_at < now() - interval '5 minutes') as stale
     from public.hub_claude_connections c join auth.users u on u.id = c.user_id
     where c.access_token_hash = $1 and c.access_expires_at > now() and ${ACTIVE_ADMIN}`,
    [secretHash(accessToken)],
  )).rows[0];
  if (!row) return null;
  if (row.stale) await sql("update public.hub_claude_connections set last_used_at = now() where id = $1", [row.id]);
  return { id: row.id, userId: row.user_id, email: row.email, clientName: row.client_name, scopes: row.scopes.filter(knownScope) };
}

export type ConnectionView = { id: string; clientName: string; scopes: HubScope[]; createdAt: string; lastUsedAt: string | null };

/** The admin's own connections for the card „Verbundene Apps“. */
export async function listConnections(userId: string): Promise<ConnectionView[]> {
  const rows = await sql<{ id: string; client_name: string; scopes: string[]; created_at: Date; last_used_at: Date | null }>(
    `select id, client_name, scopes, created_at, last_used_at from public.hub_claude_connections
     where user_id = $1 and refresh_expires_at > now() order by created_at desc`,
    [userId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    clientName: row.client_name || "Claude",
    scopes: row.scopes.filter(knownScope),
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  }));
}

/** Ends one of the admin's own connections; Claude's keys stop working at once. */
export async function disconnect(userId: string, connectionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return null;
  const row = (await sql<{ client_name: string }>("delete from public.hub_claude_connections where id = $1 and user_id = $2 returning client_name", [connectionId, userId])).rows[0];
  return row ? row.client_name || "Claude" : null;
}

/** RFC 7009: Claude gives back one of its keys; the connection ends. Unknown keys are no error. */
export async function revoke(token: string, clientId: string | null) {
  if (!SECRET.test(token)) return null;
  const hash = secretHash(token);
  return (await sql<{ user_id: string; client_name: string }>(
    `delete from public.hub_claude_connections where (access_token_hash = $1 or refresh_token_hash = $1) and ($2::text is null or client_id = $2)
     returning user_id, client_name`,
    [hash, clientId],
  )).rows[0] ?? null;
}

/** One line in the admin log (Hub › Logins), like the other admin actions; failures do not stop the connector. */
export async function logEvent(actorId: string, action: `claude.${string}`, summary: string) {
  const db = createAdminClient();
  if (!db) return;
  await db.from("hub_admin_events").insert({ actor_id: actorId, action, summary: summary.slice(0, 300) }).then(() => undefined, () => undefined);
}
