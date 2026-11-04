/**
 * Ali's welcome at the top of a customer's overview (components/hub/welcome-stage.tsx) plays once per sign-in. The
 * pre-paint script below marks <html data-host="pending"> on the hub page a login opens, that is where the greeting
 * after sign-in is on (lib/greeting.ts, whose script runs just before), and in the design preview once per tab. The
 * stage plays after the greeting has given way and takes the mark off; every later visit shows Ali standing with his
 * bubble. Self-contained (no imports) for the tests.
 */

export const HOST_PREVIEW_KEY = "oalab-host-preview";
/** Ali's message in the bubble appears as he starts to speak, its second line with his next words (seconds). */
export const HOST_CUES = [0.5, 1.45] as const;
/** Ali thinking in Nachrichten (components/hub/messages-host.tsx): two small circles, his thought bubble, its last line. */
export const THINK_CUES = [0.6, 0.72, 0.85, 1.7] as const;

/** Whether this page plays the welcome: right after a sign-in, or on the design preview's first visit in this tab. */
export function hostPending(path: string, greeting: string | undefined, previewSeen: boolean) {
  if (greeting === "on") return true;
  return (path === "/preview" || path.startsWith("/preview/")) && !previewSeen;
}

/** How many of these cues the video has passed at this time. */
export function cueCount(cues: readonly number[], seconds: number) {
  let cue = 0;
  while (cue < cues.length && seconds >= cues[cue]) cue++;
  return cue;
}

/** How many cues of HOST_CUES the video has passed at this time. */
export function hostCue(seconds: number) {
  return cueCount(HOST_CUES, seconds);
}

/** Inline script for the root layout, after the greeting's: marks the welcome before the first paint, so Ali waits hidden. */
export function hostInlineScript() {
  return `(function(){try{var r=document.documentElement,s=false;try{s=sessionStorage.getItem(${JSON.stringify(HOST_PREVIEW_KEY)})!==null}catch(e){}if((${hostPending.toString()})(location.pathname,r.dataset.greeting,s))r.dataset.host="pending"}catch(e){}})()`;
}

/** The welcome starts: no more mark on <html>, and the preview remembers it for this tab. */
export function consumeHost(root: HTMLElement, preview: boolean) {
  delete root.dataset.host;
  if (!preview) return;
  try {
    sessionStorage.setItem(HOST_PREVIEW_KEY, "1");
  } catch {
    // Without storage the preview plays again on its next visit; nothing else depends on it.
  }
}
