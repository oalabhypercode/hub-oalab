import "server-only";
import { HUB_FILES_BUCKET } from "@/lib/hub-files/catalog";
import { usesOwnPlatform } from "@/lib/platform/config";
import { sql } from "@/lib/platform/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { isNoteImageFolder, NOTE_IMAGE_FOLDERS_SQL, NOTE_IMAGE_GRACE_HOURS, NOTE_IMAGE_SWEEP_HOURS, NOTE_IMAGES_SQL, removableNoteImages, type StoredNoteImage } from "./images";

// Removes the images of the notes that nothing names any more (rules in lib/hub-notes/images.ts): previews of link
// cards that were never saved or whose last version left the history, and covers or previews of pages deleted for
// good. It runs on the hub's schedule every six hours and right after „Endgültig löschen“ and the trash's 30-day limit
// for that customer. Like the sweep of abandoned uploads it reads as the app role on the own platform: the documents
// stay in the database, only names come back. A failed read removes nothing; elsewhere the images simply stay.

const MAX_PER_RUN = 500;
const BATCH = 100;

export type NoteImageSweep = { removed: number; failed: number };

/** One customer's folder, or every folder with an image older than the grace period. Never throws. */
export async function sweepNoteImages(customerId?: string): Promise<NoteImageSweep> {
  const result: NoteImageSweep = { removed: 0, failed: 0 };
  try {
    if (!usesOwnPlatform()) return result;
    const db = createAdminClient();
    if (!db) return result;
    const folders = customerId !== undefined
      ? [customerId.toLowerCase()]
      : (await sql<{ customer: string }>(NOTE_IMAGE_FOLDERS_SQL, [HUB_FILES_BUCKET, NOTE_IMAGE_GRACE_HOURS])).rows.map((row) => row.customer);
    for (const customer of folders.filter(isNoteImageFolder)) {
      if (result.removed >= MAX_PER_RUN) break;
      try {
        const { rows } = await sql<StoredNoteImage>(NOTE_IMAGES_SQL, [HUB_FILES_BUCKET, customer, `notes/${customer}/`]);
        const unused = removableNoteImages(rows, customer).slice(0, MAX_PER_RUN - result.removed);
        for (let start = 0; start < unused.length; start += BATCH) {
          const removed = await db.storage.from(HUB_FILES_BUCKET).remove(unused.slice(start, start + BATCH));
          if (removed.error) result.failed += 1;
          else result.removed += removed.data?.length ?? 0;
        }
      } catch {
        result.failed += 1;
      }
    }
  } catch {
    result.failed += 1;
  }
  if (result.removed) console.info(`[hub-notes] removed ${result.removed} unused note images`);
  if (result.failed) console.error(`[hub-notes] note image sweep failed ${result.failed} time(s)`);
  return result;
}

let lastScheduled = 0;

/** The schedule's call (app/api/notifications/sweep, every five minutes): one sweep every six hours per server process. */
export async function sweepNoteImagesOnSchedule(now = Date.now()): Promise<NoteImageSweep | null> {
  if (now - lastScheduled < NOTE_IMAGE_SWEEP_HOURS * 3_600_000) return null;
  lastScheduled = now;
  return sweepNoteImages();
}
