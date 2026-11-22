/**
 * Fictional notes for the design preview (/preview/projects/notes; the customer's view with ?role=customer, the
 * freelancer's with ?role=freelancer). Names and pages are made up, like every example of the preview; nothing is
 * saved. Self-contained (type imports only).
 */
import { viewerReads } from "./rules";
import type { NoteDoc, NoteNode, NotePage, NotePageMeta, NoteRefs, NotesArea, NoteTaskView, NoteViewer } from "./types";

const text = (value: string, marks?: NoteNode["marks"]): NoteNode => marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const bold = (value: string) => text(value, [{ type: "bold" }]);
const link = (value: string, href: string, title = "", description = "") => text(value, [{ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow", ...(title ? { title } : {}), ...(description ? { description } : {}) } }]);
const emoji = (char: string): NoteNode => ({ type: "noteEmoji", attrs: { char } });
const p = (...content: NoteNode[]): NoteNode => content.length ? { type: "paragraph", content } : { type: "paragraph" };
const h = (level: 1 | 2 | 3, value: string): NoteNode => ({ type: "heading", attrs: { level }, content: [text(value)] });
const bullets = (...items: NoteNode[][]): NoteNode => ({ type: "bulletList", content: items.map((content) => ({ type: "listItem", content: [p(...content)] })) });
const checks = (...items: [string, boolean][]): NoteNode => ({ type: "taskList", content: items.map(([value, checked]) => ({ type: "taskItem", attrs: { checked }, content: [p(text(value))] })) });
const callout = (char: string, ...content: NoteNode[]): NoteNode => ({ type: "noteCallout", attrs: { emoji: char }, content: [p(...content)] });
const subpage = (id: string): NoteNode => ({ type: "noteSubpage", attrs: { refKind: "page", refId: id } });
const cell = (value: string, header = false, colType?: string): NoteNode => ({ type: header ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1, ...(colType ? { colType } : {}) }, content: [value ? p(text(value)) : p()] });
const table = (head: [string, string][], rows: string[][]): NoteNode => ({
  type: "table",
  content: [
    { type: "tableRow", content: head.map(([label, kind]) => cell(label, true, kind)) },
    ...rows.map((row) => ({ type: "tableRow", content: row.map((value) => cell(value)) })),
  ],
});
const toggle = (summary: string, ...content: NoteNode[]): NoteNode => ({ type: "details", attrs: { open: false }, content: [{ type: "detailsSummary", content: [text(summary)] }, { type: "detailsContent", content }] });
const doc = (...content: NoteNode[]): NoteDoc => ({ type: "doc", content: [...content, { type: "paragraph" }] });
const TASK = (n: number) => `7a5c0000-0000-4000-8000-00000000${n}`;
const tasks = (...numbers: number[]): NoteNode => ({ type: "noteTaskGroup", content: numbers.map((number) => ({ type: "noteTaskItem", attrs: { refKind: "task", refId: TASK(number), number } })) });
const mention = (number: number): NoteNode => ({ type: "noteTaskMention", attrs: { refKind: "task", refId: TASK(number), number } });
const projectBlock = (projectId: string): NoteNode => ({ type: "noteProject", attrs: { refKind: "project", refId: projectId } });
const taskList = (projectId: string, filter = "open"): NoteNode => ({ type: "noteTaskList", attrs: { refKind: "project", refId: projectId, filter } });
const card = (href: string, title: string, description: string, site: string): NoteNode => ({ type: "noteLinkCard", attrs: { href, title, description, site } });

export const PREVIEW_CUSTOMER = "c0ffee00-0000-4000-8000-000000024017";
const FORM = "c0ffee00-0000-4000-8000-000000031877";
const HORIZONT = "c0ffee00-0000-4000-8000-000000046092";
// Ids like the database's, so the preview's documents pass the same checks.
const WEB = "c0ffee00-0000-4000-8000-0000000a0001";
const BRAND = "c0ffee00-0000-4000-8000-0000000a0002";
const id = (n: number) => `0b0e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KICKOFF = id(1), ABSTIMMUNG = id(2), BRIEFING = id(3), ZIELGRUPPEN = id(4), TEXTE = id(5), UEBERGABE = id(6), KALKULATION = id(7), STUNDEN = id(8), KONTAKT = id(9), WORKSHOP = id(10);

const at = (daysAgo: number, hour = 10) => new Date(Date.UTC(2026, 9, 15 - daysAgo, hour, 12)).toISOString();

type Seed = Omit<NotePage, "customerId" | "parentId" | "projectId" | "appointmentId" | "width" | "datedOn" | "position" | "version" | "updatedBy" | "createdAt" | "cover"> & Partial<NotePage>;

const seeds: Seed[] = [
  {
    id: KICKOFF, title: "Kickoff Website-Relaunch", icon: "🚀", audience: "both", projectId: WEB, cover: { kind: "gallery", value: "ember", position: 50 }, datedOn: "2026-09-01", updatedAt: at(44), updatedBy: "p-lea",
    content: doc(
      callout("📌", text("Besprechungsnotiz zum Kickoff am 1. September. Dabei: Jana Sommer, Lea Brandt, Jonas Keller.")),
      h(2, "Ziele"),
      p(text("Ein neuer Auftritt, der zeigt, was Nordlicht ausmacht: klar, eigenständig und mit Raum für neue Ideen. "), emoji("✨")),
      h(2, "Vereinbart"),
      bullets([text("Zuerst Startseite und Leistungsseite, danach der Blog-Bereich.")], [text("Nordlicht liefert Logo-Dateien und die Texte der Leistungen, am besten mit der "), link("Briefing-Vorlage", "https://oalab.de/", "Briefing-Vorlage für Websites", "Fragen zu Zielgruppe, Inhalten und Tonalität, zum Ausfüllen vor dem Kickoff."), text(".")]),
      card("https://oalab.de/", "Briefing-Vorlage für Websites", "Fragen zu Zielgruppe, Inhalten und Tonalität, zum Ausfüllen vor dem Kickoff.", "oalab.de"),
      h(2, "Aufgaben"),
      tasks(1037, 1040),
      h(2, "Nächste Schritte"),
      checks(["Moodboard abstimmen", true], ["Texte der Leistungen liefern", false], ["Testdomain einrichten", true]),
    ),
  },
  {
    id: ABSTIMMUNG, title: "Abstimmung Startseite", icon: "🎨", audience: "team", projectId: WEB, cover: { kind: "gallery", value: "oalab", position: 50 }, datedOn: "2026-10-13", updatedAt: at(0, 9), updatedBy: "p-jonas",
    content: doc(
      p(text("Wir haben die drei Varianten aus dem Shooting angeschaut. Die Bilder liegen im "), link("Styleguide", "https://www.figma.com/", "Nordlicht · Styleguide", "Farben, Schriften und Komponenten der neuen Website."), text(" und im Asset Management. "), bold("Die Schrift im Overlay soll größer werden.")),
      h(2, "Beschlüsse"),
      bullets([text("Variante B mit Text-Overlay wird umgesetzt. "), emoji("🎉")], [text("Die Leistungsseite geht erst live, wenn alle Texte freigegeben sind: "), mention(1035), text(".")]),
      h(2, "Varianten im Vergleich"),
      table([["Variante", "text"], ["Wirkung", "text"], ["Text-Overlay", "check"], ["Entscheidung", "status"]], [["A", "Hell und ruhig", "nein", "verworfen"], ["B", "Kontrastreich, klare Kante", "ja", "umgesetzt"], ["C", "Sehr dunkel", "ja", "verworfen"]]),
      card("https://www.figma.com/", "Nordlicht · Styleguide", "Farben, Schriften und Komponenten der neuen Website, Stand 13. Oktober.", "figma.com"),
      h(2, "Aufgaben"),
      tasks(1031, 1040),
      h(2, "Nächste Schritte"),
      checks(["Text-Overlay in Variante B testen", false], ["Shooting-Bilder an Nordlicht schicken", true], ["Freigabe der Leistungstexte einholen", false]),
      toggle("Notizen aus dem Gespräch", p(text("Jana wünscht sich mehr Weißraum im Kopfbereich.")), p(text("Die Bildrechte für Variante C sind noch offen."))),
    ),
  },
  {
    id: BRIEFING, title: "Projektbriefing", icon: "📋", audience: "both", projectId: WEB, cover: { kind: "gallery", value: "ocean", position: 50 }, updatedAt: at(3), updatedBy: "p-lea",
    content: doc(
      callout("🎯", text("Ziel: Bis Ende Oktober steht die neue Website mit Startseite, Leistungen und Kontakt.")),
      projectBlock(WEB),
      h(2, "Seiten der Website"),
      table([["Seite", "text"], ["Inhalt", "text"], ["Zuständig", "person"], ["Stand", "status"]], [["Startseite", "Hero-Bild, Leistungen im Überblick", "Lea", "in Arbeit"], ["Leistungen", "Drei Leistungskarten mit Texten", "Mia", "offen"], ["Kontakt", "Formular und Anfahrt", "Lea", "fertig"], ["Blog", "Nach dem Livegang", "", "geplant"]]),
      p(text("Jede Änderung erscheint zuerst auf der "), link("Testdomain", "https://example.com/", "Nordlicht · Testdomain", "Jede Änderung erscheint zuerst hier, bevor sie live geht."), text(", bevor sie live geht.")),
      h(2, "Unterseiten"),
      subpage(ZIELGRUPPEN),
      subpage(TEXTE),
    ),
  },
  {
    id: ZIELGRUPPEN, title: "Zielgruppen", icon: "🎯", audience: "both", parentId: BRIEFING, projectId: WEB, updatedAt: at(3), updatedBy: "p-lea",
    content: doc(p(text("Wen die neue Website anspricht:")), bullets([text("Unternehmen aus der Region, die ein Studio für Marke und Web suchen")], [text("Agenturen, die einen Partner für Fotografie brauchen")], [text("Bewerberinnen und Bewerber")])),
  },
  {
    id: TEXTE, title: "Tonalität & Texte", icon: "✍️", audience: "customer", parentId: BRIEFING, projectId: WEB, datedOn: "2026-10-16", updatedAt: at(2), updatedBy: "p-jonas",
    content: doc(callout("⏳", text("Bitte die Texte der Leistungen freigeben, dann geht die Leistungsseite live.")), h(2, "So klingt Nordlicht"), bullets([text("Du statt Sie, freundlich und klar")], [text("Kurze Sätze, keine Fachbegriffe ohne Erklärung")])),
  },
  {
    id: UEBERGABE, title: "Übergabe an Freelancer", icon: "🧰", audience: "freelancer", projectId: WEB, cover: { kind: "gallery", value: "graphite", position: 50 }, updatedAt: at(1), updatedBy: "p-mia",
    content: doc(
      callout("🔒", text("Nur für Team und Freelancer. Nordlicht sieht diese Seite nicht.")),
      h(2, "Technik"),
      bullets([text("Jede Änderung zuerst auf der Testdomain, dann live")], [text("Bilder als WebP, 2400 px breit")]),
      { type: "codeBlock", attrs: { language: "bash" }, content: [text("npm run build && npm run preview")] },
      h(2, "Deine Aufgaben"),
      tasks(1031, 1035),
      h(2, "Offen"),
      checks(["Komponenten für die Leistungskarten bauen", false]),
    ),
  },
  {
    id: KALKULATION, title: "Interne Kalkulation", icon: "📊", audience: "team", projectId: WEB, updatedAt: at(14), updatedBy: "p-jonas",
    content: doc(callout("🔒", text("Nur das oalab-Team sieht diese Seite und ihre Unterseite.")), bullets([text("Etappe 1: Startseite und Leistungen")], [text("Etappe 2: Blog-Bereich")]), h(2, "Offene Aufgaben im Projekt"), taskList(WEB), subpage(STUNDEN)),
  },
  { id: STUNDEN, title: "Stundenaufstellung", icon: "⏱️", audience: "team", parentId: KALKULATION, projectId: WEB, updatedAt: at(14), updatedBy: "p-jonas", content: doc(p(text("Aufwand je Etappe, gepflegt vom Team."))) },
  {
    id: KONTAKT, title: "Ansprechpartner & Abläufe", icon: "🤝", audience: "both", projectId: null, cover: { kind: "gallery", value: "salbei", position: 50 }, updatedAt: at(28), updatedBy: "p-lea",
    content: doc(h(2, "Ansprechpartner"), p(text("Jana Sommer entscheidet über Texte und Bilder. Fragen zur Technik gehen an Jonas.")), h(2, "So arbeiten wir"), bullets([text("Feedback über Nachrichten im Hub")], [text("Termine fragt ihr im Kalender an")])),
  },
  {
    id: WORKSHOP, title: "Markenworkshop", icon: "🧭", audience: "both", projectId: BRAND, cover: { kind: "gallery", value: "aubergine", position: 50 }, datedOn: "2026-10-03", updatedAt: at(12), updatedBy: "p-lea",
    content: doc(h(2, "Ergebnisse"), bullets([text("Drei Werte: ruhig, nordisch, präzise")], [text("Farbwelt aus Grau, Eisblau und einem warmen Akzent")])),
  },
];

export const previewNotePages: NotePage[] = seeds.map((seed, index) => ({
  customerId: PREVIEW_CUSTOMER,
  parentId: null,
  projectId: null,
  appointmentId: null,
  width: "normal",
  datedOn: null,
  version: 3,
  createdAt: seed.updatedAt,
  cover: null,
  ...seed,
  position: index + 1,
  updatedBy: seed.updatedBy ?? null,
} as NotePage));

const people: Record<string, string> = { "p-jonas": "Jonas Keller", "p-lea": "Lea Brandt", "p-mia": "Mia Berger" };

const person = (id: string, name: string) => ({ id, name, initials: name.split(" ").map((part) => part[0]).join("") });
const MIA = person("p-mia", "Mia Berger"), LEA = person("p-lea", "Lea Brandt"), SAM = person("p-sam", "Sam Ott");
const day = (offset: number) => new Date(Date.UTC(2026, 9, 15 + offset)).toISOString().slice(0, 10);
const previewTasks: NoteTaskView[] = [
  { id: TASK(1031), number: 1031, title: "Startseite: Hero-Bild austauschen", status: "progress", dueOn: day(2), projectId: WEB, projectName: "Ein neuer digitaler Auftritt.", assignees: [MIA, LEA], customerTurn: false, audience: "shared", version: 4 },
  { id: TASK(1035), number: 1035, title: "Leistungsseite: Texte einpflegen", status: "todo", dueOn: day(5), projectId: WEB, projectName: "Ein neuer digitaler Auftritt.", assignees: [MIA], customerTurn: false, audience: "shared", version: 2 },
  { id: TASK(1037), number: 1037, title: "Logo-Varianten als SVG liefern", status: "todo", dueOn: day(-1), projectId: WEB, projectName: "Ein neuer digitaler Auftritt.", assignees: [], customerTurn: true, audience: "customer", version: 3 },
  { id: TASK(1040), number: 1040, title: "Bildrechte der Stockfotos prüfen", status: "todo", dueOn: day(3), projectId: WEB, projectName: "Ein neuer digitaler Auftritt.", assignees: [SAM], customerTurn: false, audience: "team", version: 1 },
];

/** What the preview's references show to each role: customers only released tasks, freelancers nothing „Nur Team“. */
export function previewRefs(viewer: NoteViewer): NoteRefs {
  const sees = (task: NoteTaskView) => viewer === "admin" || (viewer === "customer" ? task.audience === "customer" : task.audience !== "team");
  const shown = (task: NoteTaskView): NoteTaskView => viewer === "customer" ? { ...task, assignees: [], audience: null, version: null } : task;
  const visible = previewTasks.filter(sees).map(shown);
  return {
    tasks: Object.fromEntries(previewTasks.map((task) => [task.id, sees(task) ? shown(task) : null])),
    projects: { [WEB]: { id: WEB, name: "Ein neuer digitaler Auftritt.", status: "In Umsetzung", progress: 68, dueOn: "2026-10-30" } },
    projectTasks: { [WEB]: visible },
    images: {},
  };
}

export function toMetaOnly(page: NotePage): NotePageMeta {
  const meta: Partial<NotePage> = { ...page };
  delete meta.content;
  return meta as NotePageMeta;
}

/** The preview's notes as each role would see them: the team everything, customers and freelancers what is shared. */
export function notesFixtures(viewer: NoteViewer, pageId?: string | null): NotesArea {
  const visible = previewNotePages.filter((page) => viewerReads(viewer, page.audience));
  const customers = viewer === "admin"
    ? [
      { id: PREVIEW_CUSTOMER, name: "Nordlicht Studio", number: "KD-24017", hasFreelancer: true },
      { id: FORM, name: "Form & Feld", number: "KD-31877", hasFreelancer: false },
      { id: HORIZONT, name: "Studio Horizont", number: "KD-46092", hasFreelancer: false },
    ]
    : [{ id: PREVIEW_CUSTOMER, name: "Nordlicht Studio", number: "KD-24017", hasFreelancer: viewer === "freelancer" }];
  const found = visible.find((page) => page.id === pageId) ?? visible.find((page) => page.id === (viewer === "admin" ? ABSTIMMUNG : viewer === "customer" ? KICKOFF : UEBERGABE)) ?? visible[0] ?? null;
  const first = found ? { ...found, refs: previewRefs(viewer) } : null;
  return {
    viewer,
    viewerId: viewer === "admin" ? "p-jonas" : viewer === "freelancer" ? "p-mia" : "p-jana",
    customers,
    customerId: PREVIEW_CUSTOMER,
    projects: viewer === "freelancer" ? [{ id: WEB, name: "Ein neuer digitaler Auftritt." }] : [{ id: WEB, name: "Ein neuer digitaler Auftritt." }, { id: BRAND, name: "Eine Marke. Ein Gefühl." }],
    pages: visible.map(toMetaOnly),
    page: first,
    settings: { defaultAudience: "team", notifyOnShare: true, groupByProject: true, meetingTemplate: "meeting", defaultWidth: "normal" },
    people: viewer === "customer" ? {} : people,
    taskWriter: viewer !== "customer",
    ready: true,
    error: null,
  };
}

/** „Erwähnt in“ of the preview: the pages this role sees that name the task as a box row or a mention. */
export function previewMentions(taskId: string, viewer: NoteViewer) {
  const names = (node: NoteNode): boolean => (node.attrs?.refKind === "task" && node.attrs.refId === taskId) || (node.content ?? []).some(names);
  return previewNotePages
    .filter((page) => viewerReads(viewer, page.audience) && names(page.content))
    .map((page) => ({ id: page.id, title: page.title, icon: page.icon, customerId: page.customerId }));
}

/** A page of the preview with its document and what its references show to this role. */
export function previewPage(pageId: string, viewer: NoteViewer = "admin"): NotePage | null {
  const page = previewNotePages.find((item) => item.id === pageId);
  return page ? { ...page, refs: previewRefs(viewer) } : null;
}
