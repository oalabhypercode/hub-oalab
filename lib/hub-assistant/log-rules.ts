/**
 * The admin page "KI-Protokoll": one row per assistant proposal from hub_assistant_actions, with its outcome and a
 * short summary of what was proposed. Self-contained (no imports), so `node --test` checks it directly; the payloads
 * are the stored proposals of lib/hub-assistant (proposals.ts, updates.ts, customers.ts).
 */

export type ActionKind = "tasks.create" | "tasks.update" | "project.update" | "customer.create";
export type ActionOutcome = "open" | "executing" | "done" | "discarded" | "failed" | "expired";

export const kindLabels: Record<ActionKind, string> = {
  "tasks.create": "Neue Aufgaben",
  "tasks.update": "Aufgaben ändern",
  "project.update": "Projekt ändern",
  "customer.create": "Neuer Kunde",
};

export const outcomeLabels: Record<ActionOutcome, string> = {
  open: "Offen",
  executing: "Wird gespeichert",
  done: "Gespeichert",
  discarded: "Verworfen",
  failed: "Fehlgeschlagen",
  expired: "Abgelaufen",
};

/** An undecided proposal past its 30 minutes counts as expired; the table never changes the row itself. */
export function actionOutcome(status: string, expiresAt: string, now: number): ActionOutcome {
  if (status === "proposed") return Date.parse(expiresAt) <= now ? "expired" : "open";
  return status === "executing" || status === "done" || status === "discarded" || status === "failed" ? status : "failed";
}

const fieldLabels: Record<string, string> = { dueOn: "Zieltermin", startOn: "Start", status: "Status", description: "Notiz" };
const statusLabels: Record<string, string> = { planning: "Planung", active: "Aktiv", risk: "Risiko", hold: "Pausiert", complete: "Abgeschlossen" };
const day = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const showDay = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? day.format(new Date(`${value}T00:00:00Z`)) : "–";
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const text = (value: unknown) => typeof value === "string" ? value : "";
const list = (value: unknown) => Array.isArray(value) ? value as Record<string, unknown>[] : [];

/** What was proposed, in one line: "2 Aufgaben: Logo freigeben, Texte liefern" or "Status: Aktiv → Pausiert". */
export function actionSummary(kind: string, payload: unknown) {
  const data = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (kind === "tasks.create") {
    const tasks = list(data.tasks);
    const titles = tasks.slice(0, 3).map((task) => text(task.title)).filter(Boolean);
    return `${count(tasks.length, "Aufgabe", "Aufgaben")}${titles.length ? `: ${titles.join(", ")}${tasks.length > 3 ? " …" : ""}` : ""}`;
  }
  if (kind === "tasks.update") {
    const tasks = list(data.tasks);
    return `${count(tasks.length, "Aufgabe", "Aufgaben")}: ${tasks.map((task) => `#${task.number}`).join(", ")}`;
  }
  if (kind === "project.update") {
    return list(data.changes).map((change) => {
      const field = text(change.field);
      if (field === "status") return `Status: ${statusLabels[text(change.before)] ?? text(change.before)} → ${statusLabels[text(change.after)] ?? text(change.after)}`;
      if (field === "dueOn" || field === "startOn") return `${fieldLabels[field]}: ${showDay(change.after)}`;
      return fieldLabels[field] ?? field;
    }).join(" · ") || "Projekt";
  }
  if (kind === "customer.create") {
    const login = data.login && typeof data.login === "object" ? data.login as Record<string, unknown> : null;
    return [text(data.company), login && !login.taken ? `Login für ${text(login.firstName)} ${text(login.lastName)}`.trim() : ""].filter(Boolean).join(" · ");
  }
  return "";
}

/** Where the proposal belongs: customer and project, or the new customer with the number it got. */
export function actionTarget(kind: string, payload: unknown, result: unknown) {
  const data = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (kind === "customer.create") {
    const number = result && typeof result === "object" ? text((result as Record<string, unknown>).customer_number) : "";
    return [text(data.company), number].filter(Boolean).join(" · ");
  }
  return [text(data.customer), text(data.projectName)].filter(Boolean).join(" · ");
}
