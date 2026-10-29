/**
 * Customer proposals of the hub assistant (KI-Plan Schritt 6): the assistant proposes a new customer, the admin picks
 * the Service package and whether the contact person gets a login, and saves. Nothing is stored before that click.
 * The customer becomes a Service organization; its Hub customer follows by trigger. Self-contained apart from type
 * imports: the input rules of the user management come in as a parameter, so the preview checks what the form checks.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type * as UserRules from "../hub-users/rules";
import type { AssistantData } from "./tools";

export type CustomerRules = Pick<typeof UserRules, "cleanLine" | "cleanEmail" | "cleanPhone" | "cleanWebsite" | "readPerson" | "normalizeCompany">;

/** A Service package (plans row) the admin can pick for a new customer. */
export type ServicePlan = { id: string; code: string; name: string; createdAt: string };

/** What a customer proposal is checked against besides the customers in AssistantData. */
export type CustomerContext = { plans: ServicePlan[]; loginEmails: ReadonlySet<string>; mailReady: boolean };

export type CustomerProposal = {
  company: string;
  contact: { email: string; phone: string; website: string; street: string; postalCode: string; city: string; country: string };
  plans: { id: string; name: string }[];
  /** Preselected: the package Service also gives a new customer. */
  planId: string;
  /** The contact person; `taken` when a login with this address exists, then the preview offers none. */
  login: { firstName: string; lastName: string; email: string; taken: boolean } | null;
  /** Without SMTP access the hub only logs mails, so the preview offers no invitation. */
  mailReady: boolean;
  /** Existing customers that look alike; shown as a warning, the admin decides. */
  similar: { company: string; customerNumber: string; reason: "name" | "email" }[];
};

/** The admin's choices in the preview. */
export type CustomerChoice = { planId: string; login: boolean; mail: boolean };

const MAX_COMPANY = 160; // organizations.name

export const PROPOSE_CUSTOMER_TOOL: Anthropic.Beta.BetaTool = {
  name: "propose_customer",
  description: "Schlägt einen neuen Kunden vor (Unternehmen als Service-Kunde, optional mit Login für den Ansprechpartner). Dabei wird nichts gespeichert: Der Nutzer wählt in der Vorschau das Service-Paket und ob ein Login entsteht und legt selbst an. Vorher mit search prüfen, ob es den Kunden schon gibt. Nur Angaben übernehmen, die der Nutzer nennt; alles andere leer lassen.",
  input_schema: {
    type: "object",
    properties: {
      company: { type: "string", description: "Name des Unternehmens, z. B. „Muster GmbH“." },
      contact_email: { type: "string", description: "Kontakt-E-Mail des Unternehmens; nennt der Nutzer nur die E-Mail des Ansprechpartners, auch hier diese. Leer, wenn keine genannt." },
      phone: { type: "string", description: "Telefon des Unternehmens oder leer." },
      website: { type: "string", description: "Website, z. B. muster.de, oder leer." },
      street: { type: "string", description: "Straße und Hausnummer oder leer." },
      postal_code: { type: "string", description: "Postleitzahl oder leer." },
      city: { type: "string", description: "Ort oder leer." },
      plan: { type: "string", description: "Service-Paket, nur wenn der Nutzer eines nennt (Name), sonst leer für das Standardpaket." },
      person_first_name: { type: "string", description: "Vorname des Ansprechpartners oder leer." },
      person_last_name: { type: "string", description: "Nachname des Ansprechpartners oder leer." },
      person_email: { type: "string", description: "E-Mail des Ansprechpartners für einen möglichen Login oder leer." },
    },
    required: ["company", "contact_email", "phone", "website", "street", "postal_code", "city", "plan", "person_first_name", "person_last_name", "person_email"],
    additionalProperties: false,
  },
  strict: true,
  eager_input_streaming: true,
};

type Outcome<T> = { ok: true; proposal: T } | { ok: false; error: string };
const object = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;

