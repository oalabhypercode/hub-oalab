"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanEmail, cleanText, isHubRole, readCustomer, readPerson, roleLabels, type CustomerInput, type HubRole } from "./rules";
import { isDemoUser, listAllUsers, roleOf, verifyHubAdmin } from "./server";

// Every action is a public POST endpoint: each one checks with the caller's own session that the database
// considers them an active admin before the service role touches anything. Inputs are validated here again,
// whatever the form already checked. The log never stores names, e-mail addresses or links.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = { ok: false as const, error: "Dafür brauchst du einen aktiven Admin-Zugang." };
const failed = (error: string) => ({ ok: false as const, error });
/** Banning for 100 years is how Supabase Auth blocks a login; "none" lifts it. */
const BLOCKED = "876000h";

type Context = { db: SupabaseClient; actorId: string };

async function context(): Promise<Context | null> {
  const admin = await verifyHubAdmin();
  if (!admin) return null;
  const db = createAdminClient();
  return db ? { db, actorId: admin.userId } : null;
}

async function log(ctx: Context, action: string, summary: string, target: { userId?: string | null; customerId?: string | null } = {}) {
  await ctx.db.from("hub_admin_events").insert({ actor_id: ctx.actorId, action, summary: summary.slice(0, 300), target_user_id: target.userId ?? null, target_customer_id: target.customerId ?? null });
}

async function loadUser(ctx: Context, userId: unknown): Promise<User | null> {
  if (typeof userId !== "string" || !uuid.test(userId)) return null;
  const { data, error } = await ctx.db.auth.admin.getUserById(userId);
  return error ? null : data.user;
}

async function profileStatus(ctx: Context, userId: string) {
  const { data } = await ctx.db.from("hub_profiles").select("status").eq("user_id", userId).maybeSingle<{ status: string }>();
  return data?.status ?? null;
}

/** Admins that can still sign in and act: the hub role in their token and an active profile. */
async function activeAdminIds(ctx: Context) {
  const [users, profiles] = await Promise.all([
    listAllUsers(ctx.db),
    ctx.db.from("hub_profiles").select("user_id").eq("status", "active").returns<{ user_id: string }[]>(),
  ]);
  const active = new Set((profiles.data ?? []).map((row) => row.user_id));
  return users.filter((user) => roleOf(user) === "oalab_admin" && active.has(user.id)).map((user) => user.id);
}

/** Changes that could lock everyone out or touch the demo logins are refused before anything is written. */
async function guardAccountChange(ctx: Context, user: User, change: "role" | "status" | "delete") {
  if (isDemoUser(user)) return "Demo-Konten werden per Seed verwaltet und lassen sich hier nicht ändern.";
  if (user.id === ctx.actorId) return change === "role" ? "Deine eigene Rolle kannst du nicht ändern." : change === "status" ? "Du kannst dich nicht selbst deaktivieren." : "Du kannst dein eigenes Konto nicht löschen.";
  if (roleOf(user) === "oalab_admin") {
    const admins = await activeAdminIds(ctx);
    if (admins.includes(user.id) && admins.length <= 1) return "Das ist der letzte aktive Admin. Lege zuerst einen weiteren Admin an.";
  }
  return null;
}

type CustomerChoice = { mode: "existing"; customerId: string } | { mode: "new"; customer: Record<string, unknown> } | { mode: "none" };

function readChoice(value: unknown): CustomerChoice | null {
  const choice = value as Record<string, unknown> | null;
  if (choice?.mode === "existing" && typeof choice.customerId === "string" && uuid.test(choice.customerId)) return { mode: "existing", customerId: choice.customerId };
  if (choice?.mode === "new" && choice.customer && typeof choice.customer === "object") return { mode: "new", customer: choice.customer as Record<string, unknown> };
  if (choice?.mode === "none") return { mode: "none" };
  return null;
}

const customerRow = (input: CustomerInput) => ({
  company: input.company,
  customer_number: input.customerNumber,
  service_packages: input.servicePackages,
  contact_email: input.contactEmail,
  phone: input.phone,
  website: input.website,
  street: input.street,
  postal_code: input.postalCode,
  city: input.city,
  country: input.country,
});

/**
 * Resolves the customer a login is assigned to: an existing one, a new one (created here) or none (admins).
 * `created` tells the caller which customer to remove again if a later step fails.
 */
