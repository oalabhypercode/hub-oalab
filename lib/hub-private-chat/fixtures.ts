import { DEFAULT_SUBSCRIPTIONS, type AppointmentNow, type ChatArea, type ChatEvent } from "@/lib/hub-chat-events/rules";
import { chatActivity, chatUnread, type ChatSide } from "./rules";
import type { PrivateChatMessage, PrivateChatState, PrivateChatSummary } from "./types";

// Example private chats for the preview, the public demo and the demo logins. Fictional people and companies; new
// messages, switched subscriptions and confirmed requests stay in the browser window.

type DemoChat = { id: string; company: string; customerNumber: string; readAt: string | null; messages: Omit<PrivateChatMessage, "id" | "read">[] };

/**
 * „Now“ for the examples' cards: the day after the newest example, so the request still counts as „offen“ and the moved
 * appointment lies ahead, whatever the real date is.
 */
export const DEMO_NOW = Date.parse("2026-10-16T12:00:00+02:00");

const TEXTS_ID = "00000000-0000-4000-8000-0000000000a1";
const CALL_ID = "00000000-0000-4000-8000-0000000000a2";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000b1";
const PAGE_ID = "00000000-0000-4000-8000-0000000000c1";
const file = (n: number, name: string) => ({ id: `00000000-0000-4000-8000-0000000000d${n}`, name });

const textsBefore = { id: TEXTS_ID, title: "Abstimmung Texte", startsAt: "2026-10-20T10:00:00+02:00", endsAt: "2026-10-20T10:30:00+02:00", teams: true };
const textsNow = { ...textsBefore, startsAt: "2026-10-21T14:00:00+02:00", endsAt: "2026-10-21T14:30:00+02:00", before: textsBefore.startsAt };

/** The appointments the example cards name, as they stand today. */
const DEMO_APPOINTMENTS: Record<string, Exclude<AppointmentNow, undefined>> = {
  [TEXTS_ID]: { status: "confirmed", startsAt: textsNow.startsAt, endsAt: textsNow.endsAt },
  [CALL_ID]: { status: "requested", startsAt: "2026-10-22T11:00:00+02:00", endsAt: "2026-10-22T11:30:00+02:00" },
};

const created: ChatEvent = { v: 1, kind: "appointment.created", appointment: textsBefore };
const moved: ChatEvent = { v: 1, kind: "appointment.changed", appointment: textsNow };
const files: ChatEvent = { v: 1, kind: "file.shared", files: [file(1, "Oktober-Zahlen.pdf"), file(2, "logo-final.svg"), file(3, "farben.pdf")], total: 3 };
const tasksOn: ChatEvent = { v: 1, kind: "subscription", area: "tasks", on: true };
const yourTurn: ChatEvent = { v: 1, kind: "task.customer", task: { projectId: PROJECT_ID, number: 14, title: "Texte für „Über uns“", project: "Website-Relaunch", parts: [] } };
const mailbox: ChatEvent = { v: 1, kind: "contract.changed", items: [{ what: "mailbox", label: "info@nordlicht.example", change: "new" }] };
const project: ChatEvent = { v: 1, kind: "project.changed", project: { id: PROJECT_ID, name: "Website-Relaunch", change: "Zieltermin: 30. November 2026" } };
const note = (customerId: string): ChatEvent => ({ v: 1, kind: "note.shared", note: { customerId, pageId: PAGE_ID, title: "Styleguide" } });
const request: ChatEvent = { v: 1, kind: "appointment.requested", appointment: { id: CALL_ID, title: "Kurzes Telefonat zum Launch", startsAt: "2026-10-22T11:00:00+02:00", endsAt: "2026-10-22T11:30:00+02:00", teams: false } };

