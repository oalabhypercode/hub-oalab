import "server-only";
import { platformPool, sql } from "@/lib/platform/db";
import { usesOwnPlatform } from "@/lib/platform/config";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FEED_FETCHES_PER_HOUR, FEED_IDLE_DAYS, FEED_TOKEN, feedOptionsFor, feedRoleOf, feedTokenHash, newFeedToken,
  type FeedClient, type FeedFetch, type FeedOptions, type FeedRole,
} from "./feed";
import type { FeedView } from "./types";

export type { FeedView };

// What the calendar subscription keeps (migration service-oalab 202611220001_hub_calendar_feeds): one row per link in
// hub_calendar_feeds, at most one active per login, with only the SHA-256 of the key. All of it as the app role on the
// server, after the session was checked (lib/hub-calendar/actions.ts) or for the feed's own address (the key); no login
// reads any of it through PostgREST. The appointments themselves are read per fetch with the person's rights
// (lib/hub-calendar/feed-server.ts).

/** The subscription runs on the own platform, where the hub reads with a person's claims without their session. */
export const feedReady = () => usesOwnPlatform();

const HUB_ROLES = { admin: "oalab_admin", customer: "oalab_customer", freelancer: "oalab_freelancer" } as const;
const CLIENTS = new Set<FeedClient>(["apple", "google", "microsoft", "other"]);


type FeedRow = { id: string; user_id: string; role: string; options: unknown; created_at: Date; last_fetched_at: Date | null; last_client: string | null };

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);
function toView(row: FeedRow, role: FeedRole): FeedView {
  return {
    id: row.id,
    options: feedOptionsFor(role, row.options),
    createdAt: new Date(row.created_at).toISOString(),
    lastFetchedAt: iso(row.last_fetched_at),
    lastClient: row.last_client && CLIENTS.has(row.last_client as FeedClient) ? row.last_client as FeedClient : null,
  };
}

/**
 * Whether the login may still hold its feed, as SQL on `f` (the feed) joined with `u` (auth.users) and `p`
 * (hub_profiles): an active profile, not banned, still the role it had when the feed was created, and fetched (or
 * created) within the last 180 days. Anything else ends the feed for good.
 */
const STILL_VALID = `(p.status = 'active' and (u.banned_until is null or u.banned_until <= now())
  and coalesce(u.raw_app_meta_data ->> 'app_role', '') = f.role
  and coalesce(f.last_fetched_at, f.created_at) > now() - make_interval(days => ${FEED_IDLE_DAYS}))`;

const ACTIVE_OF_LOGIN = `select f.id, f.user_id, f.role, f.options, f.created_at, f.last_fetched_at, f.last_client, ${STILL_VALID} as valid
  from public.hub_calendar_feeds f join auth.users u on u.id = f.user_id left join public.hub_profiles p on p.user_id = f.user_id
  where f.user_id = $1 and f.revoked_at is null`;

async function revoke(id: string) {
  await sql("update public.hub_calendar_feeds set revoked_at = now() where id = $1 and revoked_at is null", [id]);
}

/** The login's active feed, or null; one that may no longer be held ends here. */
export async function activeFeed(userId: string, role: FeedRole): Promise<FeedView | null> {
  const row = (await sql<FeedRow & { valid: boolean }>(ACTIVE_OF_LOGIN, [userId])).rows[0];
  if (!row) return null;
  if (!row.valid || row.role !== HUB_ROLES[role]) {
    await revoke(row.id);
    return null;
  }
  return toView(row, role);
}

/** Whether a login has an active feed: its appointment mails then carry one sentence instead of the four buttons. */
export async function loginsWithFeed(userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await sql<{ user_id: string }>(
    `select f.user_id from public.hub_calendar_feeds f join auth.users u on u.id = f.user_id left join public.hub_profiles p on p.user_id = f.user_id
     where f.user_id = any($1::uuid[]) and f.revoked_at is null and ${STILL_VALID}`,
    [userIds],
  );
  return new Set(rows.rows.map((row) => row.user_id));
}

/**
 * A new feed, or a new link for the existing one („Neuen Link erzeugen“): the active row ends and a new one takes its
 * place in one transaction, so the old link stops at once. The key leaves this function once and is never stored.
 * `renewed`: there was an active feed before.
 */
