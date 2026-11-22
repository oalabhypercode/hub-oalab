import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { openSecret, sealSecret, type SealedSecret } from "@/lib/hub-vault/crypto";
import { vaultKey } from "@/lib/hub-vault/key";
import { CALENDAR_PATH } from "./paths";
import { graphBusy, icsBusy, scheduleBody, scheduleOutcomes, scheduleWindows, type BusySpan, type BusyWindow, type ScheduleItem } from "./external-busy";
import {
  microsoftConfig, readCalendarLink, SOURCE_ALERT_HOURS, SOURCE_EVERY_MINUTES, SOURCE_WEEKS, sourceLabel,
  type MicrosoftConfig, type SourceProvider, type SourceRules, type SourceView,
} from "./sources-rules";

// The other calendars of the availability (stage 2, migration service-oalab 202611220002): sources in
// hub_calendar_sources, their busy times in hub_calendar_external_busy, both only for the service role. Admins add
// sources through lib/hub-calendar/actions.ts after the admin check; the schedule (app/api/notifications/sweep) reads
// each source every ten minutes. A public link is sealed with HUB_VAULT_KEY before it reaches the database and opened
// only here, to fetch it; the panel never gets it back.

type Db = NonNullable<ReturnType<typeof createAdminClient>>;
type SourceRow = {
  id: string;
  owner_id: string;
  kind: "ics" | "microsoft";
  provider: SourceProvider;
  name: string;
  mailbox: string | null;
  ignore_all_day: boolean;
  ignore_free: boolean;
  created_at: string;
  last_fetched_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  failing_since: string | null;
  alerted_at: string | null;
  busy_count: number;
};
type SecretRow = SourceRow & { link_key_version: number | null; link_iv: string | null; link_tag: string | null; link_ciphertext: string | null };

const COLUMNS = "id, owner_id, kind, provider, name, mailbox, ignore_all_day, ignore_free, created_at, last_fetched_at, last_success_at, last_error, failing_since, alerted_at, busy_count";
const SECRET_COLUMNS = `${COLUMNS}, link_key_version, link_iv, link_tag, link_ciphertext`;
const ownerOf = (id: string) => ({ kind: "calendar-source" as const, id });
const MINUTE = 60_000;
/** A calendar file larger than this is no calendar the team keeps by hand. */
const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export const sourcesClient = () => createAdminClient();
export const missingSourcesTable = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /hub_calendar_sources|schema cache/i.test(error.message ?? "")));

function toView(row: SourceRow, ownerName: string | null): SourceView {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    name: row.name,
    mailbox: row.kind === "microsoft" ? row.mailbox : null,
    rules: { ignoreAllDay: row.ignore_all_day, ignoreFree: row.ignore_free },
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
    failingSince: row.failing_since,
    lastError: row.last_error,
    busyCount: row.busy_count,
    ownerName,
  };
}

/** Every source, the oldest first; for sources of another admin their name. Never a link. */
export async function listSources(db: Db, viewerId: string): Promise<{ sources: SourceView[]; error: { code?: string; message?: string } | null }> {
  const { data, error } = await db.from("hub_calendar_sources").select(COLUMNS).order("created_at").returns<SourceRow[]>();
  if (error) return { sources: [], error };
  const others = [...new Set((data ?? []).map((row) => row.owner_id).filter((id) => id !== viewerId))];
  const names = new Map<string, string>();
  if (others.length) {
    const profiles = await db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", others).returns<{ user_id: string; first_name: string | null; last_name: string | null }[]>();
    for (const row of profiles.data ?? []) names.set(row.user_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim());
  }
  return { sources: (data ?? []).map((row) => toView(row, row.owner_id === viewerId ? null : names.get(row.owner_id) || "einem anderen Admin")), error: null };
}

export type SourceWrite = { ok: true; id: string } | { ok: false; error: string };

