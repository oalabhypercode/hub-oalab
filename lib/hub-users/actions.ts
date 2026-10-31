"use server";

import { randomUUID } from "node:crypto";
import { refreshWorkspace } from "@/lib/refresh-workspace";
import { headers } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";
import { mailApproval, mailPasswordLink, mailRejection } from "@/lib/hub-mail/notify";
import { hasMailbox } from "@/lib/hub-auth/mail-code";
import type { MailStatus } from "@/lib/hub-mail/send";
import { defaultPlan } from "@/lib/hub-assistant/customers";
import { cleanEmail, cleanText, isHubRole, readCustomer, readPerson, roleLabels, serviceCustomerRefusal, type CustomerInput, type HubRole } from "./rules";
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

type LoginRemoval = "deleted" | "in_use" | "staff" | "missing" | "failed";

/**
 * Deletes a login. A hub customer login is also a client member in Service, and that row blocks deleting it; the
 * database function removes both in one transaction and changes nothing while other Service records (requests,
 * messages) still point at the login. Profile, hub memberships and WhatsApp link go with the login (foreign keys).
 */
async function removeLogin(ctx: Context, userId: string): Promise<LoginRemoval> {
  const { data, error } = await ctx.db.rpc("hub_delete_login", { target: userId });
  return !error && (data === "deleted" || data === "in_use" || data === "staff" || data === "missing") ? data : "failed";
}

const removalErrors: Record<Exclude<LoginRemoval, "deleted">, string> = {
  in_use: "Auf dieses Konto verweisen noch Einträge in der Serviceplattform, etwa Anfragen oder Nachrichten. Deaktiviere es stattdessen.",
  staff: "Das Konto hat Team-Zugang zur Serviceplattform und lässt sich hier nicht löschen. Deaktiviere es stattdessen.",
  missing: "Dieses Konto gibt es nicht mehr.",
  failed: "Das Konto konnte nicht gelöscht werden.",
};

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

const customerRow = (input: CustomerInput) => ({ company: input.company, customer_number: input.customerNumber, ...customerDetails(input) });

/** What the Hub keeps itself; company and number of a customer in Service belong to its organization. */
const customerDetails = (input: CustomerInput) => ({
  service_packages: input.servicePackages,
  contact_email: input.contactEmail,
  phone: input.phone,
  website: input.website,
  street: input.street,
  postal_code: input.postalCode,
  city: input.city,
  country: input.country,
});

type ResolvedCustomer = { customerId: string | null; customerNumber: string | null; company: string | null; organizationId: string | null; created: boolean };

/**
 * Resolves the customer a login is assigned to: an existing one, a new one (created here) or none (admins).
 * `created` tells the caller which customer to remove again if a later step fails.
 */
async function resolveCustomer(ctx: Context, role: HubRole, value: unknown): Promise<ActionResult<ResolvedCustomer>> {
  const choice = readChoice(value);
  if (role === "oalab_admin") return { ok: true, data: { customerId: null, customerNumber: null, company: null, organizationId: null, created: false } };
  if (!choice || choice.mode === "none") return failed("Bitte einen Kunden auswählen oder neu anlegen.");
  if (choice.mode === "existing") {
    const { data } = await ctx.db.from("hub_customers").select("id, customer_number, company").eq("id", choice.customerId).maybeSingle<{ id: string; customer_number: string; company: string }>();
    return data ? { ok: true, data: { customerId: data.id, customerNumber: data.customer_number, company: data.company, organizationId: null, created: false } } : failed("Dieser Kunde existiert nicht mehr.");
  }
  const input = readCustomer(choice.customer);
  if (!input.ok) return input;
  const created = await createServiceCustomer(ctx, input.value);
  if (!created.ok) return created;
  await log(ctx, "customer.created", "Kunde angelegt", { customerId: created.data.customerId });
  return { ok: true, data: { ...created.data, created: true } };
}

type ServiceCustomer = { customerId: string; customerNumber: string; company: string; organizationId: string };

/**
 * A new customer starts as a Service organization, with the package Service itself would pick, so its logins reach
 * Service too. Service's trigger adds the Hub customer; it then gets packages and contact data, which its own trigger
 * passes on to Service's customer profile (migration 202610310001 in service-oalab).
 */
