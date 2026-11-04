/**
 * Cues for Ali from oalab: his welcome at the top of a customer's overview (components/hub/welcome-stage.tsx) and his
 * thinking along in Nachrichten (components/hub/messages-host.tsx). Both play each time their page opens; with
 * "Bewegung reduzieren" he stands there with the finished bubble. Self-contained (no imports) for the tests.
 */

/** Ali's message in the bubble appears as he starts to speak, its second line with his next words (seconds). */
export const HOST_CUES = [0.5, 1.45] as const;
/** Ali thinking in Nachrichten (components/hub/messages-host.tsx): two small circles, his thought bubble, its last line. */
export const THINK_CUES = [0.6, 0.72, 0.85, 1.7] as const;

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
