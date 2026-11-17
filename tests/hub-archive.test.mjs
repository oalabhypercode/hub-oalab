import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileInSight, isArchivedCustomer, isArchivedOrganization, noArchive, withoutArchivedCustomers } from "../lib/hub-archive/rules.ts";

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/** The function `name` of a source file, up to the next top-level declaration. */
const functionOf = (code, name) => {
  const start = code.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, name);
  const next = code.slice(start + 1).search(/\n(export |async function |function |const |type )/);
  return code.slice(start, next < 0 ? undefined : start + 1 + next);
};

const archive = { customerIds: new Set(["c-archived", "f-archived"]), organizationIds: new Set(["o-archived"]) };

test("archive rules: what stays in sight", () => {
  assert.equal(isArchivedCustomer(archive, "c-archived"), true);
  assert.equal(isArchivedCustomer(archive, "c-live"), false);
  assert.equal(isArchivedCustomer(archive, null), false);
  assert.equal(isArchivedOrganization(archive, "o-archived"), true);
  assert.equal(isArchivedOrganization(archive, undefined), false);
  assert.deepEqual(withoutArchivedCustomers(archive, [{ id: "c-live" }, { id: "c-archived" }]).map((row) => row.id), ["c-live"]);
  // Unassigned files stay; a file only archived customers hold goes; a shared one stays.
  assert.equal(fileInSight(archive, []), true);
  assert.equal(fileInSight(archive, ["c-archived"]), false);
  assert.equal(fileInSight(archive, ["c-archived", "f-archived"]), false);
  assert.equal(fileInSight(archive, ["c-archived", "c-live"]), true);
  assert.equal(fileInSight(noArchive, ["c-archived"]), true);
});

