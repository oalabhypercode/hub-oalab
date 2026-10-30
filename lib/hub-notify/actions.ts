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

/** Marks notices as read: the given ones, or all unread ones without a list. */
export async function markNoticesRead(ids?: number[]): Promise<Result<null>> {
  const session = await signedIn();
  if (!session) return notSignedIn;
  const list = Array.isArray(ids) ? ids.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 100) : null;
  if (list && !list.length) return { ok: true, data: null };
  let update = session.supabase.from("hub_inbox").update({ read_at: new Date().toISOString() }).eq("user_id", session.userId).is("read_at", null);
  if (list) update = update.in("id", list);
  const { error } = await update;
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
