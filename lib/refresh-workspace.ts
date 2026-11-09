import "server-only";
import { refresh } from "next/cache";

/**
 * After a change in a Server Action: the current page shows fresh data, and no other hub page the browser keeps
 * in its short-lived cache (staleTimes in next.config.ts) shows the old state on the next click.
 *
 * Only `refresh()`, never `revalidatePath`/`revalidateTag`: every hub page reads its data per request, so there is
 * nothing on the server to purge. Purging made Next.js rebuild the prerendered shells of /dashboard/[section] at
 * runtime, which fails (the loading shell reads the pathname), and every subpage answered 500 on a full load until
 * the next deployment (10.11.2026).
 */
export function refreshWorkspace() {
  refresh();
}
