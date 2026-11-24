import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HUB_TEAM_ROLE, INTERNAL_TAG, TEAM_MESSAGE_MAX, TEAM_SIGHT_LABELS, TEAM_SIGHTS, cleanTeamMessage, entryTag, fileAudienceOfTeamSight, isTeamKind, teamRoleOf, teamRoleText, teamSightOfFile, teamSightOfNote, writesProjects } from "../lib/hub-team/rules.ts";
import { TEAM_NOTE_LABELS, accessLabel, audienceChoices, audienceLabel, newPageAudience, newPageRights } from "../lib/hub-notes/rules.ts";
import { isReadInHub, notePageHref, skipsMail, teamNoteNotice } from "../lib/hub-notify/rules.ts";
import { noticeColumns } from "../lib/hub-notify/columns.ts";

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
  assert.match(await source("lib/hub-private-chat/server.ts"), /select\("id, company, customer_number, kind"\)\.neq\("kind", "team"\);/);
  assert.match(await source("lib/hub-private-chat/server.ts"), /\.eq\("id", customerId\)\.neq\("kind", "team"\)/);
  assert.match(await source("lib/hub-calendar/server.ts"), /customers\.data \?\? \[\]\)\.filter\(\(row\) => !isTeamKind\(row\.kind\)\)/);
  // Files: oalab only for admins and only with the migration of stage 2 (below).
  assert.match(await source("lib/hub-files/server.ts"), /customers\.data \?\? \[\]\)\.filter\(\(row\) => !isTeamKind\(row\.kind\) \|\| \(canManage && row\.id === team\?\.id\)\)/);
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

// ---- Stage 2: notes, „Team informieren“, meeting notes of internal appointments, files (24.11.2026) ----------------

test("stage 2: oalab's pages and files know „Nur Team“ and „Team und Freelancer“ only", () => {
  assert.deepEqual(TEAM_SIGHTS, ["team", "freelancer"]);
  assert.deepEqual(TEAM_SIGHT_LABELS, { team: "Nur Team", freelancer: "Team und Freelancer" });
  // The notes' own words are the same (lib/hub-notes/rules.ts stays self-contained).
  assert.deepEqual(TEAM_NOTE_LABELS, TEAM_SIGHT_LABELS);
  // Notes store „Team und Freelancer“ as „Nur Freelancer“; anything a customer would see counts as with freelancers.
  assert.deepEqual(["team", "freelancer", "both", "customer"].map(teamSightOfNote), ["team", "freelancer", "freelancer", "team"]);
  // Files store „Nur Team“ as „Nur Kunde“: the team entry never has members.
  assert.deepEqual(["customer", "freelancer", "both", undefined].map(teamSightOfFile), ["team", "freelancer", "freelancer", "team"]);
  assert.deepEqual(TEAM_SIGHTS.map(fileAudienceOfTeamSight), ["customer", "freelancer"]);
  assert.deepEqual(audienceChoices(false, true), ["team", "freelancer"]);
  assert.deepEqual(audienceChoices(true, true), ["team", "freelancer"], "freelancers of customers never widen oalab's choices");
  assert.equal(audienceLabel("freelancer", false, true), "Team und Freelancer");
  assert.equal(audienceLabel("team", false, true), "Nur Team");
  assert.equal(accessLabel({ audience: "freelancer", customerEdits: false, freelancerEdits: true }, false, true), "Team und Freelancer");
  assert.equal(accessLabel({ audience: "team", customerEdits: false, freelancerEdits: false }, true, true), "Nur Team");
  // Customers keep their four levels.
  assert.equal(audienceLabel("freelancer", true), "Nur Freelancer");
});

test("stage 2: a new internal page starts with „Nur Team“, a subpage takes its parent's level, nobody of a customer edits", () => {
  const settings = { defaultAudience: "both", customerAccess: "edit" };
  assert.deepEqual(newPageRights("admin", null, settings, false, true), { audience: "team", customerEdits: false, freelancerEdits: false });
  assert.deepEqual(newPageRights("admin", { audience: "freelancer", customerEdits: false, freelancerEdits: true }, settings, false, true), { audience: "freelancer", customerEdits: false, freelancerEdits: true });
  assert.equal(newPageRights("admin", { audience: "both", customerEdits: true, freelancerEdits: false }, settings, false, true).customerEdits, false);
  assert.equal(newPageAudience("admin", null, settings, false, true), "team");
  assert.equal(newPageAudience("admin", { audience: "freelancer" }, settings, false, true), "freelancer");
  // Customers keep the default of the notes.
  assert.equal(newPageAudience("admin", null, settings, true), "both");
});

