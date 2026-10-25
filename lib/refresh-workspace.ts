import "server-only";
import { revalidatePath } from "next/cache";

/**
 * After a change in a Server Action: the current page shows fresh data, and no other hub page the browser keeps
 * in its short-lived cache (staleTimes in next.config.ts) shows the old state on the next click.
 */
export function refreshWorkspace() {
  revalidatePath("/dashboard", "layout");
}