test("the archive counts the hub's own and Service's, and survives a missing migration", async () => {
  const server = await source("lib/hub-archive/server.ts");
  assert.match(server, /db\.from\("organizations"\)\.select\("id"\)\.or\("status\.eq\.archived,archived_at\.not\.is\.null"\)/);
  assert.match(server, /db\.from\("hub_customers"\)\.select\("id, organization_id"\)\.not\("archived_at", "is", null\)/);
  // The hub customers of archived organizations count as archived too (a customer archived in Service or deleted).
  assert.match(server, /\.in\("organization_id", \[\.\.\.organizationIds\]\)/);
  assert.match(server, /customers\.error \? \[\] : customers\.data/, "without the column nothing is hidden instead of failing");
  assert.match(server, /export const loadArchive = cache\(/);
});

test("archived customers stay out of every screen but the user management", async () => {
  const places = [
    ["lib/hub-files/server.ts", [/canManage \? loadArchive\(\) : noArchive/, /\.filter\(\(row\) => !archive\.customerIds\.has\(row\.id\)\)/, /fileInSight\(archive, /, /\.filter\(\(row\) => !archive\.customerIds\.has\(row\.customer_id\)\)/]],
    ["lib/hub-projects/server.ts", [/admin \? readArchive\(db\) : noArchive/, /!archive\.organizationIds\.has\(row\.organization_id\)/, /&& !archive\.customerIds\.has\(row\.id\)\);/]],
    ["lib/hub-tasks/server.ts", [/const rows = \(projects\.data \?\? \[\]\)\.filter\(\(row\) => !archive\.organizationIds\.has\(row\.organization_id\)\);/, /\.filter\(\(entry\) => !archive\.customerIds\.has\(entry\.id\)\)/]],
    ["lib/hub-calendar/server.ts", [/canManage \? loadArchive\(\) : noArchive/, /!row\.customer \|\| !archive\.customerIds\.has\(row\.customer\.id\)/]],
    ["lib/hub-mcp/server.ts", [/readArchive\(db\)/, /!row\.customer \|\| !archive\.customerIds\.has\(row\.customer\.id\)/]],
    ["lib/hub-assistant/data.ts", [/readArchive\(db\)/, /\.filter\(\(row\) => !archive\.customerIds\.has\(row\.id\)\)/]],
    ["lib/hub-conversations/server.ts", [/\.not\("organization_id", "in", `\(\$\{\[\.\.\.archive\.organizationIds\]\.join\(","\)\}\)`\)/]],
    ["lib/hub-private-chat/server.ts", [/viewer\.side === "oalab" \? loadArchive\(\) : noArchive/]],
    ["lib/hub-contracts/server.ts", [/readArchive\(db\)/, /shown\(domainMail\.domains\)/, /shown\(serviceQuota\.customers\)/, /!archive\.customerIds\.has\(row\.customer_id\)/]],
    ["lib/hub-keychain/server.ts", [/readArchive\(db\)/, /\.filter\(inSight\)/]],
  ];
  for (const [file, patterns] of places) {
    const code = await source(file);
    for (const pattern of patterns) assert.match(code, pattern, `${file}: ${pattern}`);
  }
  // The board's freelancer view keeps its database rule as well (the projects of archived customers stay closed).
  assert.match(await source("lib/hub-tasks/server.ts"), /\.in\("id", ownIds\)\.neq\("status", "archived"\)/);
});

test("archive, restore and delete run in the database, behind the admin check", async () => {
  const actions = await source("lib/hub-users/actions.ts");
  const archiveAction = functionOf(actions, "archiveCustomer");
  assert.match(archiveAction, /const ctx = await context\(\);\n  if \(!ctx\) return denied;/);
  assert.match(archiveAction, /ctx\.db\.rpc\("hub_archive_customer", \{ target: entry\.id, actor: ctx\.actorId \}\)/);
  assert.match(archiveAction, /await setSignIn\(ctx, logins, true\)/, "the blocked logins cannot sign in any more");
  const restoreAction = functionOf(actions, "restoreCustomer");
  assert.match(restoreAction, /ctx\.db\.rpc\("hub_restore_customer", \{ target: entry\.id, actor: ctx\.actorId \}\)/);
  assert.match(restoreAction, /await setSignIn\(ctx, logins, false\)/);

  const remove = functionOf(actions, "deleteCustomer");
  assert.match(remove, /const ctx = await context\(\);\n  if \(!ctx\) return denied;/);
  // The typed number is checked before anything happens, and the database checks it once more.
  assert.ok(remove.indexOf("if (typed !== entry.customerNumber.toUpperCase()) return failed(mismatch);") < remove.indexOf('ctx.db.rpc("hub_delete_customer"'));
  assert.match(remove, /ctx\.db\.rpc\("hub_delete_customer", \{ target: entry\.id, actor: ctx\.actorId, confirm_number: entry\.customerNumber \}\)/);
  // The stored bytes go after the records, the logo too; the logins Service still needs are blocked.
  assert.match(remove, /ctx\.db\.storage\.from\(HUB_FILES_BUCKET\)\.remove\(files\.slice\(start, start \+ 100\)\)/);
  assert.match(remove, /ctx\.db\.storage\.from\(LOGO_BUCKET\)\.remove\(\[result\.logo\]\)/);
  assert.match(remove, /await setSignIn\(ctx, blocked, true\)/);
  // The entry is gone: the log names its number and points nowhere (its foreign key would refuse the row).
  assert.match(remove, /await log\(ctx, entry\.kind === "freelancer" \? "freelancer\.deleted" : "customer\.deleted", `\$\{entryWord\(entry\)\} \$\{entry\.customerNumber\} endgültig gelöscht/);
  assert.doesNotMatch(remove, /customer\.deleted"[^\n]*\{ customerId/);

  const preview = functionOf(actions, "previewCustomerRemoval");
  assert.match(preview, /const ctx = await context\(\);\n  if \(!ctx\) return denied;/);
  assert.doesNotMatch(preview, /\.(insert|update|delete|upsert)\(/, "the preview only reads");
});

test("links to archived entries stay when a customer or freelancer is saved", async () => {
  const actions = await source("lib/hub-users/actions.ts");
  const links = actions.slice(actions.indexOf("async function replaceLinks("), actions.indexOf("/** Logins with team access"));
  assert.match(links, /const archive = await readArchive\(ctx\.db\);/);
  assert.match(links, /uuid\.test\(id\) && !archive\.customerIds\.has\(id\)/, "no new link to an archived entry");
  assert.match(links, /!wanted\.includes\(id\) && !archive\.customerIds\.has\(id\)/, "the form does not offer them, so their links stay");
});

test("the user management lists archived entries apart and offers archive, restore and delete", async () => {
  const screen = await source("components/hub/screens/users.tsx");
  assert.match(screen, /const customers = allCustomers\.filter\(\(entry\) => !entry\.archivedAt\);/);
  assert.match(screen, /const \[archiveOpen, setArchiveOpen\] = useState\(\(\) => Boolean\(linked\?\.archivedAt\)\);/, "the group starts folded");
  assert.match(screen, /<TableGroup colSpan=\{colSpan\} label="Archiviert"/);
  assert.match(screen, /customers=\{choiceEntries\}/, "a new login never lands at an archived entry");
  assert.match(screen, /<ReviewPanel [^\n]*customers=\{liveEntries\}/);

  const dialogs = await source("components/hub/screens/users-dialogs.tsx");
  assert.equal((dialogs.match(/const removal = useEntryRemoval\(\{ entry: (customer|freelancer), users, onNotice, onClose \}\);/g) ?? []).length, 2);
  assert.equal((dialogs.match(/\{removal\.notice\}/g) ?? []).length, 2);
  assert.equal((dialogs.match(/\{removal\.section\}/g) ?? []).length, 2);

  const removal = await source("components/hub/screens/users-removal.tsx");
  assert.match(removal, /disabled=\{busy !== null \|\| !matches \|\| !preview\}/, "delete waits for the preview and the typed number");
  assert.match(removal, /const matches = typed\.trim\(\)\.toUpperCase\(\) === entry\.customerNumber\.toUpperCase\(\);/);
  assert.match(removal, /\}Jetzt archivieren<\/button>/);
  assert.match(removal, /\}Wiederherstellen<\/button>/);
  assert.match(removal, /\}Endgültig löschen<\/button>/);
});

test("the assistant knows archive and delete, and the patch notes keep them internal", async () => {
  const knowledge = await source("lib/hub-assistant/knowledge.ts");
  assert.match(knowledge, /- Archivieren oder löschen \(nur Admin, ganz unten in den Stammdaten/);
  assert.doesNotMatch(knowledge, /Importierte Kunden lassen sich bearbeiten, aber nicht löschen/);
  assert.doesNotMatch(knowledge.slice(knowledge.indexOf("## Noch nicht verfügbar (geplant)")), /Kunden löschen/);
  const { patchPackages } = await import("../lib/patch-notes.ts");
  const entries = patchPackages.flatMap((item) => item.changes).filter((change) => /archivieren|löschen|bleiben weg/i.test(change.title));
  assert.ok(entries.length >= 3);
  for (const entry of entries.filter((change) => /Kunden (archivieren|endgültig löschen)|bleiben weg/.test(change.title))) assert.equal(entry.customers, undefined, entry.title);
});
