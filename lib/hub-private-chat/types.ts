import type { CustomerLogo } from "@/lib/hub-logos/rules";
import type { ChatSide } from "./rules";

/** One message of a private chat as the reader sees it. */
export interface PrivateChatMessage {
  readonly id: string;
  readonly side: ChatSide;
  /** Written by the signed-in person. */
  readonly own: boolean;
  readonly name: string | null;
  readonly body: string;
  readonly at: string;
  /** For messages of the reader's side: someone of the other side has looked at the chat since. */
  readonly read: boolean;
}

/** A customer's private chat in the list: the company, its logo and the newest message. */
export interface PrivateChatSummary {
  /** The hub customer; a chat belongs to a company, not to one login. */
  readonly customerId: string;
  readonly company: string;
  readonly customerNumber: string;
  /** The logo set in the Asset Management, shown to admins instead of the initials; null without one. */
  readonly logo: CustomerLogo | null;
  readonly lastAt: string | null;
  readonly last: { readonly body: string; readonly side: ChatSide; readonly own: boolean; readonly name: string | null } | null;
  readonly unread: boolean;
}

export interface PrivateChatThread {
  readonly chat: PrivateChatSummary;
  readonly messages: readonly PrivateChatMessage[];
  /** For admins: the active logins of the company, who see an answer and get a notice. */
  readonly people: readonly string[];
}

export interface PrivateChatState {
  /** Real logins read the database; the preview, the public demo and the demo logins show examples. */
  readonly source: "live" | "fixtures";
  readonly viewer: ChatSide;
  /** Customers: their company's chat (rarely more than one); admins: every customer, to answer or to write first. */
  readonly chats: readonly PrivateChatSummary[];
  readonly error: string | null;
}

export type PrivateChatResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };
