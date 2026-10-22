/** Search and sort rules shared by the hub's tables (projects, files). Self-contained so `node --test` can load it directly. */

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };
export type SortValue = string | number;

/** Lower case without accents, so "uber" finds "über" and "strasse" finds "Straße". */
export function foldText(text: string) {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replaceAll("ß", "ss");
}

/** Keyword search: every word of the query has to appear in one of the fields. An empty query matches everything. */
export function matchesSearch(query: string, fields: readonly (string | null | undefined)[]) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = foldText(fields.filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}

const collator = new Intl.Collator("de-DE", { numeric: true, sensitivity: "base" });

export function compareValues(a: SortValue, b: SortValue) {
  return typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
}

/**
 * Sorts a copy of `rows` by `value` in `dir`. `group` keeps rows apart whatever the direction (completed projects stay last);
 * `tieBreak` orders equal values (always ascending), otherwise the original order stays.
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir, options: { group?: (row: T) => number; tieBreak?: (row: T) => SortValue } = {}) {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) =>
      (options.group ? options.group(a.row) - options.group(b.row) : 0)
      || sign * compareValues(value(a.row), value(b.row))
      || (options.tieBreak ? compareValues(options.tieBreak(a.row), options.tieBreak(b.row)) : 0)
      || a.index - b.index)
    .map(({ row }) => row);
}

/** Clicking the sorted column flips the direction; another column starts with its own first direction. */
export function nextSort<K extends string>(current: SortState<K>, key: K, firstDir: SortDir = "asc"): SortState<K> {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir };
}
