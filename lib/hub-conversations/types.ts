import type { CustomerLogo } from "@/lib/hub-logos/rules";
import type { ConversationGroup, ConversationSender, ConversationTone } from "./rules";
import type { TestSiteView } from "./work-status";

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
  /** A report of the team („NoteTree-Verbesserung“, request of the OALab company): open or done, no customer. */
  readonly team: boolean;
  /**
   * Newest message of the customer (also one the team wrote for them) and of oalab, for „Rückmeldung fehlt“ in the list
   * (26.11.2026); missing in the examples.
   */
  readonly lastClientAt?: string | null;
  readonly lastResultAt?: string | null;
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
  /** A result of oalab on the test site (`request_messages.delivery`): with pictures („preview“) or without („work“). */
  readonly result?: "preview" | "work";
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
  /**
   * The signed-in admin belongs to the oalab team of the service platform (`app.user_is_oalab_staff`). Without it the
   * database refuses every step, so the hub shows why up front instead of a field that fails on the first click.
   */
  readonly teamAccess: boolean;
}

/** How the team writes into a service conversation: for the customer (to the AI) or as oalab. */
export type ServiceWriteKind = "on_behalf" | "reply";

/** A new report „NoteTree-Problem melden“: the conversation it became, or the open one with the same text. */
export interface TeamIssueReport {
  readonly thread: ConversationThread;
  readonly existing: boolean;
}

export interface ConversationThread {
  readonly conversation: ConversationSummary;
  readonly messages: readonly ConversationMessage[];
  /** `null` while the database has no team controls yet (or they could not be read): read along only, as before. */
  readonly controls: ServiceControls | null;
  /** The test site of the request's project and when it last changed (26.11.2026); `null` without one. */
  readonly testSite?: TestSiteView | null;
  /** Per result message: how many people got the e-mail „Neue Testansicht bereit“ for it. */
  readonly mails?: Readonly<Record<string, number>>;
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
