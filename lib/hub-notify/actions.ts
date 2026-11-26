"use server";

import { refreshWorkspace } from "@/lib/refresh-workspace";
import { createClient } from "@/lib/supabase/server";

// Every action is a public POST endpoint: authenticate inside each one. RLS lets a login read and mark only its own
// notices; the mail setting is the login's own metadata.

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const notSignedIn = { ok: false as const, error: "Dafür brauchst du einen echten Login." };

async function signedIn() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return error || !data?.claims ? null : { supabase, userId: data.claims.sub };
}

/** Notice ids from the browser: whole positive numbers, at most a hundred (the bell lists no more unread lines). */
const noticeIds = (ids: unknown) => Array.isArray(ids) ? ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0).slice(0, 100) : null;

/** Marks notices as read: the given ones, or all unread ones without a list. */
export async function markNoticesRead(ids?: number[]): Promise<Result<null>> {
  const session = await signedIn();
  if (!session) return notSignedIn;
  const list = noticeIds(ids);
  if (list && !list.length) return { ok: true, data: null };
  let update = session.supabase.from("hub_inbox").update({ read_at: new Date().toISOString() }).eq("user_id", session.userId).is("read_at", null);
  if (list) update = update.in("id", list);
  const { error } = await update;
  if (error) return { ok: false, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
  refreshWorkspace();
  return { ok: true, data: null };
}

/**
 * „Rückgängig“ in the bell (23.11.2026): the given notices are unread again, so they come back into the bell. Only the
 * login's own rows; RLS allows a login to change read_at of its own notices and nothing else.
 */
export async function markNoticesUnread(ids: number[]): Promise<Result<null>> {
  const session = await signedIn();
  if (!session) return notSignedIn;
  const list = noticeIds(ids);
  if (!list?.length) return { ok: true, data: null };
  const { error } = await session.supabase.from("hub_inbox").update({ read_at: null }).eq("user_id", session.userId).in("id", list).not("read_at", "is", null);
  if (error) return { ok: false, error: "Das hat gerade nicht geklappt. Bitte versuche es erneut." };
  refreshWorkspace();
  return { ok: true, data: null };
}

export async function getMailNotifications(): Promise<Result<{ enabled: boolean }>> {
  const session = await signedIn();
  if (!session) return notSignedIn;
  const { data, error } = await session.supabase.auth.getUser();
  if (error || !data.user) return { ok: false, error: "Die Einstellung konnte nicht geladen werden." };
  return { ok: true, data: { enabled: data.user.user_metadata?.hub_mail_notifications !== false } };
}

export async function setMailNotifications(enabled: boolean): Promise<Result<{ enabled: boolean }>> {
  const session = await signedIn();
  if (!session) return notSignedIn;
  const { error } = await session.supabase.auth.updateUser({ data: { hub_mail_notifications: enabled === true } });
  if (error) return { ok: false, error: "Die Einstellung konnte nicht gespeichert werden." };
  return { ok: true, data: { enabled: enabled === true } };
}

type PreviewMailRow = { enabled?: unknown; customer?: unknown } | null;

/**
 * „Neue Testansicht per E-Mail“ (26.11.2026): the service platform's e-mail when a new test view is ready, the same
 * switch as under „Updates erhalten“ there. Read with the login's own session (public.hub_preview_email, service-oalab
 * migration 202611260001), which answers only for customers of the service platform. `null`: no customer there, or
 * the server does not know the switch yet; the profile then shows no row.
 */
export async function getPreviewMail(): Promise<Result<{ enabled: boolean } | null>> {
  const session = await signedIn();
  if (!session) return notSignedIn;
  const { data, error } = await session.supabase.rpc("hub_preview_email");
  const row = data as PreviewMailRow;
  if (error || row?.customer !== true) return { ok: true, data: null };
  return { ok: true, data: { enabled: row.enabled !== false } };
}

/** Switches it for every company the customer belongs to on the service platform. */
export async function setPreviewMail(enabled: boolean): Promise<Result<{ enabled: boolean }>> {
  if (typeof enabled !== "boolean") return { ok: false, error: "Die Einstellung konnte nicht gespeichert werden." };
  const session = await signedIn();
  if (!session) return notSignedIn;
  const { data, error } = await session.supabase.rpc("hub_set_preview_email", { enabled });
  const row = data as PreviewMailRow;
  if (error || row?.customer !== true) return { ok: false, error: "Die Einstellung konnte nicht gespeichert werden. Bitte versuche es erneut." };
  return { ok: true, data: { enabled: row.enabled === true } };
}
