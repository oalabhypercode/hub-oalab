/**
 * Keyboard and search rules of the hub's own lists (components/hub/select.tsx): arrow keys, Home/End, typing to jump and
 * the marked part of a suggestion. Self-contained (no imports) so tests can check it directly.
 */

/** The next option that can be chosen, `step` away from `from`, wrapping around the ends; -1 if none can be chosen. */
export function stepIndex(disabled: readonly boolean[], from: number, step: 1 | -1): number {
  const count = disabled.length;
  if (count === 0) return -1;
  let index = from;
  for (let tries = 0; tries < count; tries += 1) {
    index = from < 0 && tries === 0 ? (step === 1 ? 0 : count - 1) : (index + step + count) % count;
    if (!disabled[index]) return index;
  }
  return -1;
}

/** The first or last option that can be chosen; -1 if none can be chosen. */
export function edgeIndex(disabled: readonly boolean[], edge: "first" | "last"): number {
  const indices = disabled.map((_, index) => index);
  if (edge === "last") indices.reverse();
  return indices.find((index) => !disabled[index]) ?? -1;
}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").toLowerCase();

/**
 * Typing on a closed or open list jumps to the next option whose label starts with what was typed, after the current one
 * and wrapping around; case and accents do not matter. -1 if nothing fits.
 */
export function typeaheadIndex(labels: readonly string[], disabled: readonly boolean[], typed: string, from: number): number {
  const query = fold(typed.trimStart());
  if (!query) return -1;
  const count = labels.length;
  // A repeated single letter cycles through the options with that letter; longer input searches from the current one on.
  const start = query.length === 1 ? from + 1 : Math.max(from, 0);
  for (let offset = 0; offset < count; offset += 1) {
    const index = (start + offset + count) % count;
    if (!disabled[index] && fold(labels[index]).startsWith(query)) return index;
  }
  return -1;
}

/** A suggestion split around the first place it contains the typed text (ignoring case), to show that part in bold. */
export function highlightParts(label: string, typed: string): { text: string; hit: boolean }[] {
  const query = typed.trim().toLocaleLowerCase("de-DE");
  const at = query ? label.toLocaleLowerCase("de-DE").indexOf(query) : -1;
  if (at < 0) return [{ text: label, hit: false }];
  return [
    { text: label.slice(0, at), hit: false },
    { text: label.slice(at, at + query.length), hit: true },
    { text: label.slice(at + query.length), hit: false },
  ].filter((part) => part.text);
}

/** Lists with more options than this get a search field on top. */
export const SEARCH_FROM = 10;
