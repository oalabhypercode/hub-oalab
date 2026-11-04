import { chatUnread, type ChatSide } from "./rules";
import type { PrivateChatMessage, PrivateChatState, PrivateChatSummary } from "./types";

// Example private chats for the preview, the public demo and the demo logins. Fictional people and companies; new
// messages stay in the browser window.

type DemoChat = { id: string; company: string; customerNumber: string; readAt: string | null; messages: Omit<PrivateChatMessage, "id" | "read">[] };

export function demoPrivateChats({ firstName, company, admin }: { firstName: string; company: string | null; admin: boolean }) {
  const me = firstName || "Jana";
  const customer = company || "Nordlicht Studio";
  const viewer: ChatSide = admin ? "oalab" : "customer";
  const from = (side: ChatSide, name: string, body: string, at: string, own = false): Omit<PrivateChatMessage, "id" | "read"> => ({ side, own, name: own ? null : name, body, at });

  const chats: DemoChat[] = admin ? [
    { id: "demo-chat-nordlicht", company: "Nordlicht Studio", customerNumber: "KD-24017", readAt: "2026-10-14T16:45:00+02:00", messages: [
      from("customer", "Jana Sommer", "Hallo zusammen, können wir nächste Woche kurz über das Angebot für die Social-Media-Betreuung sprechen?", "2026-10-14T16:05:00+02:00"),
      from("oalab", "Lena Schneider", "Hallo Jana, sehr gern! Passt dir Dienstag um 10 Uhr? Ich schicke dir dann eine Einladung.", "2026-10-14T16:21:00+02:00", true),
      from("customer", "Tim Berger", "Ich wäre auch gern dabei.", "2026-10-14T16:40:00+02:00"),
      from("customer", "Jana Sommer", "Dienstag 10 Uhr passt uns beiden. Bringt ihr die Zahlen vom Oktober mit?", "2026-10-15T09:12:00+02:00"),
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
    ] },
  ];

  const messages = new Map<string, PrivateChatMessage[]>(chats.map((chat) => {
    // Messages of the reader's side count as read once the other side wrote after them.
    const otherAt = chat.messages.filter((message) => message.side !== viewer).map((message) => message.at);
    return [chat.id, chat.messages.map((message, index) => ({ ...message, id: `${chat.id}-${index}`, read: message.side === viewer && otherAt.some((at) => at >= message.at) }))];
  }));
  const summaries: PrivateChatSummary[] = chats.map((chat) => {
    const list = messages.get(chat.id) ?? [];
    const last = list.at(-1) ?? null;
    const lastOther = [...list].reverse().find((message) => message.side !== viewer);
    const lastOwnSide = [...list].reverse().find((message) => message.side === viewer);
    return {
      customerId: chat.id,
      company: chat.company,
      customerNumber: chat.customerNumber,
      logo: null,
      lastAt: last?.at ?? null,
      last: last && { body: last.body, side: last.side, own: last.own, name: last.name },
      unread: chatUnread({ lastOtherAt: lastOther?.at ?? null, lastOwnSideAt: lastOwnSide?.at ?? null, readAt: chat.readAt }),
    };
  });
  const people = new Map<string, string[]>(admin ? [["demo-chat-nordlicht", ["Jana Sommer", "Tim Berger"]], ["demo-chat-brandt", ["Paul Brandt"]], ["demo-chat-morgenrot", ["Lisa Hoff"]], ["demo-chat-praxis", ["Anna Weber"]], ["demo-chat-hansen", ["Ole Hansen"]]] : []);
  const state: PrivateChatState = { source: "fixtures", viewer, chats: summaries, error: null };
  return { state, messages, people };
}
