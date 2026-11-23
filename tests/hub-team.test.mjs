import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HUB_TEAM_ROLE, INTERNAL_TAG, entryTag, isTeamKind, teamRoleOf, teamRoleText, writesProjects } from "../lib/hub-team/rules.ts";

// oalab as its own company in the hub (plan docs/planung/oalab-als-unternehmen.md, stage 1).
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("oalab's own entry is the kind team, tagged „Intern“", () => {
  assert.equal(isTeamKind("team"), true);
  for (const kind of ["customer", "freelancer", null, undefined, "Team"]) assert.equal(isTeamKind(kind), false);
  assert.equal(entryTag("team"), INTERNAL_TAG);
  assert.equal(entryTag("customer"), null);
});

test("the team role: the hub gives Operator, higher roles stay the service platform's", () => {
  assert.equal(HUB_TEAM_ROLE, "oalab_operator");
  assert.equal(teamRoleOf([]), "none");
  assert.equal(teamRoleOf([{ role: "oalab_operator", status: "active" }]), "hub");
  assert.equal(teamRoleOf([{ role: "oalab_operator", status: "suspended" }]), "paused");
  assert.equal(teamRoleOf([{ role: "oalab_operator", status: "revoked" }]), "none");
  assert.equal(teamRoleOf([{ role: "oalab_operator", status: "invited" }]), "none");
  assert.equal(teamRoleOf([{ role: "oalab_admin", status: "active" }]), "service");
  assert.equal(teamRoleOf([{ role: "oalab_release_manager", status: "active" }]), "service");
  // A higher role from the service platform wins over an Operator row in a second oalab organization.
  assert.equal(teamRoleOf([{ role: "oalab_operator", status: "active" }, { role: "oalab_admin", status: "active" }]), "service");
  // Client roles never count as a team role.
  assert.equal(teamRoleOf([{ role: "client_owner", status: "active" }]), "none");
  assert.deepEqual(["none", "hub", "service", "paused"].map(writesProjects), [false, true, true, false]);
  for (const state of ["none", "hub", "service", "paused"]) assert.ok(teamRoleText(state).length > 20, state);
  // „Operator“ also works on requests on the service platform: the switch says so.
  assert.match(teamRoleText("hub"), /Anfragen/);
});

test("oalab never becomes a customer: no chat, no calendar choice, no customer data written to its organization", async () => {
  assert.match(await source("lib/hub-private-chat/server.ts"), /select\("id, company, customer_number"\)\.neq\("kind", "team"\);/);
  assert.match(await source("lib/hub-private-chat/server.ts"), /\.eq\("id", customerId\)\.neq\("kind", "team"\)/);
  assert.match(await source("lib/hub-calendar/server.ts"), /customers\.data \?\? \[\]\)\.filter\(\(row\) => !isTeamKind\(row\.kind\)\)/);
  assert.match(await source("lib/hub-files/server.ts"), /customers\.data \?\? \[\]\)\.filter\(\(row\) => !isTeamKind\(row\.kind\)\)/);
  assert.match(await source("lib/hub-overview/server.ts"), /\(row\.kind \?\? "customer"\) === "customer"/);
  // Saving master data would rename the oalab organization on the service platform.
  const write = await source("lib/hub-users/customer-write.ts");
  assert.ok(write.indexOf("isTeamKind(entry.data?.kind)") < write.indexOf('from("organizations").update'));
  // The user management lists customers and freelancers; oalab stands apart as `team`.
  const users = await source("lib/hub-users/server.ts");
  assert.match(users, /const customerRows = allRows\.filter\(\(row\) => !freelancerLinks\.isTeam\(row\.id\) && row\.id !== teamEntry\?\.id\);/);
  // Customer actions never reach it: kindOf says null for the team entry.
  assert.match(await source("lib/hub-users/actions.ts"), /if \(!data \|\| isTeamKind\(data\.kind\)\) return null;/);
});

test("internal projects: created on the team entry, never released to a customer", async () => {
  const write = await source("lib/hub-projects/write.ts");
  assert.match(write, /const internal = isTeamKind\(customer\.data\?\.kind\);/);
  assert.match(write, /client_visible: !internal && input\.visible === true,/);
  assert.match(write, /organization\.data\?\.kind === "oalab"\) return \{ ok: false, error: "Das ist ein internes Projekt von oalab\./);
  // The board marks projects on the oalab organization and offers no „+ Kunde“ for them.
  assert.match(await source("lib/hub-tasks/server.ts"), /row\.kind === "oalab"/);
  assert.match(await source("components/hub/screens/tasks-panel.tsx"), /\.\.\.\(internal \? \[\] : \[\{ id: "customer" as const/);
  // Claude creates internal projects, but no contract, contacts or files for oalab.
  assert.match(await source("lib/hub-mcp/areas.ts"), /if \(data\.kind === "team"\) return null;/);
  assert.match(await source("lib/hub-mcp/writes.ts"), /const internal = await teamEntryOf\(w, read\.value\.customerId\);/);
});
