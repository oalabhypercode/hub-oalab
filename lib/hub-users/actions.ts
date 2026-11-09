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
import { fillsFor, IMPORT_BATCH } from "@/lib/hub-customer-import/rules";
import { INVITE_BATCH, LOGIN_BATCH } from "@/lib/hub-invitations/rules";
import { mailSettings } from "@/lib/hub-mail/send";
import { ACTIVATION_LINK_HOURS, usesOwnPlatform } from "@/lib/platform/config";
import { cleanEmail, cleanText, freelancerNumberRefusal, isCustomerKind, isHubRole, kindForRole, readCustomer, readPerson, roleLabels, serviceCustomerRefusal, type CustomerInput, type CustomerKind, type HubRole, type PersonInput } from "./rules";
import { listAllUsers, roleOf, verifyHubAdmin } from "./server";

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
  in_use: "Auf diesen Zugang verweisen noch Einträge in der Serviceplattform, etwa Anfragen oder Nachrichten. Deaktiviere ihn stattdessen.",
  staff: "Der Zugang hat Team-Rechte auf der Serviceplattform und lässt sich hier nicht löschen. Deaktiviere ihn stattdessen.",
  missing: "Diesen Zugang gibt es nicht mehr.",
  failed: "Der Zugang konnte nicht gelöscht werden.",
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

/** Changes that could lock everyone out are refused before anything is written. */
async function guardAccountChange(ctx: Context, user: User, change: "role" | "status" | "delete") {
  if (user.id === ctx.actorId) return change === "role" ? "Deine eigene Rolle kannst du nicht ändern." : change === "status" ? "Du kannst dich nicht selbst deaktivieren." : "Du kannst deinen eigenen Zugang nicht löschen.";
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
  contact_email: input.contactEmail,
  phone: input.phone,
  website: input.website,
  street: input.street,
  postal_code: input.postalCode,
  city: input.city,
  country: input.country,
});

type ResolvedCustomer = { customerId: string | null; customerNumber: string | null; company: string | null; organizationId: string | null; created: boolean };

/** The kind of an entry; "customer" while the freelancer migration is missing (the column is not there yet). */
async function kindOf(ctx: Context, customerId: string): Promise<CustomerKind | null> {
  const { data, error } = await ctx.db.from("hub_customers").select("kind").eq("id", customerId).maybeSingle<{ kind: string }>();
  if (error) return error.code === "42703" ? "customer" : null;
  return data ? (isCustomerKind(data.kind) ? data.kind : "customer") : null;
}

const pickMessage = (kind: CustomerKind) => kind === "freelancer" ? "Bitte einen Freelancer auswählen oder neu anlegen." : "Bitte einen Kunden auswählen oder neu anlegen.";

/**
 * Resolves the entry a login belongs to: a customer for customer logins, a freelancer for freelancer logins (an
 * existing one or a new one created here), none for admins. `created` tells the caller which entry to remove again
 * if a later step fails. The database refuses a login at an entry of the other kind anyway.
 */
async function resolveCustomer(ctx: Context, role: HubRole, value: unknown): Promise<ActionResult<ResolvedCustomer>> {
  const choice = readChoice(value);
  const kind = kindForRole(role);
  if (!kind) return { ok: true, data: { customerId: null, customerNumber: null, company: null, organizationId: null, created: false } };
  if (!choice || choice.mode === "none") return failed(pickMessage(kind));
  if (choice.mode === "existing") {
    const { data } = await ctx.db.from("hub_customers").select("id, customer_number, company").eq("id", choice.customerId).maybeSingle<{ id: string; customer_number: string; company: string }>();
    if (!data) return failed(kind === "freelancer" ? "Diesen Freelancer gibt es nicht mehr." : "Dieser Kunde existiert nicht mehr.");
    if (await kindOf(ctx, data.id) !== kind) return failed(kind === "freelancer" ? "Freelancer-Zugänge gehören zu einem Freelancer, nicht zu einem Kunden." : "Kunden-Zugänge gehören zu einem Kunden, nicht zu einem Freelancer.");
    return { ok: true, data: { customerId: data.id, customerNumber: data.customer_number, company: data.company, organizationId: null, created: false } };
  }
  const input = readCustomer(choice.customer);
  if (!input.ok) return input;
  const created = kind === "freelancer" ? await createFreelancerEntry(ctx, input.value) : await createServiceCustomer(ctx, input.value);
  if (!created.ok) return created;
  await log(ctx, kind === "freelancer" ? "freelancer.created" : "customer.created", kind === "freelancer" ? "Freelancer angelegt" : "Kunde angelegt", { customerId: created.data.customerId });
  return { ok: true, data: { ...created.data, created: true } };
}

