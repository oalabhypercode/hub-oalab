import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  audienceChoices, audienceLabel, cleanIcon, cleanNoteTitle, descendantsOf, fitAudience, gains, isSafeHref, meet, narrowedBelow, newPageAudience, noteText,
  pathOf, plainDoc, statusTone, validateNoteDoc, viewerEdits, viewerReads, within,
} from "../lib/hub-notes/rules.ts";
import { EMOJIS, emojiCode, emojiSrc, searchEmojis, stripVariation } from "../lib/hub-notes/emoji.ts";
import { GALLERY_COVERS, nextCoverPosition } from "../lib/hub-notes/covers.ts";
import { filterTasks, isTaskFilter, taskAudienceFor } from "../lib/hub-notes/rules.ts";
import { checkPreviewUrl, isPrivateAddress, readPreview } from "../lib/hub-notes/link-guard.ts";
import { meetingDate, noteTemplate, TEMPLATE_CHOICES } from "../lib/hub-notes/templates.ts";
import { noteNotice } from "../lib/hub-notify/rules.ts";

const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const page = (id, audience, parentId = null, title = id) => ({ id, audience, parentId, title, position: 0 });

test("Sichtbar für: four levels, a subpage at most as visible as its parent, narrower parents take their subpages along", () => {
  assert.deepEqual(audienceChoices(true), ["team", "both", "customer", "freelancer"]);
  // Customers without a freelancer see two levels: „Nur Team“ and „Kunde“ (stored as „Nur Kunde“).
  assert.deepEqual(audienceChoices(false), ["team", "customer"]);
  assert.equal(audienceLabel("customer", false), "Kunde");
  assert.equal(audienceLabel("team"), "Nur Team");
  assert.ok(within("team", "team") && within("customer", "both") && within("freelancer", "both") && within("team", "customer"));
  assert.ok(!within("both", "customer") && !within("freelancer", "customer") && !within("customer", "team"));
  assert.equal(meet("both", "customer"), "customer");
  assert.equal(meet("freelancer", "customer"), "team");
  assert.deepEqual(gains("team", "both"), { customer: true, freelancer: true });
  assert.deepEqual(gains("both", "customer"), { customer: false, freelancer: false });
  assert.equal(fitAudience("both", false), "customer");
  assert.equal(fitAudience("freelancer", false), "team");
  const pages = [page("a", "both"), page("b", "both", "a"), page("c", "freelancer", "b"), page("d", "customer", "a")];
  assert.deepEqual(narrowedBelow(pages, "a", "customer").map(({ id, audience }) => `${id}:${audience}`), ["b:customer", "c:team"]);
  assert.deepEqual(narrowedBelow(pages, "a", "team").map(({ id, audience }) => `${id}:${audience}`), ["b:team", "c:team", "d:team"]);
  assert.deepEqual(narrowedBelow(pages, "a", "both"), []);
  assert.deepEqual(descendantsOf(pages, "a").map((item) => item.id), ["b", "c", "d"]);
  assert.deepEqual(pathOf(pages, "c").map((item) => item.id), ["a", "b", "c"]);
});

test("who reads and writes what, as the database decides", () => {
  assert.ok(viewerReads("admin", "team"));
  assert.ok(viewerReads("customer", "both") && viewerReads("customer", "customer"));
  assert.ok(!viewerReads("customer", "team") && !viewerReads("customer", "freelancer"));
  assert.ok(viewerReads("freelancer", "both") && viewerReads("freelancer", "freelancer"));
  assert.ok(!viewerReads("freelancer", "customer") && !viewerReads("freelancer", "team"));
  // Freelancers write only pages „Nur Freelancer“; customers write nothing in steps 1 to 3.
  assert.ok(viewerEdits("freelancer", "freelancer") && !viewerEdits("freelancer", "both"));
  assert.ok(!viewerEdits("customer", "customer"));
  const settings = { defaultAudience: "both" };
  assert.equal(newPageAudience("admin", null, settings, true), "both");
  assert.equal(newPageAudience("admin", null, settings, false), "customer");
  assert.equal(newPageAudience("admin", { audience: "team" }, settings, true), "team", "a subpage takes its parent's level");
  assert.equal(newPageAudience("freelancer", null, settings, true), "freelancer");
});

