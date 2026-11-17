import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";
import { todayIso } from "@/lib/hub-routes";
import { loadAssistantDataForCheckedAdmin } from "@/lib/hub-assistant/data";
import { loadAvailability } from "@/lib/hub-calendar/server";
import { addDays, isAppointmentStatus, wallTimeToUtc } from "@/lib/hub-calendar/rules";
import { loadAssignees } from "@/lib/hub-tasks/server";
import { hasScope, checkClientDocument, type ClientDocument } from "./oauth";
import { calendarRange, runHubTool, toolOf, type CalendarAppointment, type CalendarData, type ToolContext } from "./tools";
import { runWriteTool } from "./writes";
import type { ToolResult } from "./protocol";
import type { Connection } from "./store";

/** The hub's public address (NEXT_PUBLIC_SITE_URL or the request's host): issuer, resource and links. */
export function publicOrigin(request: Pick<Request, "headers">) {
  return siteOrigin(request.headers) ?? "https://hub.oalab.de";
}

/** The key from `Authorization: Bearer …`; only the header counts (no keys in addresses). */
export function bearerToken(request: Pick<Request, "headers">) {
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)\s*$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

const MAX_DOCUMENT_BYTES = 64 * 1024;

/**
 * Fetches the app's Client ID Metadata Document from its own address (an https address on Claude's hosts, checked
 * before). No redirects, five seconds, 64 KB: anything else is refused.
 */
export async function fetchClientDocument(clientId: string): Promise<{ ok: true; value: ClientDocument } | { ok: false; error: string }> {
  const unreachable = { ok: false as const, error: "Claude konnte gerade nicht geprüft werden. Bitte versuche es in Claude gleich noch einmal." };
  try {
    const response = await fetch(clientId, { headers: { accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return unreachable;
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_DOCUMENT_BYTES) return unreachable;
    return checkClientDocument(JSON.parse(new TextDecoder().decode(body)), clientId);
  } catch {
    return unreachable;
  }
}

type AppointmentRow = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  status: string;
  teams_url: string | null;
  customer: { id: string; customer_number: string; company: string } | null;
};

/**
 * Appointments and availability for the days `from` … `to` as an admin sees them (all appointments; the weekly plan
 * and exceptions), read with the server key after the key check. Null when the calendar cannot be read.
 */
async function loadCalendar(from: string, to: string): Promise<CalendarData | null> {
  const db = createAdminClient();
  if (!db) return null;
  const start = new Date(wallTimeToUtc(from, "00:00")).toISOString();
  const end = new Date(wallTimeToUtc(addDays(to, 1), "00:00")).toISOString();
  const [appointments, open] = await Promise.all([
    db.from("hub_appointments")
      .select("id, title, description, starts_at, ends_at, status, teams_url, customer:hub_customers(id, customer_number, company)")
      .lt("starts_at", end)
      .gt("ends_at", start)
      .order("starts_at")
      .returns<AppointmentRow[]>(),
    loadAvailability(db, true, from, to),
  ]);
  if (appointments.error) return null;
  return {
    availability: open.availability,
    availabilityReady: open.ready,
    appointments: (appointments.data ?? []).map((row): CalendarAppointment => ({
      id: row.id,
      title: row.title,
      description: row.description,
      start: Date.parse(row.starts_at),
      end: Date.parse(row.ends_at),
      status: isAppointmentStatus(row.status) ? row.status : "requested",
      teamsUrl: row.teams_url,
      customer: row.customer ? { id: row.customer.id, company: row.customer.company, customerNumber: row.customer.customer_number } : null,
    })),
  };
}

const refusal = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/**
 * One tool call of a checked connection: loads exactly what a reading tool needs and lets lib/hub-mcp/tools.ts answer;
 * a writing tool runs in lib/hub-mcp/writes.ts.
 */
export async function callHubTool(connection: Connection, name: string, args: Record<string, unknown>, origin: string): Promise<ToolResult | null> {
  const tool = toolOf(name);
  if (!tool) return null;
  if (!hasScope(connection.scopes, tool.scope)) return refusal("Dafür fehlt dieser Verbindung die Erlaubnis. Trenne Claude im Hub unter „Verbundene Apps“ und verbinde neu; dann fragt der Hub danach.");
  const context: ToolContext = { origin, today: todayIso(), now: Date.now() };
  if (tool.needs === "write") return runWriteTool(connection, name, args, context);
  if (tool.needs === "assistant") {
    context.assistant = (await loadAssistantDataForCheckedAdmin()) ?? undefined;
    // Who can take a task, for assignee_ids: only where Claude may write.
    const db = name === "get_project" && hasScope(connection.scopes, "hub:write") && typeof args.project_id === "string" ? createAdminClient() : null;
    if (db) context.people = (await loadAssignees(db, args.project_id as string).catch(() => null)) ?? undefined;
  } else {
    const range = calendarRange(name, args, context.today);
    if (!range.ok) return refusal(range.error);
    context.calendar = (await loadCalendar(range.from, range.to)) ?? undefined;
  }
  return runHubTool(name, args, context);
}
