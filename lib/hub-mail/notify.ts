import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFileDateTime } from "@/lib/hub-files/catalog";
import type { OutgoingMail } from "./smtp";
import { mailSettings, sendMail, type MailStatus } from "./send";
import { accessApprovedMail, loginCodeMail, passwordLinkMail, registrationConfirmationMail, registrationReceivedMail, registrationRejectedMail, teamRegistrationMail, type MailContent } from "./templates";

// Every mail the hub sends on its own. Each attempt lands in hub_notifications (kind and outcome only);
// the registration mails go out once per login. Nothing here throws: a mail problem never breaks an action.

export type NotificationKind = "registration.confirmation" | "registration.team" | "registration.received" | "registration.approved" | "registration.rejected" | "user.activation" | "user.password" | "user.login_code";

const mailOf = (to: string[], content: MailContent, extra: Partial<OutgoingMail> = {}): OutgoingMail => ({ to, ...content, ...extra });

/** Sends a mail and records the outcome. */
async function sendTracked(db: SupabaseClient, kind: NotificationKind, userId: string, mail: OutgoingMail): Promise<MailStatus> {
  const result = await sendMail({ ...mail, kind });
  await db.from("hub_notifications").insert({ kind, user_id: userId, status: result.status, provider_id: result.id ?? null, error: result.error ?? "" });
  return result.status;
}

/**
 * Sends a mail at most once per login: the row is claimed first, so a second claim (reload, parallel request)
 * fails on the unique index and sends nothing. Without the table nothing is sent, rather than sending on every visit.
 */
async function sendOnce(db: SupabaseClient, kind: NotificationKind, userId: string, mail: OutgoingMail): Promise<MailStatus | "already"> {
  const claim = await db.from("hub_notifications").insert({ kind, user_id: userId }).select("id").single<{ id: number }>();
  if (claim.error) return claim.error.code === "23505" ? "already" : "failed";
  const result = await sendMail({ ...mail, kind });
  await db.from("hub_notifications").update({ status: result.status, provider_id: result.id ?? null, error: result.error ?? "" }).eq("id", claim.data.id);
  return result.status;
}

type ProfileRow = { first_name: string; last_name: string; position: string; company_name: string; phone: string; website: string; customer_number_hint: string; message: string; status: string };

/**
 * A confirmed registration that waits for approval: the oalab team gets the details with a link to the user
 * management, the person a receipt. Called after the waiting page has rendered; each mail goes out once.
 */
export async function notifyConfirmedRegistration(userId: string, origin: string | null) {
  try {
    const db = createAdminClient();
    if (!db) return;
    const { data } = await db.auth.admin.getUserById(userId);
    const user = data?.user;
    if (!user?.email || !user.email_confirmed_at) return;
    const { data: profile } = await db.from("hub_profiles")
      .select("first_name, last_name, position, company_name, phone, website, customer_number_hint, message, status")
      .eq("user_id", userId).maybeSingle<ProfileRow>();
    if (!profile || profile.status !== "pending") return;

    const settings = mailSettings();
    if (settings.team.length) {
      const content = teamRegistrationMail({
        firstName: profile.first_name, lastName: profile.last_name, position: profile.position, companyName: profile.company_name, email: user.email,
        phone: profile.phone, website: profile.website, customerNumberHint: profile.customer_number_hint, message: profile.message,
        registeredAt: formatFileDateTime(user.created_at),
      }, `${origin ?? ""}/dashboard/users`, settings.legal);
      // Replies to the team mail go straight to the person.
      await sendOnce(db, "registration.team", userId, mailOf(settings.team, content, { replyTo: user.email }));
    }
    await sendOnce(db, "registration.received", userId, mailOf([user.email], registrationReceivedMail({ firstName: profile.first_name, contact: settings.replyTo }, settings.legal)));
  } catch (error) {
    console.error("[hub-mail] Benachrichtigung zur Registrierung fehlgeschlagen", error instanceof Error ? error.name : "unbekannt");
  }
}

/** The person learns that their access is approved, with the login link. */
export function mailApproval(db: SupabaseClient, user: User, input: { firstName: string; origin: string | null; company: string | null; customerNumber: string | null }) {
  const settings = mailSettings();
  const content = accessApprovedMail({ firstName: input.firstName, email: user.email ?? "", loginUrl: `${input.origin ?? ""}/auth/login`, company: input.company, customerNumber: input.customerNumber }, settings.legal);
  return sendTracked(db, "registration.approved", user.id, mailOf([user.email ?? ""], content));
}

/** The person learns that the registration was not approved, with the note if there is one. */
export function mailRejection(db: SupabaseClient, user: User, input: { firstName: string; note: string }) {
  const settings = mailSettings();
  return sendTracked(db, "registration.rejected", user.id, mailOf([user.email ?? ""], registrationRejectedMail(input, settings.legal)));
}

/** A one-time link to set the first or a new password, sent to the login's own address only. */
export function mailPasswordLink(db: SupabaseClient, user: User, input: { firstName: string; link: string; activation: boolean }) {
  const settings = mailSettings();
  return sendTracked(db, input.activation ? "user.activation" : "user.password", user.id, mailOf([user.email ?? ""], passwordLinkMail(input, settings.legal)));
}

/** The six-digit code of a sign-in with second factor, to the login's own address only. The log keeps no code. */
export function mailLoginCode(db: SupabaseClient, user: Pick<User, "id" | "email">, input: { firstName: string; code: string; minutes: number }) {
  const settings = mailSettings();
  return sendTracked(db, "user.login_code", user.id, mailOf([user.email ?? ""], loginCodeMail(input, settings.legal)));
}

/** Right after the registration form: the link that confirms the e-mail address. */
export function mailRegistrationConfirmation(db: SupabaseClient, user: User, input: { firstName: string; link: string }) {
  const settings = mailSettings();
  return sendTracked(db, "registration.confirmation", user.id, mailOf([user.email ?? ""], registrationConfirmationMail(input, settings.legal)));
}
