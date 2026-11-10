/**
 * Logins for many customers at once and their invitations (User Management): which customers still need a login, who
 * gets it (the contact person from the accounting's export, else the customer's contact address), what stands in the
 * way, and how far each customer is (no login, login created, invited, signed in). Self-contained, so the tests run it
 * directly; the hub's own checks of names and addresses come in as parameters.
 */

/** Logins per server call when creating them: each one is a login, a profile and a membership. */
export const LOGIN_BATCH = 10;
/** Invitations per server call: each one is a link and a mail. */
export const INVITE_BATCH = 10;

/** A contact person as the accounting's export names them. */
export type Contact = { firstName: string; lastName: string; email: string; line: number };

export type LoginCustomer = { id: string; kind: string; customerNumber: string; company: string; contactEmail: string; memberIds: readonly string[] };

export type LoginDraft = {
  customerId: string;
  company: string;
  customerNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Where the address came from: the contact person of the file, the customer's contact address, or nowhere yet. */
  source: "file" | "customer" | "";
};

/**
 * One row per customer without a login, by company name. The contact person of the file (if one was loaded) gives the
 * names and, if they have one, the address; otherwise the customer's own contact address is the start.
 */
export function loginDrafts(customers: readonly LoginCustomer[], contactFor: (customer: LoginCustomer) => Contact | null = () => null): LoginDraft[] {
  return customers
    .filter((customer) => customer.kind === "customer" && customer.memberIds.length === 0)
    .map((customer): LoginDraft => {
      const contact = contactFor(customer);
      const email = (contact?.email || customer.contactEmail || "").trim().toLowerCase();
      return {
        customerId: customer.id,
        company: customer.company,
        customerNumber: customer.customerNumber,
        firstName: contact?.firstName ?? "",
        lastName: contact?.lastName ?? "",
        email,
        source: contact?.email ? "file" : email ? "customer" : "",
      };
    })
    .sort((a, b) => a.company.localeCompare(b.company, "de"));
}

export type CheckedLogin = LoginDraft & { problem: string | null };

/**
 * What stands in the way of each row: a missing or invalid address, an address that already has a login (one login
 * belongs to one customer), the same address at an earlier row, missing or invalid names. `check` holds the hub's own
 * rules (cleanEmail, readPerson); `taken` the addresses of all existing logins.
 */
export function checkLogins(drafts: readonly LoginDraft[], taken: ReadonlySet<string>, check: { email: (email: string) => string | null; person: (firstName: string, lastName: string) => string | null }): CheckedLogin[] {
  const seen = new Map<string, string>();
  return drafts.map((draft) => {
    const email = draft.email.trim().toLowerCase();
    const problem = !email ? "E-Mail-Adresse fehlt"
      : check.email(email) ? "Keine gültige E-Mail-Adresse"
      : taken.has(email) ? "Für diese Adresse gibt es schon einen Zugang"
      : seen.has(email) ? `Dieselbe Adresse wie bei „${seen.get(email)}“`
      : !draft.firstName.trim() || !draft.lastName.trim() ? "Vor- und Nachname fehlen"
      : check.person(draft.firstName, draft.lastName);
    if (email && !seen.has(email)) seen.set(email, draft.company);
    return { ...draft, email, problem };
  });
}

// How far a customer is ------------------------------------------------------------------------------------------------

export type LoginState = "none" | "created" | "invited" | "active";

export const loginStateLabels: Record<LoginState, string> = {
  none: "kein Zugang",
  created: "Zugang angelegt",
  invited: "eingeladen",
  active: "aktiv",
};

export type MemberLogin = { lastSignInAt: string | null; invitedAt: string | null };

/**
 * A customer's state from its logins: active once one of them signed in, invited once an invitation went out to one,
 * otherwise created; none without logins. The last login is the newest of all.
 */
export function customerLoginState(members: readonly MemberLogin[]): { state: LoginState; lastSignInAt: string | null } {
  const lastSignInAt = members.reduce<string | null>((latest, member) => (member.lastSignInAt && (!latest || member.lastSignInAt > latest) ? member.lastSignInAt : latest), null);
  if (!members.length) return { state: "none", lastSignInAt: null };
  if (lastSignInAt) return { state: "active", lastSignInAt };
  return { state: members.some((member) => member.invitedAt) ? "invited" : "created", lastSignInAt: null };
}

export type InvitableLogin = { id: string; displayStatus: string; invitedAt: string | null };

/** Logins an invitation can go to: active, never signed in. */
export const isInvitable = (login: InvitableLogin) => login.displayStatus === "invited";

/** Ticked at the start: the ones never invited; reminders to the others are a choice. */
export const isFirstInvitation = (login: InvitableLogin) => isInvitable(login) && !login.invitedAt;

// The announcement before the invitations -----------------------------------------------------------------------------

/** How far ahead the day of the invitations may lie: within a week, so the mail can name it by its weekday. */
export const ANNOUNCE_DAYS_AHEAD = 6;

export type AnnounceableLogin = InvitableLogin & { role: string | null; announcedAt: string | null };

/** Logins the announcement goes to: customer logins nobody has signed in with yet. */
export const isAnnounceable = (login: AnnounceableLogin) => isInvitable(login) && login.role === "oalab_customer";

/** Ticked at the start: the ones that got neither the announcement nor an invitation yet. */
export const isFirstAnnouncement = (login: AnnounceableLogin) => isAnnounceable(login) && !login.announcedAt && !login.invitedAt;

const berlinDate = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day of a moment in German time, as YYYY-MM-DD. */
export function berlinDayKey(moment: Date) {
  const parts = Object.fromEntries(berlinDate.formatToParts(moment).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The days the invitations may be announced for: from today up to ANNOUNCE_DAYS_AHEAD days ahead, suggested tomorrow. */
export function announceDays(now: Date) {
  const [year, month, day] = berlinDayKey(now).split("-").map(Number);
  const ahead = (days: number) => new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
  return { min: ahead(0), max: ahead(ANNOUNCE_DAYS_AHEAD), suggested: ahead(1) };
}

/**
 * The chosen day of the invitations as noon of that day (in German time still the same date), or null for anything
 * that is no real date within announceDays.
 */
export function readAnnounceDay(value: unknown, now: Date): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const { min, max } = announceDays(now);
  if (value < min || value > max) return null;
  const [year, month, day] = value.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  return noon.toISOString().slice(0, 10) === value ? noon : null;
}
