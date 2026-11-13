import type { CustomerLogo } from "@/lib/hub-logos/rules";

/** A category as the settings keep it, with the number of accesses in it. */
export type KeychainCategory = { id: string; name: string; icon: string; position: number; fixed: boolean; count: number };

/** Whom an access belongs to: a customer, or oalab itself (id null, „oalab intern“). */
export type KeychainOwner = { id: string | null; company: string; customerNumber: string; logo: CustomerLogo | null; cancelled: boolean };

/**
 * One access. Mailboxes come from „Vertrag & Domain“ (address, person) and always sit under „Postfächer“; logins are the
 * rows of hub_customer_logins, from there or made here. Of password and note only whether one is stored: their text
 * only travels through the reveal actions, after the unlock check.
 */
export type KeychainEntry = {
  id: string;
  kind: "mailbox" | "login";
  categoryId: string;
  ownerId: string | null;
  title: string;
  /** The person of a mailbox. */
  person: string;
  loginUrl: string;
  username: string;
  hasPassword: boolean;
  hasNote: boolean;
  /** When the password (or, without one, the entry) changed last, ISO. */
  changedAt: string;
};

/** Where the admin stands: not set up yet, locked, open (until when), or shut after too many wrong codes. */
export type KeychainLock =
  | { status: "setup" }
  | { status: "locked"; attemptsLeft: number; recoveryLeft: number }
  | { status: "blocked"; until: string; recoveryLeft: number }
  | { status: "unlocked"; until: string; hardUntil: string; via: "app" | "recovery" | "setup"; recoveryLeft: number };

export type KeychainState = {
  /** False while the database does not know the keychain yet (migration 202611130001 in service-oalab). */
  ready: boolean;
  error?: string;
  /** Whether the server holds HUB_VAULT_KEY, with its short name (never the key). */
  keyId: string | null;
  categories: KeychainCategory[];
  owners: KeychainOwner[];
  entries: KeychainEntry[];
  lock: KeychainLock;
  /** The admin's address, masked („in***@oalab.de“), for the setup's mail code. */
  email: string;
};

/** The lock alone, for the passwords under „Vertrag & Domain“. */
export type KeychainGate = { lock: KeychainLock; keyId: string | null };
