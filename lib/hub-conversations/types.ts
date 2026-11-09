import type { CustomerLogo } from "@/lib/hub-logos/rules";
import type { ConversationGroup, ConversationSender, ConversationTone } from "./rules";

/** One service conversation in the admins' list: a request of the service platform with its newest message. */
export interface ConversationSummary {
  /** The request's id; `reference` ("OA-12") is how the service platform names it. */
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly state: string;
  readonly stateLabel: string;
  readonly tone: ConversationTone;
  readonly group: ConversationGroup;
  /** The customer's company. */
  readonly company: string | null;
  /** The hub customer behind the request's organization and its logo from the Asset Management, if there is one. */
  readonly customerId: string | null;
  readonly logo: CustomerLogo | null;
  readonly lastAt: string;
  readonly lastMessage: { readonly body: string; readonly sender: ConversationSender; readonly name: string | null } | null;
}

export interface ConversationMessage {
  readonly id: string;
  readonly sender: ConversationSender;
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
  /** Admin logins read the service platform; the preview shows examples. */
  readonly source: "service" | "fixtures";
  readonly conversations: readonly ConversationSummary[];
  readonly error: string | null;
}

export type ConversationResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };
