import "server-only";
import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServicePackageId } from "@/lib/service-packages";
import { mailSettings } from "@/lib/hub-mail/send";
import { displayStatus, isAccountStatus, isHubRole, nextCustomerNumber, servicePackageIds, type HubRole } from "./rules";
import type { HubAccountData, ManagedCustomer, ManagedEvent, ManagedUser, UserManagementState } from "./types";

type ProfileRow = {
  user_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  position: string;
  company_name: string;
  website: string;
  customer_number_hint: string;
  message: string;
  status: string;
  source: string;
  privacy_noted_at: string | null;
  decided_at: string | null;
  decision_note: string;
};
type CustomerRow = {
  id: string;
  customer_number: string;
  company: string;
  service_packages: string[] | null;
  contact_email: string;
  phone: string;
  website: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  created_at: string;
};
type EventRow = { id: number; created_at: string; actor_id: string | null; target_user_id: string | null; target_customer_id: string | null; action: string; summary: string };

const CUSTOMER_COLUMNS = "id, customer_number, company, service_packages, contact_email, phone, website, street, postal_code, city, country, created_at";

/** The user management tables are missing until its migration is applied. */
export function isMissingUserTables(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || /hub_profiles|hub_admin_events|service_packages|schema cache/i.test(error.message ?? "")));
}

export const roleOf = (user: Pick<User, "app_metadata">): HubRole | null => {
  const role = (user.app_metadata as Record<string, unknown> | undefined)?.app_role;
  return isHubRole(role) ? role : null;
};
export const isDemoUser = (user: Pick<User, "app_metadata">) => (user.app_metadata as Record<string, unknown> | undefined)?.demo_account === true;

const packagesOf = (value: string[] | null): ServicePackageId[] => (value ?? []).filter((id): id is ServicePackageId => (servicePackageIds as readonly string[]).includes(id));

function toCustomer(row: CustomerRow) {
  return {
    id: row.id,
    customerNumber: row.customer_number,
    company: row.company,
    servicePackages: packagesOf(row.service_packages),
    contactEmail: row.contact_email ?? "",
    phone: row.phone ?? "",
    website: row.website ?? "",
    street: row.street ?? "",
    postalCode: row.postal_code ?? "",
    city: row.city ?? "",
    country: row.country ?? "",
  };
}

/**
 * The signed-in login, if the *database* considers it an active admin (role in the verified token and an active
 * profile). Every admin action and the admin pages start here; only afterwards is the service role used.
 */
export async function verifyHubAdmin(): Promise<{ userId: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  if ((data.claims.app_metadata as Record<string, unknown> | undefined)?.app_role !== "oalab_admin") return null;
  const { data: isAdmin, error: rpcError } = await supabase.rpc("is_hub_admin");
  if (rpcError || isAdmin !== true) return null;
  return { userId: data.claims.sub };
}