test("stage 2: „Team informieren“ is one line for the other admins, with the optional sentence", () => {
  const notice = teamNoteNotice({ title: "Wochenplanung", customerId: "t1", pageId: "p1", author: "Lea Brandt", message: "Bitte bis Freitag ergänzen." });
  assert.deepEqual(notice, { kind: "note.team", title: "Lea Brandt hat „Wochenplanung“ geteilt", body: "Bitte bis Freitag ergänzen.", href: notePageHref("t1", "p1") });
  assert.equal(teamNoteNotice({ title: "Wochenplanung", customerId: "t1", pageId: "p1", author: "" }).title, "Jemand aus dem Team hat „Wochenplanung“ geteilt");
  assert.equal(teamNoteNotice({ title: "Wochenplanung", customerId: "t1", pageId: "p1", author: "Lea" }).body, "Interne Notiz unter Projekte › Notizen");
  // Read in the hub (opening the page reads it), it needs no mail.
  assert.equal(isReadInHub("note.team"), true);
  assert.equal(skipsMail({ kind: "note.team", read_at: "2026-11-24T10:00:00Z" }), true);
  assert.deepEqual(noticeColumns(notice, "admin"), { where: INTERNAL_TAG, path: "Projekte › Notizen", title: "„Wochenplanung“ geteilt", body: "Bitte bis Freitag ergänzen.", from: "Lea Brandt", fromDetail: "Team" });
  assert.equal(noticeColumns(teamNoteNotice({ title: "Wochenplanung", customerId: "t1", pageId: "p1", author: "Lea" }), "admin").body, "");
  assert.equal(cleanTeamMessage("  Bitte\n  bis Freitag  "), "Bitte bis Freitag");
  assert.equal(cleanTeamMessage(undefined), "");
  assert.equal(cleanTeamMessage("x".repeat(TEAM_MESSAGE_MAX + 1)), null);
});

test("stage 2: without migration 202611240002 the hub shows oalab neither in notes nor in files", async () => {
  const server = await source("lib/hub-team/server.ts");
  assert.match(server, /db\.rpc\("hub_team_notes_ready"\)/);
  assert.match(server, /return !error && data === true;/);
  assert.match(server, /if \(!db \|\| !\(await teamNotesReady\(db\)\)\) return null;/);
  // Notes: only the admins' list takes the entry, first; freelancers and customers never.
  const notes = await source("lib/hub-notes/server.ts");
  assert.equal(notes.split("loadTeamNotesEntry(").length - 1, 1);
  assert.ok(notes.indexOf("loadTeamNotesEntry(ctx.db)") < notes.indexOf('if (ctx.viewer === "freelancer")'));
  assert.match(notes, /return \[\.\.\.internal, \.\.\.shown\.map/);
  // Files: only for admins; the calendar knows internal meeting notes only for admins.
  assert.match(await source("lib/hub-files/server.ts"), /kind: row\.kind === "freelancer" \? "freelancer" : isTeamKind\(row\.kind\) \? "team" : "customer"/);
  assert.match(await source("lib/hub-notes/calendar.ts"), /ctx\.viewer === "admin" \? loadTeamNotesEntry\(ctx\.db\) : null,/);
});

test("stage 2: internal pages stay internal: no customer audiences, no customer notices, „Team informieren“ instead", async () => {
  const write = await source("lib/hub-notes/write.ts");
  assert.match(write, /if \(customer\.team && \(!TEAM_NOTE_AUDIENCES\.includes\(target\.audience\) \|\| target\.customerEdits\)\) return fail\(/);
  assert.match(write, /if \(input\.notify !== false && !customer\.team\) \{/);
  assert.match(write, /if \(await teamOf\(ctx, page\.customerId\)\) return fail\("Bei internen Seiten von oalab gibt es „Team informieren“\."\);/);
  assert.match(write, /export async function notifyTeamAs\(ctx: NotesContext[^\n]*\n {2}if \(ctx\.viewer !== "admin"\) return fail\(/);
  // The sender never gets the line; a still unread line about the page takes the new one.
  const notify = await source("lib/hub-notify/server.ts");
  assert.match(notify, /const to = admins\.filter\(\(id\) => id !== input\.authorId\);/);
  assert.match(notify, /\.eq\("kind", "note\.team"\)\.eq\("href", notice\.href\)/);
  // Opening the page reads only the viewer's own line.
  assert.match(await source("lib/hub-notes/server.ts"), /\.eq\("kind", "note\.team"\)\.eq\("href", href\)\.eq\("user_id", ctx\.userId\)/);
  // Tasks from an internal page are never released to a customer.
  assert.match(await source("lib/hub-notes/tasks.ts"), /if \(customer\.team && input\.audience === "customer"\) return fail\(/);
  assert.match(await source("components/hub/screens/notes-tasks-ui.tsx"), /AUDIENCES\.filter\(\(item\) => !internal \|\| item\.id !== "customer"\)/);
  // The chat never gets a card for oalab (cards only for customers, decision 9).
  assert.match(await source("lib/hub-chat-events/server.ts"), /\(data\?\.kind \?\? "customer"\) === "customer"/);
});

test("stage 2: a meeting note of an appointment without a customer lands at oalab with „Nur Team“", async () => {
  const calendar = await source("lib/hub-notes/calendar.ts");
  assert.match(calendar, /const team = appointment\.data\.customer_id \? null : await loadTeamNotesEntry\(ctx\.db\);\n {2}const customerId = appointment\.data\.customer_id \?\? team\?\.id \?\? null;/);
  assert.match(calendar, /audience: "team", appointment_id: input\.appointmentId/);
  // From an internal page, an appointment is internal (no customer).
  assert.match(calendar, /customerId: internal \? "" : page\.customerId,/);
  assert.match(calendar, /return internal \? query\.is\("customer_id", null\) : query\.eq\("customer_id", input\.customerId\);/);
  // The calendar offers it for internal appointments once the database knows it.
  assert.match(await source("components/hub/screens/calendar.tsx"), /\(panelAppointment\.customer \? panelAppointment\.customer\.kind !== "freelancer" : notes\.internal \|\| Boolean\(notes\.byAppointment\[panelAppointment\.id\]\)\)/);
});

