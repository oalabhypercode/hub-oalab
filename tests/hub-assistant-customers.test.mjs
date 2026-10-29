import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  contactColumns, contactLines, customerNote, defaultPlan, newCustomerNumber, prepareCustomerProposal, PROPOSE_CUSTOMER_TOOL, readCustomerChoice,
} from "../lib/hub-assistant/customers.ts";
import * as rules from "../lib/hub-users/rules.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const customer = (company, customerNumber, contactEmail = "") => ({ id: customerNumber, organizationId: null, company, customerNumber, servicePackages: [], city: "", website: "", contactEmail });
const data = { projects: [], customers: [customer("Nordlicht Studio GmbH", "KD-24017"), customer("KalaClo", "OA-KALACLO", "hallo@kalaclo.com")] };
const plans = [
  { id: "p-fixture", code: "fixture_standard", name: "Test", createdAt: "2026-08-01T00:00:00Z" },
  { id: "p-pro", code: "pro", name: "Pro", createdAt: "2026-09-01T00:00:00Z" },
  { id: "p-starter", code: "starter", name: "Starter", createdAt: "2026-08-10T00:00:00Z" },
];
const context = { plans, loginEmails: new Set(["taken@beispiel.de"]), mailReady: true };
const call = (extra = {}) => ({ company: "Muster GmbH", contact_email: "", phone: "", website: "", street: "", postal_code: "", city: "", plan: "", person_first_name: "", person_last_name: "", person_email: "", ...extra });
const prepare = (extra) => prepareCustomerProposal(call(extra), data, context, rules);

test("the customer tool is strict, only proposes and asks for every field", () => {
  assert.equal(PROPOSE_CUSTOMER_TOOL.name, "propose_customer");
  assert.equal(PROPOSE_CUSTOMER_TOOL.strict, true);
  assert.match(PROPOSE_CUSTOMER_TOOL.description, /nichts gespeichert/);
  const schema = PROPOSE_CUSTOMER_TOOL.input_schema;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
});

test("a new customer gets Service's default package, cleaned contact data and a login offer", () => {
  assert.equal(defaultPlan(plans).id, "p-starter"); // oldest active, test fixtures last
  const outcome = prepare({ company: "  Muster   GmbH ", contact_email: "Max@Beispiel.de", website: "muster.de", street: "Hauptstraße 1", postal_code: "04109", city: "Leipzig", person_first_name: "Max", person_last_name: "Mustermann", person_email: "max@beispiel.de" });
  assert.equal(outcome.ok, true);
  const { proposal } = outcome;
  assert.equal(proposal.company, "Muster GmbH");
  assert.equal(proposal.planId, "p-starter");
  assert.deepEqual(proposal.contact, { email: "max@beispiel.de", phone: "", website: "https://muster.de", street: "Hauptstraße 1", postalCode: "04109", city: "Leipzig", country: "Deutschland" });
  assert.deepEqual(proposal.login, { firstName: "Max", lastName: "Mustermann", email: "max@beispiel.de", taken: false });
  assert.deepEqual(contactLines(proposal.contact).map((line) => `${line.label}: ${line.value}`), ["Kontakt-E-Mail: max@beispiel.de", "Website: muster.de", "Anschrift: Hauptstraße 1, 04109 Leipzig"]);
  assert.deepEqual(contactColumns(proposal.contact), { contact_email: "max@beispiel.de", phone: "", website: "https://muster.de", street: "Hauptstraße 1", postal_code: "04109", city: "Leipzig", country: "Deutschland" });
  assert.equal(prepare({ plan: "pro" }).proposal.planId, "p-pro");
});

test("existing customers, unknown packages, bad data and half a contact person are refused", () => {
  assert.match(prepare({ company: "nordlicht studio" }).error, /gibt es schon als Kunde \(KD-24017\)/);
  assert.match(prepare({ company: "KalaClo GmbH" }).error, /OA-KALACLO/);
  assert.match(prepare({ company: "" }).error, /Namen des Unternehmens/);
  assert.equal(prepare({ company: "x".repeat(161) }).ok, false);
  assert.match(prepare({ plan: "Premium" }).error, /Aktive Pakete: Test, Pro, Starter/);
  assert.equal(prepare({ contact_email: "kein-mail" }).ok, false);
  assert.equal(prepare({ postal_code: "!!" }).ok, false);
  assert.match(prepare({ person_email: "max@beispiel.de" }).error, /Vornamen/);
  assert.match(prepare({ person_first_name: "Max", person_last_name: "Mustermann" }).error, /E-Mail-Adresse/);
  assert.match(prepareCustomerProposal(call(), data, { ...context, plans: [] }, rules).error, /kein aktives Paket/);
});

