/**
 * Templates of new pages (plan 1.3, step 2): Besprechung, Projektbriefing, Abnahme and an empty page. A meeting note
 * from an appointment (step 3) uses the meeting template with the appointment's title and date. Self-contained so tests
 * load it directly.
 */
import type { NoteDoc, NoteNode, NoteTemplateId } from "./types";

export const TEMPLATE_CHOICES: { id: NoteTemplateId; label: string; hint: string; icon: string }[] = [
  { id: "blank", label: "Leere Seite", hint: "Einfach losschreiben", icon: "📝" },
  { id: "meeting", label: "Besprechung", hint: "Teilnehmer, Agenda, Beschlüsse, nächste Schritte", icon: "🗓️" },
  { id: "briefing", label: "Projektbriefing", hint: "Ziel, Zielgruppe, Inhalte, Termine", icon: "📋" },
  { id: "acceptance", label: "Abnahme", hint: "Was geprüft wurde, was offen ist, Freigabe", icon: "✅" },
];

const text = (value: string): NoteNode => ({ type: "text", text: value });
const p = (value = ""): NoteNode => value ? { type: "paragraph", content: [text(value)] } : { type: "paragraph" };
const h = (value: string): NoteNode => ({ type: "heading", attrs: { level: 2 }, content: [text(value)] });
const bullets = (...items: string[]): NoteNode => ({ type: "bulletList", content: items.map((item) => ({ type: "listItem", content: [p(item)] })) });
const checks = (...items: string[]): NoteNode => ({ type: "taskList", content: items.map((item) => ({ type: "taskItem", attrs: { checked: false }, content: [p(item)] })) });
const callout = (emoji: string, value: string): NoteNode => ({ type: "noteCallout", attrs: { emoji }, content: [p(value)] });

/** "Mo, 2. Nov. 2026" for the meeting template. */
export function meetingDate(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" }).format(date);
}

/** The document of a template; the title and icon a new page gets with it. Every template ends with an empty line. */
export function noteTemplate(id: NoteTemplateId, context: { title?: string; date?: string | null } = {}): { title: string; icon: string; doc: NoteDoc } {
  const date = meetingDate(context.date);
  switch (id) {
    case "meeting":
      return {
        title: context.title ? `Besprechung: ${context.title}`.slice(0, 200) : "Besprechung",
        icon: "🗓️",
        doc: { type: "doc", content: [
          callout("📌", date ? `Besprechung am ${date}.` : "Wann, wo und worum es geht: "),
          h("Teilnehmer"), bullets(""),
          h("Agenda"), bullets(""),
          h("Notizen"), p(),
          h("Beschlüsse"), bullets(""),
          h("Nächste Schritte"), checks(""),
          p(),
        ] },
      };
    case "briefing":
      return {
        title: "Projektbriefing",
        icon: "📋",
        doc: { type: "doc", content: [
          callout("🎯", "Ziel: "),
          h("Zielgruppe"), p(),
          h("Inhalte und Seiten"), bullets(""),
          h("Tonalität und Gestaltung"), p(),
          h("Termine"), bullets(""),
          h("Offene Fragen"), checks(""),
          p(),
        ] },
      };
    case "acceptance":
      return {
        title: "Abnahme",
        icon: "✅",
        doc: { type: "doc", content: [
          callout("📋", "Abnahme: Was geprüft wurde und was noch fehlt."),
          h("Geprüft"), checks(""),
          h("Offen"), checks(""),
          h("Freigabe"), p("Freigegeben am … von …"),
          p(),
        ] },
      };
    default:
      return { title: "Neue Seite", icon: "", doc: { type: "doc", content: [p()] } };
  }
}