/** The package Service gives a new customer: the oldest active one, test fixtures last (as Service's own „Kunde anlegen“). */
export function defaultPlan(plans: readonly ServicePlan[]) {
  return [...plans].sort((a, b) => Number(a.code === "fixture_standard") - Number(b.code === "fixture_standard") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0] ?? null;
}

/** Checks a propose_customer call: a company that is not a customer yet, valid contact data, a known package. */
export function prepareCustomerProposal(input: unknown, data: AssistantData, context: CustomerContext, rules: CustomerRules): Outcome<CustomerProposal> {
  const args = object(input);
  if (!args) return { ok: false, error: "Ungültige Eingabe." };
  const company = rules.cleanLine(args.company, 200);
  if (!company) return { ok: false, error: "Bitte den Namen des Unternehmens angeben." };
  if (company.length > MAX_COMPANY) return { ok: false, error: `Der Name ist länger als ${MAX_COMPANY} Zeichen.` };
  const key = rules.normalizeCompany(company);
  if (!key) return { ok: false, error: "Bitte einen Firmennamen mit Buchstaben oder Ziffern angeben." };
  const twin = data.customers.find((customer) => rules.normalizeCompany(customer.company) === key);
  if (twin) return { ok: false, error: `„${twin.company}“ gibt es schon als Kunde (${twin.customerNumber}). Es wurde nichts vorgeschlagen; nenne dem Nutzer den vorhandenen Kunden.` };

  const email = rules.cleanLine(args.contact_email, 254) ? rules.cleanEmail(args.contact_email) : { ok: true as const, value: "" };
  if (!email.ok) return { ok: false, error: "Bitte eine gültige Kontakt-E-Mail angeben." };
  const phone = rules.cleanPhone(args.phone, false);
  if (!phone.ok) return phone;
  const website = rules.cleanWebsite(args.website);
  if (!website.ok) return website;
  const postalCode = rules.cleanLine(args.postal_code, 12);
  if (postalCode && !/^[A-Za-z0-9 -]{3,12}$/.test(postalCode)) return { ok: false, error: "Bitte eine gültige Postleitzahl angeben." };

  const fallback = defaultPlan(context.plans);
  if (!fallback) return { ok: false, error: "In Service ist kein aktives Paket eingerichtet. Ohne Paket lässt sich kein Kunde anlegen." };
  const wanted = rules.cleanLine(args.plan, 120).toLowerCase();
  const plan = wanted ? context.plans.find((item) => item.name.toLowerCase() === wanted || item.code.toLowerCase() === wanted) : fallback;
  if (!plan) return { ok: false, error: `Das Paket „${rules.cleanLine(args.plan, 120)}“ gibt es nicht. Aktive Pakete: ${context.plans.map((item) => item.name).join(", ")}.` };

  let login: CustomerProposal["login"] = null;
  const named = [args.person_first_name, args.person_last_name, args.person_email].some((value) => rules.cleanLine(value, 254));
  if (named) {
    const person = rules.readPerson({ firstName: args.person_first_name, lastName: args.person_last_name });
    if (!person.ok) return { ok: false, error: `Ansprechpartner: ${person.error} Frag nach oder lass alle drei person_*-Felder leer.` };
    const address = rules.cleanEmail(args.person_email);
    if (!address.ok) return { ok: false, error: "Ansprechpartner: Für einen Login braucht es seine E-Mail-Adresse. Frag nach oder lass alle drei person_*-Felder leer." };
    login = { firstName: person.value.firstName, lastName: person.value.lastName, email: address.value, taken: context.loginEmails.has(address.value) };
  }

  // Similar names ("Muster" and "Muster Bau") or the same contact address: a warning, not a block.
  const similar: CustomerProposal["similar"] = [];
  for (const customer of data.customers) {
    const other = rules.normalizeCompany(customer.company);
    const close = Math.min(other.length, key.length) >= 4 && (other.includes(key) || key.includes(other));
    const sameEmail = Boolean(email.value) && customer.contactEmail.toLowerCase() === email.value;
    if (close || sameEmail) similar.push({ company: customer.company, customerNumber: customer.customerNumber, reason: close ? "name" : "email" });
  }

  return {
    ok: true,
    proposal: {
      company,
      contact: { email: email.value, phone: phone.value, website: website.value, street: rules.cleanLine(args.street, 120), postalCode, city: rules.cleanLine(args.city, 80), country: "Deutschland" },
      plans: context.plans.map((item) => ({ id: item.id, name: item.name })),
      planId: plan.id,
      login,
      mailReady: context.mailReady,
      similar: similar.slice(0, 5),
    },
  };
}