export async function createFeed(userId: string, role: FeedRole, options: FeedOptions): Promise<{ token: string; view: FeedView; renewed: boolean }> {
  const token = newFeedToken();
  const client = await platformPool().connect();
  try {
    await client.query("begin");
    // Old links that ended long ago are of no use to anyone.
    await client.query("delete from public.hub_calendar_feeds where revoked_at < now() - interval '30 days'");
    const ended = await client.query("update public.hub_calendar_feeds set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
    const saved = await client.query<FeedRow>(
      `insert into public.hub_calendar_feeds (user_id, role, token_hash, options) values ($1, $2, $3, $4::jsonb)
       returning id, user_id, role, options, created_at, last_fetched_at, last_client`,
      [userId, HUB_ROLES[role], feedTokenHash(token), JSON.stringify(feedOptionsFor(role, options))],
    );
    await client.query("commit");
    return { token, view: toView(saved.rows[0], role), renewed: (ended.rowCount ?? 0) > 0 };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** What is in the feed, from the next fetch on; null without an active feed. */
export async function saveFeedOptions(userId: string, role: FeedRole, options: FeedOptions): Promise<FeedView | null> {
  const row = (await sql<FeedRow>(
    `update public.hub_calendar_feeds set options = $2::jsonb where user_id = $1 and revoked_at is null
     returning id, user_id, role, options, created_at, last_fetched_at, last_client`,
    [userId, JSON.stringify(feedOptionsFor(role, options))],
  )).rows[0];
  return row ? toView(row, role) : null;
}

/** „Abo beenden“ and every automatic end: the link stops at once. How many feeds ended (0 or 1). */
export async function endFeedsOf(userId: string) {
  return (await sql("update public.hub_calendar_feeds set revoked_at = now() where user_id = $1 and revoked_at is null", [userId])).rowCount ?? 0;
}

/**
 * One fetch of the feed's address: the key must belong to an active feed whose login may still hold it (else the feed
 * ends and the answer is the same as for a key that never existed), and the feed may be fetched at most 60 times an
 * hour. A counted fetch notes when and with what kind of program it came.
 */
export async function takeFeedFetch(token: string, client: FeedClient): Promise<FeedFetch> {
  if (!FEED_TOKEN.test(token)) return { ok: false, reason: "unknown" };
  const row = (await sql<{ id: string; user_id: string; role: string; options: unknown; valid: boolean; counted: number; window_left: number | null }>(
    `select f.id, f.user_id, f.role, f.options, ${STILL_VALID} as valid,
       case when f.fetch_window_at > now() - interval '1 hour' then f.fetch_count else 0 end as counted,
       extract(epoch from (f.fetch_window_at + interval '1 hour' - now()))::int as window_left
     from public.hub_calendar_feeds f join auth.users u on u.id = f.user_id left join public.hub_profiles p on p.user_id = f.user_id
     where f.token_hash = $1 and f.revoked_at is null`,
    [feedTokenHash(token)],
  )).rows[0];
  const role = row ? feedRoleOf(row.role) : null;
  if (!row || !role) return { ok: false, reason: "unknown" };
  if (!row.valid) {
    await revoke(row.id);
    await logFeedEvent(null, row.user_id, "calendar.feed_expired", "Kalender-Abo von selbst beendet: Zugang, Rolle oder lange nicht abgerufen");
    return { ok: false, reason: "unknown" };
  }
  if (Number(row.counted) >= FEED_FETCHES_PER_HOUR) return { ok: false, reason: "limited", retryAfter: Math.max(60, Number(row.window_left ?? 3600)) };
  await sql(
    `update public.hub_calendar_feeds set
       fetch_count = case when fetch_window_at > now() - interval '1 hour' then fetch_count + 1 else 1 end,
       fetch_window_at = case when fetch_window_at > now() - interval '1 hour' then fetch_window_at else now() end,
       last_fetched_at = now(), last_client = $2
     where id = $1 and revoked_at is null`,
    [row.id, client],
  );
  return { ok: true, userId: row.user_id, role, options: feedOptionsFor(role, row.options) };
}

/**
 * A line in the login's history (user management › Verlauf) and with it in the admin log: creating, renewing and
 * ending a feed. `actorId` null for what ended by itself. Failures do not stop the feed.
 */
export async function logFeedEvent(actorId: string | null, userId: string, action: `calendar.${string}`, summary: string) {
  const db = createAdminClient();
  if (!db) return;
  await db.from("hub_admin_events").insert({ actor_id: actorId, target_user_id: userId, action, summary: summary.slice(0, 300) })
    .then(() => undefined, () => undefined);
}
