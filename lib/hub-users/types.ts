import type { CustomerLogo } from "@/lib/hub-logos/rules";
import type { PackageId } from "@/lib/service-packages";
import type { TeamEntry, TeamRoleState } from "@/lib/hub-team/rules";
import type { StartMailKind } from "@/lib/hub-invitations/rules";
import type { AccountStatus, CustomerKind, DisplayStatus, HubRole } from "./rules";

/** A login as the user management lists it: Supabase Auth data merged with its profile and customers. */
export type ManagedUser = {
  id: string;
  email: string;
  emailConfirmed: boolean;
  firstName: string;
  lastName: string;
  phone: string;
  position: string;
  /** What the person stated when registering. */
  companyName: string;
  website: string;
  customerNumberHint: string;
  message: string;
  status: AccountStatus;
  displayStatus: DisplayStatus;
  role: HubRole | null;
  /** The signed-in admin themself: no role change, deactivation or deletion. */
  self: boolean;
  /** The method sign-in asks for as second factor: off, a code by e-mail or the login's authenticator app. */
  secondFactor: "off" | "email" | "totp";
  /** Freelancers: an admin switched Claude on for this login (the Claude connector with the freelancer's rights). */
  claude: boolean;
  /** Admins: the team role in Studio that lets them write projects and tasks (lib/hub-team/rules.ts). */
  teamRole: TeamRoleState;
  customerIds: string[];
  source: "registration" | "admin" | "existing";
  createdAt: string;
  lastSignInAt: string | null;
  /** When the last activation mail went out to the login (invitation or „Link per E-Mail senden“). */
  invitedAt: string | null;
  /** When the last announcement of the invitation went out to the login („Ankündigung senden“). */
  announcedAt: string | null;
  /** When the last reminder before the start of hub and service platform went out to the login („Erinnerung senden“). */
  remindedAt: string | null;
  /** When each mail of the start series last went out to the login („Startmails senden“, 26.11.2026). */
  startMails: Partial<Record<StartMailKind, string>>;
  /** False once the login stopped the info mails with the link at the foot of one (lib/hub-mail/opt-out.ts). */
  infoMails: boolean;
  decidedAt: string | null;
  decisionNote: string;
  privacyNotedAt: string | null;
};

export type ManagedCustomer = {
  id: string;
  customerNumber: string;
  company: string;
  /** The packages the customer holds (both groups); they are edited under „Vertrag & Domain“. */
  packages: PackageId[];
  contactEmail: string;
  phone: string;
  website: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  /** Also a Service organization: company, number and contact data are the same on both platforms. */
  inService: boolean;
  createdAt: string;
  memberIds: string[];
  /** The same logo as in the asset management; without one the letters stand there. */
  logo?: CustomerLogo | null;
  /** A customer or a freelancer; "customer" while the freelancer migration is missing. */
  kind: CustomerKind;
  /** Customers: the freelancers who look after them. Freelancers: the customers they look after. */
  linkedIds: string[];
  /**
   * When it was archived (in the user management or, for a customer, its organization in Service); null while active.
   * An archived entry is out of sight everywhere but here (lib/hub-archive).
   */
  archivedAt: string | null;
  /** Who archived it; null when that happened in Service or the login is gone. */
  archivedBy: string | null;
  /** The logins the archive blocked; restoring frees exactly these. */
  archivedLoginIds: string[];
};

/** oalab's own entry (kind "team"): the group „oalab“ under „Zugänge“ with its logo; null before its migration. */
export type ManagedTeam = TeamEntry & { logo?: CustomerLogo | null };

export type ManagedEvent = {
  id: number;
  at: string;
  actorName: string;
  action: string;
  summary: string;
  targetUserId: string | null;
  targetCustomerId: string | null;
};

export type UserManagementState = {
  users: ManagedUser[];
  /** Customers and freelancers; oalab's own entry stands apart in `team`. */
  customers: ManagedCustomer[];
  team: ManagedTeam | null;
  /** Admin actions and sent mails, newest first. */
  events: ManagedEvent[];
  nextCustomerNumber: string;
  nextFreelancerNumber: string;
  /** Freelancers can be managed: the database knows them (migration 202611040002 in service-oalab). */
  freelancers: boolean;
  /** False while the SMTP access is missing: mails are only logged (test mode). */
  mailConfigured: boolean;
  error?: string;
};

/** The signed-in login's own account for the hub shell: who they are and whom they represent. */
export type HubAccountData = {
  userId: string;
  email: string;
  /** "unknown" while the user management migration is not applied yet. */
  status: AccountStatus | "unknown";
  role: HubRole | null;
  firstName: string;
  lastName: string;
  phone: string;
  position: string;
  decisionNote: string;
  customers: {
    id: string;
    customerNumber: string;
    company: string;
    packages: PackageId[];
    contactEmail: string;
    phone: string;
    website: string;
    street: string;
    postalCode: string;
    city: string;
    country: string;
  }[];
};
