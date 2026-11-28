import "server-only";
import { HUB_FILES_BUCKET } from "@/lib/hub-files/catalog";
import { asRole } from "@/lib/platform/db";
import { multipart } from "@/lib/platform/storage";

/*
 * What the upload area no longer keeps, once per run of the schedule (28.11.2026):
 * - waiting uploads after their 7 days, and uploads that never finished within a day;
 * - bytes under uploads/ that lost their row (the customer was deleted, or a run stopped halfway).
 * The bytes go first, then the row and its catalog entry; a failure leaves the row for the next run. Before the
 * database knows the upload area there is nothing to do.
 */

const BATCH = 50;

export async function sweepExpiredUploads() {
  return asRole("service_role", null, async (client) => {
    const known = await client.query<{ table: string | null }>("select to_regclass('public.hub_uploads')::text as table");
    if (!known.rows[0]?.table) return { expired: 0, orphans: 0 };

    const due = await client.query<{ id: string; storage_path: string; upload_ref: string | null; status: string }>(
      `select id, storage_path, upload_ref, status from public.hub_uploads
       where (status = 'waiting' and expires_at <= now()) or (status = 'uploading' and created_at < now() - interval '1 day')
       order by created_at limit $1`,
      [BATCH],
    );
    let expired = 0;
    for (const row of due.rows) {
      try {
        if (row.status === "uploading" && row.upload_ref) await multipart.abort(HUB_FILES_BUCKET, row.storage_path, row.upload_ref);
        await multipart.remove(HUB_FILES_BUCKET, row.storage_path);
      } catch (error) {
        console.error("[hub-uploads] expiry: bytes stay for the next run", error instanceof Error ? error.message : error);
        continue;
      }
      await client.query("delete from public.hub_uploads where id = $1", [row.id]);
      await client.query("delete from storage.objects where bucket_id = $1 and name = $2", [HUB_FILES_BUCKET, row.storage_path]);
      expired += 1;
    }

    const lost = await client.query<{ name: string }>(
      `select o.name from storage.objects o
       where o.bucket_id = $1 and o.name like 'uploads/%' and o.created_at < now() - interval '2 hours'
         and not exists (select 1 from public.hub_uploads u where u.storage_path = o.name)
         and not exists (select 1 from public.hub_files f where f.storage_path = o.name)
       order by o.created_at limit $2`,
      [HUB_FILES_BUCKET, BATCH],
    );
    let orphans = 0;
    for (const { name } of lost.rows) {
      try {
        await multipart.remove(HUB_FILES_BUCKET, name);
      } catch {
        continue;
      }
      await client.query("delete from storage.objects where bucket_id = $1 and name = $2", [HUB_FILES_BUCKET, name]);
      orphans += 1;
    }
    return { expired, orphans };
  });
}
