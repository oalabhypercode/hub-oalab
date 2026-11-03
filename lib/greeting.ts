/**
 * Greeting after sign-in (components/hub/hub-greeting.tsx). Right before the login page leaves, it notes the greeting
 * in sessionStorage; the pre-paint script of the hub page it opens turns the note into <html data-greeting> before the
 * first paint, so the greeting covers the loading hub from the start. Self-contained (no imports) for the tests.
 */

export const GREETING_STORAGE_KEY = "oalab-greeting";
/** A note older than this belongs to a login that never reached the hub (code page, waiting room) and is dropped. */
const GREETING_NOTE_TTL = 20_000;
/** If the hub page never reports back (a script error), the greeting still gives way after this long. */
const GREETING_FALLBACK = 8_000;

/** Hub addresses a login opens with the greeting; the code page, the waiting room and the Service platform don't. */
export function greetsAt(path: string) {
  return path === "/dashboard" || path.startsWith("/dashboard/") || path.startsWith("/dashboard?");
}

/** Notes the greeting for the hub page the login opens next; without a first name it greets without one. */
export function noteGreeting(firstName: string) {
  try {
    sessionStorage.setItem(GREETING_STORAGE_KEY, JSON.stringify({ at: Date.now(), name: firstName.trim().slice(0, 40) }));
  } catch {
    // Without storage the hub opens as before, just without the greeting.
  }
}

/** Shows the greeting on <html> for a fresh note; shared by the inline script and the tests. */
export function applyGreeting(note: unknown, root: HTMLElement, now: number, shownAt: number, ttl: number) {
  const { at, name } = (note ?? {}) as { at?: unknown; name?: unknown };
  if (typeof at !== "number" || now < at || now - at > ttl) return false;
  root.dataset.greeting = "on";
  root.dataset.greetingAt = String(Math.round(shownAt));
  const firstName = typeof name === "string" ? name.trim().slice(0, 40) : "";
  if (firstName) {
    root.dataset.greetingName = "";
    // A CSS string: app/loader.css writes it after "Willkommen zurück,".
    root.style.setProperty("--greeting-name", JSON.stringify(firstName));
  }
  return true;
}

/** Takes the greeting off <html> once it has faded out. */
export function clearGreeting(root: HTMLElement) {
  delete root.dataset.greeting;
  delete root.dataset.greetingAt;
  delete root.dataset.greetingName;
  root.style.removeProperty("--greeting-name");
}

/** Inline script for the root layout: greets on the hub page a login opens, before its first paint; reads the note once. */
export function greetingInlineScript() {
  return `(function(){try{if(!(${greetsAt.toString()})(location.pathname))return;var k=${JSON.stringify(GREETING_STORAGE_KEY)};var s=sessionStorage.getItem(k);if(!s)return;sessionStorage.removeItem(k);var r=document.documentElement;if(!(${applyGreeting.toString()})(JSON.parse(s),r,Date.now(),performance.now(),${GREETING_NOTE_TTL}))return;setTimeout(function(){if(r.dataset.greeting!=="on")return;r.dataset.greeting="leaving";setTimeout(function(){(${clearGreeting.toString()})(r)},600)},${GREETING_FALLBACK})}catch(e){}})()`;
}
