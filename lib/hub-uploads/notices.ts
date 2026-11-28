import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBytes } from "@/lib/hub-files/catalog";
import { uploadExpiringNotice, uploadReceivedNotice, UPLOADS_HREF, type Notice } from "@/lib/hub-notify/rules";
import { telegramUploadReceived } from "@/lib/hub-telegram/rules";
import { sendTelegram } from "@/lib/hub-telegram/server";

/*
 * The upload area's lines for the admins, once per run of the schedule (28.11.2026): a new file (bell, mail and the
 * team's Telegram group) and, a day before a file goes, a reminder (bell and mail). Each upload carries when it was
 * told (notified_at, reminded_at); the mark comes first, so two runs never tell twice. Before the database knows the
 * upload area the reads fail and the run moves on.
 */

const DAY_MS = 86_400_000;
const BATCH = 50;
const whenFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type UploadRow = { id: string; customer_id: string; file_name: string; size_bytes: number; uploaded_by: string | null; expires_at: string | null };
type Hooks = { admins: () => Promise<string[]>; insert: (userIds: string[], notice: Notice) => Promise<number> };

export async function collectUploadNotices(db: SupabaseClient, origin: string, { admins, insert }: Hooks, now = Date.now()) {
  const columns = "id, customer_id, file_name, size_bytes, uploaded_by, expires_at";
  const [fresh, soon] = await Promise.all([
    db.from("hub_uploads").select(columns).eq("status", "waiting").is("notified_at", null).order("completed_at").limit(BATCH).returns<UploadRow[]>(),
    db.from("hub_uploads").select(columns).eq("status", "waiting").is("reminded_at", null).lte("expires_at", new Date(now + DAY_MS).toISOString()).order("expires_at").limit(BATCH).returns<UploadRow[]>(),
  ]);
  if (fresh.error || soon.error) return { error: "uploads" };
  const rows = [...(fresh.data ?? []), ...(soon.data ?? [])];
  if (!rows.length) return { received: 0, expiring: 0 };

  const customerIds = [...new Set(rows.map((row) => row.customer_id))];
  const uploaderIds = [...new Set(rows.map((row) => row.uploaded_by).filter((id): id is string => Boolean(id)))];
  const [customers, profiles] = await Promise.all([
    db.from("hub_customers").select("id, company").in("id", customerIds).returns<{ id: string; company: string }[]>(),
    uploaderIds.length ? db.from("hub_profiles").select("user_id, first_name, last_name").in("user_id", uploaderIds).returns<{ user_id: string; first_name: string; last_name: string }[]>() : Promise.resolve({ data: [] as { user_id: string; first_name: string; last_name: string }[] }),
  ]);
  const companyOf = new Map((customers.data ?? []).map((row) => [row.id, row.company]));
  const nameOf = new Map((profiles.data ?? []).map((row) => [row.user_id, `${row.first_name} ${row.last_name}`.trim()]));
  const recipients = await admins();
  const stamp = new Date(now).toISOString();
  let received = 0;
  let expiring = 0;

  for (const row of fresh.data ?? []) {
    const marked = await db.from("hub_uploads").update({ notified_at: stamp }).eq("id", row.id).is("notified_at", null).select("id");
    if (marked.error || !marked.data?.length) continue;
    const company = companyOf.get(row.customer_id) ?? "";
    const uploader = row.uploaded_by ? nameOf.get(row.uploaded_by) ?? "" : "";
    const size = formatBytes(Number(row.size_bytes));
    // The bell line first, then the group: a failing Telegram never costs the line.
    await insert(recipients, uploadReceivedNotice({ fileName: row.file_name, company, size, uploader }));
    await sendTelegram(telegramUploadReceived({ company, uploader, fileName: row.file_name, size, url: `${origin}${UPLOADS_HREF}` }));
    received += 1;
  }
  for (const row of soon.data ?? []) {
    if (!row.expires_at) continue;
    const marked = await db.from("hub_uploads").update({ reminded_at: stamp }).eq("id", row.id).is("reminded_at", null).select("id");
    if (marked.error || !marked.data?.length) continue;
    await insert(recipients, uploadExpiringNotice({ fileName: row.file_name, company: companyOf.get(row.customer_id) ?? "", when: `${whenFormat.format(Date.parse(row.expires_at))} Uhr` }));
    expiring += 1;
  }
  return { received, expiring };
}