/**
 * A freelancer lives only in the hub: no Service organization and no service packages, so its logins never reach the
 * service platform. Its number is "FL-" and a free random number.
 */
async function createFreelancerEntry(ctx: Context, input: CustomerInput): Promise<ActionResult<{ customerId: string; customerNumber: string; company: string; organizationId: null }>> {
  const refused = freelancerNumberRefusal(input.customerNumber);
  if (refused) return failed(refused);
  const { data, error } = await ctx.db.from("hub_customers")
    .insert({ ...customerRow(input), kind: "freelancer", updated_by: ctx.actorId })
    .select("id, customer_number, company").single<{ id: string; customer_number: string; company: string }>();
  if (error || !data) {
    if (error?.code === "23505") return failed("Diese Nummer ist schon vergeben.");
    if (error?.code === "42703" || error?.code === "PGRST204") return failed("Freelancer sind in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus.");
    return failed("Der Freelancer konnte nicht angelegt werden.");
  }
  return { ok: true, data: { customerId: data.id, customerNumber: data.customer_number, company: data.company, organizationId: null } };
}

type LinkSide = { customerId: string; freelancerIds: string[] } | { freelancerId: string; customerIds: string[] };

/**
 * Who looks after whom, as the admin ticked it: the freelancers of one customer or the customers of one freelancer.
 * Only differences are written. The database checks the kind of both sides (a wrong id fails, nothing else changes).
 */
async function replaceLinks(ctx: Context, side: LinkSide): Promise<ActionResult<{ added: number; removed: number }>> {
  const byCustomer = "customerId" in side;
  const fixed = byCustomer ? side.customerId : side.freelancerId;
  const wanted = Array.from(new Set((byCustomer ? side.freelancerIds : side.customerIds).filter((id) => typeof id === "string" && uuid.test(id)))).slice(0, 500);
  const [own, other] = byCustomer ? ["customer_id", "freelancer_id"] as const : ["freelancer_id", "customer_id"] as const;
  const current = await ctx.db.from("hub_freelancer_customers").select("freelancer_id, customer_id").eq(own, fixed).returns<{ freelancer_id: string; customer_id: string }[]>();
  if (current.error) return failed("Die Zuordnung der Freelancer konnte nicht gelesen werden.");
  const existing = new Set((current.data ?? []).map((row) => row[other]));
  const removed = [...existing].filter((id) => !wanted.includes(id));
  const added = wanted.filter((id) => !existing.has(id));
  if (removed.length) {
    const { error } = await ctx.db.from("hub_freelancer_customers").delete().eq(own, fixed).in(other, removed);
    if (error) return failed("Die Zuordnung der Freelancer konnte nicht geändert werden.");
  }
  if (added.length) {
    const { error } = await ctx.db.from("hub_freelancer_customers").insert(added.map((id) => ({ [own]: fixed, [other]: id, assigned_by: ctx.actorId })));
    if (error) return failed(error.code === "23503" ? "Freelancer betreuen nur Kunden, keine anderen Freelancer." : "Die Zuordnung der Freelancer konnte nicht geändert werden.");
  }
  if (added.length || removed.length) {
    await log(ctx, byCustomer ? "customer.freelancers" : "freelancer.customers", byCustomer ? `Betreuung durch Freelancer geändert (${wanted.length})` : `Kunden des Freelancers geändert (${wanted.length})`, { customerId: fixed });
  }
  return { ok: true, data: { added: added.length, removed: removed.length } };
}

