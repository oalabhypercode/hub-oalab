import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connectorClaims } from "@/lib/platform/auth";
import { createOwnClaimsClient } from "@/lib/platform/client";
import { todayIso } from "@/lib/hub-routes";
import { loadAvailability } from "@/lib/hub-calendar/server";
import { addDays, isAppointmentStatus, wallTimeToUtc } from "@/lib/hub-calendar/rules";
import { loadFreelancerBoardAs } from "@/lib/hub-tasks/server";
import { loadFreelancerCardsWith } from "@/lib/hub-freelancer-customers/server";
import { hasScope } from "./oauth";
import {
  customersFromCards, freelancerCalendarRange, freelancerToolOf, runFreelancerTool, type FreelancerAppointment, type FreelancerCalendar, type FreelancerContext,
} from "./freelancer-tools";
import { runFreelancerWrite } from "./freelancer-writes";
import { runNotesTool } from "./notes";
import { freelancerTask } from "./board";
import type { ToolResult } from "./protocol";
import type { Connection } from "./store";

// A freelancer's connection (since 19.11.2026): every tool reads with a client carrying the freelancer's own claims
// (lib/platform/auth.ts connectorClaims, aal2 as after „Erlauben“, no session), never with the server key. Row Level
// Security therefore decides exactly as in the hub: their projects without „Nur Team“, the customers they look after
// with what oalab released (hub_freelancer_customer_cards), oalab's availability and booked times without details,
// their own requests. Only lib/hub-tasks/server.ts names the people and projects of their own board with the server
// key, as it does for the board in the hub. lib/hub-mcp/freelancer-tools.ts answers from that.

type Json = Record<string, unknown>;
type Client = SupabaseClient;
const refusal = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

type AppointmentRow = { id: string; title: string; description: string; starts_at: string; ends_at: string; status: string; teams_url: string | null; response_note: string | null };

/**
 * The freelancer's calendar for the days `from` … `to`: oalab's availability (hub_calendar_availability, without the
 * team's notes), the booked times without details (hub_calendar_busy, with the buffer around the days) and their own
 * requests and appointments, i.e. those of the entries their login belongs to. Null when it cannot be read.
 */
async function loadOwnCalendar(client: Client, userId: string, from: string, to: string): Promise<FreelancerCalendar | null> {
  const open = await loadAvailability(client as unknown as Parameters<typeof loadAvailability>[0], false, from, to);
  const pad = open.availability.rules.buffer * 60_000;
  const start = new Date(wallTimeToUtc(from, "00:00") - pad).toISOString();
  const end = new Date(wallTimeToUtc(addDays(to, 1), "00:00") + pad).toISOString();
  const [memberships, busy] = await Promise.all([
    client.from("hub_customer_members").select("customer_id").eq("user_id", userId).returns<{ customer_id: string }[]>(),
    client.rpc("hub_calendar_busy", { range_start: start, range_end: end }),
  ]);
  if (memberships.error || busy.error) return null;
  const entries = (memberships.data ?? []).map((row) => row.customer_id);
  const own = entries.length
    ? await client.from("hub_appointments").select("id, title, description, starts_at, ends_at, status, teams_url, response_note")
      .in("customer_id", entries).lt("starts_at", end).gt("ends_at", start).order("starts_at").returns<AppointmentRow[]>()
    : { data: [] as AppointmentRow[], error: null };
  if (own.error) return null;
  return {
    availability: open.availability,
    availabilityReady: open.ready,
    busy: ((busy.data ?? []) as { starts_at: string; ends_at: string }[]).map((row) => ({ start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) })),
    own: (own.data ?? []).map((row): FreelancerAppointment => ({
      id: row.id,
      title: row.title,
      description: row.description,
      start: Date.parse(row.starts_at),
      end: Date.parse(row.ends_at),
      status: isAppointmentStatus(row.status) ? row.status : "requested",
      teamsUrl: row.teams_url,
      responseNote: row.response_note,
    })),
  };
}

/** The freelancer's claims for this request: their rights, as the database sees a session of theirs with code. */
export async function freelancerClient(userId: string): Promise<Client | null> {
  const claims = await connectorClaims(userId).catch(() => null);
  return claims ? createOwnClaimsClient(claims) as unknown as Client : null;
}

/**
 * One tool call of a checked freelancer's connection. Only the freelancers' tools exist here; the admins' tools
 * (lib/hub-mcp/tools.ts, writes.ts) are never reached from a freelancer's connection.
 */
export async function callFreelancerTool(connection: Connection, name: string, args: Json, origin: string): Promise<ToolResult | null> {
  const tool = freelancerToolOf(name);
  if (!tool) return null;
  if (!hasScope(connection.scopes, tool.scope)) return refusal("Dafür fehlt dieser Verbindung die Erlaubnis. Trenne Claude im Hub unter „Verbundene Apps“ und verbinde neu; dann fragt der Hub danach.");
  // Notes with the freelancer's own claims, through the notes' own code: released pages, writing only „Nur Freelancer“.
  if (tool.needs === "notes") return runNotesTool(connection, name, args, origin);
  const client = await freelancerClient(connection.userId);
  if (!client) return refusal("Der Hub kann gerade nicht lesen. Bitte versuche es gleich noch einmal.");
  const context: FreelancerContext = { origin, today: todayIso(), now: Date.now(), canWrite: hasScope(connection.scopes, "hub:write") };

  // Writing: the board's and the request window's own save code, with the same claims (lib/hub-mcp/freelancer-writes.ts).
  if (tool.needs === "write") return runFreelancerWrite(connection, name, args, context, client);
  // One card of their own projects, read with their claims („Nur Team“ stays out), as the board reads (lib/hub-mcp/board.ts).
  if (tool.needs === "task") return freelancerTask(connection.userId, client, args, origin);
  if (tool.needs === "calendar") {
    const range = freelancerCalendarRange(name, args, context.today);
    if (!range.ok) return refusal(range.error);
    context.calendar = (await loadOwnCalendar(client, connection.userId, range.from, range.to).catch(() => null)) ?? undefined;
  } else if (tool.needs === "board") {
    const [board, cards] = await Promise.all([loadFreelancerBoardAs(connection.userId, client), loadFreelancerCardsWith(client)]);
    if (board.error) return refusal(board.error);
    if (cards) context.customers = customersFromCards(cards);
    context.board = { viewerId: board.viewerId, projects: board.projects, tasks: board.tasks, people: board.people, freelancers: board.freelancers };
  }
  return runFreelancerTool(name, args, context);
}
