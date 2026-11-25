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
  readonly lastMessage: { readonly body: string; readonly sender: ConversationSender; readonly name: string | null; readonly onBehalf: boolean } | null;
  /** The AI of this request waits for a person („Selbst nachbearbeiten“ or stopped in NoteTree): the team is up. */
  readonly aiPaused: boolean;
}

export interface ConversationMessage {
  readonly id: string;
  readonly sender: ConversationSender;
  readonly name: string | null;
  readonly body: string;
  readonly markdown: boolean;
  readonly at: string;
  /** Written by the team for the customer (`request_messages.on_behalf`): counts as the customer's message. */
  readonly onBehalf: boolean;
}

/**
 * What an admin may do in an open conversation (migration 202611250001, `hub_service_controls`). `handBack`: what
 * „Zurückgeben“ would do now – back to the customer for approval („client“), back to the AI („ai“) or nothing.
 */
export interface ServiceControls {
  readonly version: number;
  readonly handBack: "client" | "ai" | null;
  /** The AI's step in NoteTree (`business_automation_tasks.state`), `null` without automation. */
  readonly aiState: string | null;
  /** Open, not in the bin, the company active: the team may write. */
  readonly writable: boolean;
}

/** How the team writes into a service conversation: for the customer (to the AI) or as oalab. */
export type ServiceWriteKind = "on_behalf" | "reply";

export interface ConversationThread {
  readonly conversation: ConversationSummary;
  readonly messages: readonly ConversationMessage[];
  /** `null` while the database has no team controls yet (or they could not be read): read along only, as before. */
  readonly controls: ServiceControls | null;
}

export interface ConversationsState {
  /** Admin logins read the service platform; the preview shows examples. */
  readonly source: "service" | "fixtures";
  readonly conversations: readonly ConversationSummary[];
  readonly error: string | null;
  /** Requests with a customer's message the signed-in admin has not seen yet (23.11.2026). */
  readonly unread?: readonly string[];
}

/** A failed step may still bring the fresh state along, e.g. when the request changed in between. */
export type ConversationResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string; readonly data?: T };