/** Logins with team access to the service platform never become freelancers: freelancers have no access there. */
async function hasServiceTeamAccess(ctx: Context, userId: string) {
  const { data, error } = await ctx.db.from("memberships").select("status, organization:organizations(kind)").eq("user_id", userId).eq("status", "active").returns<{ status: string; organization: { kind: string } | null }[]>();
  return Boolean(error) || (data ?? []).some((row) => row.organization?.kind === "oalab");
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
async function noteServiceCustomer(ctx: Context, customer: { organizationId: string | null; customerNumber: string | null }, source: "hub_user_management" | "hub_customer_import" = "hub_user_management") {
  if (!customer.organizationId) return;
  await ctx.db.from("audit_events").insert({
    organization_id: customer.organizationId, actor_type: "user", actor_id: ctx.actorId, action: "hub.customer_created", target_type: "organization", target_id: customer.organizationId,
    result: "success", correlation_id: `cor_${randomUUID().replaceAll("-", "")}`, safe_metadata: { customerNumber: customer.customerNumber, source },
  });
}

/**
 * Writes company, number and contact data of an existing customer. For a customer that is also in Service, company and
 * number go through its organization (Service's sync passes them on) and the contact data through the Hub's own row.
 */
async function writeCustomer(ctx: Context, id: string, organizationId: string | null, value: CustomerInput): Promise<ActionResult<{ id: string }>> {
  if (organizationId) {
    const refused = serviceCustomerRefusal(value);
    if (refused) return failed(refused);
    const organization = await ctx.db.from("organizations").update({ name: value.company, customer_number: value.customerNumber }).eq("id", organizationId);
    if (organization.error) return failed(organization.error.code === "23505" ? "Diese Kundennummer ist schon vergeben." : "Der Kunde konnte nicht gespeichert werden.");
  }
  const row = organizationId ? customerDetails(value) : customerRow(value);
  const { data, error } = await ctx.db.from("hub_customers").update({ ...row, updated_by: ctx.actorId }).eq("id", id).select("id").single<{ id: string }>();
  if (error || !data) return failed(error?.code === "23505" ? "Diese Kundennummer ist schon vergeben." : "Der Kunde konnte nicht gespeichert werden.");
  return { ok: true, data };
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
  // Freelancers always confirm their sign-in with a code: by e-mail, unless they set up an app.
  if (role === "oalab_freelancer" && metadata.second_factor !== "totp") metadata.second_factor = "email";
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

const noCodeAddress = "Freelancer melden sich immer mit einem Code per E-Mail an. An diese Adresse kann kein Code zugestellt werden (Testadresse ohne Postfach).";

// Registrations ------------------------------------------------------------------------------------------------------

/** Approves a waiting (or earlier rejected) registration: role, customer and finally the active status; then mails the person. */
export async function approveRegistration(input: { userId: string; role: string; customer: unknown }): Promise<ActionResult<{ customerNumber: string | null; mail: MailStatus }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user) return failed("Diesen Zugang gibt es nicht mehr.");
  const status = await profileStatus(ctx, user.id);
  if (status !== "pending" && status !== "rejected") return failed("Diese Registrierung ist bereits entschieden.");
  if (!isHubRole(input?.role)) return failed("Bitte eine Rolle wählen.");
  const role = input.role;
  if (role === "oalab_freelancer" && !hasMailbox(user.email)) return failed(noCodeAddress);

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
  if (!user) return failed("Diesen Zugang gibt es nicht mehr.");
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
  const kind = kindForRole(role);
  if (kind && !readChoice(input.customer)) return failed(pickMessage(kind));

  const added = await addLogin(ctx, { email: email.value, person: person.value, role, customer: input.customer, withLink: true });
  if (!added.ok) return added;
  const { user, link, customerId } = added.data;
  if (!link) return failed("Der Zugang konnte nicht vollständig angelegt werden. Es wurde nichts gespeichert.");
  await log(ctx, "user.created", `Zugang angelegt als ${roleLabels[role]}`, { userId: user.id, customerId });
  const mail = input.mailLink === true ? await mailPasswordLink(ctx.db, user, { firstName: person.value.firstName, link, activation: true, validUntil: activationUntil() }) : null;
  refreshWorkspace();
  return { ok: true, data: { userId: user.id, link, mail } };
}

/**
 * The steps of a new login, for „Zugang anlegen“ and „Zugänge anlegen“: the login first, so a taken address stops here
 * without leftovers, then its entry (an existing one or a new one), profile and membership. With `withLink` it also
 * makes the activation link and counts as failed without one. Whatever fails is taken back; the caller logs.
 */