/** The admin's choices, checked against the stored proposal: a listed package; a login only if one is offered. */
export function readCustomerChoice(proposal: CustomerProposal, value: unknown): { ok: true; choice: CustomerChoice } | { ok: false; error: string } {
  const choice = object(value);
  if (!choice || typeof choice.planId !== "string" || typeof choice.login !== "boolean" || typeof choice.mail !== "boolean") return { ok: false, error: "Die Auswahl passt nicht zum Vorschlag. Bitte den Chat neu laden." };
  if (!proposal.plans.some((plan) => plan.id === choice.planId)) return { ok: false, error: "Dieses Paket steht im Vorschlag nicht zur Wahl." };
  const login = choice.login && Boolean(proposal.login) && !proposal.login?.taken;
  if (choice.login && !login) return { ok: false, error: "Für diesen Vorschlag lässt sich kein Login anlegen." };
  return { ok: true, choice: { planId: choice.planId, login, mail: login && proposal.mailReady && choice.mail } };
}

/** "OA-" and a random free number from 10000 to 99999, so customers cannot tell how many customers there are. */
export function newCustomerNumber(taken: ReadonlySet<string>, random: () => number = Math.random) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const number = `OA-${10000 + Math.floor(random() * 90000)}`;
    if (!taken.has(number)) return number;
  }
  return null;
}

/** The hub_customers columns for the contact data. */
export const contactColumns = (contact: CustomerProposal["contact"]) => ({
  contact_email: contact.email,
  phone: contact.phone,
  website: contact.website,
  street: contact.street,
  postal_code: contact.postalCode,
  city: contact.city,
  country: contact.country,
});

// How the chat shows a customer proposal ---------------------------------------------------------------------------

export type CustomerView = CustomerProposal & { kind: "customer.create"; id: string; expiresAt: string };

/** The contact data as short lines for the preview; empty fields are left out. */
export function contactLines(contact: CustomerProposal["contact"]) {
  const place = [contact.postalCode, contact.city].filter(Boolean).join(" ");
  return [
    { label: "Kontakt-E-Mail", value: contact.email },
    { label: "Telefon", value: contact.phone },
    { label: "Website", value: contact.website.replace(/^https:\/\//, "") },
    { label: "Anschrift", value: [contact.street, place].filter(Boolean).join(", ") },
  ].filter((line) => line.value);
}

/** What Claude learns about a customer proposal in later turns: only the outcome the server reported. */
export function customerNote(view: CustomerView, outcome: "open" | "saved" | "discarded" | "failed", detail = "") {
  const what = `neuer Kunde „${view.company}“`;
  if (outcome === "saved") return `[Vermerk des Hubs: Vorschlag (${what}) wurde vom Nutzer angelegt.${detail ? ` ${detail}` : ""}]`;
  if (outcome === "discarded") return `[Vermerk des Hubs: Vorschlag (${what}) wurde vom Nutzer verworfen, nichts angelegt.]`;
  if (outcome === "failed") return `[Vermerk des Hubs: Anlegen (${what}) ist fehlgeschlagen.${detail ? ` ${detail}` : ""}]`;
  return `[Vermerk des Hubs: Vorschlag (${what}) liegt in der Vorschau, noch nicht angelegt.]`;
}
