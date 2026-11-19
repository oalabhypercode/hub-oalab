/**
 * Several files to one customer at once (user 19.11.2026): out of the Ablage, from another customer or from „Alle
 * Dateien“, with the button „Zuordnen“ or by dragging them onto the customer in the list. Pure rules and texts, so
 * tests check them directly; lib/hub-files/actions.ts (assignFiles) does the writing.
 */

/** Where the files come from: the Ablage, „Alle Dateien“ (they keep their customers) or one customer. */
export type AssignSource = { kind: "inbox" } | { kind: "all" } | { kind: "customer"; id: string; company: string };

/** At the customer they come from, files leave (Verschieben, the default) or stay as well (Auch behalten). */
export type AssignMode = "move" | "keep";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The panel's second line: how many files and from where. */
export function assignSubtitle(count: number, source: AssignSource) {
  const files = plural(count, "Datei", "Dateien");
  return source.kind === "inbox" ? `${files} aus der Ablage` : source.kind === "all" ? `${files} aus „Alle Dateien“` : `${files} von ${source.company}`;
}

/** The main button: what it does, with the number once there is more than one file. */
export function assignLabel(count: number, source: AssignSource, mode: AssignMode) {
  const [word, verb] = source.kind === "customer" && mode === "move" ? ["Verschieben", "verschieben"] : source.kind === "inbox" ? ["Zuordnen", "zuordnen"] : ["Freigeben", "freigeben"];
  return count > 1 ? `${count} Dateien ${verb}` : word;
}

/**
 * The line above the list once the files are there. `added` counts the files that were not at the customer yet; files
 * that were keep their folder unless one was chosen.
 */
export function assignMessage(input: { count: number; added: number; company: string; folder: string | null; source: AssignSource; mode: AssignMode }) {
  const { count, added, company, folder, source, mode } = input;
  const files = plural(count, "Datei", "Dateien");
  if (!added && !folder && !(source.kind === "customer" && mode === "move")) return count === 1 ? `Die Datei liegt schon bei ${company}.` : `Die Dateien liegen schon bei ${company}.`;
  const where = folder ? ` in „${folder}“` : "";
  if (source.kind === "customer") {
    return mode === "move" ? `${files} von ${source.company} zu ${company}${where} verschoben.` : `${files} zusätzlich bei ${company}${where} abgelegt. ${source.company} behält sie.`;
  }
  if (source.kind === "all") return `${files} auch für ${company}${where} freigegeben.`;
  return folder ? `${files} ${company} zugeordnet und in „${folder}“ abgelegt.` : `${files} ${company} zugeordnet.`;
}