async function addLogin(ctx: Context, input: { email: string; person: PersonInput; role: HubRole; customer: unknown; withLink: boolean }): Promise<ActionResult<{ user: User; link: string | null; customerId: string | null }>> {
  const { email, person, role } = input;
  if (role === "oalab_freelancer" && !hasMailbox(email)) return failed(noCodeAddress);
  // Freelancers start with the code by e-mail: they see the files of several customers.
  const created = await ctx.db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: role === "oalab_freelancer" ? { app_role: role, second_factor: "email" } : { app_role: role },
    user_metadata: { first_name: person.firstName, last_name: person.lastName, full_name: `${person.firstName} ${person.lastName}` },
  });
  if (created.error || !created.data.user) {
    const taken = created.error?.code === "email_exists" || /already|registered|exists/i.test(created.error?.message ?? "");
    return failed(taken ? "Für diese E-Mail-Adresse besteht bereits ein Zugang." : "Der Zugang konnte nicht angelegt werden.");
  }
  const user = created.data.user;
  const undo = async (customerId?: string | null) => {
    await removeLogin(ctx, user.id);
    if (customerId) await removeNewCustomer(ctx, customerId);
  };

  const customer = await resolveCustomer(ctx, role, input.customer);
  if (!customer.ok) { await undo(); return customer; }
  const saved = !(await ctx.db.from("hub_profiles").upsert({
    user_id: user.id, first_name: person.firstName, last_name: person.lastName, phone: person.phone, position: person.position,
    status: "active", source: "admin", decided_at: new Date().toISOString(), decided_by: ctx.actorId,
  }, { onConflict: "user_id" })).error && await assignCustomer(ctx, user.id, customer.data.customerId);
  const link = saved && input.withLink ? await passwordLink(ctx, email) : null;
  if (!saved || (input.withLink && !link)) {
    await undo(customer.data.created ? customer.data.customerId : null);
    return failed("Der Zugang konnte nicht vollständig angelegt werden. Es wurde nichts gespeichert.");
  }
  if (customer.data.created) await noteServiceCustomer(ctx, customer.data);
  return { ok: true, data: { user, link, customerId: customer.data.customerId } };
}

/** The end of an activation link when the hub knows it: on the own platform a week (lib/platform/config.ts). */
const activationUntil = () => usesOwnPlatform() ? new Date(Date.now() + ACTIVATION_LINK_HOURS * 60 * 60 * 1000) : null;

// Logins and invitations in bulk ---------------------------------------------------------------------------------------

export type LoginCreationResult = { customerId: string; outcome: "created" | "failed"; email: string; userId?: string; error?: string };

/**
 * „Zugänge anlegen“ (lib/hub-invitations): one login with the role Kunde per row, at an existing customer, at most
 * LOGIN_BATCH per call; the dialog sends them in batches. No mail goes out: the invitations follow with
 * „Einladungen senden“, so the logins can be prepared and checked first.
 */
export async function createCustomerLogins(input: { rows?: unknown }): Promise<ActionResult<LoginCreationResult[]>> {
  const ctx = await context();
  if (!ctx) return denied;
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  if (!rows.length || rows.length > LOGIN_BATCH) return failed(`Bitte 1 bis ${LOGIN_BATCH} Zugänge auf einmal anlegen.`);
  const results: LoginCreationResult[] = [];
  for (const raw of rows) {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const customerId = typeof row.customerId === "string" && uuid.test(row.customerId) ? row.customerId : "";
    const email = cleanEmail(row.email);
    const person = readPerson({ firstName: row.firstName, lastName: row.lastName, phone: "", position: "" });
    const fail = (error: string) => { results.push({ customerId, outcome: "failed", email: email.ok ? email.value : "", error }); };
    if (!customerId) { fail("Diesen Kunden gibt es nicht mehr."); continue; }
    if (!email.ok) { fail(email.error); continue; }
    if (!person.ok) { fail(person.error); continue; }
    const added = await addLogin(ctx, { email: email.value, person: person.value, role: "oalab_customer", customer: { mode: "existing", customerId }, withLink: false });
    if (!added.ok) { fail(added.error); continue; }
    await log(ctx, "user.created", "Zugang angelegt als Kunde (Sammelanlage, Einladung folgt)", { userId: added.data.user.id, customerId });
    results.push({ customerId, outcome: "created", email: email.value, userId: added.data.user.id });
  }
  refreshWorkspace();
  return { ok: true, data: results };
}

export type InvitationResult = { userId: string; outcome: "sent" | "skipped" | "failed"; error?: string };

/**
 * „Einladungen senden“: the activation link by mail to logins that never signed in, at most INVITE_BATCH per call. A new
 * link makes older ones invalid, so the same button sends reminders. Logins that signed in meanwhile are skipped; they
 * use „Passwort vergessen“. Without a mail server nothing starts.
 */
