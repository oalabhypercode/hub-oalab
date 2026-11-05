import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { freelancerNumberRefusal, hubRoles, isHubRole, kindForRole, randomFreeNumber, roleForKind, roleLabels } from "../lib/hub-users/rules.ts";
import { isFreelancerLogin, secondFactorMethod, secondFactorPending, secondFactorRequired } from "../lib/hub-auth/second-factor.ts";
import { loginCodeMail } from "../lib/hub-mail/templates.ts";

// Freelancers (decision of 4.11.2026): a third role, only in the hub. A freelancer entry gets customers assigned by the
// oalab team, gets files like a customer and reads the files its customers share with it.

const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("freelancers are a third role, and each kind of entry has its own role", () => {
  assert.deepEqual([...hubRoles], ["oalab_customer", "oalab_freelancer", "oalab_admin"]);
  assert.equal(roleLabels.oalab_freelancer, "Freelancer");
  assert.equal(isHubRole("oalab_freelancer"), true);
  assert.equal(roleForKind("freelancer"), "oalab_freelancer");
  assert.equal(roleForKind("customer"), "oalab_customer");
  assert.equal(kindForRole("oalab_freelancer"), "freelancer");
  assert.equal(kindForRole("oalab_customer"), "customer");
  assert.equal(kindForRole("oalab_admin"), null);
});

test("freelancer numbers start with FL- and are free random numbers like the customers' OA- ones", () => {
  assert.equal(freelancerNumberRefusal("FL-48213"), null);
  for (const number of ["OA-48213", "FL-12", "fl-48213", "FL48213"]) assert.ok(freelancerNumberRefusal(number), number);
  const taken = new Set(["FL-10000"]);
  const numbers = [0, 0, 0.5];
  assert.equal(randomFreeNumber("FL", taken, () => numbers.shift()), "FL-55000");
  assert.equal(randomFreeNumber("FL", new Set(Array.from({ length: 90000 }, (_, index) => `FL-${10000 + index}`))), null);
});

