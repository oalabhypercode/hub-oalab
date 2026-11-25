import { conversationState, requestReference } from "./rules";
import type { ConversationMessage, ConversationsState, ConversationSummary, ConversationThread, ServiceControls, ServiceWriteKind } from "./types";

// Example service conversations for the admins' tab "Service" in the demo logins. Fictional people and companies.

interface DemoThread { id: string; number: number; title: string; state: string; company: string; paused?: boolean; messages: Omit<ConversationMessage, "id">[] }

export function demoConversations() {
  const client = (body: string, at: string, name = "Jana Sommer"): Omit<ConversationMessage, "id"> => ({ sender: "client", name, body, markdown: false, at, onBehalf: false });
  const team = (body: string, at: string): Omit<ConversationMessage, "id"> => ({ sender: "oalab", name: "Lena Schneider", body, markdown: false, at, onBehalf: false });
  const note = (sender: "system" | "assistant", body: string, at: string): Omit<ConversationMessage, "id"> => ({ sender, name: null, body, markdown: false, at, onBehalf: false });
  const threads: DemoThread[] = [
    { id: "demo-logo", number: 1027, title: "Logo im Kopf größer", state: "running", company: "Atelier Brandt", paused: true, messages: [
      client("Das Logo oben ist zu klein, man erkennt es auf dem Handy kaum.", "2026-10-14T08:50:00+02:00", "Paul Brandt"),
      { sender: "client", name: "Lena Schneider", body: "Bitte das Logo im Kopf auf dem Handy etwa doppelt so groß und mittig, auf großen Bildschirmen links lassen.", markdown: false, at: "2026-10-14T09:05:00+02:00", onBehalf: true },
      team("Das größere Logo liegt auf der Testseite. Schau gern drauf, bevor wir es live schalten.", "2026-10-14T10:12:00+02:00"),
    ] },
    { id: "demo-design", number: 1024, title: "Neue Designrichtung", state: "awaiting_client", company: "Nordlicht Studio", messages: [
      client("Hallo Lena, wie weit seid ihr mit der Designrichtung? Wir würden sie gern nächste Woche im Team zeigen.", "2026-10-13T16:12:00+02:00"),
      team("Hallo Jana! Wir sind fast durch, morgen Vormittag bekommst du die erste Fassung.", "2026-10-13T16:30:00+02:00"),
      note("system", "Die Anfrage wartet auf deine Rückmeldung.", "2026-10-14T09:38:00+02:00"),
      team("Die erste Designrichtung für Nordlicht Studio ist fertig. Wir haben die Klarheit eurer Marke mit einem frischen, eigenständigen Look verbunden. Die Brand Direction liegt bei deinen Dateien.", "2026-10-14T09:39:00+02:00"),
      team("Schau sie dir in Ruhe an. Wir freuen uns auf deine Gedanken!", "2026-10-14T09:40:00+02:00"),
    ] },
    { id: "demo-texts", number: 1019, title: "Startseite: neue Texte", state: "running", company: "Nordlicht Studio", messages: [
      team("Die neuen Texte für die Startseite sind auf der Testseite. Magst du drüberschauen?", "2026-10-13T10:02:00+02:00"),
      client("Passt so, danke!", "2026-10-14T15:20:00+02:00"),
    ] },
    { id: "demo-social", number: 1012, title: "Instagram-Plan November", state: "submitted", company: "Atelier Brandt", messages: [
      client("Könnt ihr für November drei Posts zu unserem Herbstangebot planen?", "2026-10-10T11:00:00+02:00", "Paul Brandt"),
      note("assistant", "Danke für deine Anfrage! Das oalab-Team plant die Posts und meldet sich bis Freitag.", "2026-10-10T11:05:00+02:00"),
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
      lastMessage: last && { body: last.body, sender: last.sender, name: last.name, onBehalf: last.onBehalf },
      aiPaused: thread.paused === true,
    };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const state: ConversationsState = { source: "fixtures", conversations, error: null };
  // What an admin could do in each example: the paused one goes back to the customer, finished ones are closed.
  const controls = new Map<string, ServiceControls>(conversations.map((item) => [item.id, {
    version: 1,
    handBack: item.aiPaused ? "client" : null,
    aiState: item.aiPaused ? "paused" : null,
    writable: item.group !== "done",
  }]));
  return { state, messages, controls };
}

/** One step of the team in the preview, as the database would do it (migration 202611250001), only in this window. */
export type DemoStep = { readonly kind: "hand_back" } | { readonly kind: ServiceWriteKind; readonly body: string };

export function demoStep(thread: ConversationThread, step: DemoStep, author: string, at: string): ConversationThread {
  const controls = thread.controls ?? { version: 1, handBack: null, aiState: null, writable: true };
  const withState = (conversation: ConversationSummary, next: string): ConversationSummary => {
    const view = conversationState(next);
    return { ...conversation, state: next, stateLabel: view.label, tone: view.tone, group: view.group };
  };
  if (step.kind === "hand_back") {
    if (!controls.handBack) return thread;
    // Back to the customer: the test page waits for approval again. Back to the AI: it works on, the state stays.
    const toClient = controls.handBack === "client";
    return {
      ...thread,
      conversation: { ...withState(thread.conversation, toClient ? "release_review" : thread.conversation.state), aiPaused: false },
      controls: { ...controls, version: controls.version + 1, handBack: null, aiState: toClient ? "review_required" : "pending" },
    };
  }
  const onBehalf = step.kind === "on_behalf";
  const message: ConversationMessage = { id: `local-${at}-${thread.messages.length}`, sender: onBehalf ? "client" : "oalab", name: author, body: step.body, markdown: false, at, onBehalf };
  // For the customer counts as their new content: running work is sorted again, a paused AI takes it up after „KI weitermachen lassen“.
  const next = onBehalf && (thread.conversation.state === "queued" || thread.conversation.state === "running") ? "triage_needed" : thread.conversation.state;
  return {
    conversation: { ...withState(thread.conversation, next), lastAt: at, lastMessage: { body: message.body, sender: message.sender, name: author, onBehalf } },
    messages: [...thread.messages, message],
    controls: { ...controls, version: controls.version + 1, handBack: onBehalf && controls.handBack ? "ai" : controls.handBack },
  };
}