export async function sendInvitations(input: { userIds?: unknown }): Promise<ActionResult<InvitationResult[]>> {
  const ctx = await context();
  if (!ctx) return denied;
  if (!mailSettings().configured) return failed("Der Mailversand ist noch nicht eingerichtet. Ohne ihn geht keine Einladung raus.");
  const ids = Array.isArray(input?.userIds) ? [...new Set(input.userIds.filter((id): id is string => typeof id === "string" && uuid.test(id)))] : [];
  if (!ids.length || ids.length > INVITE_BATCH) return failed(`Bitte 1 bis ${INVITE_BATCH} Einladungen auf einmal senden.`);
  const results: InvitationResult[] = [];
  for (const userId of ids) {
    const user = await loadUser(ctx, userId);
    if (!user?.email) { results.push({ userId, outcome: "failed", error: "Diesen Zugang gibt es nicht mehr." }); continue; }
      if (user.last_sign_in_at) { results.push({ userId, outcome: "skipped", error: "Hat sich schon angemeldet." }); continue; }
    if (await profileStatus(ctx, user.id) !== "active") { results.push({ userId, outcome: "failed", error: "Der Zugang ist nicht aktiv." }); continue; }
    const link = await passwordLink(ctx, user.email);
    if (!link) { results.push({ userId, outcome: "failed", error: "Der Link konnte nicht erzeugt werden." }); continue; }
    const mail = await mailPasswordLink(ctx.db, user, { firstName: await firstNameOf(ctx, user.id), link, activation: true, validUntil: activationUntil() });
    await log(ctx, "user.activation_link", mail === "sent" ? "Einladung mit Aktivierungslink per E-Mail verschickt" : "Einladung erzeugt, die E-Mail ging nicht raus", { userId: user.id });
    results.push(mail === "sent" ? { userId, outcome: "sent" } : { userId, outcome: "failed", error: mailStatusMessage(mail) });
  }
  refreshWorkspace();
  return { ok: true, data: results };
}

const mailStatusMessage = (status: MailStatus) => status === "skipped" ? "Der Mailversand ist nicht eingerichtet." : "Die E-Mail konnte nicht verschickt werden.";

/**
 * A fresh link to set the password: the activation for new logins, a reset for everyone else. Older links expire.
 * "copy" hands the link to the admin; "mail" sends it to the login's own address and keeps it from the admin.
 */
export async function createPasswordLink(input: { userId: string; deliver?: "copy" | "mail" }): Promise<ActionResult<{ link: string | null; activation: boolean; mail: MailStatus | null }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user?.email) return failed("Diesen Zugang gibt es nicht mehr.");
  if (await profileStatus(ctx, user.id) !== "active") return failed("Links gibt es nur für aktive Zugänge.");
  const link = await passwordLink(ctx, user.email);
  if (!link) return failed("Der Link konnte nicht erzeugt werden.");
  const activation = !user.last_sign_in_at;
  const byMail = input?.deliver === "mail";
  await log(ctx, activation ? "user.activation_link" : "user.password_link", `${activation ? "Aktivierungslink" : "Link zum Passwort-Zurücksetzen"} erzeugt${byMail ? " und per E-Mail verschickt" : ""}`, { userId: user.id });
  if (!byMail) return { ok: true, data: { link, activation, mail: null } };
  const mail = await mailPasswordLink(ctx.db, user, { firstName: await firstNameOf(ctx, user.id), link, activation, validUntil: activation ? activationUntil() : null });
  refreshWorkspace();
  return { ok: true, data: { link: null, activation, mail } };
}

