// Privater Chat (4 November 2026): one chat per hub customer between its logins and oalab. Customers write here
// instead of into a request of the service platform; admins answer in the hub. Pure rules for the server, the screen
// and the tests; this file imports nothing from the app.

export type ChatSide = "customer" | "oalab";

export const isChatSide = (value: unknown): value is ChatSide => value === "customer" || value === "oalab";

/**
 * A chat is new for a reader while the other side wrote after both the reader's last look and the newest message of the
 * reader's own side: an answer from a colleague, or from another admin, settles it for the whole side.
 */
export function chatUnread(input: { lastOtherAt: string | null; lastOwnSideAt: string | null; readAt: string | null }): boolean {
  if (!input.lastOtherAt) return false;
  const seen = Math.max(input.readAt ? Date.parse(input.readAt) : 0, input.lastOwnSideAt ? Date.parse(input.lastOwnSideAt) : 0);
  return Date.parse(input.lastOtherAt) > seen;
}

/**
 * Cards in the chat (24.11.2026, lib/hub-chat-events): grey lines (a subscription switched, a request withdrawn) are
 * never news; a card is news for the other side but never an answer of its own side, only people answer. The kinds are
 * those of SYSTEM_EVENT_KINDS in lib/hub-chat-events/rules.ts (the tests compare them).
 */
export const SYSTEM_LINE_KINDS: readonly string[] = ["subscription", "appointment.withdrawn"];
type ChatRowLike = { readonly side: string; readonly created_at: string; readonly event?: unknown };
const kindOf = (event: unknown) => (event && typeof event === "object" && "kind" in event ? String((event as { kind: unknown }).kind) : null);
export const isSystemRow = (row: Pick<ChatRowLike, "event">) => SYSTEM_LINE_KINDS.includes(kindOf(row.event) ?? "");
export const isCardRow = (row: Pick<ChatRowLike, "event">) => kindOf(row.event) !== null && !isSystemRow(row);

/**
 * What the list needs of a chat's rows, newest first: the last message or card (never a grey line), the other side's
 * newest message or card, and the newest message people of the own side wrote.
 */
export function chatActivity<T extends ChatRowLike>(newest: readonly T[], viewer: ChatSide) {
  const shown = newest.filter((row) => isChatSide(row.side) && !isSystemRow(row));
  return {
    last: shown[0] ?? null,
    lastOtherAt: shown.find((row) => row.side !== viewer)?.created_at ?? null,
    lastOwnSideAt: shown.find((row) => row.side === viewer && !isCardRow(row))?.created_at ?? null,
  };
}

/** A message counts as read once someone of the other side looked at the chat after it came. */
export function readByOtherSide(at: string, otherSideReads: readonly string[]): boolean {
  const time = Date.parse(at);
  return otherSideReads.some((readAt) => Date.parse(readAt) >= time);
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? "";

/**
 * Who wrote, as the reader sees it. Customers read oalab's people as "Lena von oalab" and their colleagues by name;
 * admins read customers and the other admins by name. The own messages carry no name in the chat.
 */
export function chatSender(input: { side: ChatSide; own: boolean; name: string | null; viewer: ChatSide }): string {
  if (input.own) return "Du";
  if (input.side === "oalab") {
    if (input.viewer === "oalab") return input.name?.trim() || "oalab-Team";
    const first = firstName(input.name);
    return first ? `${first} von oalab` : "oalab-Team";
  }
  return input.name?.trim() || "Kunde";
}

/** Who wrote, in the list's one line: "Du", oalab's people by first name ("Lena"), a customer by full name. */
export function chatListSender(input: { side: ChatSide; own: boolean; name: string | null }): string {
  if (input.own) return "Du";
  if (input.side === "oalab") return firstName(input.name) || "oalab";
  return input.name?.trim() || "Kunde";
}

/**
 * Which side of the chat a message sits on: the reader's side on the right. Customers see only their own messages on
 * the right (colleagues write like in a group, on the left with their name); admins see all of oalab on the right.
 */
export function chatMessageSide(input: { side: ChatSide; own: boolean; viewer: ChatSide }): "out" | "in" {
  if (input.viewer === "oalab") return input.side === "oalab" ? "out" : "in";
  return input.own ? "out" : "in";
}

/** "Jana Sommer und Tim Berger", "Jana Sommer, Tim Berger und Mia Roth": the people who read a customer's chat. */
export function peopleLine(names: readonly string[]): string {
  const list = names.map((name) => name.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} und ${list.at(-1)}`;
}