export function demoPrivateChats({ firstName, company, admin }: { firstName: string; company: string | null; admin: boolean }) {
  const me = firstName || "Jana";
  const customer = company || "Nordlicht Studio";
  const viewer: ChatSide = admin ? "oalab" : "customer";
  const from = (side: ChatSide, name: string, body: string, at: string, own = false): Omit<PrivateChatMessage, "id" | "read"> => ({ side, own, name: own ? null : name, body, at, event: null });
  const card = (side: ChatSide, name: string | null, at: string, event: ChatEvent, own = false): Omit<PrivateChatMessage, "id" | "read"> => ({ side, own, name: own ? null : name, body: "", at, event });

  const chats: DemoChat[] = admin ? [
    { id: "demo-chat-nordlicht", company: "Nordlicht Studio", customerNumber: "KD-24017", readAt: "2026-10-14T16:45:00+02:00", messages: [
      from("customer", "Jana Sommer", "Hallo zusammen, können wir nächste Woche kurz über das Angebot für die Social-Media-Betreuung sprechen?", "2026-10-14T16:05:00+02:00"),
      from("oalab", "Lena Schneider", "Hallo Jana, sehr gern! Passt dir Dienstag um 10 Uhr? Ich schicke dir dann eine Einladung.", "2026-10-14T16:21:00+02:00", true),
      from("customer", "Tim Berger", "Ich wäre auch gern dabei.", "2026-10-14T16:40:00+02:00"),
      from("customer", "Jana Sommer", "Dienstag 10 Uhr passt uns beiden. Bringt ihr die Zahlen vom Oktober mit?", "2026-10-15T09:12:00+02:00"),
      card("oalab", "Lena Schneider", "2026-10-15T09:41:00+02:00", created, true),
      card("oalab", "Tom Weber", "2026-10-15T10:05:00+02:00", files),
      card("customer", "Jana Sommer", "2026-10-16T08:58:00+02:00", tasksOn),
      card("oalab", null, "2026-10-16T09:02:00+02:00", yourTurn),
      card("oalab", "Lena Schneider", "2026-10-16T09:20:00+02:00", moved, true),
      card("oalab", "Tom Weber", "2026-10-16T09:31:00+02:00", mailbox),
      card("customer", "Jana Sommer", "2026-10-16T09:40:00+02:00", request),
    ] },
    { id: "demo-chat-brandt", company: "Atelier Brandt", customerNumber: "KD-24023", readAt: "2026-10-12T15:02:00+02:00", messages: [
      from("oalab", "Lena Schneider", "Die neuen Fotos sind online, schau gern drüber.", "2026-10-12T15:02:00+02:00", true),
      from("customer", "Paul Brandt", "Sieht super aus, danke! Können wir das Teamfoto noch etwas heller machen?", "2026-10-15T08:47:00+02:00"),
    ] },
    { id: "demo-chat-morgenrot", company: "Café Morgenrot", customerNumber: "OA-5821", readAt: "2026-10-14T11:45:00+02:00", messages: [
      from("customer", "Lisa Hoff", "Könnt ihr die Öffnungszeiten für die Feiertage eintragen?", "2026-10-14T11:20:00+02:00"),
      from("oalab", "Lena Schneider", "Gern, bis Freitag ist es drin!", "2026-10-14T11:45:00+02:00", true),
    ] },
    { id: "demo-chat-praxis", company: "Praxis am Park", customerNumber: "OA-7310", readAt: "2026-10-12T09:30:00+02:00", messages: [
      from("customer", "Anna Weber", "Wo finde ich die Rechnung für Oktober?", "2026-10-12T09:10:00+02:00"),
      from("oalab", "Tom Weber", "Die Rechnung liegt bei euren Dateien.", "2026-10-12T09:30:00+02:00"),
    ] },
    { id: "demo-chat-hansen", company: "Bäckerei Hansen", customerNumber: "OA-4417", readAt: null, messages: [] },
  ] : [
    { id: "demo-chat-own", company: customer, customerNumber: "KD-24017", readAt: "2026-10-15T09:12:00+02:00", messages: [
      from("customer", me, "Hallo zusammen, können wir nächste Woche kurz über das Angebot für die Social-Media-Betreuung sprechen?", "2026-10-14T16:05:00+02:00", true),
      from("oalab", "Lena Schneider", `Hallo ${me}, sehr gern! Passt dir Dienstag um 10 Uhr? Ich schicke dir dann eine Einladung.`, "2026-10-14T16:21:00+02:00"),
      from("customer", "Tim Berger", "Ich wäre auch gern dabei.", "2026-10-14T16:40:00+02:00"),
      from("customer", me, "Dienstag 10 Uhr passt uns beiden. Bringt ihr die Zahlen vom Oktober mit?", "2026-10-15T09:12:00+02:00", true),
      from("oalab", "Tom Weber", "Machen wir! Ich lege sie euch vorher unter Dateien ab.", "2026-10-15T09:30:00+02:00"),
      card("oalab", "Lena Schneider", "2026-10-15T09:41:00+02:00", created),
      card("oalab", "Tom Weber", "2026-10-15T10:05:00+02:00", files),
      card("customer", me, "2026-10-16T08:58:00+02:00", tasksOn, true),
      card("oalab", null, "2026-10-16T09:02:00+02:00", yourTurn),
      card("oalab", "Lena Schneider", "2026-10-16T09:20:00+02:00", moved),
      card("oalab", "Tom Weber", "2026-10-16T09:31:00+02:00", mailbox),
      card("oalab", null, "2026-10-16T09:47:00+02:00", project),
      from("customer", me, "Danke! Mittwoch um 14 Uhr passt auch.", "2026-10-16T10:05:00+02:00", true),
      card("oalab", "Lena Schneider", "2026-10-16T10:15:00+02:00", note("demo-chat-own")),
    ] },
  ];

  const messages = new Map<string, PrivateChatMessage[]>(chats.map((chat) => {
    // Messages of the reader's side count as read once the other side wrote after them.
    const otherAt = chat.messages.filter((message) => message.side !== viewer).map((message) => message.at);
    return [chat.id, chat.messages.map((message, index) => ({ ...message, id: `${chat.id}-${index}`, read: message.side === viewer && otherAt.some((at) => at >= message.at) }))];
  }));
  const summaries: PrivateChatSummary[] = chats.map((chat) => demoSummary(chat, messages.get(chat.id) ?? [], viewer));
  const people = new Map<string, string[]>(admin ? [["demo-chat-nordlicht", ["Jana Sommer", "Tim Berger"]], ["demo-chat-brandt", ["Paul Brandt"]], ["demo-chat-morgenrot", ["Lisa Hoff"]], ["demo-chat-praxis", ["Anna Weber"]], ["demo-chat-hansen", ["Ole Hansen"]]] : []);
  // The chats with cards have subscribed to Aufgaben, as their grey line says; the others keep the defaults.
  const subscriptions = new Map<string, Record<ChatArea, boolean>>(chats.map((chat) => [chat.id, { ...DEFAULT_SUBSCRIPTIONS, tasks: chat.id === "demo-chat-nordlicht" || chat.id === "demo-chat-own" }]));
  const state: PrivateChatState = { source: "fixtures", viewer, chats: summaries, error: null };
  return { state, messages, people, subscriptions, appointments: { ...DEMO_APPOINTMENTS }, calendarLinks: { [TEXTS_ID]: { ics: "#", google: "#", outlook: "#" } } };
}

/** A demo chat in the list, by the same rules as real ones (grey lines skipped, cards no answer). */
export function demoSummary(chat: Pick<DemoChat, "id" | "company" | "customerNumber" | "readAt">, list: readonly PrivateChatMessage[], viewer: ChatSide): PrivateChatSummary {
  const rows = [...list].reverse().map((message) => ({ ...message, created_at: message.at }));
  const { last, lastOtherAt, lastOwnSideAt } = chatActivity(rows, viewer);
  return {
    customerId: chat.id,
    company: chat.company,
    customerNumber: chat.customerNumber,
    logo: null,
    lastAt: last?.at ?? null,
    last: last && { body: last.body, side: last.side, own: last.own, name: last.name, event: last.event },
    unread: chatUnread({ lastOtherAt, lastOwnSideAt, readAt: chat.readAt }),
  };
}