test("documents: JSON with known blocks only, links only https: and mailto:, attributes checked, text and references read", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2, evil: "x" }, content: [{ type: "text", text: "Ziele" }] },
      { type: "paragraph", content: [
        { type: "text", text: "Siehe " },
        { type: "text", text: "Styleguide", marks: [{ type: "link", attrs: { href: "https://www.figma.com/", target: "_blank", rel: "noopener noreferrer nofollow", class: "x", onclick: "alert(1)" } }] },
        { type: "text", text: " und ", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
        { type: "noteEmoji", attrs: { char: "🚀" } },
      ] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Erledigt" }] }] }] },
      { type: "noteCallout", attrs: { emoji: "<b>" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Hinweis" }] }] },
      { type: "noteSubpage", attrs: { refKind: "page", refId: "11111111-2222-4333-8444-555555555555" } },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colType: "status" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Stand" }] }] }] }] },
    ],
  };
  const result = validateNoteDoc(doc);
  assert.equal(result.ok, true);
  const [heading, paragraph, , callout] = result.doc.content;
  assert.deepEqual(heading.attrs, { level: 2 }, "unknown attributes fall away");
  assert.deepEqual(paragraph.content[1].marks, [{ type: "link", attrs: { href: "https://www.figma.com/", target: "_blank", rel: "noopener noreferrer nofollow" } }]);
  assert.equal(paragraph.content[2].marks, undefined, "a javascript: link loses its link, the text stays");
  assert.deepEqual(callout.attrs, { emoji: "" }, "no markup as an emoji");
  assert.equal(result.doc.content[5].content[0].content[0].attrs.colType, "status");
  assert.match(result.text, /Ziele\nSiehe Styleguide und 🚀\nErledigt\nHinweis/);
  assert.deepEqual(result.refs, [{ kind: "page", id: "11111111-2222-4333-8444-555555555555" }]);
  // Unknown blocks are refused, as are HTML strings and documents over 1 MB.
  assert.equal(validateNoteDoc({ type: "doc", content: [{ type: "iframe", attrs: { src: "https://x" } }] }).ok, false);
  assert.equal(validateNoteDoc("<p>Hallo</p>").ok, false);
  assert.equal(validateNoteDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(1_000_001) }] }] }).ok, false);
  assert.equal(validateNoteDoc({ type: "doc", content: [{ type: "noteEmoji", attrs: {} }] }).ok, false, "an emoji needs its character");
  assert.equal(noteText({ type: "doc", content: [{ type: "paragraph" }] }), "");
});

test("titles, icons and links are checked like the database does", () => {
  assert.equal(cleanNoteTitle("  Kickoff   Website  "), "Kickoff Website");
  assert.equal(cleanNoteTitle("   "), null);
  assert.equal(cleanNoteTitle("x".repeat(201)), null);
  assert.equal(cleanIcon("🧑‍💻"), "🧑‍💻");
  assert.equal(cleanIcon(""), "");
  assert.equal(cleanIcon("<b>"), null);
  assert.equal(cleanIcon("A"), null);
  assert.ok(isSafeHref("https://oalab.de/") && isSafeHref("mailto:team@example.com"));
  for (const bad of ["http://oalab.de", "javascript:alert(1)", "data:text/html,x", "https://a b", "//oalab.de"]) assert.ok(!isSafeHref(bad), bad);
});

test("emojis: German names, the same image on every device, served by the hub itself (Fluent Emoji, MIT)", async () => {
  assert.equal(searchEmojis("rakete")[0].char, "🚀");
  assert.equal(searchEmojis("bluete").length >= 1, true, "ä, ö, ü and ß match their spelling with e and ss");
  assert.equal(searchEmojis("xyz").length, 0);
  assert.equal(emojiCode("🧑‍💻"), "1f9d1-200d-1f4bb");
  assert.equal(stripVariation("✍️"), "✍");
  assert.equal(emojiSrc("😀"), "/emoji/fluent/1f600.webp");
  assert.equal(emojiSrc("🦄"), null, "emojis outside the set stay characters");
  assert.equal(new Set(EMOJIS.map((entry) => entry.char)).size, EMOJIS.length, "no emoji twice");
  for (const entry of EMOJIS) assert.ok(existsSync(new URL(`../public/emoji/fluent/${emojiCode(entry.char)}.webp`, import.meta.url)), `image for ${entry.char}`);
  assert.match(await source("public/emoji/fluent/LICENSE.txt"), /MIT License[\s\S]*Copyright \(c\) Microsoft Corporation/);
  // The images come from the hub itself and skip the sign-in check like every other image.
  assert.match(await source("proxy.ts"), /webp/);
});

