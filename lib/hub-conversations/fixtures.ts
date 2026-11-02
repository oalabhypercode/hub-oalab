import { conversationState, requestReference } from "./rules";
import type { ConversationMessage, ConversationsState, ConversationSummary } from "./types";

// Example conversations for the preview, the public demo and the demo logins. Fictional people and companies; the
// newest message is the one the overview's "Nachrichten" card names (Lena Schneider, "Neue Designrichtung").

interface DemoThread { id: string; number: number; title: string; state: string; company: string; seenAt: string | null; messages: Omit<ConversationMessage, "id">[] }

export function demoConversations({ firstName, company, admin }: { firstName: string; company: string | null; admin: boolean }) {
  const me = firstName || "Jana";
  const customer = company || "Nordlicht Studio";
  const client = (body: string, at: string, name = "Jana Sommer"): Omit<ConversationMessage, "id"> => ({ sender: "client", own: !admin, name: admin ? name : null, body, markdown: false, at });
  const team = (body: string, at: string): Omit<ConversationMessage, "id"> => ({ sender: "oalab", own: false, name: admin ? "Lena Schneider" : null, body, markdown: false, at });
  const threads: DemoThread[] = [
    { id: "demo-design", number: 1024, title: "Neue Designrichtung", state: "awaiting_client", company: customer, seenAt: "2026-10-13T16:31:00+02:00", messages: [
      client("Hallo Lena, wie weit seid ihr mit der Designrichtung? Wir würden sie gern nächste Woche im Team zeigen.", "2026-10-13T16:12:00+02:00"),
      team(`Hallo ${me}! Wir sind fast durch, morgen Vormittag bekommst du die erste Fassung.`, "2026-10-13T16:30:00+02:00"),
      { sender: "system", own: false, name: null, body: "Die Anfrage wartet auf deine Rückmeldung.", markdown: false, at: "2026-10-14T09:38:00+02:00" },
      team(`Die erste Designrichtung für ${customer} ist fertig. Wir haben die Klarheit eurer Marke mit einem frischen, eigenständigen Look verbunden. Die Brand Direction liegt bei deinen Dateien.`, "2026-10-14T09:39:00+02:00"),
      team("Schau sie dir in Ruhe an. Wir freuen uns auf deine Gedanken!", "2026-10-14T09:40:00+02:00"),
    ] },
    { id: "demo-texts", number: 1019, title: "Startseite: neue Texte", state: "running", company: customer, seenAt: "2026-10-14T15:20:00+02:00", messages: [
      team("Die neuen Texte für die Startseite sind auf der Testseite. Magst du drüberschauen?", "2026-10-13T10:02:00+02:00"),
      client("Passt so, danke!", "2026-10-14T15:20:00+02:00"),
    ] },
    { id: "demo-social", number: 1012, title: "Instagram-Plan November", state: "submitted", company: admin ? "Atelier Brandt" : customer, seenAt: "2026-10-10T11:06:00+02:00", messages: [
      client("Könnt ihr für November drei Posts zu unserem Herbstangebot planen?", "2026-10-10T11:00:00+02:00", "Paul Brandt"),
      { sender: "assistant", own: false, name: null, body: "Danke für deine Anfrage! Das oalab-Team plant die Posts und meldet sich bis Freitag.", markdown: false, at: "2026-10-10T11:05:00+02:00" },
    ] },
    { id: "demo-invoice", number: 998, title: "Rechnungsadresse ändern", state: "resolved", company: customer, seenAt: "2026-10-02T14:10:00+02:00", messages: [
      client("Bitte ändert unsere Rechnungsadresse auf die neue Anschrift aus dem Profil.", "2026-10-02T09:15:00+02:00"),
      team("Erledigt, die neue Adresse gilt ab sofort.", "2026-10-02T14:02:00+02:00"),
    ] },
  ];
  const messages = new Map(threads.map((thread) => [thread.id, thread.messages.map((message, index) => ({ ...message, id: `${thread.id}-${index}` }))]));
  const conversations: ConversationSummary[] = threads.map((thread) => {
    const state = conversationState(thread.state);
    const list = messages.get(thread.id) ?? [];
    const last = list.at(-1) ?? null;
    const lastAnswer = [...list].reverse().find((message) => message.sender === "oalab" || message.sender === "assistant");
    return {
      id: thread.id,
      reference: requestReference(thread.number),
      title: thread.title,
      state: thread.state,
      stateLabel: state.label,
      tone: state.tone,
      group: state.group,
      canReply: !admin && state.canReply,
      version: 1,
      company: admin ? thread.company : null,
      lastAt: last?.at ?? thread.messages[0].at,
      lastMessage: last && { body: last.body, sender: last.sender, own: last.own, name: last.name },
      unread: !admin && Boolean(lastAnswer && (!thread.seenAt || lastAnswer.at > thread.seenAt)),
    };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const state: ConversationsState = { source: "fixtures", readOnly: admin, conversations, error: null };
  return { state, messages };
}