async function resolveCustomer(ctx: Context, role: HubRole, value: unknown): Promise<ActionResult<{ customerId: string | null; customerNumber: string | null; created: boolean }>> {
  const choice = readChoice(value);
  if (role === "oalab_admin") return { ok: true, data: { customerId: null, customerNumber: null, created: false } };
  if (!choice || choice.mode === "none") return failed("Bitte einen Kunden auswählen oder neu anlegen.");
  if (choice.mode === "existing") {
    const { data } = await ctx.db.from("hub_customers").select("id, customer_number").eq("id", choice.customerId).maybeSingle<{ id: string; customer_number: string }>();
    return data ? { ok: true, data: { customerId: data.id, customerNumber: data.customer_number, created: false } } : failed("Dieser Kunde existiert nicht mehr.");
  }
  const input = readCustomer(choice.customer);
  if (!input.ok) return input;
  const { data, error } = await ctx.db.from("hub_customers").insert(customerRow(input.value)).select("id, customer_number").single<{ id: string; customer_number: string }>();
  if (error) return failed(error.code === "23505" ? "Diese Kundennummer ist schon vergeben." : "Der Kunde konnte nicht angelegt werden.");
  await log(ctx, "customer.created", "Kunde angelegt", { customerId: data.id });
  return { ok: true, data: { customerId: data.id, customerNumber: data.customer_number, created: true } };
}

/** One customer per login: replaces the memberships (admins see every customer and need none). */
async function assignCustomer(ctx: Context, userId: string, customerId: string | null) {
  const removed = await ctx.db.from("hub_customer_members").delete().eq("user_id", userId);
  if (removed.error) return false;
  if (!customerId) return true;
  const added = await ctx.db.from("hub_customer_members").insert({ customer_id: customerId, user_id: userId });
  return !added.error;
}

async function setRole(ctx: Context, user: User, role: HubRole | null) {
  const metadata = { ...(user.app_metadata ?? {}) } as Record<string, unknown>;
  if (role) metadata.app_role = role;
  else delete metadata.app_role;
  const { error } = await ctx.db.auth.admin.updateUserById(user.id, { app_metadata: metadata });
  return !error;
}

/** The address of this hub for activation links: an explicit site URL, otherwise the request's own origin. */
async function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured && /^https?:\/\/[^/\s]+$/i.test(configured.replace(/\/$/, ""))) return configured.replace(/\/$/, "");
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "";
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const proto = list.get("x-forwarded-proto") === "http" || local ? "http" : "https";
  return `${proto}://${host}`;
}

/** A one-time link that lets the login set a (new) password and signs it in. It goes to the admin only, never to the log. */
async function passwordLink(ctx: Context, email: string) {
  const origin = await siteOrigin();
  if (!origin) return null;
  const { data, error } = await ctx.db.auth.admin.generateLink({ type: "recovery", email });
  const token = data?.properties?.hashed_token;
  if (error || !token) return null;
  return `${origin}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=recovery&next=${encodeURIComponent("/auth/update-password")}`;
}

// Registrations ------------------------------------------------------------------------------------------------------

/** Approves a waiting (or earlier rejected) registration: role, customer and finally the active status. */
export async function approveRegistration(input: { userId: string; role: string; customer: unknown }): Promise<ActionResult<{ customerNumber: string | null }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user) return failed("Dieses Konto gibt es nicht mehr.");
  if (isDemoUser(user)) return failed("Demo-Konten werden per Seed verwaltet.");
  const status = await profileStatus(ctx, user.id);
  if (status !== "pending" && status !== "rejected") return failed("Diese Registrierung ist bereits entschieden.");
  if (!isHubRole(input?.role)) return failed("Bitte eine Rolle wählen.");
  const role = input.role;

  const customer = await resolveCustomer(ctx, role, input.customer);
  if (!customer.ok) return customer;
  // The active status comes last: until then the login has no access, whatever step fails.
  const steps = await setRole(ctx, user, role) && await assignCustomer(ctx, user.id, customer.data.customerId);
  const activated = steps && !(await ctx.db.from("hub_profiles").update({ status: "active", decided_at: new Date().toISOString(), decided_by: ctx.actorId, decision_note: "" }).eq("user_id", user.id)).error;
  if (!activated) {
    if (customer.data.created && customer.data.customerId) await ctx.db.from("hub_customers").delete().eq("id", customer.data.customerId);
    return failed("Die Freigabe ist nicht vollständig gelungen. Bitte versuche es erneut.");
  }
  await log(ctx, "registration.approved", `Registrierung freigegeben als ${roleLabels[role]}`, { userId: user.id, customerId: customer.data.customerId });
  refresh();
  return { ok: true, data: { customerNumber: customer.data.customerNumber } };
}

