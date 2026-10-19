/**
 * Derives the hub's metrics, insights and highlights from the workspace data.
 * Rule-based on purpose: the insight texts can later be replaced by an AI summary.
 * Pure functions with UTC date math so server and client render identical output.
 */
import { demoConversation, demoNextSteps, metricHref, type HubFile, type NextStep, type Project } from "./hub-data";
import type { CategoryId } from "./categories";

export type MetricId = "active-projects" | "average-progress" | "milestones" | "feedback" | "open-steps" | "shared-files" | "file-volume" | "messages";
export type RangeId = "T" | "W" | "M" | "6M" | "J";

export type MiniChartData =
  | { type: "bars"; values: number[] }
  | { type: "sparkline"; values: number[] }
  | { type: "progress"; value: number }
  | { type: "ticks"; values: ("ok" | "warning")[] }
  | { type: "badge"; label: string };

export type MetricSnapshot = {
  id: MetricId;
  category: CategoryId;
  name: string;
  value: string;
  unit: string;
  context: string;
  timestamp: string;
  href: string;
  mini?: MiniChartData;
};

export type ComparisonRow = { label: string; value: number; display: string };
export type Highlight = {
  id: string;
  category: CategoryId;
  metric: MetricId;
  period: string;
  headline: string;
  viz: { type: "comparison"; rows: [ComparisonRow, ComparisonRow] } | { type: "week"; days: { label: string; value: number }[]; average: number; averageLabel: string };
};

export type Insight = { headline: string; body: string; timestamp: string; figures: { label: string; value: string; category: CategoryId }[] };
export type ActivityItem = { id: string; title: string; detail: string; category: CategoryId; href: string };
export type ProjectRow = { id: string; title: string; subtitle: string; progress: number; href: string };

export type SeriesBucket = { label: string; showLabel: boolean; value: number | null; tooltip: string };
export type MetricSeries = { caption: string; value: string; unit: string; rangeLabel: string; buckets: SeriesBucket[]; max: number; empty: boolean };

type HubEvent = { at: number; kind: "milestone" | "feedback" | "file" | "message"; title: string; category: CategoryId; project?: Project };

export type HubModelInput = {
  preview: boolean;
  asOf: string;
  projects: Project[];
  files: HubFile[];
  populated: boolean;
  admin: boolean;
  completedSteps: string[];
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const utc = { timeZone: "UTC" } as const;
const dayMonth = new Intl.DateTimeFormat("de-DE", { ...utc, day: "numeric", month: "short" });
const dayMonthLong = new Intl.DateTimeFormat("de-DE", { ...utc, day: "numeric", month: "long" });
const fullDate = new Intl.DateTimeFormat("de-DE", { ...utc, weekday: "long", day: "numeric", month: "long" });
const weekday = new Intl.DateTimeFormat("de-DE", { ...utc, weekday: "short" });
const monthShort = new Intl.DateTimeFormat("de-DE", { ...utc, month: "short" });
const monthLong = new Intl.DateTimeFormat("de-DE", { ...utc, month: "long" });
const numeric = new Intl.DateTimeFormat("de-DE", { ...utc, day: "numeric", month: "numeric" });
const dayMonthYear = new Intl.DateTimeFormat("de-DE", { ...utc, day: "numeric", month: "short", year: "numeric" });
const integer = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** ISO date or local datetime without zone, interpreted as UTC wall time. */
export const toTime = (iso: string) => Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : `${iso}:00Z`);
const startOfDay = (time: number) => Math.floor(time / DAY) * DAY;
const startOfWeek = (time: number) => startOfDay(time) - ((new Date(startOfDay(time)).getUTCDay() + 6) % 7) * DAY;
const startOfMonth = (time: number) => { const date = new Date(time); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1); };
const addMonths = (time: number, months: number) => { const date = new Date(time); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1); };
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const formatDayMonth = (time: number) => dayMonth.format(time);
export const formatFullDate = (iso: string) => fullDate.format(toTime(iso));
export const formatNumber = (value: number) => (Number.isInteger(value) ? integer : decimal).format(value);
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const fileSizeMb = (size: string) => Number.parseFloat(size.replace(",", ".")) * (/kb/i.test(size) ? 1 / 1024 : /gb/i.test(size) ? 1024 : 1);