/** A public calendar link, sealed with the vault key under the new source's id. */
export async function insertLinkSource(db: Db, ownerId: string, input: { url: string; provider: "icloud" | "outlook"; name: string; rules: SourceRules }): Promise<SourceWrite> {
  const key = vaultKey();
  if (!key) return { ok: false, error: "Auf dem Server fehlt der Schlüssel für die Verschlüsselung (HUB_VAULT_KEY). Ohne ihn speichert der Hub keinen Kalender-Link." };
  const id = randomUUID();
  const sealed = sealSecret(key, ownerOf(id), input.url);
  const { error } = await db.from("hub_calendar_sources").insert({
    id, owner_id: ownerId, kind: "ics", provider: input.provider, name: input.name,
    link_key_version: sealed.keyVersion, link_iv: sealed.iv, link_tag: sealed.authTag, link_ciphertext: sealed.ciphertext,
    ignore_all_day: input.rules.ignoreAllDay, ignore_free: input.rules.ignoreFree,
  });
  return error ? { ok: false, error: missingSourcesTable(error) ? "Für andere Kalender fehlt noch die Erweiterung der Datenbank." : "Der Kalender konnte nicht gespeichert werden." } : { ok: true, id };
}

export async function insertMailboxSource(db: Db, ownerId: string, input: { mailbox: string; name: string; rules: SourceRules }): Promise<SourceWrite> {
  const id = randomUUID();
  const { error } = await db.from("hub_calendar_sources").insert({
    id, owner_id: ownerId, kind: "microsoft", provider: "microsoft", name: input.name, mailbox: input.mailbox,
    ignore_all_day: input.rules.ignoreAllDay, ignore_free: input.rules.ignoreFree,
  });
  return error ? { ok: false, error: missingSourcesTable(error) ? "Für andere Kalender fehlt noch die Erweiterung der Datenbank." : "Das Postfach konnte nicht gespeichert werden." } : { ok: true, id };
}

/** „Link neu einfügen“ for a link source that stopped working: the new link replaces the old one, sealed again. */
export async function replaceLink(db: Db, id: string, input: { url: string; provider: "icloud" | "outlook" }): Promise<SourceWrite> {
  const key = vaultKey();
  if (!key) return { ok: false, error: "Auf dem Server fehlt der Schlüssel für die Verschlüsselung (HUB_VAULT_KEY)." };
  const sealed = sealSecret(key, ownerOf(id), input.url);
  const { data, error } = await db.from("hub_calendar_sources").update({
    provider: input.provider, link_key_version: sealed.keyVersion, link_iv: sealed.iv, link_tag: sealed.authTag, link_ciphertext: sealed.ciphertext,
    last_fetched_at: null, last_error: null, failing_since: null, alerted_at: null,
  }).eq("id", id).eq("kind", "ics").select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Diesen Kalender gibt es nicht mehr." };
  return { ok: true, id };
}

export async function saveRules(db: Db, id: string, rules: SourceRules) {
  const { data, error } = await db.from("hub_calendar_sources").update({ ignore_all_day: rules.ignoreAllDay, ignore_free: rules.ignoreFree, last_fetched_at: null })
    .eq("id", id).select("id, name, provider").maybeSingle<{ id: string; name: string; provider: SourceProvider }>();
  return error ? null : data;
}

/** Removes a source; its busy times go with it, so they block nothing from now on. */
export async function deleteSource(db: Db, id: string) {
  const { data, error } = await db.from("hub_calendar_sources").delete().eq("id", id).select("id, name, provider").maybeSingle<{ id: string; name: string; provider: SourceProvider }>();
  return error ? null : data;
}

/* ---------- Reading the sources ---------- */

type Outcome = { ok: true; spans: BusySpan[] } | { ok: false; error: string };

/**
 * A public calendar's file: only https to iCloud or Outlook, every redirect checked the same way, at most 15 seconds
 * and 5 MB. Errors come back as short codes (sources-rules.ts FETCH_ERRORS).
 */
async function fetchCalendar(link: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let url = link;
  for (let hop = 0; hop < 4; hop++) {
    const checked = readCalendarLink(url);
    if (!checked.ok) return { ok: false, error: hop ? "redirect" : "not-calendar" };
    let response: Response;
    try {
      response = await fetch(checked.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "text/calendar, */*;q=0.5", "User-Agent": "oalab-client-hub/1.0 (calendar busy times)" },
      });
    } catch (error) {
      return { ok: false, error: (error as { name?: string } | null)?.name === "TimeoutError" ? "timeout" : "network" };
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return { ok: false, error: "redirect" };
      url = new URL(next, checked.url).toString();
      continue;
    }
    if (response.status === 404 || response.status === 410) return { ok: false, error: "gone" };
    if (response.status === 401 || response.status === 403) return { ok: false, error: "denied" };
    if (response.status >= 500) return { ok: false, error: "server" };
    if (!response.ok) return { ok: false, error: "network" };
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return { ok: false, error: "too-large" };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, error: "network" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done || !value) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel().catch(() => undefined); return { ok: false, error: "too-large" }; }
      chunks.push(value);
    }
    return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
  }
  return { ok: false, error: "redirect" };
}