test("covers: the gallery is drawn with CSS, no image from elsewhere", async () => {
  const css = await source("app/notes.css");
  for (const cover of GALLERY_COVERS) assert.match(css, new RegExp(`\\.nz-cv-${cover.key} \\{`), cover.key);
  assert.doesNotMatch(css, /url\("?https?:/);
  assert.equal(nextCoverPosition(50), 0);
  assert.equal(nextCoverPosition(100), 50);
  assert.equal(statusTone("umgesetzt"), "ok");
  assert.equal(statusTone("in Arbeit"), "info");
  assert.equal(statusTone("offen"), "todo");
  assert.equal(statusTone("verworfen"), "off");
});

test("the page saves on its own without reloading the hub, and reads and writes with the person's own session", async () => {
  const actions = await source("lib/hub-notes/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.doesNotMatch(actions, /refreshWorkspace|revalidatePath|revalidateTag|refresh\(/, "autosave must not re-render the page");
  const write = await source("lib/hub-notes/write.ts");
  assert.match(write, /\.update\(row\)\.eq\("id", input\.id\)\.eq\("version", input\.version\)/, "a save is written only while its version holds");
  assert.match(write, /stale: true, current/);
  assert.doesNotMatch(write, /ctx\.db\.from\("hub_note_pages"\)/, "pages are never written with the server key");
  const server = await source("lib/hub-notes/server.ts");
  assert.match(server, /ctx\.session\.from\("hub_note_pages"\)/);
  assert.match(server, /NOT_READY = "Notizen sind noch nicht eingerichtet/);
  // The editor loads only on the notes page.
  assert.match(await source("components/hub/screens/notes.tsx"), /dynamic\(\(\) => import\("\.\/notes-editor"\), \{ ssr: false/);
  // Tiptap's own normalising (the empty line at the end) does not save a page that was merely opened.
  assert.match(await source("components/hub/screens/notes-editor.tsx"), /if \(transaction\.steps\.length\) changeRef\.current/);
});

// ---- Step 2: tasks, links, trash, templates ----------------------------------------------------------------------

const TASK = "11111111-2222-4333-8444-555555555555";
const PROJECT = "aaaaaaaa-2222-4333-8444-555555555555";
const CUSTOMER = "cccccccc-2222-4333-8444-555555555555";

test("blocks from the hub carry only references: tasks, task lists, projects and link cards are checked", () => {
  const check = (block) => validateNoteDoc({ type: "doc", content: [block] });
  const group = check({ type: "noteTaskGroup", content: [{ type: "noteTaskItem", attrs: { refKind: "task", refId: TASK, number: 1031, title: "Titel aus dem Board" } }] });
  assert.equal(group.ok, true);
  assert.deepEqual(group.doc.content[0].content[0].attrs, { refKind: "task", refId: TASK, number: 1031 }, "a task's title is never stored in the note");
  assert.deepEqual(group.refs, [{ kind: "task", id: TASK }]);
  const mention = check({ type: "paragraph", content: [{ type: "noteTaskMention", attrs: { refKind: "task", refId: TASK, number: 1031 } }] });
  assert.equal(mention.text, "#1031");
  const list = check({ type: "noteTaskList", attrs: { refKind: "project", refId: PROJECT, filter: "evil", dueBy: "2026-13-40" } });
  assert.deepEqual(list.doc.content[0].attrs, { refKind: "project", refId: PROJECT, filter: "open" }, "an unknown filter falls back, a wrong date goes");
  assert.deepEqual(check({ type: "noteTaskList", attrs: { refKind: "project", refId: PROJECT, filter: "due", dueBy: "2026-11-30" } }).doc.content[0].attrs.dueBy, "2026-11-30");
  assert.deepEqual(check({ type: "noteProject", attrs: { refKind: "project", refId: PROJECT } }).refs, [{ kind: "project", id: PROJECT }]);
  assert.equal(check({ type: "noteTaskGroup", content: [{ type: "noteTaskItem", attrs: { refKind: "task", refId: "x" } }] }).ok, false, "a task row needs a real id");
  // Link cards: https only, a picture only from the hub's own storage.
  const card = { href: "https://example.org/a", title: "Titel", description: "Text", site: "example.org" };
  assert.equal(check({ type: "noteLinkCard", attrs: { ...card, image: `notes/${CUSTOMER}/links/${TASK}.webp` } }).doc.content[0].attrs.image, `notes/${CUSTOMER}/links/${TASK}.webp`);
  assert.equal(check({ type: "noteLinkCard", attrs: { ...card, image: "https://elsewhere.example/x.png" } }).doc.content[0].attrs.image, undefined);
  assert.equal(check({ type: "noteLinkCard", attrs: { ...card, href: "http://example.org/a" } }).ok, false);
  assert.equal(check({ type: "noteLinkCard", attrs: { ...card, href: "javascript:alert(1)" } }).ok, false);
});

test("task lists filter like the board, and a task from a note starts as visible as the page allows", () => {
  const tasks = [
    { id: "a", status: "todo", customerTurn: true, dueOn: "2026-11-25", assignees: [{ id: "u1" }] },
    { id: "b", status: "progress", customerTurn: false, dueOn: "2026-11-20", assignees: [{ id: "u2" }] },
    { id: "c", status: "done", customerTurn: true, dueOn: "2026-11-19", assignees: [{ id: "u1" }] },
    { id: "d", status: "todo", customerTurn: false, dueOn: null, assignees: [] },
  ];
  const ids = (list) => list.map((task) => task.id);
  assert.deepEqual(ids(filterTasks(tasks, "open", "u1")), ["a", "b", "d"], "done tasks never show");
  assert.deepEqual(ids(filterTasks(tasks, "customer", "u1")), ["a"]);
  assert.deepEqual(ids(filterTasks(tasks, "mine", "u1")), ["a"]);
  assert.deepEqual(ids(filterTasks(tasks, "due", "u1")), ["b", "a"], "by date, without undated ones");
  assert.deepEqual(ids(filterTasks(tasks, "due", "u1", "2026-11-22")), ["b"]);
  assert.ok(isTaskFilter("mine") && !isTaskFilter("all"));
  assert.equal(taskAudienceFor("team"), "team");
  for (const audience of ["both", "customer", "freelancer"]) assert.equal(taskAudienceFor(audience), "shared", "„+ Kunde“ is chosen on purpose");
});

test("link previews: only public web pages on the usual ports, read from their head", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "fe80::1", "fd12::1", "ff02::1", "64:ff9b::a00:1", "2001:db8::1", "2002:7f00:1::1", "2001::1", "localhost"]) {
    assert.ok(isPrivateAddress(address), address);
  }
  for (const address of ["8.8.8.8", "93.184.215.14", "2a00:1450:4001:82a::200e", "2606:4700::1111"]) assert.ok(!isPrivateAddress(address), address);
  assert.equal(checkPreviewUrl("https://example.org/seite").ok, true);
  assert.equal(checkPreviewUrl("http://example.org/").ok, true, "a redirect to https is checked again");
  for (const bad of ["http://example.org:8080/", "https://user:pw@example.org/", "https://localhost/", "https://intranet.local/", "https://127.0.0.1/", "https://[::1]/",
    "https://2130706433/", "https://0x7f.0.0.1/", "ftp://example.org/", "file:///etc/passwd", "x".repeat(3000)]) {
    assert.equal(checkPreviewUrl(bad).ok, false, bad);
  }
  const base = new URL("https://www.example.org/projekt/");
  const head = `<html><head><title>Fallback</title>
    <meta property="og:title" content="Neuer Auftritt &amp; mehr">
    <meta name="description" content="Kurz   und
      klar.">
    <meta property="og:site_name" content="Example">
    <meta property="og:image" content="/bilder/vorschau.png"></head><body>…</body></html>`;
  assert.deepEqual(readPreview(head, base), { title: "Neuer Auftritt & mehr", description: "Kurz und klar.", site: "Example", image: "https://www.example.org/bilder/vorschau.png" });
  assert.deepEqual(readPreview("<p>nichts</p>", base), { title: "example.org", description: "", site: "example.org", image: null });
  assert.equal(readPreview(`<meta property="og:image" content="javascript:alert(1)">`, base).image, null);
});

test("the server fetches a preview only through the guarded lookup, within limits, and stores the picture itself", async () => {
  const preview = await source("lib/hub-notes/link-preview.ts");
  assert.match(preview, /^import "server-only";/);
  assert.match(preview, /lookup: guardedLookup/);
  assert.match(preview, /isPrivateAddress\(entry\.address\)/);
  assert.match(preview, /const REDIRECTS = 3;/);
  assert.match(preview, /checked = checkPreviewUrl\(next\);/, "every redirect is checked like the first address");
  assert.match(preview, /const deadline = setTimeout\(\(\) => req\.destroy\(new Error\("TIMEOUT"\)\), TIMEOUT\)/);
  assert.match(preview, /!picture\.truncated/);
  const write = await source("lib/hub-notes/write.ts");
  assert.match(write, /`notes\/\$\{input\.customerId\.toLowerCase\(\)\}\/links\/\$\{crypto\.randomUUID\(\)\}\.webp`/);
  const refs = await source("lib/hub-notes/refs.ts");
  assert.match(refs, /path\.startsWith\(own\)/, "pictures are signed only from the page's own customer");
});

test("templates: meeting, briefing and acceptance are valid pages and end with an empty line", () => {
  assert.deepEqual(TEMPLATE_CHOICES.map((choice) => choice.id), ["blank", "meeting", "briefing", "acceptance"]);
  for (const choice of TEMPLATE_CHOICES) {
    const template = noteTemplate(choice.id);
    const checked = validateNoteDoc(template.doc);
    assert.equal(checked.ok, true, choice.id);
    assert.equal(template.doc.content.at(-1).type, "paragraph");
  }
  const meeting = noteTemplate("meeting", { title: "Abstimmung Startseite", date: "2026-11-02" });
  assert.equal(meeting.title, "Besprechung: Abstimmung Startseite");
  assert.match(JSON.stringify(meeting.doc), /Besprechung am Mo\., 2\. Nov\. 2026\./);
  assert.equal(meetingDate("kein Datum"), "");
  assert.equal(noteTemplate("meeting", { title: "x".repeat(300) }).title.length, 200);
});

test("notices: a released or changed note rings the bell of everybody who sees it, with a link to the page", async () => {
  const shared = noteNotice("note.shared", "Kickoff", CUSTOMER, TASK);
  assert.equal(shared.title, "Neue Notiz: Kickoff");
  assert.equal(shared.href, `/dashboard/projects/notes?customer=${CUSTOMER}&page=${TASK}`);
  assert.equal(noteNotice("note.changed", "Kickoff", CUSTOMER, TASK).title, "Notiz geändert: Kickoff");
  const write = await source("lib/hub-notes/write.ts");
  assert.match(write, /notifyNote\(/);
  const server = await source("lib/hub-notify/server.ts");
  assert.match(server, /export async function notifyNote\(/);
});

test("the trash keeps pages 30 days for the team; deleting a customer counts its notes and frees their pictures", async () => {
  const write = await source("lib/hub-notes/write.ts");
  assert.match(write, /const TRASH_DAYS = 30;/);
  assert.match(write, /set\(\{ deleted_at|deleted_at: new Date|\.update\(\{ deleted_at/);
  const users = await source("lib/hub-users/actions.ts");
  assert.match(users, /counted\(ctx\.db\.from\("hub_note_pages"\)\.select\("id", HEAD\)\.eq\("customer_id", id\)\)/);
  assert.match(users, /const images = await noteImages\(ctx\.db, entry\.id\);/);
  assert.match(await source("components/hub/screens/users-removal.tsx"), /count\(preview\.notes, "Notizseite", "Notizseiten"\)/);
});

test("tasks, projects and appointments point back to the notes that name them", async () => {
  for (const path of ["components/hub/screens/tasks-panel.tsx", "components/hub/screens/calendar-panels.tsx"]) {
    assert.match(await source(path), /<NoteMentions taskId=\{task\.id\} preview=\{preview\} \/>/, path);
  }
  assert.equal((await source("components/hub/screens/calendar-panels.tsx")).match(/<NoteMentions /g).length, 2, "the calendar shows them to the team and to customers");
  assert.match(await source("components/hub/screens/projects-side-panel.tsx"), /<ProjectNotes /);
  const actions = await source("lib/hub-notes/actions.ts");
  for (const name of ["taskMentions", "projectNotes", "createNoteTask", "setNoteTaskDone", "searchNoteTasks", "noteLinkPreview", "trashNotePage", "restoreNotePage", "purgeNotePage"]) {
    assert.match(actions, new RegExp(`export async function ${name}\\(`), name);
  }
  assert.equal((actions.match(/await notesContext\(\)/g) ?? []).length, (actions.match(/^export async function /gm) ?? []).length, "every action checks who asks");
});

// ---- Step 3: calendar, history, „bearbeitet gerade“, search ---------------------------------------------------------

test("appointments in a note are references only, and a freelancer sees „Termin (nicht sichtbar)“", async () => {
  const block = validateNoteDoc({ type: "doc", content: [{ type: "noteAppointment", attrs: { refKind: "appointment", refId: TASK, title: "Abstimmung", starts: "2026-11-02" } }] });
  assert.equal(block.ok, true);
  assert.deepEqual(block.doc.content[0].attrs, { refKind: "appointment", refId: TASK }, "title and time come from the calendar, never from the note");
  assert.deepEqual(block.refs, [{ kind: "appointment", id: TASK }]);
  assert.equal(validateNoteDoc({ type: "doc", content: [{ type: "noteAppointment", attrs: { refKind: "appointment" } }] }).ok, false);
  const refs = await source("lib/hub-notes/refs.ts");
  assert.match(refs, /ctx\.session\.from\("hub_appointments"\)\.select\("id, title, starts_at, ends_at, status, teams_url, customer_id"\)\.in\("id", wanted\.appointments\)/);
  assert.match(refs, /teamsUrl: status === "confirmed" \? row\.teams_url : null/);
  assert.match(await source("components/hub/screens/notes-refs.tsx"), /Termin \(nicht sichtbar\)/);
});

test("the calendar and the notes: one meeting note per appointment, appointments through the calendar's own code", async () => {
  const calendar = await source("lib/hub-notes/calendar.ts");
  assert.match(calendar, /^import "server-only";/);
  assert.match(calendar, /if \(ctx\.viewer !== "admin"\) return fail\("Besprechungsnotizen legt das oalab-Team an\."\);/);
  assert.match(calendar, /audience: "team", appointment_id: input\.appointmentId/);
  assert.match(calendar, /error\?\.code === "23505"/, "two people at once end up at the same note");
  assert.match(calendar, /await writeAppointment\(supabase, null,/);
  assert.match(calendar, /await requestAppointmentAs\(supabase, ctx\.userId,/);
  assert.match(calendar, /secondFactorMissing\(ctx\.session, data\.claims\.aal\)/, "a login with a second factor confirms it first, as in the calendar");
  assert.doesNotMatch(calendar, /ctx\.db\.from\("hub_(note_pages|appointments)"\)/, "notes and appointments are read with the person's own session");
  assert.match(calendar, /\.is\("appointment_id", null\)/, "meeting notes hang at their appointment, not as a second entry");
  const page = await source("app/dashboard/[section]/[detail]/page.tsx");
  assert.match(page, /await loadCalendarNotes\(calendarState\.appointments\.map\(\(item\) => item\.id\)/);
  const screen = await source("components/hub/screens/calendar.tsx");
  assert.match(screen, /useStoredValue\("oalab-calendar-notes", "on"\)/);
  assert.match(screen, /<MeetingNote appointmentId=\{panelAppointment\.id\} note=\{notes\.byAppointment\[panelAppointment\.id\] \?\? null\} canCreate=\{false\}/, "customers only open a shared note");
  const panels = await source("components/hub/screens/calendar-panels.tsx");
  assert.equal((panels.match(/\{extra\}/g) ?? []).length, 2);
});

test("history, „bearbeitet gerade“ and the search read with the person's session, the search without a filter expression", async () => {
  const history = await source("lib/hub-notes/history.ts");
  assert.match(history, /if \(ctx\.viewer !== "admin"\) return fail\("Den Verlauf sieht das oalab-Team\."\);/);
  assert.match(history, /ctx\.session\.rpc\("hub_restore_note_revision", \{ revision_id: input\.revisionId, expected_version: input\.version \}\)/);
  assert.match(history, /if \(input\.editing && ctx\.viewer !== "customer"\)/, "customers only read, they leave no mark");
  assert.equal((history.match(/\.ilike\(/g) ?? []).length, 2);
  assert.doesNotMatch(history, /\.or\(/, "the words never become part of a filter expression");
  const notes = await source("components/hub/screens/notes.tsx");
  assert.match(notes, /window\.setInterval\(\(\) => void beat\(\), 15_000\)/);
  assert.match(notes, /void notePresence\(\{ pageId, editing: false, leave: true \}\)/);
  const shell = await source("components/hub/app-shell.tsx");
  assert.match(shell, /searchNotes\(\{ query: term \}\)/);
  assert.doesNotMatch(shell, /from "@\/lib\/hub-notes\/fixtures"/, "the preview's examples load only in the preview");
});

test("a page goes to the server as plain JSON: the editor's attributes have no prototype, which a Server Action does not carry", async () => {
  // ProseMirror builds the attributes of blocks and marks with Object.create(null); React then sends "$T" instead of them.
  const bare = (values) => Object.assign(Object.create(null), values);
  const editorDoc = { type: "doc", content: [
    { type: "heading", attrs: bare({ level: 2 }), content: [{ type: "text", text: "Ziele", marks: [{ type: "link", attrs: bare({ href: "https://www.figma.com/" }) }] }] },
    { type: "noteLinkCard", attrs: bare({ href: "https://github.com/", title: "GitHub" }) },
  ] };
  const plain = plainDoc(editorDoc);
  const prototypes = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    prototypes.push(Object.getPrototypeOf(value));
    for (const child of Object.values(value)) walk(child);
  };
  walk(plain);
  assert.ok(prototypes.every((proto) => proto === Object.prototype || proto === Array.prototype), "every object and array is a plain one");
  assert.deepEqual(plain, JSON.parse(JSON.stringify(editorDoc)));
  const checked = validateNoteDoc(plain);
  assert.ok(checked.ok);
  assert.deepEqual(checked.doc.content[0].attrs, { level: 2 });
  assert.equal(checked.doc.content[0].content[0].marks[0].attrs.href, "https://www.figma.com/");
  assert.equal(checked.doc.content[1].attrs.href, "https://github.com/");

  // What arrives instead of an object (the placeholder) is refused, never dropped: no heading loses its level unnoticed.
  const placeholder = { type: "doc", content: [{ type: "heading", attrs: "$T", content: [{ type: "text", text: "Ziele" }] }] };
  assert.deepEqual(validateNoteDoc(placeholder), { ok: false, error: "Ein Block im Dokument ist unvollständig." });
  const proxy = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Link", marks: [{ type: "link", attrs: () => undefined }] }] }] };
  assert.equal(validateNoteDoc(proxy).ok, false);
  assert.ok(validateNoteDoc({ type: "doc", content: [{ type: "paragraph", attrs: null }] }).ok, "missing attributes stay fine");

  const notes = await source("components/hub/screens/notes.tsx");
  assert.match(notes, /saveNotePage\(\{ id: current\.id, version: versionRef\.current, patch: patch\.content \? \{ \.\.\.patch, content: plainDoc\(patch\.content\) \} : patch \}\)/);
  assert.equal((notes.match(/saveNotePage\(/g) ?? []).length, 1, "the only way a page is saved");
});