/** Person data, role and customer of an existing login. */
export async function updateHubUser(input: { userId: string; firstName: string; lastName: string; phone: string; position: string; role: string; customer: unknown }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user) return failed("Diesen Zugang gibt es nicht mehr.");
  if (await profileStatus(ctx, user.id) === "pending") return failed("Offene Registrierungen bitte über „Prüfen“ freigeben.");
  const person = readPerson(input ?? {});
  if (!person.ok) return person;
  if (!isHubRole(input?.role)) return failed("Bitte eine Rolle wählen.");
  const role = input.role;
  const roleChanged = roleOf(user) !== role;
  if (roleChanged) {
    const refused = await guardAccountChange(ctx, user, "role");
    if (refused) return failed(refused);
    if (role === "oalab_freelancer") {
      if (!hasMailbox(user.email)) return failed(noCodeAddress);
      if (await hasServiceTeamAccess(ctx, user.id)) return failed("Dieser Zugang hat Team-Rechte auf der Serviceplattform. Freelancer haben dort keinen Zugang; lege für den Freelancer einen eigenen Zugang an.");
    }
  }

  const customer = await resolveCustomer(ctx, role, input.customer);
  if (!customer.ok) return customer;
  const done = !(await ctx.db.from("hub_profiles").update({ first_name: person.value.firstName, last_name: person.value.lastName, phone: person.value.phone, position: person.value.position }).eq("user_id", user.id)).error
    && (!roleChanged || await setRole(ctx, user, role))
    && await assignCustomer(ctx, user.id, customer.data.customerId);
  if (!done) return failed("Die Änderungen konnten nicht vollständig gespeichert werden. Bitte prüfe den Zugang.");
  await log(ctx, "user.updated", roleChanged ? `Zugang bearbeitet, Rolle jetzt ${roleLabels[role]}` : "Zugang bearbeitet", { userId: user.id, customerId: customer.data.customerId });
  refreshWorkspace();
  return { ok: true, data: null };
}

/** Deactivates (blocks the login and all data at once) or reactivates a login. */
export async function setHubUserActive(input: { userId: string; active: boolean }): Promise<ActionResult<null>> {
  const ctx = await context();
  if (!ctx) return denied;
  const user = await loadUser(ctx, input?.userId);
  if (!user) return failed("Diesen Zugang gibt es nicht mehr.");
  const active = input?.active === true;
  const status = await profileStatus(ctx, user.id);
  if (status !== (active ? "disabled" : "active")) return failed(active ? "Nur deaktivierte Zugänge lassen sich aktivieren." : "Nur aktive Zugänge lassen sich deaktivieren.");
  if (!active) {
    const refused = await guardAccountChange(ctx, user, "status");
    if (refused) return failed(refused);
  }

  // The profile first: an inactive profile cuts all data access immediately, the ban stops new sign-ins.
  const saved = !(await ctx.db.from("hub_profiles").update({ status: active ? "active" : "disabled", decided_at: new Date().toISOString(), decided_by: ctx.actorId }).eq("user_id", user.id)).error;
  const banned = saved && !(await ctx.db.auth.admin.updateUserById(user.id, { ban_duration: active ? "none" : BLOCKED })).error;
  if (!banned) return failed(active ? "Der Zugang konnte nicht aktiviert werden." : "Der Zugang konnte nicht vollständig deaktiviert werden. Bitte erneut versuchen.");
  await log(ctx, active ? "user.reactivated" : "user.deactivated", active ? "Zugang wieder aktiviert" : "Zugang deaktiviert", { userId: user.id });
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
  if (!user) return failed("Diesen Zugang gibt es nicht mehr.");
  const choice = input?.choice === "email" ? "email" : input?.choice === "off" ? "off" : null;
  if (!choice) return failed("Bitte eine Methode wählen.");
  if (choice === "off" && roleOf(user) === "oalab_freelancer") return failed("Freelancer melden sich immer mit einem Code an, weil sie die Dateien mehrerer Kunden sehen.");
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
  if (!user?.email) return failed("Diesen Zugang gibt es nicht mehr.");
  const refused = await guardAccountChange(ctx, user, "delete");
  if (refused) return failed(refused);
  if (cleanEmail(input?.confirmEmail).ok === false || String(input.confirmEmail).trim().toLowerCase() !== user.email.toLowerCase()) return failed("Zur Bestätigung bitte die E-Mail-Adresse des Zugangs genau eintragen.");
  const { data: membership } = await ctx.db.from("hub_customer_members").select("customer_id").eq("user_id", user.id).limit(1).maybeSingle<{ customer_id: string }>();
  // Files and appointments of the customer stay.
  const removed = await removeLogin(ctx, user.id);
  if (removed !== "deleted") return failed(removalErrors[removed]);
  await log(ctx, "user.deleted", "Zugang endgültig gelöscht", { customerId: membership?.customer_id ?? null });
  refreshWorkspace();
  return { ok: true, data: null };
}

// Customers ----------------------------------------------------------------------------------------------------------

/**
 * Creates a customer (in Service too) or updates one; the customer number stays unique. For a customer in Service,
 * company and number go to its organization and come back through Service's trigger; the contact data the Hub saves
 * reaches Service's customer profile through the Hub's own trigger. Hub-only customers stay as they are.
 */
