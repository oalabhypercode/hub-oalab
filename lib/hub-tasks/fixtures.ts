/**
 * Fictional board for the local design preview (/preview/projects/tasks, the freelancer's view with ?role=freelancer).
 * Dates count from the preview's reference day, so "heute", "morgen" and "überfällig" stay meaningful.
 * Self-contained (type imports only).
 */
import type { BoardFreelancer, BoardPerson, BoardProject, BoardTask, TaskBoardState, TaskDetail, TaskPriority, TaskStatus } from "./types";

const team: BoardPerson[] = [
  { id: "p-jonas", name: "Jonas Keller", initials: "JK", kind: "team" },
  { id: "p-lea", name: "Lea Brandt", initials: "LB", kind: "team" },
  { id: "p-sam", name: "Sam Ott", initials: "SO", kind: "team" },
];

/** Two freelancers look after the example customer; one of them works on the website. */
const freelancerEntries: BoardFreelancer[] = [
  { id: "fl-pixelwerk", name: "Pixelwerk GbR", number: "FL-20481", loginIds: ["p-mia"], organizationIds: ["org-preview"] },
  { id: "fl-tom", name: "Tom Richter Design", number: "FL-20517", loginIds: ["p-tom"], organizationIds: ["org-preview"] },
];
const freelancerPeople: BoardPerson[] = [
  { id: "p-mia", name: "Mia Berger", initials: "MB", kind: "freelancer", company: "Pixelwerk GbR" },
  { id: "p-tom", name: "Tom Richter", initials: "TR", kind: "freelancer", company: "Tom Richter Design" },
];

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type Extra = { visible?: boolean; teamOnly?: boolean; comments?: number; done?: number; total?: number; files?: number; by?: string };
type Seed = [number, string, TaskStatus, string, string[], TaskPriority, number | null, string[], Extra?];

const seeds: Seed[] = [
  [1042, "Blog-Bereich konzipieren", "backlog", "web", ["Konzept"], "low", null, []],
  [1043, "Englische Version vorbereiten", "backlog", "web", ["Konzept", "Text"], "none", null, []],
  [1051, "Angebot für den Wartungsvertrag schreiben", "backlog", "web", ["Recht"], "medium", 12, ["p-jonas"], { teamOnly: true }],
  [1040, "Bildrechte der Stockfotos prüfen", "todo", "web", ["Recht"], "high", 3, ["p-sam"], { files: 1 }],
  [1035, "Leistungsseite: Texte einpflegen", "todo", "web", ["Text"], "medium", 5, ["p-mia"], { done: 0, total: 3 }],
  [1037, "Logo-Varianten als SVG liefern", "todo", "web", ["Kunde"], "medium", -1, [], { visible: true }],
  [1039, "Kontaktformular an das CRM anbinden", "todo", "web", ["Technik"], "high", 10, ["p-jonas"]],
  [1031, "Startseite: Hero-Bild austauschen", "progress", "web", ["Design"], "high", 2, ["p-mia", "p-lea"], { comments: 3, done: 1, total: 3, files: 2 }],
  [1024, "Navigation fürs Handy umbauen", "progress", "web", ["Technik"], "medium", 0, ["p-sam"], { comments: 2, files: 1 }],
  [1027, "Moodboard für die Bildsprache", "progress", "web", ["Design"], "none", 4, ["p-mia"], { by: "p-mia" }],
  [1028, "Budget und Stunden nachrechnen", "progress", "web", ["Recht"], "medium", 6, ["p-jonas"], { teamOnly: true }],
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

/**
 * The example board. `viewer: "freelancer"` shows it as Mia Berger (Pixelwerk GbR) sees it: only the website, on
 * which she works, without „Nur Team“, and only the freelancers of that project.
 */
export function taskFixtures(asOf: string, viewer: TaskBoardState["viewer"] = "admin"): TaskBoardState {
  const projects: BoardProject[] = [
    { id: "web", name: "Ein neuer digitaler Auftritt.", organizationId: "org-preview", company: "Sommer Studio", startedOn: addDays(asOf, -40), dueOn: addDays(asOf, 15), status: "active", freelancerIds: ["fl-pixelwerk"] },
    { id: "brand", name: "Eine Marke. Ein Gefühl.", organizationId: "org-preview", company: "Sommer Studio", startedOn: addDays(asOf, -30), dueOn: addDays(asOf, 8), status: "active", freelancerIds: [] },
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
      teamOnly: Boolean(extra.teamOnly),
      order: order.get(key)!,
      version: 1,
      createdBy: extra.by ?? "p-jonas",
      createdAt: `${addDays(asOf, -7)}T09:12:00Z`,
      updatedAt: `${addDays(asOf, -1)}T16:05:00Z`,
      comments: extra.comments ?? 0,
      checklist: { done: extra.done ?? 0, total: extra.total ?? 0 },
      files: extra.files ?? 0,
    };
  });
  if (viewer === "admin") return { viewer, projects, tasks, people: [...team, ...freelancerPeople], freelancers: freelancerEntries, viewerId: "p-jonas", confirmed: true, error: null };

  // Mia's view: what the database would show her session.
  const own = projects.filter((project) => project.freelancerIds.includes("fl-pixelwerk"));
  const onProjects = new Set(own.flatMap((project) => project.freelancerIds));
  const freelancers = freelancerEntries.filter((entry) => onProjects.has(entry.id));
  const logins = new Set(freelancers.flatMap((entry) => entry.loginIds));
  return {
    viewer,
    projects: own,
    tasks: tasks.filter((task) => own.some((project) => project.id === task.projectId) && !task.teamOnly),
    people: [...team, ...freelancerPeople.filter((person) => logins.has(person.id))],
    freelancers,
    viewerId: "p-mia",
    confirmed: true,
    error: null,
  };
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
        { id: `${task.id}-c2`, authorId: task.assigneeIds.includes("p-mia") ? "p-mia" : "p-sam", body: "Klar, die erste Variante kommt morgen.", createdAt: task.updatedAt },
        { id: `${task.id}-c3`, authorId: "p-lea", body: "Super, ich schaue sie mir gleich an.", createdAt: task.updatedAt },
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