/** Rejects a registration. The login stays (as decided), but never reaches the hub; the note is shown to the person. */
export async function rejectRegistration(input: { userId: string; note: string }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user) return failed("Dieses Konto gibt es nicht mehr.");
  if (isDemoUser(user)) return failed("Demo-Konten werden per Seed verwaltet.");
  if (await profileStatus(ctx, user.id) !== "pending") return failed("Nur offene Registrierungen lassen sich ablehnen.");
  const note = cleanText(input?.note, 500);
  const { error } = await ctx.db.from("hub_profiles").update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: ctx.actorId, decision_note: note }).eq("user_id", user.id);
  if (error) return failed("Die Ablehnung konnte nicht gespeichert werden.");
  await setRole(ctx, user, null);
  await assignCustomer(ctx, user.id, null);
  await log(ctx, "registration.rejected", note ? "Registrierung abgelehnt (mit Begründung)" : "Registrierung abgelehnt", { userId: user.id });
  refresh();
  return { ok: true, data: null };
}

// Logins -------------------------------------------------------------------------------------------------------------

/** Creates a login with role and customer; returns the activation link the admin passes on. */
export async function createHubUser(input: { email: string; firstName: string; lastName: string; phone: string; position: string; role: string; customer: unknown }): Promise<ActionResult<{ userId: string; link: string }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const email = cleanEmail(input?.email);
  if (!email.ok) return email;
  const person = readPerson(input ?? {});
  if (!person.ok) return person;
  if (!isHubRole(input?.role)) return failed("Bitte eine Rolle wählen.");
  const role = input.role;
  if (role === "oalab_customer" && !readChoice(input.customer)) return failed("Bitte einen Kunden auswählen oder neu anlegen.");

  // The login exists before anything else, so a taken address stops here without leftovers.
  const created = await ctx.db.auth.admin.createUser({
    email: email.value,
    email_confirm: true,
    app_metadata: { app_role: role },
    user_metadata: { first_name: person.value.firstName, last_name: person.value.lastName, full_name: `${person.value.firstName} ${person.value.lastName}` },
  });
  if (created.error || !created.data.user) {
    const taken = created.error?.code === "email_exists" || /already|registered|exists/i.test(created.error?.message ?? "");
    return failed(taken ? "Für diese E-Mail-Adresse besteht bereits ein Konto." : "Das Konto konnte nicht angelegt werden.");
  }
  const user = created.data.user;
  const undo = async (customerId?: string | null) => {
    await ctx.db.auth.admin.deleteUser(user.id);
    if (customerId) await ctx.db.from("hub_customers").delete().eq("id", customerId);
  };

  const customer = await resolveCustomer(ctx, role, input.customer);
  if (!customer.ok) { await undo(); return customer; }
  const saved = !(await ctx.db.from("hub_profiles").upsert({
    user_id: user.id, first_name: person.value.firstName, last_name: person.value.lastName, phone: person.value.phone, position: person.value.position,
    status: "active", source: "admin", decided_at: new Date().toISOString(), decided_by: ctx.actorId,
  }, { onConflict: "user_id" })).error && await assignCustomer(ctx, user.id, customer.data.customerId);
  const link = saved ? await passwordLink(ctx, email.value) : null;
  if (!link) {
    await undo(customer.data.created ? customer.data.customerId : null);
    return failed("Das Konto konnte nicht vollständig angelegt werden. Es wurde nichts gespeichert.");
  }
  await log(ctx, "user.created", `Konto angelegt als ${roleLabels[role]}`, { userId: user.id, customerId: customer.data.customerId });
  refresh();
  return { ok: true, data: { userId: user.id, link } };
}

/** A fresh link to set the password: the activation for new logins, a reset for everyone else. Older links expire. */
export async function createPasswordLink(input: { userId: string }): Promise<ActionResult<{ link: string; activation: boolean }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user?.email) return failed("Dieses Konto gibt es nicht mehr.");
  if (isDemoUser(user)) return failed("Demo-Konten werden per Seed verwaltet.");
  if (await profileStatus(ctx, user.id) !== "active") return failed("Links gibt es nur für aktive Konten.");
  const link = await passwordLink(ctx, user.email);
  if (!link) return failed("Der Link konnte nicht erzeugt werden.");
  const activation = !user.last_sign_in_at;
  await log(ctx, activation ? "user.activation_link" : "user.password_link", activation ? "Aktivierungslink erzeugt" : "Link zum Passwort-Zurücksetzen erzeugt", { userId: user.id });
  return { ok: true, data: { link, activation } };
}