/** Progress of a project at a given time, interpolated linearly between start and today (or completion). */
function progressAt(project: Project, time: number, asOfEnd: number) {
  const start = toTime(project.startedOn);
  if (time < start) return null;
  const done = project.status === "Abgeschlossen";
  const end = done ? toTime(project.dueOn) + DAY : asOfEnd;
  const target = done ? 100 : project.progress;
  return target * clamp((time - start) / Math.max(end - start, DAY));
}

const isActiveAt = (project: Project, time: number) => time >= toTime(project.startedOn) && (project.status !== "Abgeschlossen" || time < toTime(project.dueOn) + DAY);

const feedbackSince = (project: Project) => project.status === "Dein Feedback" ? project.milestones.find((item) => item.kind === "feedback")?.at : undefined;

type MetricDefinition = {
  category: CategoryId;
  name: string;
  kind: "state" | "event";
  unit: (value: number) => string;
  about: string;
  /** State metrics: value at a point in time. */
  stateAt?: (time: number) => number | null;
  /** Event metrics: which events count. */
  events?: (event: HubEvent) => boolean;
  format?: (value: number) => string;
};

/** Name and category of every metric; the single source for cards, search and navigation. */
export const metricMeta: Record<MetricId, { name: string; category: CategoryId }> = {
  "active-projects": { name: "Aktive Projekte", category: "projects" },
  "average-progress": { name: "Ø Fortschritt", category: "projects" },
  milestones: { name: "Meilensteine", category: "projects" },
  feedback: { name: "Dein Feedback", category: "projects" },
  "open-steps": { name: "Nächste Schritte", category: "projects" },
  "shared-files": { name: "Geteilte Dateien", category: "files" },
  "file-volume": { name: "Datenvolumen", category: "files" },
  messages: { name: "Nachrichten", category: "messages" },
};

export const metricOrder: MetricId[] = ["active-projects", "average-progress", "milestones", "feedback", "open-steps", "shared-files", "file-volume", "messages"];
export const defaultFavorites: MetricId[] = ["average-progress", "open-steps", "milestones", "shared-files"];
export const isMetricId = (value: string): value is MetricId => (metricOrder as string[]).includes(value);

