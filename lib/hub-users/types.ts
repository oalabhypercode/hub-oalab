import type { ServicePackageId } from "@/lib/service-packages";
import type { AccountStatus, DisplayStatus, HubRole } from "./rules";

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
  /** Seeded demo login: read-only in the user management. */
  demo: boolean;
  /** The signed-in admin themself: no role change, deactivation or deletion. */
  self: boolean;
  customerIds: string[];
  source: "registration" | "admin" | "existing";
  createdAt: string;
  lastSignInAt: string | null;
  decidedAt: string | null;
  decisionNote: string;
  privacyNotedAt: string | null;
};

export type ManagedCustomer = {
  id: string;
  customerNumber: string;
  company: string;
  servicePackages: ServicePackageId[];
  contactEmail: string;
  phone: string;
  website: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  createdAt: string;
  memberIds: string[];
};

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
  customers: ManagedCustomer[];
  events: ManagedEvent[];
  nextCustomerNumber: string;
  error?: string;
};

/** The signed-in login's own account for the hub shell: who they are and whom they represent. */
export type HubAccountData = {
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
    servicePackages: ServicePackageId[];
    contactEmail: string;
    phone: string;
    website: string;
    street: string;
    postalCode: string;
    city: string;
    country: string;
  }[];
};
