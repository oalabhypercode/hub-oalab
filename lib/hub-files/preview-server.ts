import "server-only";
import { createClient } from "@/lib/supabase/server";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { HUB_FILES_BUCKET } from "./catalog";
import { PREVIEW_EDGE, PREVIEW_MAX_PIXELS, previewKind, type PreviewSize } from "./preview";
import { renderPreview, type RenderedPreview } from "./preview-render";
import { createTurns } from "./turns";

/**
 * The preview of one stored file for the signed-in person (app/api/files/[id]/preview). Row Level Security decides as
 * for a download: whoever may read the file's record and its bytes gets the picture, nobody else. Every request checks
 * that first; only then a finished preview may come from the memory below.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PreviewResult = ({ status: 200 } & RenderedPreview) | { status: 401 | 404 | 415 | 503 };

/** Finished previews, the most recently used last, up to about 48 MB, so a second look costs no work. */
const CACHE_BYTES = 48 * 1024 * 1024;
const cache = new Map<string, RenderedPreview>();
let cachedBytes = 0;

function remember(key: string, preview: RenderedPreview) {
  if (preview.data.byteLength > CACHE_BYTES / 8) return;
  cache.set(key, preview);
  cachedBytes += preview.data.byteLength;
  for (const [oldKey, old] of cache) {
    if (cachedBytes <= CACHE_BYTES) break;
    cache.delete(oldKey);
    cachedBytes -= old.data.byteLength;
  }
}

function recall(key: string) {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/**
 * One image at a time, from loading the original to the finished preview: the hub may use 512 MB in all. On 23.11.2026
 * the tiles of a customer with 40 large photos asked for 36 previews at once; each loaded its original (up to 9 MB,
 * several copies) before waiting for its turn, and the system stopped the hub twice for lack of memory. Now a request
 * waits before it loads anything (36 previews take a few seconds), and gives up after 40 s; the browser asks once more.
 */
const inTurn = createTurns(1, 40_000);

export async function filePreview(fileId: string, size: PreviewSize): Promise<PreviewResult> {
  if (!uuid.test(fileId)) return { status: 404 };
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims) return { status: 401 };
  // A login with the e-mail code sees previews only after confirming it, like downloads (lib/hub-files/actions.ts).
  if (await secondFactorMissing(supabase, claims.claims.aal)) return { status: 401 };
  const { data: file } = await supabase.from("hub_files").select("storage_path, file_name, mime_type").eq("id", fileId)
    .maybeSingle<{ storage_path: string; file_name: string; mime_type: string }>();
  if (!file) return { status: 404 };
  if (previewKind(file.file_name, file.mime_type) !== "image") return { status: 415 };

  const key = `${fileId.toLowerCase()}:${size}`;
  const known = recall(key);
  if (known) return { status: 200, ...known };
  const result = await inTurn(async (): Promise<PreviewResult> => {
    // Another request for the same picture may have finished while this one waited.
    const done = recall(key);
    if (done) return { status: 200, ...done };
    const stored = await supabase.storage.from(HUB_FILES_BUCKET).download(file.storage_path);
    if (stored.error || !stored.data) return { status: 503 };
    const preview = await renderPreview(new Uint8Array(await stored.data.arrayBuffer()), { edge: PREVIEW_EDGE[size], quality: size === "s" ? 76 : 82, maxPixels: PREVIEW_MAX_PIXELS });
    if (!preview) return { status: 415 };
    remember(key, preview);
    return { status: 200, ...preview };
  });
  return result === "busy" ? { status: 503 } : result;
}