async function createServiceCustomer(ctx: Context, input: CustomerInput): Promise<ActionResult<ServiceCustomer>> {
  const refused = serviceCustomerRefusal(input);
  if (refused) return failed(refused);
  const plans = await ctx.db.from("plans").select("id, code, name, created_at").eq("is_active", true).returns<{ id: string; code: string; name: string; created_at: string }[]>();
  const plan = defaultPlan((plans.data ?? []).map((row) => ({ id: row.id, code: row.code, name: row.name, createdAt: row.created_at })));
  if (plans.error || !plan) return failed("In Service ist gerade kein Paket aktiv. Der Kunde wurde nicht angelegt.");
  const organization = await ctx.db.from("organizations").insert({ customer_number: input.customerNumber, name: input.company, kind: "client", status: "active", plan_id: plan.id }).select("id").single<{ id: string }>();
  if (organization.error || !organization.data) return failed(organization.error?.code === "23505" ? "Diese Kundennummer ist schon vergeben." : "Der Kunde konnte nicht angelegt werden.");
  const organizationId = organization.data.id;
  const customer = await ctx.db.from("hub_customers").update({ ...customerDetails(input), updated_by: ctx.actorId }).eq("organization_id", organizationId).select("id, customer_number, company").maybeSingle<{ id: string; customer_number: string; company: string }>();
  if (customer.error || !customer.data) {
    await removeServiceCustomer(ctx, organizationId);
    return failed("Der Kunde konnte nicht angelegt werden.");
  }
  return { ok: true, data: { customerId: customer.data.id, customerNumber: customer.data.customer_number, company: customer.data.company, organizationId } };
}

/** Takes back a customer created a moment ago when a later step fails; one that lives only in the Hub goes alone. */
async function removeNewCustomer(ctx: Context, customerId: string) {
  const { data } = await ctx.db.from("hub_customers").select("organization_id").eq("id", customerId).maybeSingle<{ organization_id: string | null }>();
  if (data?.organization_id) await removeServiceCustomer(ctx, data.organization_id);
  else await ctx.db.from("hub_customers").delete().eq("id", customerId);
}

/**
 * Memberships, profile, Hub customer and finally the organization they all point to; only for brand-new ones. The
 * memberships go first: removing one makes Service's sync rebuild the organization's Hub customer if it is missing.
 */
async function removeServiceCustomer(ctx: Context, organizationId: string) {
  await ctx.db.from("memberships").delete().eq("organization_id", organizationId);
  await ctx.db.from("business_customer_profiles").delete().eq("organization_id", organizationId);
  await ctx.db.from("hub_customers").delete().eq("organization_id", organizationId);
  await ctx.db.from("organizations").delete().eq("id", organizationId);
}

/** Service's audit trail notes where a customer came from, as for the ones the assistant creates. Once it is complete. */
async function noteServiceCustomer(ctx: Context, customer: { organizationId: string | null; customerNumber: string | null }) {
  if (!customer.organizationId) return;
  await ctx.db.from("audit_events").insert({
    organization_id: customer.organizationId, actor_type: "user", actor_id: ctx.actorId, action: "hub.customer_created", target_type: "organization", target_id: customer.organizationId,
    result: "success", correlation_id: `cor_${randomUUID().replaceAll("-", "")}`, safe_metadata: { customerNumber: customer.customerNumber, source: "hub_user_management" },
  });
}

