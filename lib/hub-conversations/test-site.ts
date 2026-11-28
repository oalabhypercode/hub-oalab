import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicHttpsUrl, type TestSiteView } from "./work-status";

// „Zuletzt angepasst“ of a project's test site (26.11.2026), as on the service platform (apps/web/server/test-site.ts in
// service-oalab). The site itself says when it was built (`Last-Modified`, static pages on Vercel send it), so a change
// shows even when the AI never reported it (OA-14, 25.11.2026); without that header the newest result reported for the
// project counts. Asked at most once a minute per address, on a short leash, only https on public host names. Callers
// checked that an active admin reads; everything here runs with the server key.

const TTL_MS = 60_000;
const FAIL_TTL_MS = 30_000;
const TIMEOUT_MS = 2_500;
const stamps = new Map<string, { readonly until: number; readonly value: string | null }>();

async function head(url: URL): Promise<Response> {
  const once = (target: URL, method: "HEAD" | "GET") => fetch(target, {
    method,
    redirect: "manual",
    cache: "no-store",
    headers: { "user-agent": "oalab-Hub/Testseiten-Stand" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let response = await once(url, "HEAD");
  // One hop of a redirect, and only to another public https address.
  if (response.status >= 300 && response.status < 400) {
    const next = response.headers.get("location");
    const target = next ? publicHttpsUrl(new URL(next, url).toString()) : null;
    if (!target) return response;
    response = await once(target, "HEAD");
    url = target;
  }
  if (response.status === 405 || response.status === 501) {
    response = await once(url, "GET");
    void response.body?.cancel().catch(() => undefined);
  }
  return response;
}

/** When the site was built by its own word, or `null` (dynamic pages, errors, no header). */
export async function siteStamp(value: string, now = Date.now()): Promise<string | null> {
  const url = publicHttpsUrl(value);
  if (!url) return null;
  const key = url.toString();
  const hit = stamps.get(key);
  if (hit && hit.until > now) return hit.value;
  let stamp: string | null = null;
  try {
    const response = await head(url);
    const header = response.ok ? response.headers.get("last-modified") : null;
    const at = header ? Date.parse(header) : Number.NaN;
    // A date in the future, or one made on this very visit, says nothing about the last change.
    if (Number.isFinite(at) && at <= now + 5 * 60_000 && now - at > 5_000) stamp = new Date(at).toISOString();
  } catch {
    stamp = null;
  }
  stamps.set(key, { until: now + (stamp ? TTL_MS : FAIL_TTL_MS), value: stamp });
  if (stamps.size > 300) for (const [entry, cached] of stamps) if (cached.until <= now) stamps.delete(entry);
  return stamp;
}

const iso = (value: string | null | undefined): string | null => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
};

/** The newer of the site's own stamp and the newest reported result. */
export async function testSiteView(url: string | null, reportedAt: string | null): Promise<TestSiteView | null> {
  const address = publicHttpsUrl(url);
  if (!url || !address) return null;
  const site = await siteStamp(url);
  const reported = iso(reportedAt);
  if (site && (!reported || site >= reported)) return { url: address.toString(), updatedAt: site, source: "site" };
  return { url: address.toString(), updatedAt: reported, source: reported ? "result" : null };
}

const chunks = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/** The newest result reported for any of these requests (`business_release_reviews`), or `null`. */
async function newestReview(db: SupabaseClient, requestIds: readonly string[]): Promise<string | null> {
  const parts = await Promise.all(chunks(requestIds, 100).map((part) => db.from("business_release_reviews").select("created_at")
    .in("request_id", part).order("created_at", { ascending: false }).limit(1).returns<{ created_at: string }[]>()));
  let newest: string | null = null;
  for (const part of parts) {
    const at = part.error ? null : part.data?.[0]?.created_at ?? null;
    if (at && (!newest || Date.parse(at) > Date.parse(newest))) newest = at;
  }
  return newest;
}

/**
 * The test site per service request: the address of the request's project and the newer of its own date and the
 * newest result reported for any request of that project (the test site belongs to the project). A decoration: what
 * cannot be read stays `null`.
 */
export async function testSitesFor(db: SupabaseClient, requests: readonly { readonly id: string; readonly project_id: string | null }[]): Promise<Map<string, TestSiteView | null>> {
  const result = new Map<string, TestSiteView | null>(requests.map((request) => [request.id, null]));
  const projectIds = [...new Set(requests.map((request) => request.project_id).filter((id): id is string => Boolean(id)))].slice(0, 40);
  if (!projectIds.length) return result;
  const projects = await db.from("customer_projects").select("id, test_url").in("id", projectIds).returns<{ id: string; test_url: string | null }[]>();
  if (projects.error) return result;
  const views = new Map<string, TestSiteView | null>(await Promise.all((projects.data ?? []).map(async (project) => {
    if (!publicHttpsUrl(project.test_url)) return [project.id, null] as const;
    const siblings = await db.from("service_requests").select("id").eq("project_id", project.id).limit(500).returns<{ id: string }[]>();
    const reported = siblings.error ? null : await newestReview(db, (siblings.data ?? []).map((row) => row.id));
    return [project.id, await testSiteView(project.test_url, reported)] as const;
  })));
  for (const request of requests) result.set(request.id, request.project_id ? views.get(request.project_id) ?? null : null);
  return result;
}

/** The test sites of service requests by id, for the list; requests in the bin stay out. `null` when the read failed. */
export async function testSitesForRequests(db: SupabaseClient, ids: readonly string[]): Promise<Record<string, TestSiteView | null> | null> {
  const requests = await db.from("service_requests").select("id, project_id").in("id", [...ids]).is("trashed_at", null)
    .returns<{ id: string; project_id: string | null }[]>();
  if (requests.error) return null;
  return Object.fromEntries(await testSitesFor(db, requests.data ?? []));
}

/**
 * Per result message of a request: how many people the e-mail „Neue Testansicht bereit“ reached (service-oalab
 * migration 202611260001). Without the queue's kind or the right to read it, none; the line then names no e-mail.
 */
export async function previewMails(db: SupabaseClient, requestId: string): Promise<Record<string, number>> {
  const { data, error } = await db.from("reply_email_deliveries").select("message_id, user_id").eq("request_id", requestId)
    .eq("kind", "preview").eq("state", "sent").limit(500).returns<{ message_id: string; user_id: string }[]>();
  if (error) return {};
  const people = new Map<string, Set<string>>();
  for (const row of data ?? []) people.set(row.message_id, (people.get(row.message_id) ?? new Set()).add(row.user_id));
  return Object.fromEntries([...people].map(([messageId, users]) => [messageId, users.size]));
}

/**
 * Per result message: when the customer pressed „Gefällt mir“ on it (`audit_events` `client.preview_approved`, one per
 * result, migration 202610180001). A decoration of the thread: without it (no rights, failed read) none shows.
 */
export async function previewApprovals(db: SupabaseClient, requestId: string): Promise<Record<string, string>> {
  const { data, error } = await db.from("audit_events").select("target_id, occurred_at").eq("action", "client.preview_approved")
    .eq("result", "success").eq("safe_metadata->>requestId", requestId).limit(200).returns<{ target_id: string | null; occurred_at: string }[]>();
  if (error) return {};
  return Object.fromEntries((data ?? []).flatMap((row) => row.target_id ? [[row.target_id, row.occurred_at]] : []));
}
