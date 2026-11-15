/**
 * Fictional board for the local design preview (/preview/projects/tasks). Dates count from the preview's reference day,
 * so "heute", "morgen" and "überfällig" stay meaningful. Self-contained (type imports only).
 */
import type { BoardPerson, BoardProject, BoardTask, TaskBoardState, TaskDetail, TaskPriority, TaskStatus } from "./types";

const people: BoardPerson[] = [
  { id: "p-jonas", name: "Jonas Keller", initials: "JK", kind: "team" },
  { id: "p-lea", name: "Lea Brandt", initials: "LB", kind: "team" },
  { id: "p-sam", name: "Sam Ott", initials: "SO", kind: "team" },
];

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type Seed = [number, string, TaskStatus, string, string[], TaskPriority, number | null, string[], { visible?: boolean; comments?: number; done?: number; total?: number; files?: number }?];

const seeds: Seed[] = [
  [1042, "Blog-Bereich konzipieren", "backlog", "web", ["Konzept"], "low", null, []],
  [1043, "Englische Version vorbereiten", "backlog", "web", ["Konzept", "Text"], "none", null, []],
  [1051, "Angebot für den Wartungsvertrag schreiben", "backlog", "web", ["Recht"], "medium", 12, ["p-jonas"]],
  [1040, "Bildrechte der Stockfotos prüfen", "todo", "web", ["Recht"], "high", 3, ["p-sam"], { files: 1 }],
  [1035, "Leistungsseite: Texte einpflegen", "todo", "web", ["Text"], "medium", 5, ["p-sam"], { done: 0, total: 3 }],
  [1037, "Logo-Varianten als SVG liefern", "todo", "web", ["Kunde"], "medium", -1, [], { visible: true }],
  [1039, "Kontaktformular an das CRM anbinden", "todo", "web", ["Technik"], "high", 10, ["p-jonas"]],
  [1031, "Startseite: Hero-Bild austauschen", "progress", "web", ["Design"], "high", 2, ["p-sam", "p-lea"], { comments: 3, done: 1, total: 3, files: 2 }],
  [1024, "Navigation fürs Handy umbauen", "progress", "web", ["Technik"], "medium", 0, ["p-sam"], { comments: 2, files: 1 }],
  [1027, "Moodboard für die Bildsprache", "progress", "web", ["Design"], "none", 4, ["p-lea"]],
  [1019, "Farbpalette und Typografie", "review", "web", ["Design"], "medium", 1, ["p-sam"], { comments: 1, done: 4, total: 4 }],
  [1021, "Sitemap freigeben", "review", "web", ["Kunde"], "medium", 3, [], { visible: true }],
  [1011, "Kick-off mit dem Kunden", "done", "web", ["Konzept"], "none", null, ["p-jonas"]],
  [1015, "Wireframes Startseite", "done", "web", ["Design"], "none", null, ["p-lea"]],
  [1016, "Domain-Umzug vorbereiten", "done", "web", ["Technik"], "none", null, ["p-jonas"]],
  [1061, "Content-Plan Dezember", "todo", "brand", ["Konzept"], "medium", 5, ["p-lea"]],
  [1062, "Reels: Schnitt für Woche 1", "progress", "brand", ["Design"], "high", 3, ["p-lea"]],
  [1063, "Posting-Texte KW 48", "review", "brand", ["Text"], "medium", 2, ["p-sam"], { visible: true }],
  [1065, "Kampagnen-Idee präsentiert", "done", "brand", ["Konzept"], "none", null, ["p-jonas"]],
];

export function taskFixtures(asOf: string): TaskBoardState {
  const projects: BoardProject[] = [
    { id: "web", name: "Ein neuer digitaler Auftritt.", organizationId: "org-preview", company: "Sommer Studio", startedOn: addDays(asOf, -40), dueOn: addDays(asOf, 15), status: "active" },
    { id: "brand", name: "Eine Marke. Ein Gefühl.", organizationId: "org-preview", company: "Sommer Studio", startedOn: addDays(asOf, -30), dueOn: addDays(asOf, 8), status: "active" },
  ];
  const order = new Map<string, number>();
  const tasks: BoardTask[] = seeds.map(([number, title, status, projectId, labels, priority, due, assigneeIds, extra = {}]) => {
    const key = `${projectId}:${status}`;
    order.set(key, (order.get(key) ?? 0) + 1);
    return {
      id: `fixture-${number}`,
      number,
      projectId,
      title,
      status,
      priority,
      dueOn: due === null ? null : addDays(asOf, due),
      labels,
      assigneeIds,
      visible: Boolean(extra.visible),
      order: order.get(key)!,
      version: 1,
      createdBy: "p-jonas",
      createdAt: `${addDays(asOf, -7)}T09:12:00Z`,
      updatedAt: `${addDays(asOf, -1)}T16:05:00Z`,
      comments: extra.comments ?? 0,
      checklist: { done: extra.done ?? 0, total: extra.total ?? 0 },
      files: extra.files ?? 0,
    };
  });
  return { projects, tasks, people, viewerId: "p-jonas", error: null };
}

/** The window of an example card: a short history, a checklist where the card has one. */
export function taskDetailFixture(task: BoardTask): TaskDetail {
  const subtasks = Array.from({ length: task.checklist.total }, (_, index) => ({
    id: `${task.id}-s${index}`,
    title: ["Drei Varianten wählen", "Mit Text-Overlay testen", "Export als WebP und JPG", "Kontrast geprüft"][index % 4],
    done: index < task.checklist.done,
    order: index + 1,
    version: 1,
  }));
  const comments = task.comments
    ? [
        { id: `${task.id}-c1`, authorId: "p-jonas", body: "Die Unterlagen liegen bereit. Kannst du bis Dienstag einen ersten Stand zeigen?", createdAt: task.createdAt },
        { id: `${task.id}-c2`, authorId: "p-sam", body: "Klar, die erste Variante kommt morgen.", createdAt: task.updatedAt },
      ].slice(0, task.comments)
    : [];
  return {
    taskId: task.id,
    description: task.number === 1031 ? "Das bisherige Hero-Bild wirkt zu dunkel. Bitte drei Varianten aus dem Shooting vorschlagen (16:9, mindestens 2400 px breit) und mit dem Text-Overlay testen." : "",
    subtasks,
    comments,
    files: [],
    events: [{ id: `${task.id}-e1`, actorId: task.createdBy, kind: "task.insert", createdAt: task.createdAt }],
  };
}