export function buildHubModel(input: HubModelInput) {
  const { projects, files, preview, populated, admin, completedSteps } = input;
  const asOf = toTime(input.asOf);
  const asOfEnd = asOf + DAY - 1;
  const asOfLabel = formatDayMonth(asOf);

  const events: HubEvent[] = populated ? [
    ...projects.flatMap((project) => project.milestones.map((item) => ({ at: toTime(item.at), kind: item.kind, title: item.title, category: "projects" as const, project }))),
    ...files.map((file) => ({ at: toTime(file.sharedAt), kind: "file" as const, title: file.name, category: "files" as const })),
    { at: toTime(demoConversation.sentAt), kind: "message" as const, title: demoConversation.topic, category: "messages" as const },
  ].filter((event) => event.at <= asOfEnd).sort((a, b) => b.at - a.at) : [];

  const steps: (NextStep & { href: string; done: boolean })[] = populated ? demoNextSteps.map((step) => {
    const project = projects[step.projectIndex] || projects[0];
    return { ...step, href: projectHref(preview, project?.id), done: completedSteps.includes(step.id) };
  }) : [];
  const openSteps = steps.filter((step) => !step.done);

  const definitions: Record<MetricId, MetricDefinition> = {
    "active-projects": {
      ...metricMeta["active-projects"], kind: "state", unit: (value) => plural(value, "Projekt", "Projekte"),
      about: "Zählt alle Projekte, die gestartet und noch nicht abgeschlossen sind. Abgeschlossene Projekte bleiben in der Projektliste sichtbar.",
      stateAt: (time) => projects.filter((project) => isActiveAt(project, time)).length,
    },
    "average-progress": {
      ...metricMeta["average-progress"], kind: "state", unit: () => "%",
      about: "Der durchschnittliche Fortschritt aller gestarteten Projekte. Dein Projektteam pflegt den Fortschritt, sobald ein Meilenstein erreicht ist.",
      stateAt: (time) => {
        const values = projects.map((project) => progressAt(project, time, asOfEnd)).filter((value): value is number => value !== null);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      },
      format: (value) => integer.format(value),
    },
    milestones: {
      ...metricMeta.milestones, kind: "event", unit: (value) => plural(value, "Meilenstein", "Meilensteine"),
      about: "Erreichte Meilensteine und geteilte Zwischenstände deiner Projekte – vom Kickoff bis zum Launch.",
      events: (event) => event.kind === "milestone" || event.kind === "feedback",
    },
    feedback: {
      ...metricMeta.feedback, kind: "state", unit: (value) => plural(value, "Projekt", "Projekte"),
      about: admin ? "Projekte, die gerade auf eine Rückmeldung des Kunden warten." : "Projekte, die gerade auf deine Rückmeldung warten. Mit deinem Feedback geht es weiter.",
      stateAt: (time) => projects.filter((project) => { const since = feedbackSince(project); return since !== undefined && toTime(since) <= time; }).length,
    },
    "open-steps": {
      ...metricMeta["open-steps"], kind: "state", unit: () => "offen",
      about: "Aufgaben, bei denen du am Zug bist. In der Vorschau kannst du sie auf der Übersicht abhaken; ein Verlauf entsteht mit der echten Aufgabenverwaltung.",
    },
    "shared-files": {
      ...metricMeta["shared-files"], kind: "event", unit: (value) => plural(value, "Datei", "Dateien"),
      about: "Briefings, Entwürfe und finale Ergebnisse, die in deinem Workspace geteilt wurden.",
      events: (event) => event.kind === "file",
    },
    "file-volume": {
      ...metricMeta["file-volume"], kind: "state", unit: () => "MB",
      about: "Die Gesamtgröße aller geteilten Dateien in deinem Workspace.",
      stateAt: (time) => files.filter((file) => toTime(file.sharedAt) <= time).reduce((sum, file) => sum + fileSizeMb(file.size), 0),
      format: (value) => decimal.format(value),
    },
    messages: {
      ...metricMeta.messages, kind: "event", unit: (value) => plural(value, "Nachricht", "Nachrichten"),
      about: "Nachrichten aus deinen Projektgesprächen. Live-Nachrichten folgen mit der Datenbankanbindung.",
      events: (event) => event.kind === "message",
    },
  };

  const countEvents = (id: MetricId, from: number, to: number) => {
    const match = definitions[id].events;
    return match ? events.filter((event) => match(event) && event.at >= from && event.at < to).length : 0;
  };
  const stateAt = (id: MetricId, time: number) => definitions[id].stateAt?.(time) ?? null;
  const format = (id: MetricId, value: number) => definitions[id].format?.(value) ?? formatNumber(value);
  const lastEvent = (id: MetricId) => { const match = definitions[id].events; return match ? events.find(match) : undefined; };

  const activeProjects = projects.filter((project) => project.status !== "Abgeschlossen");
  const feedbackProjects = projects.filter((project) => project.status === "Dein Feedback");
  const avgProgress = stateAt("average-progress", asOfEnd) ?? 0;
  const avgProgressWeekAgo = stateAt("average-progress", asOfEnd - 7 * DAY) ?? 0;
  const thisWeek = startOfWeek(asOf);
  const filesThisWeek = countEvents("shared-files", thisWeek, asOfEnd + 1);
  const totalVolume = stateAt("file-volume", asOfEnd) ?? 0;
  const message = lastEvent("messages");

  const snapshot = (id: MetricId, value: number, context: string, mini?: MiniChartData, timestamp = asOfLabel): MetricSnapshot => ({
    id, category: definitions[id].category, name: definitions[id].name, value: format(id, value), unit: definitions[id].unit(value), context, timestamp, href: metricHref(preview, id), mini,
  });
  const weeklyCounts = (id: MetricId, weeks: number) => Array.from({ length: weeks }, (_, index) => { const from = thisWeek - (weeks - 1 - index) * 7 * DAY; return countEvents(id, from, from + 7 * DAY); });
  const dailyCounts = (id: MetricId, days: number) => Array.from({ length: days }, (_, index) => { const from = asOf - (days - 1 - index) * DAY; return countEvents(id, from, from + DAY); });
  const nextStep = openSteps[0];

  const metrics: Record<MetricId, MetricSnapshot> = {
    "active-projects": snapshot("active-projects", activeProjects.length, `von ${projects.length} ${plural(projects.length, "Projekt", "Projekten")} insgesamt`),
    "average-progress": snapshot("average-progress", avgProgress, avgProgress - avgProgressWeekAgo >= 0.5 ? `+${integer.format(avgProgress - avgProgressWeekAgo)} Punkte seit letzter Woche` : "über alle gestarteten Projekte", { type: "progress", value: avgProgress }),
    milestones: snapshot("milestones", countEvents("milestones", asOf - 29 * DAY, asOfEnd + 1), "in den letzten 30 Tagen", { type: "bars", values: weeklyCounts("milestones", 7) }, lastEvent("milestones") ? formatDayMonth(lastEvent("milestones")!.at) : asOfLabel),
    feedback: snapshot("feedback", feedbackProjects.length, feedbackProjects[0] ? feedbackProjects[0].category + (feedbackProjects.length > 1 ? ` und ${feedbackProjects.length - 1} weitere` : "") : "Gerade wartet nichts auf dich", projects.length ? { type: "ticks", values: projects.slice(0, 18).map((project) => project.status === "Dein Feedback" ? "warning" : "ok") } : undefined),
    "open-steps": snapshot("open-steps", openSteps.length, nextStep ? nextStep.title : "Alles erledigt", nextStep ? { type: "badge", label: `fällig ${numeric.format(toTime(nextStep.dueOn))}` } : undefined),
    "shared-files": snapshot("shared-files", files.length, filesThisWeek ? `${filesThisWeek} neu in dieser Woche` : "Diese Woche keine neuen", { type: "bars", values: dailyCounts("shared-files", 7) }, lastEvent("shared-files") ? formatDayMonth(lastEvent("shared-files")!.at) : asOfLabel),
    "file-volume": snapshot("file-volume", totalVolume, `in ${files.length} ${plural(files.length, "Datei", "Dateien")}`, files.length ? { type: "sparkline", values: Array.from({ length: 30 }, (_, index) => stateAt("file-volume", asOf - (29 - index) * DAY + DAY - 1) ?? 0) } : undefined),
    messages: snapshot("messages", message ? 1 : 0, message ? `${demoConversation.person} · ${demoConversation.topic}` : "Noch keine Gespräche", message && message.at >= asOf - 6 * DAY ? { type: "badge", label: "Neu" } : undefined, message ? formatDayMonth(message.at) : asOfLabel),
  };

  // Highlights
  const lastWeek = thisWeek - 7 * DAY;
  const filesLastWeek = countEvents("shared-files", lastWeek, thisWeek);
  const comparison = (current: number, previous: number, display: (value: number) => string, labels = ["Diese Woche", "Letzte Woche"]): [ComparisonRow, ComparisonRow] => [
    { label: labels[0], value: current, display: display(current) },
    { label: labels[1], value: previous, display: display(previous) },
  ];
  const sinceLastWeek = ["Heute", "Vor 7 Tagen"];
  const monthStart = startOfMonth(asOf);
  const previousMonth = addMonths(monthStart, -1);
  const milestonesThisMonth = countEvents("milestones", monthStart, asOfEnd + 1);
  const milestonesLastMonth = countEvents("milestones", previousMonth, monthStart);
  const activityDays = Array.from({ length: 7 }, (_, index) => {
    const from = asOf - (6 - index) * DAY;
    return { label: weekday.format(from).replace(".", ""), value: events.filter((event) => event.at >= from && event.at < from + DAY).length };
  });
  const activityAverage = activityDays.reduce((sum, day) => sum + day.value, 0) / 7;
  const activeDays = activityDays.filter((day) => day.value > 0).length;
  const highlights: Highlight[] = populated ? [
    {
      id: "files-week", category: "files", metric: "shared-files", period: "Diese Woche",
      headline: filesThisWeek === filesLastWeek ? `Diese Woche wurden genauso viele Dateien geteilt wie letzte Woche.` : `Diese Woche wurden ${filesThisWeek} ${plural(filesThisWeek, "Datei", "Dateien")} geteilt – ${filesThisWeek > filesLastWeek ? "mehr" : "weniger"} als letzte Woche.`,
      viz: { type: "comparison", rows: comparison(filesThisWeek, filesLastWeek, (value) => `${value} ${plural(value, "Datei", "Dateien")}`) },
    },
    {
      id: "progress-week", category: "projects", metric: "average-progress", period: "Letzte 7 Tage",
      headline: avgProgress - avgProgressWeekAgo >= 0.5 ? `Der Ø Fortschritt ist seit letzter Woche um ${integer.format(avgProgress - avgProgressWeekAgo)} Punkte gestiegen.` : "Der Ø Fortschritt ist seit letzter Woche stabil.",
      viz: { type: "comparison", rows: comparison(avgProgress, avgProgressWeekAgo, (value) => `${integer.format(value)} %`, sinceLastWeek) },
    },
    {
      id: "activity-week", category: "projects", metric: "milestones", period: "Letzte 7 Tage",
      headline: `An ${activeDays} der letzten 7 Tage gab es Neuigkeiten in ${admin ? "den" : "deinen"} Projekten.`,
      viz: { type: "week", days: activityDays, average: activityAverage, averageLabel: `Ø ${decimal.format(activityAverage)}` },
    },
    {
      id: "milestones-month", category: "projects", metric: "milestones", period: monthLong.format(monthStart),
      headline: `Im ${monthLong.format(monthStart)} ${milestonesThisMonth === 1 ? "wurde bisher ein Meilenstein" : `wurden bisher ${milestonesThisMonth} Meilensteine`} erreicht, im ${monthLong.format(previousMonth)} ${milestonesLastMonth}.`,
      viz: { type: "comparison", rows: [
        { label: monthLong.format(monthStart), value: milestonesThisMonth, display: String(milestonesThisMonth) },
        { label: monthLong.format(previousMonth), value: milestonesLastMonth, display: String(milestonesLastMonth) },
      ] },
    },
  ] : [];

  // Insights
  const nextDue = activeProjects.map((project) => toTime(project.dueOn)).filter((time) => time >= asOf).sort((a, b) => a - b)[0];
  const insight: Insight | null = populated ? {
    headline: feedbackProjects.length
      ? `${feedbackProjects.length === 1 ? "Ein Projekt wartet" : `${feedbackProjects.length} Projekte warten`} auf ${admin ? "Kundenfeedback" : "dein Feedback"}.`
      : activeProjects.length ? "Deine Projekte sind auf Kurs." : "Alle Projekte sind abgeschlossen.",
    body: [
      feedbackProjects[0] ? `„${feedbackProjects[0].name.replace(/\.$/, "")}“ ist bereit für ${admin ? "eine Rückmeldung" : "deine Gedanken"}.` : "",
      activeProjects.length ? `${activeProjects.length} ${plural(activeProjects.length, "Projekt läuft", "Projekte laufen")}, im Schnitt zu ${integer.format(avgProgress)} % fertig.` : "",
      nextDue ? `Nächster Zieltermin: ${dayMonthLong.format(nextDue)}.` : "",
    ].filter(Boolean).join(" "),
    timestamp: asOfLabel,
    figures: [
      { label: "Aktive Projekte", value: String(activeProjects.length), category: "projects" },
      { label: "Ø Fortschritt", value: `${integer.format(avgProgress)} %`, category: "projects" },
      { label: "Neue Dateien", value: String(filesThisWeek), category: "files" },
    ],
  } : null;

  const activity: ActivityItem[] = events.slice(0, 4).map((event, index) => ({
    id: `${event.kind}-${index}`,
    title: event.kind === "milestone" ? `Meilenstein erreicht: ${event.title}` : event.kind === "feedback" ? `Bereit für Feedback: ${event.title}` : event.kind === "file" ? `Neue Datei: ${event.title}` : `Neue Nachricht von ${demoConversation.person.split(" ")[0]}`,
    detail: `${event.project ? (event.project.company ? `${event.project.company} · ` : "") + event.project.category : event.kind === "file" ? "Dateien" : demoConversation.title} · ${formatDayMonth(event.at)}`,
    category: event.category,
    href: event.project ? projectHref(preview, event.project.id) : `${metricHref(preview, event.kind === "file" ? "shared-files" : "messages")}`,
  }));

  const projectRows: ProjectRow[] = activeProjects.map((project) => ({
    id: project.id,
    title: project.category,
    subtitle: `${project.company ? `${project.company} · ` : ""}Ziel ${dayMonth.format(toTime(project.dueOn))}`,
    progress: project.progress,
    href: projectHref(preview, project.id),
  }));

  /** Aggregates a metric for the detail page's period switcher. */
  function series(id: MetricId, range: RangeId): MetricSeries {
    const definition = definitions[id];
    const buckets: { from: number; to: number; label: string; showLabel: boolean; tooltip: string }[] = [];
    if (range === "T") {
      for (let hour = 0; hour < 24; hour++) buckets.push({ from: asOf + hour * HOUR, to: asOf + (hour + 1) * HOUR, label: `${hour}`, showLabel: hour % 6 === 0, tooltip: `${hour}–${hour + 1} Uhr` });
    } else if (range === "W" || range === "M") {
      const days = range === "W" ? 7 : 30;
      for (let index = 0; index < days; index++) {
        const from = asOf - (days - 1 - index) * DAY;
        buckets.push({ from, to: from + DAY, label: range === "W" ? weekday.format(from).replace(".", "") : numeric.format(from), showLabel: range === "W" || (days - 1 - index) % 7 === 0, tooltip: dayMonth.format(from) });
      }
    } else if (range === "6M") {
      for (let index = 0; index < 26; index++) {
        const from = thisWeek - (25 - index) * 7 * DAY;
        const newMonth = index === 0 || new Date(from).getUTCMonth() !== new Date(from - 7 * DAY).getUTCMonth();
        buckets.push({ from, to: from + 7 * DAY, label: monthShort.format(from).replace(".", ""), showLabel: newMonth, tooltip: `Woche ab ${dayMonth.format(from)}` });
      }
    } else {
      for (let index = 0; index < 12; index++) {
        const from = addMonths(monthStart, index - 11);
        buckets.push({ from, to: addMonths(from, 1), label: monthShort.format(from).charAt(0), showLabel: true, tooltip: monthLong.format(from) });
      }
    }
    const first = buckets[0].from;
    const last = buckets[buckets.length - 1];
    const rangeFormat = range === "6M" || range === "J" ? dayMonthYear : dayMonth;
    const rangeLabel = range === "T" ? fullDate.format(asOf) : `${rangeFormat.format(first)} – ${rangeFormat.format(Math.min(last.to - 1, asOfEnd))}`;
    const unitName = { T: "", W: "pro Tag", M: "pro Tag", "6M": "pro Woche", J: "pro Monat" }[range];

    if (definition.kind === "event") {
      const values = buckets.map((bucket) => countEvents(id, bucket.from, Math.min(bucket.to, asOfEnd + 1)));
      const total = values.reduce((sum, value) => sum + value, 0);
      const average = range === "T" ? total : total / values.length;
      return {
        caption: range === "T" ? "GESAMT" : "DURCHSCHNITT",
        value: formatNumber(range === "T" ? total : Math.round(average * 10) / 10),
        unit: range === "T" ? definition.unit(total) : unitName,
        rangeLabel,
        buckets: buckets.map((bucket, index) => ({ label: bucket.label, showLabel: bucket.showLabel, value: values[index], tooltip: `${bucket.tooltip}: ${values[index]} ${definition.unit(values[index])}` })),
        max: Math.max(1, ...values),
        empty: !populated || total === 0,
      };
    }
    if (!definition.stateAt) {
      return { caption: "AKTUELL", value: metrics[id].value, unit: metrics[id].unit, rangeLabel, buckets: [], max: 1, empty: true };
    }
    const values = buckets.map((bucket) => bucket.from > asOfEnd ? null : stateAt(id, Math.min(bucket.to - 1, asOfEnd)));
    const known = values.filter((value): value is number => value !== null);
    const current = stateAt(id, asOfEnd) ?? 0;
    const average = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : 0;
    const shown = range === "T" ? current : average;
    return {
      caption: range === "T" ? "AKTUELL" : "DURCHSCHNITT",
      value: format(id, Math.round(shown * 10) / 10),
      unit: definition.unit(shown),
      rangeLabel,
      buckets: buckets.map((bucket, index) => ({ label: bucket.label, showLabel: bucket.showLabel, value: values[index], tooltip: values[index] === null ? `${bucket.tooltip}: keine Daten` : `${bucket.tooltip}: ${format(id, Math.round(values[index]! * 10) / 10)} ${definition.unit(values[index]!)}` })),
      max: Math.max(1, ...known),
      empty: !populated || known.length === 0,
    };
  }

  /** "This week vs. last week" for the detail page. */
  function weekComparison(id: MetricId): Highlight | null {
    if (!populated) return null;
    const definition = definitions[id];
    if (definition.kind === "event") {
      const current = countEvents(id, thisWeek, asOfEnd + 1);
      const previous = countEvents(id, lastWeek, thisWeek);
      return { id: `${id}-week`, category: definition.category, metric: id, period: "Diese Woche", headline: current === previous ? `Diese Woche genauso viele ${definition.unit(2)} wie letzte Woche.` : `Diese Woche ${current > previous ? "mehr" : "weniger"} ${definition.unit(2)} als letzte Woche.`, viz: { type: "comparison", rows: comparison(current, previous, (value) => `${value} ${definition.unit(value)}`) } };
    }
    if (!definition.stateAt) return null;
    const current = stateAt(id, asOfEnd) ?? 0;
    const previous = stateAt(id, asOfEnd - 7 * DAY) ?? 0;
    const display = (value: number) => `${format(id, Math.round(value * 10) / 10)} ${definition.unit(value)}`;
    return { id: `${id}-week`, category: definition.category, metric: id, period: "Letzte 7 Tage", headline: Math.abs(current - previous) < 0.05 ? `${definition.name} ist seit letzter Woche unverändert.` : `${definition.name} ist seit letzter Woche ${current > previous ? "gestiegen" : "gesunken"}.`, viz: { type: "comparison", rows: comparison(current, previous, display, sinceLastWeek) } };
  }

  return {
    asOfLabel,
    dateLine: fullDate.format(asOf),
    metrics,
    definitions,
    insight,
    highlights,
    activity,
    projectRows,
    steps,
    openSteps: openSteps.length,
    series,
    weekComparison,
    counts: { projects: projects.length, files: files.length, messages: populated ? 1 : 0 },
  };
}

export type HubModel = ReturnType<typeof buildHubModel>;

function projectHref(preview: boolean, id: string | undefined) {
  const base = preview ? "/preview/projects" : "/dashboard/projects";
  return id ? `${base}?project=${id}` : base;
}
