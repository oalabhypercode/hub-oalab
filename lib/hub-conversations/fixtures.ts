import { conversationState, requestReference } from "./rules";
import type { ConversationMessage, ConversationsState, ConversationSummary } from "./types";

// Example service conversations for the admins' tab "Service" in the demo logins. Fictional people and companies.

interface DemoThread { id: string; number: number; title: string; state: string; company: string; messages: Omit<ConversationMessage, "id">[] }

export function demoConversations() {
  const client = (body: string, at: string, name = "Jana Sommer"): Omit<ConversationMessage, "id"> => ({ sender: "client", name, body, markdown: false, at });
  const team = (body: string, at: string): Omit<ConversationMessage, "id"> => ({ sender: "oalab", name: "Lena Schneider", body, markdown: false, at });
  const threads: DemoThread[] = [
    { id: "demo-design", number: 1024, title: "Neue Designrichtung", state: "awaiting_client", company: "Nordlicht Studio", messages: [
      client("Hallo Lena, wie weit seid ihr mit der Designrichtung? Wir würden sie gern nächste Woche im Team zeigen.", "2026-10-13T16:12:00+02:00"),
      team("Hallo Jana! Wir sind fast durch, morgen Vormittag bekommst du die erste Fassung.", "2026-10-13T16:30:00+02:00"),
      { sender: "system", name: null, body: "Die Anfrage wartet auf deine Rückmeldung.", markdown: false, at: "2026-10-14T09:38:00+02:00" },
      team("Die erste Designrichtung für Nordlicht Studio ist fertig. Wir haben die Klarheit eurer Marke mit einem frischen, eigenständigen Look verbunden. Die Brand Direction liegt bei deinen Dateien.", "2026-10-14T09:39:00+02:00"),
      team("Schau sie dir in Ruhe an. Wir freuen uns auf deine Gedanken!", "2026-10-14T09:40:00+02:00"),
    ] },
    { id: "demo-texts", number: 1019, title: "Startseite: neue Texte", state: "running", company: "Nordlicht Studio", messages: [
      team("Die neuen Texte für die Startseite sind auf der Testseite. Magst du drüberschauen?", "2026-10-13T10:02:00+02:00"),
      client("Passt so, danke!", "2026-10-14T15:20:00+02:00"),
    ] },
    { id: "demo-social", number: 1012, title: "Instagram-Plan November", state: "submitted", company: "Atelier Brandt", messages: [
      client("Könnt ihr für November drei Posts zu unserem Herbstangebot planen?", "2026-10-10T11:00:00+02:00", "Paul Brandt"),
      { sender: "assistant", name: null, body: "Danke für deine Anfrage! Das oalab-Team plant die Posts und meldet sich bis Freitag.", markdown: false, at: "2026-10-10T11:05:00+02:00" },
    ] },
    { id: "demo-invoice", number: 998, title: "Rechnungsadresse ändern", state: "resolved", company: "Nordlicht Studio", messages: [
      client("Bitte ändert unsere Rechnungsadresse auf die neue Anschrift aus dem Profil.", "2026-10-02T09:15:00+02:00"),
      team("Erledigt, die neue Adresse gilt ab sofort.", "2026-10-02T14:02:00+02:00"),
    ] },
  ];
  const messages = new Map(threads.map((thread) => [thread.id, thread.messages.map((message, index) => ({ ...message, id: `${thread.id}-${index}` }))]));
  const conversations: ConversationSummary[] = threads.map((thread) => {
    const state = conversationState(thread.state);
    const last = messages.get(thread.id)?.at(-1) ?? null;
    return {
      id: thread.id,
      reference: requestReference(thread.number),
      title: thread.title,
      state: thread.state,
      stateLabel: state.label,
      tone: state.tone,
      group: state.group,
      company: thread.company,
      customerId: null,
      logo: null,
      lastAt: last?.at ?? thread.messages[0].at,
      lastMessage: last && { body: last.body, sender: last.sender, name: last.name },
    };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const state: ConversationsState = { source: "fixtures", conversations, error: null };
  return { state, messages };
}
