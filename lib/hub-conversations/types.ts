import type { ConversationGroup, ConversationSender, ConversationTone } from "./rules";

/** One conversation in the list: a request of the service platform with its newest message. */
export interface ConversationSummary {
  /** The request's id; `reference` ("OA-12") is how the service platform names it. */
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly state: string;
  readonly stateLabel: string;
  readonly tone: ConversationTone;
  readonly group: ConversationGroup;
  readonly canReply: boolean;
  /** The request's version; a reply must name it so nothing newer is overlooked. */
  readonly version: number;
  /** The customer's company; shown to admins, who read every customer's conversations. */
  readonly company: string | null;
  readonly lastAt: string;
  readonly lastMessage: { readonly body: string; readonly sender: ConversationSender; readonly own: boolean; readonly name: string | null } | null;
  readonly unread: boolean;
}

export interface ConversationMessage {
  readonly id: string;
  readonly sender: ConversationSender;
  /** Written by the signed-in person. */
  readonly own: boolean;
  readonly name: string | null;
  readonly body: string;
  readonly markdown: boolean;
  readonly at: string;
}

export interface ConversationThread {
  readonly conversation: ConversationSummary;
  readonly messages: readonly ConversationMessage[];
}

export interface ConversationsState {
  /** Real logins read the service platform; the preview and the demo logins show examples. */
  readonly source: "service" | "fixtures";
  /** Admins read along; answers come from NoteTree Business. */
  readonly readOnly: boolean;
  readonly conversations: readonly ConversationSummary[];
  readonly error: string | null;
}

export type ConversationResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };
