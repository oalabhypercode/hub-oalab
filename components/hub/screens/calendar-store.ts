"use client";

import { useMemo, useState } from "react";
import { closeAppointment, deleteAppointment, requestAppointment, saveAppointment, withdrawRequest } from "@/lib/hub-calendar/actions";
import { cleanNote, MAX_OPEN_REQUESTS, readAppointmentInput, readRequestInput, type Interval } from "@/lib/hub-calendar/rules";
import type { AppointmentInput, CalendarActionResult, HubAppointment, HubCalendarState, RequestInput } from "@/lib/hub-calendar/types";

export type CalendarStore = ReturnType<typeof useCalendarStore>;

const done = <T,>(data: T): CalendarActionResult<T> => ({ ok: true, data });

/**
 * Real logins change appointments through server actions, and the page refreshes with the new data.
 * The preview and the public demo apply the same rules to a copy that never leaves this browser tab.
 */
export function useCalendarStore(state: HubCalendarState) {
  const live = state.source === "supabase";
  const [local, setLocal] = useState(state.appointments);
  const appointments = live ? state.appointments : local;
  // Admins see every appointment, so their busy times come from the list itself.
  const busy = useMemo<Interval[]>(() => state.canManage
    ? appointments.filter((item) => item.status === "confirmed").map(({ start, end }) => ({ start, end }))
    : state.busy, [state.canManage, state.busy, appointments]);
  // Times a customer cannot request: the booked calendar plus their own open requests.
  const blocked = useMemo<Interval[]>(() => state.canManage ? busy
    : [...busy, ...appointments.filter((item) => item.status === "requested").map(({ start, end }) => ({ start, end }))], [state.canManage, busy, appointments]);

  const change = (id: string, update: Partial<HubAppointment>) => setLocal((list) => list.map((item) => item.id === id ? { ...item, ...update } : item));

  async function save(id: string | null, input: AppointmentInput) {
    if (live) return saveAppointment(id, input);
    const read = readAppointmentInput(input);
    if (!read.ok) return read;
    const { title, description, customerId, interval, teamsUrl } = read.value;
    const previous = local.find((item) => item.id === id);
    const next: HubAppointment = {
      id: id ?? `local-${Date.now()}`, title, description, start: interval.start, end: interval.end, status: "confirmed", teamsUrl, responseNote: "",
      customer: state.customers.find((customer) => customer.id === customerId) ?? null,
      sample: Boolean(previous?.sample && teamsUrl === previous.teamsUrl),
    };
    setLocal((list) => id ? list.map((item) => item.id === id ? next : item) : [...list, next]);
    return done({ id: next.id });
  }

  async function close(id: string, status: "declined" | "cancelled", note: string) {
    if (live) return closeAppointment(id, status, note);
    change(id, { status, responseNote: cleanNote(note) });
    return done(null);
  }

  async function remove(id: string) {
    if (live) return deleteAppointment(id);
    setLocal((list) => list.filter((item) => item.id !== id));
    return done(null);
  }

  async function request(input: RequestInput) {
    if (live) return requestAppointment(input);
    const customer = state.customers[0];
    if (!customer) return { ok: false as const, error: "Dein Konto ist noch keinem Kunden zugeordnet." };
    const read = readRequestInput(input, blocked, state.now);
    if (!read.ok) return read;
    if (local.filter((item) => item.status === "requested" && item.end > state.now).length >= MAX_OPEN_REQUESTS) {
      return { ok: false as const, error: `Du hast schon ${MAX_OPEN_REQUESTS} offene Anfragen. Bitte warte auf eine Antwort oder ziehe eine zurück.` };
    }
    const { title, description, interval } = read.value;
    const id = `local-${Date.now()}`;
    setLocal((list) => [...list, { id, title, description, start: interval.start, end: interval.end, status: "requested", teamsUrl: null, responseNote: "", customer }]);
    return done({ id });
  }

  async function withdraw(id: string) {
    if (live) return withdrawRequest(id);
    change(id, { status: "cancelled" });
    return done(null);
  }

  return { live, appointments, busy, blocked, customers: state.customers, canManage: state.canManage, today: state.today, now: state.now, save, close, remove, request, withdraw };
}