/** Person data, role and customer of an existing login. */
export async function updateHubUser(input: { userId: string; firstName: string; lastName: string; phone: string; position: string; role: string; customer: unknown }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user) return failed("Dieses Konto gibt es nicht mehr.");
  if (isDemoUser(user)) return failed("Demo-Konten werden per Seed verwaltet und lassen sich hier nicht ändern.");
  if (await profileStatus(ctx, user.id) === "pending") return failed("Offene Registrierungen bitte über „Prüfen“ freigeben.");
  const person = readPerson(input ?? {});
  if (!person.ok) return person;
  if (!isHubRole(input?.role)) return failed("Bitte eine Rolle wählen.");
  const role = input.role;
  const roleChanged = roleOf(user) !== role;
  if (roleChanged) {
    const refused = await guardAccountChange(ctx, user, "role");
    if (refused) return failed(refused);
  }

  const customer = await resolveCustomer(ctx, role, input.customer);
  if (!customer.ok) return customer;
  const done = !(await ctx.db.from("hub_profiles").update({ first_name: person.value.firstName, last_name: person.value.lastName, phone: person.value.phone, position: person.value.position }).eq("user_id", user.id)).error
    && (!roleChanged || await setRole(ctx, user, role))
    && await assignCustomer(ctx, user.id, customer.data.customerId);
  if (!done) return failed("Die Änderungen konnten nicht vollständig gespeichert werden. Bitte prüfe das Konto.");
  await log(ctx, "user.updated", roleChanged ? `Konto bearbeitet, Rolle jetzt ${roleLabels[role]}` : "Konto bearbeitet", { userId: user.id, customerId: customer.data.customerId });
  refresh();
  return { ok: true, data: null };
}

/** Deactivates (blocks the login and all data at once) or reactivates a login. */
export async function setHubUserActive(input: { userId: string; active: boolean }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user) return failed("Dieses Konto gibt es nicht mehr.");
  const active = input?.active === true;
  const status = await profileStatus(ctx, user.id);
  if (status !== (active ? "disabled" : "active")) return failed(active ? "Nur deaktivierte Konten lassen sich aktivieren." : "Nur aktive Konten lassen sich deaktivieren.");
  if (!active) {
    const refused = await guardAccountChange(ctx, user, "status");
    if (refused) return failed(refused);
  } else if (isDemoUser(user)) return failed("Demo-Konten werden per Seed verwaltet.");

  // The profile first: an inactive profile cuts all data access immediately, the ban stops new sign-ins.
  const saved = !(await ctx.db.from("hub_profiles").update({ status: active ? "active" : "disabled", decided_at: new Date().toISOString(), decided_by: ctx.actorId }).eq("user_id", user.id)).error;
  const banned = saved && !(await ctx.db.auth.admin.updateUserById(user.id, { ban_duration: active ? "none" : BLOCKED })).error;
  if (!banned) return failed(active ? "Das Konto konnte nicht aktiviert werden." : "Das Konto konnte nicht vollständig deaktiviert werden. Bitte erneut versuchen.");
  await log(ctx, active ? "user.reactivated" : "user.deactivated", active ? "Konto wieder aktiviert" : "Konto deaktiviert", { userId: user.id });
  refresh();
  return { ok: true, data: null };
}

/** Deletes a login for good. The e-mail address has to be typed again as confirmation. */
export async function deleteHubUser(input: { userId: string; confirmEmail: string }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user?.email) return failed("Dieses Konto gibt es nicht mehr.");
  const refused = await guardAccountChange(ctx, user, "delete");
  if (refused) return failed(refused);
  if (cleanEmail(input?.confirmEmail).ok === false || String(input.confirmEmail).trim().toLowerCase() !== user.email.toLowerCase()) return failed("Zur Bestätigung bitte die E-Mail-Adresse des Kontos genau eintragen.");
  const { data: membership } = await ctx.db.from("hub_customer_members").select("customer_id").eq("user_id", user.id).limit(1).maybeSingle<{ customer_id: string }>();
  // Profile, memberships and WhatsApp link go with the login (foreign keys); files and appointments stay.
  const { error } = await ctx.db.auth.admin.deleteUser(user.id);
  if (error) return failed("Das Konto konnte nicht gelöscht werden.");
  await log(ctx, "user.deleted", "Konto endgültig gelöscht", { customerId: membership?.customer_id ?? null });
  refresh();
  return { ok: true, data: null };
}

// Customers ----------------------------------------------------------------------------------------------------------

/** Creates a customer (company) or updates one; the customer number stays unique. */
export async function saveCustomer(input: { id?: string } & Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const customer = readCustomer(input ?? {});
  if (!customer.ok) return customer;
  const id = typeof input?.id === "string" && uuid.test(input.id) ? input.id : null;
  const query = id
    ? ctx.db.from("hub_customers").update(customerRow(customer.value)).eq("id", id).select("id").single<{ id: string }>()
    : ctx.db.from("hub_customers").insert(customerRow(customer.value)).select("id").single<{ id: string }>();
  const { data, error } = await query;
  if (error || !data) return failed(error?.code === "23505" ? "Diese Kundennummer ist schon vergeben." : "Der Kunde konnte nicht gespeichert werden.");
  await log(ctx, id ? "customer.updated" : "customer.created", id ? "Kunde bearbeitet" : "Kunde angelegt", { customerId: data.id });
  refresh();
  return { ok: true, data: { id: data.id } };
}