async function firstNameOf(ctx: Context, userId: string) {
  const { data } = await ctx.db.from("hub_profiles").select("first_name").eq("user_id", userId).maybeSingle<{ first_name: string }>();
  return data?.first_name ?? "";
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

/** The address of this hub for activation links and mails: an explicit site URL, otherwise the request's own origin. */
const requestOrigin = async () => siteOrigin(await headers());

/** A one-time link that lets the login set a (new) password and signs it in. It goes to the admin or the login's own mailbox, never to the log. */
async function passwordLink(ctx: Context, email: string) {
  const origin = await requestOrigin();
  if (!origin) return null;
  const { data, error } = await ctx.db.auth.admin.generateLink({ type: "recovery", email });
  const token = data?.properties?.hashed_token;
  if (error || !token) return null;
  return `${origin}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=recovery&next=${encodeURIComponent("/auth/update-password")}`;
}

// Registrations ------------------------------------------------------------------------------------------------------

/** Approves a waiting (or earlier rejected) registration: role, customer and finally the active status; then mails the person. */
export async function approveRegistration(input: { userId: string; role: string; customer: unknown }): Promise<ActionResult<{ customerNumber: string | null; mail: MailStatus }>> {
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
    if (customer.data.created && customer.data.customerId) await removeNewCustomer(ctx, customer.data.customerId);
    return failed("Die Freigabe ist nicht vollständig gelungen. Bitte versuche es erneut.");
  }
  if (customer.data.created) await noteServiceCustomer(ctx, customer.data);
  await log(ctx, "registration.approved", `Registrierung freigegeben als ${roleLabels[role]}`, { userId: user.id, customerId: customer.data.customerId });
  const mail = await mailApproval(ctx.db, user, { firstName: await firstNameOf(ctx, user.id), origin: await requestOrigin(), company: customer.data.company, customerNumber: customer.data.customerNumber });
  refreshWorkspace();
  return { ok: true, data: { customerNumber: customer.data.customerNumber, mail } };
}

/** Rejects a registration. The login stays (as decided), but never reaches the hub; the note is shown to the person and mailed. */
export async function rejectRegistration(input: { userId: string; note: string }): Promise<ActionResult<{ mail: MailStatus }>> {
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
  const mail = await mailRejection(ctx.db, user, { firstName: await firstNameOf(ctx, user.id), note });
  refreshWorkspace();
  return { ok: true, data: { mail } };
}

// Logins -------------------------------------------------------------------------------------------------------------

/** Creates a login with role and customer; returns the activation link and, if asked for, mails it to the login. */
export async function createHubUser(input: { email: string; firstName: string; lastName: string; phone: string; position: string; role: string; customer: unknown; mailLink?: boolean }): Promise<ActionResult<{ userId: string; link: string; mail: MailStatus | null }>> {
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
    await removeLogin(ctx, user.id);
    if (customerId) await removeNewCustomer(ctx, customerId);
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
  if (customer.data.created) await noteServiceCustomer(ctx, customer.data);
  await log(ctx, "user.created", `Konto angelegt als ${roleLabels[role]}`, { userId: user.id, customerId: customer.data.customerId });
  const mail = input.mailLink === true ? await mailPasswordLink(ctx.db, user, { firstName: person.value.firstName, link, activation: true }) : null;
  refreshWorkspace();
  return { ok: true, data: { userId: user.id, link, mail } };
}

/**
 * A fresh link to set the password: the activation for new logins, a reset for everyone else. Older links expire.
 * "copy" hands the link to the admin; "mail" sends it to the login's own address and keeps it from the admin.
 */
export async function createPasswordLink(input: { userId: string; deliver?: "copy" | "mail" }): Promise<ActionResult<{ link: string | null; activation: boolean; mail: MailStatus | null }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user?.email) return failed("Dieses Konto gibt es nicht mehr.");
  if (isDemoUser(user)) return failed("Demo-Konten werden per Seed verwaltet.");
  if (await profileStatus(ctx, user.id) !== "active") return failed("Links gibt es nur für aktive Konten.");
  const link = await passwordLink(ctx, user.email);
  if (!link) return failed("Der Link konnte nicht erzeugt werden.");
  const activation = !user.last_sign_in_at;
  const byMail = input?.deliver === "mail";
  await log(ctx, activation ? "user.activation_link" : "user.password_link", `${activation ? "Aktivierungslink" : "Link zum Passwort-Zurücksetzen"} erzeugt${byMail ? " und per E-Mail verschickt" : ""}`, { userId: user.id });
  if (!byMail) return { ok: true, data: { link, activation, mail: null } };
  const mail = await mailPasswordLink(ctx.db, user, { firstName: await firstNameOf(ctx, user.id), link, activation });
  refreshWorkspace();
  return { ok: true, data: { link: null, activation, mail } };
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
  refreshWorkspace();
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
  refreshWorkspace();
  return { ok: true, data: null };
}

/**
 * Sets a login's second factor to the code by e-mail or off. The person sets up an app in the profile themself (the
 * QR code has to reach their phone); an admin can only take it back, e.g. after a lost phone: the app is removed.
 * It counts from the login's next page on, since the hub asks Supabase Auth, not the token's copy. Supabase merges
 * app_metadata, so "off" sends null, which removes the key.
 */
