/**
 * The connector's notes tools („Notizen“ under Projekte, since 23.11.2026): the pages of a customer as a tree, a page
 * as Markdown (lib/hub-notes/markdown.ts), the search, writing pages and subpages and, for the team, „Sichtbar für“,
 * „Änderung mitteilen“, meeting notes at appointments, the history and the trash. „Endgültig löschen“ stays in the hub.
 * Admins and freelancers share the tools: a freelancer's Claude sees list, read, search, create and update only, and
 * the database's rules decide what it reaches (pages released to freelancers; writing only „Nur Freelancer“).
 * lib/hub-mcp/notes.ts runs them through the notes' own code. Only definitions here, so tests load them directly.
 */
import { MAX_MARKDOWN } from "../hub-notes/markdown";
import { MAX_TITLE } from "../hub-notes/rules";
import type { HubScope } from "./config";
import type { ToolDefinition } from "./protocol";

export type NotesRole = "admin" | "freelancer";
type NotesTool = Omit<ToolDefinition, "description"> & { description: string | Record<NotesRole, string>; scope: HubScope; roles: readonly NotesRole[] };

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** Every change asks first in Claude (destructive), as for appointments and tasks. */
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const uuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const id = (description: string) => ({ type: "string", pattern: uuidPattern, description });
const DAY = "^\\d{4}-\\d{2}-\\d{2}$";
const BOTH = ["admin", "freelancer"] as const;
const TEAM = ["admin"] as const;

/** How Claude writes a page: Markdown plus the hub's own blocks as `oalab:` links on a line of their own. */
export const NOTE_MARKDOWN_HELP = [
  "Inhalt als Markdown: # bis ### Überschriften, **fett**, *kursiv*, ~~durchgestrichen~~, <u>unterstrichen</u>, `Code`, Links mit https: oder mailto:, Listen (-, 1.), Checklisten (- [ ] / - [x]), Tabellen (| … |), Codeblöcke (```), Trennlinie (---), Hinweisbox (> 💡 Text), Aufklapper (<details><summary>Titel</summary> … </details>); jede neue Zeile ist ein Zeilenumbruch.",
  "Blöcke des Hubs je als eigene Zeile: [Titel](oalab:task/<project_id>/<task_number>) für eine Aufgabe (mehrere solche Zeilen untereinander ergeben eine Aufgabenbox; im Satz ist sie eine Erwähnung), [Titel](oalab:tasklist/<project_id>) für die offenen Aufgaben eines Projekts, [Titel](oalab:project/<project_id>), [Titel](oalab:appointment/<appointment_id>), [Titel](oalab:page/<page_id>) für eine Unterseite und [Titel](https://… \"Linkkarte\") für eine Linkkarte. Aufgaben, Projekte und Termine müssen zum Kunden der Seite gehören.",
].join(" ");

const CONTENT = { type: "string", maxLength: MAX_MARKDOWN, description: "Inhalt als Markdown (Format wie in der Beschreibung von create_note)." };