export async function saveCustomer(input: { id?: string; freelancerIds?: unknown } & Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const customer = readCustomer(input ?? {});
  if (!customer.ok) return customer;
  const id = typeof input?.id === "string" && uuid.test(input.id) ? input.id : null;
  // The freelancers who look after the customer, when the dialog sends them (only once the database knows freelancers).
  const freelancerIds = Array.isArray(input?.freelancerIds) ? input.freelancerIds.filter((value): value is string => typeof value === "string") : null;
  if (!id) {
    const created = await createServiceCustomer(ctx, customer.value);
    if (!created.ok) return created;
    await noteServiceCustomer(ctx, created.data);
    await log(ctx, "customer.created", "Kunde angelegt", { customerId: created.data.customerId });
    if (freelancerIds?.length) {
      const linked = await replaceLinks(ctx, { customerId: created.data.customerId, freelancerIds });
      if (!linked.ok) { refreshWorkspace(); return failed(`Der Kunde ist angelegt, aber: ${linked.error}`); }
    }
    refreshWorkspace();
    return { ok: true, data: { id: created.data.customerId } };
  }

  const current = await ctx.db.from("hub_customers").select("organization_id").eq("id", id).maybeSingle<{ organization_id: string | null }>();
  if (current.error || !current.data) return failed("Diesen Kunden gibt es nicht mehr.");
  if (await kindOf(ctx, id) === "freelancer") return failed("Das ist ein Freelancer. Bitte über „Freelancer“ bearbeiten.");
  const written = await writeCustomer(ctx, id, current.data.organization_id, customer.value);
  if (!written.ok) return written;
  const data = written.data;
  await log(ctx, "customer.updated", "Kunde bearbeitet", { customerId: data.id });
  if (freelancerIds) {
    const linked = await replaceLinks(ctx, { customerId: data.id, freelancerIds });
    if (!linked.ok) { refreshWorkspace(); return failed(`Der Kunde ist gespeichert, aber: ${linked.error}`); }
  }
  refreshWorkspace();
  return { ok: true, data: { id: data.id } };
}

// Import from the accounting -----------------------------------------------------------------------------------------

export type CustomerImportResult = { line: number; outcome: "created" | "updated" | "unchanged" | "failed"; customerNumber: string; company: string; error?: string };

type StoredCustomer = { organization_id: string | null; company: string; customer_number: string; contact_email: string; phone: string; website: string; street: string; postal_code: string; city: string; country: string };

/**
 * Takes over customers from the accounting's contact export (lib/hub-customer-import), at most IMPORT_BATCH per call:
 * the dialog sends them in batches and shows the progress. A new customer goes the way of „Kunde anlegen“ (Service
 * organization first, with Service's default plan). A match only gets its empty contact fields filled, read again
 * here so nothing is overwritten, and, when asked, the number from the file. No logins, no mails, no packages.
 */