test("similar names and a known contact address only warn; a taken login address offers no login", () => {
  const { proposal } = prepare({ company: "Nordlicht", contact_email: "hallo@kalaclo.com", person_first_name: "Eva", person_last_name: "Muster", person_email: "taken@beispiel.de" });
  assert.deepEqual(proposal.similar, [{ company: "Nordlicht Studio GmbH", customerNumber: "KD-24017", reason: "name" }, { company: "KalaClo", customerNumber: "OA-KALACLO", reason: "email" }]);
  assert.equal(proposal.login.taken, true);
  assert.equal(readCustomerChoice(proposal, { planId: "p-pro", login: true, mail: false }).ok, false);
  assert.deepEqual(readCustomerChoice(proposal, { planId: "p-pro", login: false, mail: false }).choice, { planId: "p-pro", login: false, mail: false });
});

test("the choice can only pick a listed package; the mail needs the login and a working mailbox", () => {
  const { proposal } = prepare({ person_first_name: "Max", person_last_name: "Mustermann", person_email: "max@beispiel.de" });
  assert.deepEqual(readCustomerChoice(proposal, { planId: "p-starter", login: true, mail: true }).choice, { planId: "p-starter", login: true, mail: true });
  assert.deepEqual(readCustomerChoice(proposal, { planId: "p-starter", login: false, mail: true }).choice, { planId: "p-starter", login: false, mail: false });
  assert.deepEqual(readCustomerChoice({ ...proposal, mailReady: false }, { planId: "p-starter", login: true, mail: true }).choice, { planId: "p-starter", login: true, mail: false });
  assert.equal(readCustomerChoice(proposal, { planId: "p-other", login: false, mail: false }).ok, false);
  assert.equal(readCustomerChoice(proposal, { planId: "p-starter", login: "yes", mail: false }).ok, false);
  assert.equal(readCustomerChoice(prepare().proposal, { planId: "p-starter", login: true, mail: false }).ok, false); // no person, no login
});

test("customer numbers are OA- plus a random free five-digit number", () => {
  assert.equal(newCustomerNumber(new Set(), () => 0), "OA-10000");
  assert.equal(newCustomerNumber(new Set(), () => 0.99999), "OA-99999");
  const sequence = [0, 0, 0.5];
  assert.equal(newCustomerNumber(new Set(["OA-10000"]), () => sequence.shift()), "OA-55000");
  assert.equal(newCustomerNumber(new Set(["OA-10000"]), () => 0), null);
  for (let index = 0; index < 50; index++) assert.match(newCustomerNumber(new Set()), /^OA-[1-9]\d{4}$/);
  // Service's check on organizations.customer_number.
  assert.match(newCustomerNumber(new Set()), /^OA-[A-Z0-9]{4,20}$/);
});

test("Claude learns the outcome of a customer proposal only from the hub's note", () => {
  const view = { kind: "customer.create", id: "x", expiresAt: "", company: "Muster GmbH" };
  assert.match(customerNote(view, "saved", "Angelegt: Muster GmbH · OA-12345."), /neuer Kunde „Muster GmbH“\) wurde vom Nutzer angelegt\. Angelegt: Muster GmbH · OA-12345\./);
  assert.match(customerNote(view, "discarded"), /verworfen, nichts angelegt/);
  assert.match(customerNote(view, "open"), /noch nicht angelegt/);
});

test("creating checks the admin, claims once, uses the server key only for Service and logs it", async () => {
  const actions = await source("lib/hub-assistant/actions.ts");
  assert.match(actions, /claim<CustomerProposal>\(ctx, id, "customer\.create"\)/);
  assert.match(actions, /ctx\.db\.from\("organizations"\)\.insert\(\{ customer_number: number, name: proposal\.company, kind: "client", status: "active", plan_id: choice\.planId \}\)/);
  assert.match(actions, /\.from\("plans"\)\.select\("id"\)\.eq\("id", choice\.planId\)\.eq\("is_active", true\)/);
  assert.match(actions, /action: "hub\.customer_created", target_type: "organization"/);
  // The login goes through the user management, whose assignment also gives Service access.
  assert.match(actions, /await createHubUser\(\{ email: proposal\.login\.email, [^}]*role: "oalab_customer", customer: \{ mode: "existing", customerId \}, mailLink: choice\.mail \}\)/);
  const route = await source("app/api/assistant/route.ts");
  assert.match(route, /block\.name === "propose_customer" \? await proposeCustomer\(/);
  assert.match(route, /saveProposal\(userId, "customer\.create", \{ organizationId: null, projectId: null \}, prepared\.proposal\)/);
  assert.match(await source("lib/hub-assistant/knowledge.ts"), /Neue Kunden schlägst du mit propose_customer vor/);
});