const tools: NotesTool[] = [
  {
    name: "list_notes",
    title: "Notizseiten auflisten",
    description: {
      admin: "Die Notizseiten eines Kunden (Notizen unter Projekte) als Baum in der Reihenfolge des Hubs: Titel, Symbol, Ebene, Projekt, „Sichtbar für“, Datum, wer zuletzt geändert hat, mit IDs für read_note und update_note. Dazu die Projekte des Kunden (für project_id) und die Stufen von „Sichtbar für“, die es bei ihm gibt.",
      freelancer: "Die Notizseiten eines deiner Kunden, die oalab für Freelancer freigegeben hat, und deine eigenen „Nur Freelancer“-Seiten, als Baum: Titel, Symbol, Ebene, Projekt, „Sichtbar für“, Datum, zuletzt geändert, mit IDs für read_note und update_note. Dazu deine Projekte bei diesem Kunden (für project_id).",
    },
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Der Kunde (ID aus search)."),
        project_id: id("Nur die Seiten dieses Projekts."),
      },
      required: ["customer_id"],
      additionalProperties: false,
    },
    annotations: { title: "Notizseiten auflisten", ...READ },
    scope: "hub:read",
    roles: BOTH,
  },
  {
    name: "read_note",
    title: "Notizseite lesen",
    description: "Eine Notizseite mit Titel, Symbol, Kunde, Projekt, „Sichtbar für“, Datum, Version, wer sie zuletzt geändert hat, ihren Unterseiten und dem Inhalt als Markdown (Format wie bei create_note; Aufgaben, Projekte und Termine darin mit ihrem aktuellen Stand). Die version brauchst du, um den Inhalt mit update_note zu ersetzen.",
    inputSchema: { type: "object", properties: { page_id: id("Die Seite (ID aus list_notes oder search_notes).") }, required: ["page_id"], additionalProperties: false },
    annotations: { title: "Notizseite lesen", ...READ },
    scope: "hub:read",
    roles: BOTH,
  },
  {
    name: "search_notes",
    title: "Notizen durchsuchen",
    description: "Sucht in Titel und Text aller Notizseiten, die du sehen darfst, wie die Suche im Hub: höchstens 8 Treffer, zuletzt geänderte zuerst, mit Kunde, Ausschnitt und Link.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 2, maxLength: 80, description: "Suchbegriff, mindestens 2 Zeichen." } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { title: "Notizen durchsuchen", ...READ },
    scope: "hub:read",
    roles: BOTH,
  },
  {
    name: "get_note_history",
    title: "Verlauf einer Notizseite",
    description: "Frühere Fassungen einer Notizseite wie unter „Verlauf“ im Hub: Version, Titel, warum sie aufgehoben wurde (Bearbeitung, „Sichtbar für“ geändert, vor einer Wiederherstellung), von wem, wann und ihr Text (gekürzt). Der Hub hebt beim Bearbeiten höchstens alle 10 Minuten eine Fassung auf, 90 Tage lang.",
    inputSchema: { type: "object", properties: { page_id: id("Die Seite (ID aus list_notes).") }, required: ["page_id"], additionalProperties: false },
    annotations: { title: "Verlauf einer Notizseite", ...READ },
    scope: "hub:read",
    roles: TEAM,
  },
  {
    name: "list_note_trash",
    title: "Papierkorb der Notizen",
    description: "Die Notizseiten eines Kunden im Papierkorb: in den letzten 30 Tagen gelöscht, mit wann, von wem und wie viele Tage sie noch wiederherstellbar sind (restore_note). Unterseiten, die mit ihrer Seite gelöscht wurden, kommen mit ihr zurück.",
    inputSchema: { type: "object", properties: { customer_id: id("Der Kunde (ID aus search).") }, required: ["customer_id"], additionalProperties: false },
    annotations: { title: "Papierkorb der Notizen", ...READ },
    scope: "hub:read",
    roles: TEAM,
  },

  // ---------- Writing (scope hub:write) ----------
  {
    name: "create_note",
    title: "Notizseite anlegen",
    description: {
      admin: `Legt bei einem Kunden eine Notizseite an, wie „Neue Seite“ unter Notizen: Titel, Inhalt (content) oder eine Vorlage, nach Wunsch als Unterseite (parent_id), zu einem Projekt, mit Symbol (ein Emoji) und Datum (dann steht sie im Kalender). Eine neue Seite bekommt den Standard der Notizen (sonst „Nur Team“), eine Unterseite die Stufe der Seite darüber; für Kunde oder Freelancer freigeben geht danach mit set_note_visibility. ${NOTE_MARKDOWN_HELP}`,
      freelancer: `Legt bei einem deiner Kunden eine Notizseite an, wie „Neue Seite“ unter Notizen: Titel, Inhalt (content) oder eine Vorlage, nach Wunsch als Unterseite einer „Nur Freelancer“-Seite (parent_id), zu einem deiner Projekte, mit Symbol (ein Emoji) und Datum. Sie ist immer „Nur Freelancer“: das oalab-Team und die Freelancer des Kunden sehen sie, der Kunde nicht. ${NOTE_MARKDOWN_HELP}`,
    },
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Der Kunde (ID aus search)."),
        title: { type: "string", minLength: 1, maxLength: MAX_TITLE, description: "Titel der Seite, eine Zeile." },
        content: CONTENT,
        template: { type: "string", enum: ["meeting", "briefing", "acceptance"], description: "Statt content eine Vorlage des Hubs: meeting = Besprechung, briefing = Projektbriefing, acceptance = Abnahme." },
        parent_id: id("Seite darüber, wenn es eine Unterseite werden soll (ID aus list_notes)."),
        project_id: id("Projekt des Kunden, zu dem die Seite gehört (aus list_notes); ohne Angabe „Allgemein“. Eine Unterseite gehört zum Projekt der Seite darüber."),
        icon: { type: "string", maxLength: 16, description: "Symbol: ein Emoji, z. B. 📝." },
        dated_on: { type: "string", pattern: DAY, description: "Datum JJJJ-MM-TT; die Seite steht dann im Kalender." },
      },
      required: ["customer_id", "title"],
      additionalProperties: false,
    },
    annotations: { title: "Notizseite anlegen", ...WRITE },
    scope: "hub:write",
    roles: BOTH,
  },
  {
    name: "update_note",
    title: "Notizseite ändern",
    description: {
      admin: "Ändert eine Notizseite wie im Editor: Titel, Symbol, Datum, Projekt, Breite und Inhalt; was du weglässt, bleibt. content ersetzt den ganzen Inhalt und braucht dafür die version aus read_note (hat inzwischen jemand anders gespeichert, wird nichts überschrieben); content_mode append hängt unten an, prepend oben, beides ohne version. Behalte beim Ersetzen die oalab:-Zeilen bei, sonst verschwinden die Aufgaben-, Termin- und Unterseiten-Blöcke. Der Verlauf hebt die Fassung davor auf. „Sichtbar für“ ändert set_note_visibility.",
      freelancer: "Ändert eine deiner „Nur Freelancer“-Seiten wie im Editor: Titel, Symbol, Datum, Projekt, Breite und Inhalt; was du weglässt, bleibt. Andere Seiten kannst du nur lesen. content ersetzt den ganzen Inhalt und braucht dafür die version aus read_note (hat inzwischen jemand anders gespeichert, wird nichts überschrieben); content_mode append hängt unten an, prepend oben, beides ohne version. Behalte beim Ersetzen die oalab:-Zeilen bei, sonst verschwinden die Aufgaben-, Termin- und Unterseiten-Blöcke.",
    },
    inputSchema: {
      type: "object",
      properties: {
        page_id: id("Die Seite (ID aus list_notes oder read_note)."),
        version: { type: "integer", minimum: 1, description: "version aus read_note; nötig, wenn content den Inhalt ersetzt." },
        title: { type: "string", minLength: 1, maxLength: MAX_TITLE, description: "Neuer Titel." },
        icon: { type: "string", maxLength: 16, description: "Neues Symbol (ein Emoji); leer nimmt es weg." },
        dated_on: { type: ["string", "null"], pattern: DAY, description: "Datum JJJJ-MM-TT; null nimmt es weg." },
        project_id: { type: ["string", "null"], pattern: uuidPattern, description: "Projekt des Kunden (aus list_notes); null = „Allgemein“." },
        width: { type: "string", enum: ["normal", "wide"], description: "Breite der Seite: normal oder wide (breit)." },
        content: CONTENT,
        content_mode: { type: "string", enum: ["replace", "append", "prepend"], default: "replace", description: "replace ersetzt den Inhalt (mit version), append hängt unten an, prepend oben." },
      },
      required: ["page_id"],
      additionalProperties: false,
    },
    annotations: { title: "Notizseite ändern", ...WRITE },
    scope: "hub:write",
    roles: BOTH,
  },
  {
    name: "set_note_visibility",
    title: "„Sichtbar für“ ändern",
    description: "„Sichtbar für“ einer Notizseite wie im Zahnrad der Seite: team = Nur Team, both = Kunde und Freelancer, customer = Nur Kunde (ohne Freelancer beim Kunden einfach „Kunde“), freelancer = Nur Freelancer. Eine Unterseite ist höchstens so sichtbar wie die Seite darüber; eine engere Stufe nimmt die Unterseiten mit. Wer die Seite neu sieht, bekommt eine Meldung (Glocke und Mail), außer notify ist false.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: id("Die Seite (ID aus list_notes)."),
        audience: { type: "string", enum: ["team", "both", "customer", "freelancer"], description: "Die neue Stufe." },
        notify: { type: "boolean", default: true, description: "false: ohne Meldung an die, die die Seite neu sehen." },
      },
      required: ["page_id", "audience"],
      additionalProperties: false,
    },
    annotations: { title: "„Sichtbar für“ ändern", ...WRITE },
    scope: "hub:write",
    roles: TEAM,
  },
  {
    name: "notify_note_change",
    title: "Änderung mitteilen",
    description: "„Änderung mitteilen“ wie im Hub: Alle, die eine freigegebene Notizseite sehen (Kunde und/oder Freelancer), bekommen einmal eine Meldung, dass sie sich geändert hat. Für Seiten mit „Nur Team“ gibt es niemanden zu benachrichtigen.",
    inputSchema: { type: "object", properties: { page_id: id("Die Seite (ID aus list_notes).") }, required: ["page_id"], additionalProperties: false },
    annotations: { title: "Änderung mitteilen", ...WRITE },
    scope: "hub:write",
    roles: TEAM,
  },
  {
    name: "create_meeting_note",
    title: "Besprechungsnotiz anlegen",
    description: "„Notiz anlegen“ an einem Termin mit Kunde, wie im Kalender: eine Besprechungsnotiz pro Termin, „Besprechung: <Termin>“, mit dem Tag des Termins, „Nur Team“ und der Besprechungsvorlage. Mit content steht dein Markdown statt der Vorlage darin (Format wie bei create_note). Gibt es schon eine, kommt sie zurück; ändern dann mit update_note.",
    inputSchema: {
      type: "object",
      properties: { appointment_id: id("Der Termin (ID aus list_appointments)."), content: CONTENT },
      required: ["appointment_id"],
      additionalProperties: false,
    },
    annotations: { title: "Besprechungsnotiz anlegen", ...WRITE },
    scope: "hub:write",
    roles: TEAM,
  },
  {
    name: "trash_note",
    title: "Notizseite in den Papierkorb",
    description: "Legt eine Notizseite mit ihren Unterseiten in den Papierkorb, wie „In den Papierkorb“ im Hub. Sie bleibt 30 Tage wiederherstellbar (restore_note); endgültig löschen kann nur das Team im Hub.",
    inputSchema: { type: "object", properties: { page_id: id("Die Seite (ID aus list_notes).") }, required: ["page_id"], additionalProperties: false },
    annotations: { title: "Notizseite in den Papierkorb", ...WRITE },
    scope: "hub:write",
    roles: TEAM,
  },
  {
    name: "restore_note",
    title: "Notizseite wiederherstellen",
    description: "Holt eine Notizseite aus dem Papierkorb zurück, mit den Unterseiten, die mit ihr gelöscht wurden (ID aus list_note_trash). Liegt die Seite darüber noch im Papierkorb, kommt sie oben in die Liste.",
    inputSchema: { type: "object", properties: { page_id: id("Die Seite (ID aus list_note_trash).") }, required: ["page_id"], additionalProperties: false },
    annotations: { title: "Notizseite wiederherstellen", ...WRITE },
    scope: "hub:write",
    roles: TEAM,
  },
  {
    name: "restore_note_version",
    title: "Frühere Fassung wiederherstellen",
    description: "Stellt eine frühere Fassung einer Notizseite wieder her, wie im Verlauf des Hubs (revision_id aus get_note_history). version ist die aktuelle Version der Seite aus read_note; den jetzigen Stand hebt der Verlauf vorher auf.",
    inputSchema: {
      type: "object",
      properties: {
        revision_id: id("Die Fassung (ID aus get_note_history)."),
        version: { type: "integer", minimum: 1, description: "Die aktuelle version der Seite aus read_note." },
      },
      required: ["revision_id", "version"],
      additionalProperties: false,
    },
    annotations: { title: "Frühere Fassung wiederherstellen", ...WRITE },
    scope: "hub:write",
    roles: TEAM,
  },
];

/** The notes tools of a role, each with the right it needs; descriptions in the role's words. */
export function notesTools(role: NotesRole): (ToolDefinition & { scope: HubScope })[] {
  return tools
    .filter((tool) => tool.roles.includes(role))
    .map(({ roles: _roles, description, ...tool }) => {
      void _roles;
      return { ...tool, description: typeof description === "string" ? description : description[role] };
    });
}

export const NOTES_TOOL_NAMES = tools.map((tool) => tool.name);
export const isNotesTool = (name: string) => NOTES_TOOL_NAMES.includes(name);