export async function importCustomers(input: { rows?: unknown }): Promise<ActionResult<CustomerImportResult[]>> {
  const ctx = await context();
  if (!ctx) return denied;
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  if (!rows.length || rows.length > IMPORT_BATCH) return failed(`Bitte 1 bis ${IMPORT_BATCH} Kunden auf einmal übernehmen.`);
  const results: CustomerImportResult[] = [];
  for (const raw of rows) {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const line = typeof row.line === "number" && Number.isInteger(row.line) ? row.line : 0;
    const customer = readCustomer(row.customer && typeof row.customer === "object" ? row.customer as Record<string, unknown> : {});
    if (!customer.ok) { results.push({ line, outcome: "failed", customerNumber: "", company: "", error: customer.error }); continue; }
    const value = customer.value;
    const fail = (error: string) => { results.push({ line, outcome: "failed", customerNumber: value.customerNumber, company: value.company, error }); };
    const customerId = typeof row.customerId === "string" && uuid.test(row.customerId) ? row.customerId : null;

    if (!customerId) {
      const created = await createServiceCustomer(ctx, value);
      if (!created.ok) { fail(created.error); continue; }
      await noteServiceCustomer(ctx, created.data, "hub_customer_import");
      await log(ctx, "customer.created", "Kunde aus der Buchhaltung übernommen", { customerId: created.data.customerId });
      results.push({ line, outcome: "created", customerNumber: created.data.customerNumber, company: created.data.company });
      continue;
    }

    const stored = await ctx.db.from("hub_customers").select("organization_id, company, customer_number, contact_email, phone, website, street, postal_code, city, country").eq("id", customerId).maybeSingle<StoredCustomer>();
    if (stored.error || !stored.data) { fail("Diesen Kunden gibt es nicht mehr."); continue; }
    if (await kindOf(ctx, customerId) !== "customer") { fail("Das ist ein Freelancer, kein Kunde."); continue; }
    const current = stored.data;
    const now: CustomerInput = {
      company: current.company, customerNumber: current.customer_number, contactEmail: current.contact_email, phone: current.phone, website: current.website,
      street: current.street, postalCode: current.postal_code, city: current.city, country: current.country,
    };
    const fills = fillsFor(now, value);
    const renumber = row.renumber === true && value.customerNumber !== now.customerNumber;
    if (!fills.length && !renumber) { results.push({ line, outcome: "unchanged", customerNumber: now.customerNumber, company: now.company }); continue; }
    const merged: CustomerInput = { ...now, customerNumber: renumber ? value.customerNumber : now.customerNumber };
    for (const field of fills) merged[field] = value[field];
    const written = await writeCustomer(ctx, customerId, current.organization_id, merged);
    if (!written.ok) { fail(written.error); continue; }
    await log(ctx, "customer.updated", renumber ? "Aus der Buchhaltung ergänzt, mit neuer Kundennummer" : "Aus der Buchhaltung ergänzt", { customerId });
    results.push({ line, outcome: "updated", customerNumber: merged.customerNumber, company: merged.company });
  }
  refreshWorkspace();
  return { ok: true, data: results };
}

// Freelancers --------------------------------------------------------------------------------------------------------

/**
 * Creates or edits a freelancer (only in the hub) with the customers they look after. The number keeps its "FL-"
 * form; there are no service packages. Customers are only ever assigned here, a freelancer creates none.
 */
export async function saveFreelancer(input: { id?: string; customerIds?: unknown } & Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const freelancer = readCustomer(input ?? {});
  if (!freelancer.ok) return freelancer;
  const customerIds = Array.isArray(input?.customerIds) ? input.customerIds.filter((value): value is string => typeof value === "string") : [];
  let id = typeof input?.id === "string" && uuid.test(input.id) ? input.id : null;
  if (!id) {
    const created = await createFreelancerEntry(ctx, freelancer.value);
    if (!created.ok) return created;
    id = created.data.customerId;
    await log(ctx, "freelancer.created", "Freelancer angelegt", { customerId: id });
  } else {
    if (await kindOf(ctx, id) !== "freelancer") return failed("Diesen Freelancer gibt es nicht mehr.");
    const refused = freelancerNumberRefusal(freelancer.value.customerNumber);
    if (refused) return failed(refused);
    const { error } = await ctx.db.from("hub_customers").update({ ...customerRow(freelancer.value), updated_by: ctx.actorId }).eq("id", id);
    if (error) return failed(error.code === "23505" ? "Diese Nummer ist schon vergeben." : "Der Freelancer konnte nicht gespeichert werden.");
    await log(ctx, "freelancer.updated", "Freelancer bearbeitet", { customerId: id });
  }
  const linked = await replaceLinks(ctx, { freelancerId: id, customerIds });
  refreshWorkspace();
  return linked.ok ? { ok: true, data: { id } } : failed(`Der Freelancer ist gespeichert, aber: ${linked.error}`);
}

/** The freelancers who look after one customer, e.g. from the head of the customer in the asset management. */
export async function setCustomerFreelancers(input: { customerId: string; freelancerIds: string[] }): Promise<ActionResult<{ count: number }>> {
  const ctx = await context();
  if (!ctx) return denied;
  const customerId = typeof input?.customerId === "string" && uuid.test(input.customerId) ? input.customerId : null;
  if (!customerId || await kindOf(ctx, customerId) !== "customer") return failed("Diesen Kunden gibt es nicht mehr.");
  const freelancerIds = Array.isArray(input?.freelancerIds) ? input.freelancerIds.filter((value): value is string => typeof value === "string") : [];
  const linked = await replaceLinks(ctx, { customerId, freelancerIds });
  if (!linked.ok) return linked;
  refreshWorkspace();
  return { ok: true, data: { count: freelancerIds.length } };
}