/** Every Supabase Auth user, page by page. */
export async function listAllUsers(db: SupabaseClient) {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

const emptyState: UserManagementState = { users: [], customers: [], events: [], nextCustomerNumber: nextCustomerNumber([]), mailConfigured: false };

type NotificationRow = { id: number; created_at: string; kind: string; user_id: string | null; status: string };
const mailKinds: Record<string, string> = {
  "registration.team": "Team-Benachrichtigung zur Registrierung",
  "registration.received": "Eingangsbestätigung",
  "registration.approved": "Freigabe mit Login-Link",
  "registration.rejected": "Ablehnung",
  "user.activation": "Aktivierungslink",
  "user.password": "Passwort-Link",
};
const mailOutcome: Record<string, string> = { sent: "gesendet", skipped: "nicht gesendet (Mailversand nicht eingerichtet)", failed: "fehlgeschlagen", sending: "wird gesendet" };

/** Everything the admin page shows. Only for active admins; the merge happens here, the browser gets plain data. */
export async function loadUserManagement(): Promise<UserManagementState> {
  const admin = await verifyHubAdmin();
  if (!admin) return { ...emptyState, error: "Das User Management ist nur für Admins verfügbar." };
  const db = createAdminClient();
  if (!db) return { ...emptyState, error: "Auf dem Server fehlt der Supabase Secret Key (SUPABASE_SECRET_KEY). Ohne ihn können keine Konten verwaltet werden." };

  try {
    const [authUsers, profiles, customers, members, events, notifications] = await Promise.all([
      listAllUsers(db),
      db.from("hub_profiles").select("user_id, first_name, last_name, phone, position, company_name, website, customer_number_hint, message, status, source, privacy_noted_at, decided_at, decision_note").returns<ProfileRow[]>(),
      db.from("hub_customers").select(CUSTOMER_COLUMNS).order("customer_number").returns<CustomerRow[]>(),
      db.from("hub_customer_members").select("customer_id, user_id").returns<{ customer_id: string; user_id: string }[]>(),
      db.from("hub_admin_events").select("id, created_at, actor_id, target_user_id, target_customer_id, action, summary").order("created_at", { ascending: false }).limit(300).returns<EventRow[]>(),
      // Optional until its migration is applied: without the table the history simply shows no mails.
      db.from("hub_notifications").select("id, created_at, kind, user_id, status").order("created_at", { ascending: false }).limit(300).returns<NotificationRow[]>(),
    ]);
    const failure = profiles.error ?? customers.error ?? members.error ?? events.error;
    if (failure) {
      return { ...emptyState, error: isMissingUserTables(failure) ? "Das User Management ist in Supabase noch nicht eingerichtet. Die Migration steht noch aus." : "Die Konten konnten gerade nicht geladen werden. Bitte versuche es erneut." };
    }

    const profileOf = new Map((profiles.data ?? []).map((row) => [row.user_id, row]));
    const memberships = members.data ?? [];
    const users: ManagedUser[] = authUsers.map((user) => {
      const profile = profileOf.get(user.id);
      const status = isAccountStatus(profile?.status) ? profile.status : "pending";
      return {
        id: user.id,
        email: user.email ?? "",
        emailConfirmed: Boolean(user.email_confirmed_at),
        firstName: profile?.first_name ?? "",
        lastName: profile?.last_name ?? "",
        phone: profile?.phone ?? "",
        position: profile?.position ?? "",
        companyName: profile?.company_name ?? "",
        website: profile?.website ?? "",
        customerNumberHint: profile?.customer_number_hint ?? "",
        message: profile?.message ?? "",
        status,
        displayStatus: displayStatus(status, user.last_sign_in_at ?? null),
        role: roleOf(user),
        demo: isDemoUser(user),
        self: user.id === admin.userId,
        customerIds: memberships.filter((row) => row.user_id === user.id).map((row) => row.customer_id),
        source: profile?.source === "admin" || profile?.source === "existing" ? profile.source : "registration",
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? null,
        decidedAt: profile?.decided_at ?? null,
        decisionNote: profile?.decision_note ?? "",
        privacyNotedAt: profile?.privacy_noted_at ?? null,
      };
    });
    const customerRows = customers.data ?? [];
    const nameOf = (id: string | null) => {
      const user = users.find((item) => item.id === id);
      return user ? `${user.firstName} ${user.lastName}`.trim() || user.email : "Gelöschtes Konto";
    };
    return {
      users,
      customers: customerRows.map((row): ManagedCustomer => ({
        ...toCustomer(row),
        createdAt: row.created_at,
        memberIds: memberships.filter((member) => member.customer_id === row.id).map((member) => member.user_id),
      })),
      events: [
        ...(events.data ?? []).map((row): ManagedEvent => ({
          id: row.id,
          at: row.created_at,
          actorName: nameOf(row.actor_id),
          action: row.action,
          summary: row.summary,
          targetUserId: row.target_user_id,
          targetCustomerId: row.target_customer_id,
        })),
        // Mails get negative ids so they never collide with admin events in React keys.
        ...(notifications.data ?? []).map((row): ManagedEvent => ({
          id: -row.id,
          at: row.created_at,
          actorName: "Client Hub",
          action: `mail.${row.kind}`,
          summary: `E-Mail: ${mailKinds[row.kind] ?? row.kind} ${mailOutcome[row.status] ?? row.status}`,
          targetUserId: row.user_id,
          targetCustomerId: null,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at)),
      nextCustomerNumber: nextCustomerNumber(customerRows.map((row) => row.customer_number)),
      mailConfigured: mailSettings().configured,
    };
  } catch {
    return { ...emptyState, error: "Die Konten konnten gerade nicht geladen werden. Bitte versuche es erneut." };
  }
}

/** Open registrations for the badge in the admin navigation; RLS lets only active admins count them. */
export async function countPendingRegistrations() {
  const supabase = await createClient();
  const { count, error } = await supabase.from("hub_profiles").select("user_id", { count: "exact", head: true }).eq("status", "pending");
  return error ? 0 : count ?? 0;
}

/**
 * The signed-in login's own account, read with its own session (RLS: own profile, own customers).
 * Request-scoped, never cached across users.
 */
export const getHubAccount = cache(async (): Promise<HubAccountData | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  const role = (data.claims.app_metadata as Record<string, unknown> | undefined)?.app_role;
  const [profile, memberships] = await Promise.all([
    supabase.from("hub_profiles").select("first_name, last_name, phone, position, status, decision_note").eq("user_id", data.claims.sub).maybeSingle<Pick<ProfileRow, "first_name" | "last_name" | "phone" | "position" | "status" | "decision_note">>(),
    supabase.from("hub_customer_members").select(`customer:hub_customers(${CUSTOMER_COLUMNS})`).eq("user_id", data.claims.sub).returns<{ customer: CustomerRow | null }[]>(),
  ]);
  const base = {
    userId: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : "",
    role: isHubRole(role) ? role : null, firstName: "", lastName: "", phone: "", position: "", decisionNote: "", customers: [],
  };
  if (isMissingUserTables(profile.error) || isMissingUserTables(memberships.error)) return { ...base, status: "unknown" };
  // Without a readable profile the login counts as waiting: access is granted only by an active profile.
  if (profile.error || !profile.data) return { ...base, status: "pending" };
  return {
    ...base,
    status: isAccountStatus(profile.data.status) ? profile.data.status : "pending",
    firstName: profile.data.first_name,
    lastName: profile.data.last_name,
    phone: profile.data.phone,
    position: profile.data.position,
    decisionNote: profile.data.decision_note,
    customers: (memberships.data ?? []).flatMap((row) => row.customer ? [toCustomer(row.customer)] : []).sort((a, b) => a.customerNumber.localeCompare(b.customerNumber)),
  };
});