test("freelancers always confirm with a code: by e-mail unless they chose the app, never switched off", () => {
  const freelancer = { app_role: "oalab_freelancer" };
  assert.equal(secondFactorRequired(freelancer), true);
  assert.equal(secondFactorRequired({ app_role: "oalab_customer" }), false);
  assert.equal(secondFactorMethod(freelancer, false), "email");
  assert.equal(secondFactorMethod({ ...freelancer, second_factor: "totp" }, true), "totp");
  assert.equal(secondFactorMethod({ app_role: "oalab_customer" }, false), null);
  // The proxy sends a freelancer who signed in with the password alone to the code page.
  assert.equal(secondFactorPending({ aal: "aal1", app_metadata: freelancer }, false), true);
  assert.equal(secondFactorPending({ aal: "aal2", app_metadata: freelancer }, false), false);
  return Promise.all([source("lib/hub-auth/second-factor-actions.ts"), source("lib/hub-users/actions.ts")]).then(([own, admin]) => {
    assert.match(own, /if \(choice === "off" && secondFactorRequired\(login\.user\.app_metadata\)\) return failed\(/);
    assert.match(admin, /if \(choice === "off" && roleOf\(user\) === "oalab_freelancer"\) return failed\(/);
    assert.match(admin, /app_metadata: role === "oalab_freelancer" \? \{ app_role: role, second_factor: "email" \} : \{ app_role: role \}/);
    assert.match(admin, /if \(role === "oalab_freelancer" && metadata\.second_factor !== "totp"\) metadata\.second_factor = "email";/);
  });
});

test("freelancers live only in the hub: no Service organization, no team access, the kind of every entry checked", async () => {
  const actions = await source("lib/hub-users/actions.ts");
  // A new freelancer is a hub entry of its own kind, never a Service organization.
  const create = actions.slice(actions.indexOf("async function createFreelancerEntry"), actions.indexOf("type LinkSide"));
  assert.match(create, /kind: "freelancer"/);
  assert.match(create, /servicePackages: \[\]/);
  assert.doesNotMatch(create, /organizations/);
  // An existing entry must be of the role's kind; logins with Service team access never become freelancers.
  assert.match(actions, /if \(await kindOf\(ctx, data\.id\) !== kind\) return failed\(/);
  assert.match(actions, /if \(await hasServiceTeamAccess\(ctx, user\.id\)\) return failed\(/);
  // Customers are assigned only by admins, through the context that checked the admin first.
  for (const name of ["saveFreelancer", "setCustomerFreelancers"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    assert.equal(body.split("\n").slice(1, 3).join("\n"), "  const ctx = await context();\n  if (!ctx) return denied;", name);
  }
});

test("the user management knows freelancers only once the database does, and reads them on their own", async () => {
  const server = await source("lib/hub-users/server.ts");
  assert.match(server, /const ready = !kinds\.error && !links\.error;/);
  assert.match(server, /freelancers: freelancerLinks\.ready,/);
  // CUSTOMER_COLUMNS (and with it the account of every login) stays without the new column.
  assert.doesNotMatch(server.match(/const CUSTOMER_COLUMNS = "[^"]+"/)[0], /kind/);
  const screen = await source("components/hub/screens/users.tsx");
  assert.match(screen, /freelancers=\{state\.freelancers \? freelancers\.length : null\}/);
});

test("the asset management: freelancers read, admins set who looks after a customer and who sees a file", async () => {
  const am = await source("components/hub/screens/asset-management.tsx");
  // A freelancer organises folders only in their own files; the "Ablage" stays with the admins.
  assert.match(am, /const canOrganize = !freelancerView \|\| \(current !== null && current\.id === ownId\);/);
  assert.match(am, /\{!term && !freelancerView && pinned\(\{ kind: "inbox" \}/);
  assert.match(am, /canFile=\{\(customerId\) => !freelancerView \|\| customerId === ownId\}/);
  // Upload, logo and "Betreut von" need the admin's upload right; the audience only goes through the server.
  assert.match(am, /\{canUpload && fileState\.freelancers && current\.kind !== "freelancer" && freelancerEntries\.length > 0 && \(/);
  const actions = await source("lib/hub-files/actions.ts");
  const audience = actions.slice(actions.indexOf("export async function setFileAudience"));
  assert.match(audience, /const db = await verifyHubAdmin\(\) \? createAdminClient\(\) : null;\n {2}if \(!db\) return denied;/);
  const files = await source("lib/hub-files/server.ts");
  // Before the migration the new columns are missing: the files load as before.
  assert.match(files, /const files = missingColumn\(firstFiles\.error\) \? await readFiles\("folder_id"\) : firstFiles;/);
});

test("freelancers have no projects and no way to the service platform in the hub", async () => {
  const sidebar = await source("components/hub/glass-sidebar.tsx");
  assert.match(sidebar, /categoryOrder\.filter\(\(id\) => !\(account\.freelancer && id === "projects"\)\)/);
  const chat = await source("components/hub/screens/private-chat.tsx");
  assert.match(chat, /\{!admin && !freelancer && \(/);
  const overview = await source("components/hub/screens/overview.tsx");
  assert.match(overview, /\? <FreelancerCard customers=/);
  const cards = await source("components/hub/cards.tsx");
  const card = cards.slice(cards.indexOf("export function FreelancerCard"), cards.indexOf("/** Rule-based summary"));
  assert.doesNotMatch(card, /SERVICE_PLATFORM_URL/);
});

test("code mail and code page leave the service platform out for freelancers", async () => {
  // 5.11.2026: both said "im Hub und auf der Serviceplattform", where freelancers never get in.
  assert.equal(isFreelancerLogin({ app_role: "oalab_freelancer" }), true);
  assert.equal(isFreelancerLogin({ app_role: "oalab_customer" }), false);
  const issuedAt = new Date("2026-11-05T00:04:30Z");
  const freelancer = loginCodeMail({ firstName: "Fiona", code: "042917", minutes: 10, issuedAt, hubOnly: true });
  assert.match(freelancer.text, /um deine Anmeldung im oalab Client Hub zu bestätigen\./);
  assert.doesNotMatch(freelancer.text, /Serviceplattform/);
  assert.match(loginCodeMail({ firstName: "Jana", code: "042917", minutes: 10, issuedAt }).text, /im oalab Client Hub und auf der Serviceplattform/);
  const actions = await source("lib/hub-auth/actions.ts");
  assert.match(actions, /if \(session\) await issueMailCode\(session, isFreelancerLogin\(data\.user\?\.app_metadata\)\);/);
  assert.match(actions, /const issued = await issueMailCode\(session, isFreelancerLogin\(state\.user\.app_metadata\)\);/);
  assert.match(await source("app/auth/mfa/page.tsx"), /hubOnly: isFreelancerLogin\(user\?\.app_metadata\)/);
  const form = await source("components/auth-form.tsx");
  assert.match(form, /const place = secondFactor\?\.hubOnly \? "im Hub" : "im Hub und auf der Serviceplattform";/);
  const description = form.slice(form.indexOf("const description = mode"), form.indexOf("const action = mode"));
  assert.doesNotMatch(description, /Serviceplattform/);
});