let graphKey: { value: string; until: number; client: string } | null = null;

/** The app's token for Microsoft Graph (client credentials), kept until shortly before it runs out. */
async function graphToken(config: MicrosoftConfig): Promise<string | null> {
  if (graphKey && graphKey.client === config.client && graphKey.until > Date.now()) return graphKey.value;
  const body = new URLSearchParams({ client_id: config.client, client_secret: config.secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
    method: "POST", body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => null);
  if (!response?.ok) return null;
  const json = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  if (typeof json?.access_token !== "string") return null;
  const seconds = typeof json.expires_in === "number" ? json.expires_in : 3600;
  graphKey = { value: json.access_token, until: Date.now() + Math.max(60, seconds - 120) * 1000, client: config.client };
  return graphKey.value;
}

/**
 * Free/busy of the given mailboxes through getSchedule, in parts of six weeks and twenty mailboxes. Only status, start
 * and end of the items are kept (external-busy.ts); a mailbox outside what the app may read comes back as an error.
 */
async function mailboxItems(config: MicrosoftConfig, mailboxes: string[], window: BusyWindow): Promise<Map<string, { ok: true; items: ScheduleItem[] } | { ok: false; error: string }>> {
  const result = new Map<string, { ok: true; items: ScheduleItem[] } | { ok: false; error: string }>();
  const token = await graphToken(config);
  if (!token) {
    for (const mailbox of mailboxes) result.set(mailbox, { ok: false, error: "graph-auth" });
    return result;
  }
  for (const mailbox of mailboxes) result.set(mailbox, { ok: true, items: [] });
  for (let index = 0; index < mailboxes.length; index += 20) {
    const group = mailboxes.slice(index, index + 20);
    for (const part of scheduleWindows(window)) {
      const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(group[0])}/calendar/getSchedule`, {
        method: "POST",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'outlook.timezone="UTC"' },
        body: JSON.stringify(scheduleBody(group, part)),
      }).catch(() => null);
      const code = !response ? "graph" : response.status === 401 ? "graph-auth" : response.status === 403 || response.status === 404 ? "graph-mailbox" : response.ok ? null : "graph";
      if (code === "graph-auth") graphKey = null;
      const outcomes = code ? null : scheduleOutcomes(await response!.json().catch(() => null), group);
      for (const mailbox of group) {
        const current = result.get(mailbox);
        if (!current?.ok) continue;
        const outcome = outcomes?.get(mailbox);
        if (!outcome || !outcome.ok) result.set(mailbox, { ok: false, error: code ?? (outcome && !outcome.ok ? outcome.error : "graph") });
        else current.items.push(...outcome.items);
      }
    }
  }
  return result;
}

export type SyncReport = { checked: number; ok: number; failed: number; alerted: number; skipped?: string };

/**
 * One run of the schedule: every source that was not read in the last ten minutes (or just the one given), read and
 * its busy times replaced in one step. A source that fails keeps its last times; after 24 hours its owner gets a
 * notice in the bell, once, until it works again.
 */
export async function syncCalendarSources(options: { only?: string; now?: Date } = {}): Promise<SyncReport> {
  const db = createAdminClient();
  if (!db) return { checked: 0, ok: 0, failed: 0, alerted: 0, skipped: "no-db" };
  const now = options.now ?? new Date();
  const { data, error } = await db.from("hub_calendar_sources").select(SECRET_COLUMNS).returns<SecretRow[]>();
  if (error) return { checked: 0, ok: 0, failed: 0, alerted: 0, skipped: missingSourcesTable(error) ? "no-table" : "read" };
  // A little early, so the five-minute schedule reads each source every ten minutes and not every fifteen.
  const dueBefore = now.getTime() - (SOURCE_EVERY_MINUTES - 1) * MINUTE;
  const due = (data ?? []).filter((row) => options.only ? row.id === options.only : !row.last_fetched_at || Date.parse(row.last_fetched_at) <= dueBefore);
  const window: BusyWindow = { from: now.getTime(), to: now.getTime() + SOURCE_WEEKS * 7 * 86_400_000 };
  const outcomes = new Map<string, Outcome>();

  // Public links, one after the other.
  const key = vaultKey();
  for (const row of due.filter((item) => item.kind === "ics")) {
    const sealed: SealedSecret | null = row.link_ciphertext && row.link_iv && row.link_tag && row.link_key_version
      ? { keyVersion: row.link_key_version, iv: row.link_iv, authTag: row.link_tag, ciphertext: row.link_ciphertext } : null;
    const link = key && sealed ? openSecret(key, ownerOf(row.id), sealed) : null;
    if (!link) { outcomes.set(row.id, { ok: false, error: "no-key" }); continue; }
    const fetched = await fetchCalendar(link);
    if (!fetched.ok) { outcomes.set(row.id, fetched); continue; }
    const parsed = icsBusy(fetched.text, { ignoreAllDay: row.ignore_all_day, ignoreFree: row.ignore_free }, window);
    outcomes.set(row.id, parsed.ok ? { ok: true, spans: parsed.spans } : { ok: false, error: parsed.error });
  }

  // Mailboxes in Microsoft 365, all in one go; each source applies its own rules.
  const mailboxRows = due.filter((item) => item.kind === "microsoft" && item.mailbox);
  if (mailboxRows.length) {
    const config = microsoftConfig(process.env);
    const items = config ? await mailboxItems(config, [...new Set(mailboxRows.map((row) => row.mailbox!.toLowerCase()))], window) : null;
    for (const row of mailboxRows) {
      const answer = items?.get(row.mailbox!.toLowerCase());
      if (!config || !answer) outcomes.set(row.id, { ok: false, error: config ? "graph" : "no-config" });
      else outcomes.set(row.id, answer.ok ? { ok: true, spans: graphBusy(answer.items, { ignoreAllDay: row.ignore_all_day, ignoreFree: row.ignore_free }, window) } : answer);
    }
  }

  const report: SyncReport = { checked: due.length, ok: 0, failed: 0, alerted: 0 };
  for (const row of due) {
    const outcome = outcomes.get(row.id) ?? { ok: false, error: "network" };
    if (outcome.ok) {
      const saved = await db.rpc("hub_calendar_replace_busy", { source: row.id, spans: outcome.spans.map((span) => [new Date(span.start).toISOString(), new Date(span.end).toISOString()]) });
      if (!saved.error) { report.ok += 1; continue; }
    }
    report.failed += 1;
    const failingSince = row.failing_since ?? now.toISOString();
    const alert = !row.alerted_at && now.getTime() - Date.parse(failingSince) >= SOURCE_ALERT_HOURS * 3_600_000;
    await db.from("hub_calendar_sources").update({
      last_fetched_at: now.toISOString(), last_error: outcome.ok ? "server" : outcome.error.slice(0, 200), failing_since: failingSince,
      ...(alert ? { alerted_at: now.toISOString() } : {}),
    }).eq("id", row.id);
    if (alert) {
      // Bell only, for the admin who added it: until it works again, the last times keep blocking.
      const { error: noticeError } = await db.from("hub_inbox").insert({
        user_id: row.owner_id, kind: "calendar.source", mail_state: "skipped",
        title: `Kalender nicht erreichbar: ${sourceLabel(row)}`.slice(0, 200),
        body: "Seit mehr als 24 Stunden. Bis er wieder geht, gelten die zuletzt gelesenen Zeiten. Prüf ihn unter Verfügbarkeit.",
        href: `${CALENDAR_PATH}?avail=1`,
      });
      if (!noticeError) report.alerted += 1;
    }
  }
  return report;
}

/* ---------- The admins' calendar ---------- */

export type PrivateBlock = { start: number; end: number; source: string };

/** Busy times of the other calendars for the admins' week: grey blocks „Privat“ with where they come from. */
export async function loadPrivateBlocks(from: string, to: string): Promise<PrivateBlock[]> {
  const db = createAdminClient();
  if (!db) return [];
  const { data, error } = await db.from("hub_calendar_external_busy").select("starts_at, ends_at, source:hub_calendar_sources(name, provider)")
    .lt("starts_at", to).gt("ends_at", from).order("starts_at").limit(2000)
    .returns<{ starts_at: string; ends_at: string; source: { name: string; provider: SourceProvider } | null }[]>();
  if (error) return [];
  return (data ?? []).map((row) => ({ start: Date.parse(row.starts_at), end: Date.parse(row.ends_at), source: row.source ? sourceLabel(row.source) : "anderer Kalender" }));
}
