import "server-only";
import { createClient } from "@/lib/supabase/server";
import { secondFactorMissing } from "@/lib/hub-auth/second-factor";
import { HUB_FILES_BUCKET } from "./catalog";
import { PREVIEW_EDGE, PREVIEW_MAX_PIXELS, previewKind, type PreviewSize } from "./preview";
import { renderPreview, type RenderedPreview } from "./preview-render";

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

/** Two images at a time at most: the server has two cores, and a large photo takes a moment and some memory. */
const MAX_RUNNING = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_RUNNING) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

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
  const stored = await supabase.storage.from(HUB_FILES_BUCKET).download(file.storage_path);
  if (stored.error || !stored.data) return { status: 503 };
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  const preview = await inTurn(() => renderPreview(bytes, { edge: PREVIEW_EDGE[size], quality: size === "s" ? 76 : 82, maxPixels: PREVIEW_MAX_PIXELS }));
  if (!preview) return { status: 415 };
  remember(key, preview);
  return { status: 200, ...preview };
}