export async function setHubUserSecondFactor(input: { userId: string; choice: "off" | "email" }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user) return failed("Dieses Konto gibt es nicht mehr.");
  if (isDemoUser(user)) return failed("Demo-Konten werden per Seed verwaltet und lassen sich hier nicht ändern.");
  const choice = input?.choice === "email" ? "email" : input?.choice === "off" ? "off" : null;
  if (!choice) return failed("Bitte eine Methode wählen.");
  if (choice === "email" && !hasMailbox(user.email)) return failed("An diese Adresse kann kein Code zugestellt werden (Testadresse ohne Postfach).");
  const { data: factors } = await ctx.db.auth.admin.mfa.listFactors({ userId: user.id });
  const apps = (factors?.factors ?? []).filter((factor) => factor.factor_type === "totp");
  for (const factor of apps) {
    if ((await ctx.db.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id })).error) return failed("Die Authenticator-App konnte nicht entfernt werden. Bitte versuche es erneut.");
  }
  const { error } = await ctx.db.auth.admin.updateUserById(user.id, { app_metadata: { second_factor: choice === "email" ? "email" : null } });
  if (error) return failed("Die Einstellung konnte nicht gespeichert werden. Bitte versuche es erneut.");
  const summary = choice === "email" ? "Zwei-Faktor-Schutz: Code per E-Mail" : "Zwei-Faktor-Schutz ausgeschaltet";
  await log(ctx, choice === "email" ? "user.second_factor_email" : "user.second_factor_off", apps.length ? `${summary}, Authenticator-App entfernt` : summary, { userId: user.id });
  refreshWorkspace();
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
  // Files and appointments of the customer stay.
  const removed = await removeLogin(ctx, user.id);
  if (removed !== "deleted") return failed(removalErrors[removed]);
  await log(ctx, "user.deleted", "Konto endgültig gelöscht", { customerId: membership?.customer_id ?? null });
  refreshWorkspace();
  return { ok: true, data: null };
}

// Customers ----------------------------------------------------------------------------------------------------------

/**
 * Creates a customer (in Service too) or updates one; the customer number stays unique. For a customer in Service,
 * company and number go to its organization and come back through Service's trigger; the contact data the Hub saves
 * reaches Service's customer profile through the Hub's own trigger. Hub-only customers (the demo ones) stay as they are.
 */
export async function saveCustomer(input: { id?: string } & Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const customer = readCustomer(input ?? {});
  if (!customer.ok) return customer;
  const id = typeof input?.id === "string" && uuid.test(input.id) ? input.id : null;
  if (!id) {
    const created = await createServiceCustomer(ctx, customer.value);
    if (!created.ok) return created;
    await noteServiceCustomer(ctx, created.data);
    await log(ctx, "customer.created", "Kunde angelegt", { customerId: created.data.customerId });
    refreshWorkspace();
    return { ok: true, data: { id: created.data.customerId } };
  }

  const current = await ctx.db.from("hub_customers").select("organization_id").eq("id", id).maybeSingle<{ organization_id: string | null }>();
  if (current.error || !current.data) return failed("Diesen Kunden gibt es nicht mehr.");
  const organizationId = current.data.organization_id;
  if (organizationId) {
    const refused = serviceCustomerRefusal(customer.value);
    if (refused) return failed(refused);
    const organization = await ctx.db.from("organizations").update({ name: customer.value.company, customer_number: customer.value.customerNumber }).eq("id", organizationId);
    if (organization.error) return failed(organization.error.code === "23505" ? "Diese Kundennummer ist schon vergeben." : "Der Kunde konnte nicht gespeichert werden.");
  }
  const row = organizationId ? customerDetails(customer.value) : customerRow(customer.value);
  const { data, error } = await ctx.db.from("hub_customers").update({ ...row, updated_by: ctx.actorId }).eq("id", id).select("id").single<{ id: string }>();
  if (error || !data) return failed(error?.code === "23505" ? "Diese Kundennummer ist schon vergeben." : "Der Kunde konnte nicht gespeichert werden.");
  await log(ctx, "customer.updated", "Kunde bearbeitet", { customerId: data.id });
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}
