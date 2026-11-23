import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  audienceChoices, audienceLabel, cleanIcon, cleanNoteTitle, descendantsOf, fitAudience, gains, isSafeHref, meet, narrowedBelow, newPageAudience, noteText,
  pathOf, plainDoc, statusTone, validateNoteDoc, viewerEdits, viewerReads, within,
} from "../lib/hub-notes/rules.ts";
import { EMOJIS, emojiCode, emojiSrc, searchEmojis, stripVariation } from "../lib/hub-notes/emoji.ts";
import { coverWithLink, GALLERY_COVERS, keepCoverLink, nextCoverPosition } from "../lib/hub-notes/covers.ts";
import { filterTasks, isTaskFilter, taskAudienceFor } from "../lib/hub-notes/rules.ts";
import { checkPreviewUrl, isPrivateAddress, readPreview } from "../lib/hub-notes/link-guard.ts";
import { meetingDate, noteTemplate, TEMPLATE_CHOICES } from "../lib/hub-notes/templates.ts";
import { isNoteImageFolder, NOTE_IMAGE_FOLDERS_SQL, NOTE_IMAGE_GRACE_HOURS, NOTE_IMAGE_SWEEP_HOURS, NOTE_IMAGES_SQL, removableNoteImages } from "../lib/hub-notes/images.ts";
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

test("an uploaded cover or one from the files keeps its image after a reload, another page and a new position", async () => {
  const listed = { kind: "upload", value: "notes/c/1.webp", position: 50 };
  const open = { kind: "upload", value: "notes/c/1.webp", position: 50, url: "https://files.example/notes/c/1.webp?sig" };
  assert.deepEqual(coverWithLink(listed, open), { ...listed, url: open.url }, "the list has no link, the open page has one");
  assert.equal(coverWithLink(listed, { ...open, value: "notes/c/2.webp" }), listed, "another image keeps its own state");
  assert.equal(coverWithLink({ kind: "gallery", value: "ozean", position: 50 }, open).url, undefined);
  assert.equal(coverWithLink(null, open), null);
  const file = { kind: "file", value: "f1", position: 50, url: "https://files.example/f1?sig", name: "Moodboard" };
  assert.deepEqual(keepCoverLink(file, { kind: "file", value: "f1", position: 0 }), { kind: "file", value: "f1", position: 0, url: file.url, name: "Moodboard" });
  assert.deepEqual(keepCoverLink(file, { kind: "upload", value: "notes/c/1.webp", position: 50 }), { kind: "upload", value: "notes/c/1.webp", position: 50 });
  assert.equal(keepCoverLink(file, null), null);

  const notes = await source("components/hub/screens/notes.tsx");
  assert.match(notes, /cover=\{coverWithLink\(pageMeta\.cover, page\.cover\)\}/);
  assert.doesNotMatch(notes, /\.\.\.metaPatch\(patch\)/, "every save applies its fields through withMeta");
  assert.equal((notes.match(/withMeta\((item|open), patch\)/g) ?? []).length, 5);
});

test("the bar for links in the text shows only at links in the text and goes when the text changes", async () => {
  const editor = await source("components/hub/screens/notes-editor.tsx");
  assert.match(editor, /closest\("a\[href\]:not\(\[class\]\)"\)/, "cards, appointments and „Im Board“ bring their own buttons");
  assert.match(editor, /editor\.on\("update", changed\)/);
  assert.match(editor, /editor\.off\("update", changed\)/);
  const css = await source("app/notes.css");
  assert.match(css, /\.nz-prose a:not\(\[class\]\) \{/, "the same rule tells text links apart in the styles");
});

test("the notes sections in the appointment and project windows show icon and heading on one line", async () => {
  const links = await source("components/hub/screens/notes-links.tsx");
  assert.equal((links.match(/<section className="um-sec nz-links">/g) ?? []).length, 3);
  const css = await source("app/notes.css");
  assert.match(css, /\.nz-links \.um-sec-head h3 \{ display: flex; align-items: center; gap: 8px; \}/, "not only inside the task window (.kb-panel)");
});

// ---- Stored images: covers and link previews go once nothing names them --------------------------------------------

test("a stored image goes once no page and no version names it, and not before it is a day old", () => {
  const hour = 3_600_000;
  const now = Date.parse("2026-11-23T12:00:00Z");
  const ago = (hours) => new Date(now - hours * hour);
  const preview = `notes/${CUSTOMER}/links/${TASK}.webp`;
  const cover = `notes/${CUSTOMER}/${PROJECT}.webp`;
  const rows = [
    { name: preview, created_at: ago(48), used: false },
    { name: cover, created_at: ago(25).toISOString(), used: false },
    { name: `notes/${CUSTOMER}/links/${PROJECT}.webp`, created_at: ago(48), used: true },
    { name: `notes/${CUSTOMER}/links/22222222-2222-4333-8444-555555555555.webp`, created_at: ago(23), used: false },
    { name: `notes/${CUSTOMER}/links/33333333-2222-4333-8444-555555555555.webp`, created_at: ago(48), used: null },
    { name: `notes/${CUSTOMER}/links/44444444-2222-4333-8444-555555555555.webp`, created_at: "kein Datum", used: false },
    { name: `notes/${PROJECT}/links/${TASK}.webp`, created_at: ago(48), used: false },
    { name: `notes/${CUSTOMER}/links/sub/${TASK}.webp`, created_at: ago(48), used: false },
    { name: `notes/${CUSTOMER}/links/${TASK}.png`, created_at: ago(48), used: false },
    { name: `notes/${CUSTOMER}/readme.txt`, created_at: ago(48), used: false },
  ];
  assert.deepEqual(removableNoteImages(rows, CUSTOMER, now), [preview, cover], "only the hub's own covers and previews in this folder, unused and older than a day");
  assert.deepEqual(removableNoteImages(rows, CUSTOMER.toUpperCase(), now), [], "folders carry the id in small letters");
  assert.deepEqual(removableNoteImages(rows, "kein-kunde", now), []);
  assert.equal(NOTE_IMAGE_GRACE_HOURS, 24);
  assert.equal(NOTE_IMAGE_SWEEP_HOURS, 6);
  assert.ok(isNoteImageFolder(CUSTOMER) && !isNoteImageFolder("..") && !isNoteImageFolder(`${CUSTOMER}/links`));
});

test("what names an image: pages of its customer also in the trash, with covers and cards in any block, and their history", async () => {
  // A version keeps a removed card's picture, so „Verlauf → Diese Fassung wiederherstellen“ always finds it.
  assert.match(NOTE_IMAGES_SQL, /from public\.hub_note_revisions r\s+join public\.hub_note_pages p on p\.id = r\.page_id/);
  assert.equal((NOTE_IMAGES_SQL.match(/jsonb_path_query\((p|r)\.content, 'lax \$\.\*\* \? \(@\.type == "noteLinkCard"\)'\)/g) ?? []).length, 2, "cards in callouts, lists, tables and toggles too, in pages and versions");
  assert.match(NOTE_IMAGES_SQL, /p\.customer_id = \$2::uuid and p\.cover_kind = 'upload'/);
  assert.doesNotMatch(NOTE_IMAGES_SQL, /deleted_at/, "a page in the trash can come back with its pictures");
  assert.match(NOTE_IMAGES_SQL, /left join used u on u\.name = o\.name/, "the names in use are gathered once, not once per object");
  assert.match(NOTE_IMAGE_FOLDERS_SQL, /o\.created_at < now\(\) - make_interval\(hours => \$2::int\)/);

  const sweep = await source("lib/hub-notes/sweep.ts");
  assert.match(sweep, /^import "server-only";/);
  assert.match(sweep, /if \(!usesOwnPlatform\(\)\) return result;/);
  assert.match(sweep, /sql<StoredNoteImage>\(NOTE_IMAGES_SQL, \[HUB_FILES_BUCKET, customer, `notes\/\$\{customer\}\/`\]\)/);
  assert.match(sweep, /removableNoteImages\(rows, customer\)/);
  assert.match(sweep, /const MAX_PER_RUN = 500;/);
  assert.match(sweep, /if \(now - lastScheduled < NOTE_IMAGE_SWEEP_HOURS \* 3_600_000\) return null;/);
  // The hub's schedule runs it every six hours; deleting for good and the trash's 30 days run it for that customer.
  const route = await source("app/api/notifications/sweep/route.ts");
  assert.match(route, /if \(!usesOwnPlatform\(\)\) return;\s+await sweepAbandonedUploads\(\)[\s\S]*await sweepNoteImagesOnSchedule\(\);/);
  const write = await source("lib/hub-notes/write.ts");
  assert.match(write, /delete\(\)\.eq\("id", row\.id\);\s+if \(error\) return fail\("Die Seite konnte gerade nicht gelöscht werden\."\);\s+after\(\(\) => sweepNoteImages\(row\.customer_id\)\);/);
  assert.match(write, /if \(!removed\.error\) after\(\(\) => sweepNoteImages\(input\.customerId\)\);/);
  assert.doesNotMatch(write, /storedPaths/, "deleting a page never removes a picture another page or version still names");
  // A cover is never in the history: a replaced or removed upload goes at once.
  assert.match(write, /await removeStored\(ctx, \[before\.data\.cover_value\]\)/);
  assert.match(write, /if \(previous\) await removeStored\(ctx, \[previous\]\);/);
});

/* ---------- Markdown for the Claude connector (lib/hub-notes/markdown.ts, since 23.11.2026) ---------- */

// markdown.ts imports its neighbours without extension, as the bundler resolves them; Node needs the ".ts".
const { registerHooks } = await import("node:module");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.includes("/lib/")) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const md = await import("../lib/hub-notes/markdown.ts");

const ID = { task: "11111111-1111-4111-8111-111111111111", project: "22222222-2222-4222-8222-222222222222", appointment: "33333333-3333-4333-8333-333333333333", page: "44444444-4444-4444-8444-444444444444", other: "55555555-5555-4555-8555-555555555555" };
const t = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const para = (...content) => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const linkTo = (href) => ({ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } });
const richPage = () => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [t("Kickoff ABC")] },
    para(t("Wir haben "), t("fett", [{ type: "bold" }]), t(" und "), t("kursiv", [{ type: "italic" }]), t(", "), t("beides", [{ type: "bold" }, { type: "italic" }]), t(" und "), t("Code*", [{ type: "code" }]), t(" sowie "), t("Link", [linkTo("https://oalab.de/x_(y)")]), t(" und *Sterne* _unter_ snake_case 5 * 3 ~~nicht~~.")),
    para(t("Zeile 1"), { type: "hardBreak" }, t("Zeile 2 mit "), { type: "noteTaskMention", attrs: { refKind: "task", refId: ID.task, number: 12 } }, t(".")),
    para({ type: "noteTaskMention", attrs: { refKind: "task", refId: ID.task, number: 12 } }),
    { type: "bulletList", content: [
      { type: "listItem", content: [para(t("Punkt A")), { type: "bulletList", content: [{ type: "listItem", content: [para(t("Unterpunkt"))] }] }] },
      { type: "listItem", content: [para(t("- kein Unterpunkt"))] },
      { type: "listItem", content: [para()] },
    ] },
    { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [para(t("drei")), para(t("zweiter Absatz"))] }, { type: "listItem", content: [para(t("vier"))] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [para(t("erledigt"))] }, { type: "taskItem", attrs: { checked: false }, content: [para()] }] },
    { type: "codeBlock", attrs: { language: "js" }, content: [t("const a = `x`;\n```\nok")] },
    { type: "horizontalRule" },
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", attrs: { colType: "status", colwidth: [120] }, content: [para(t("Status"))] }, { type: "tableHeader", content: [para(t("Wer | was"))] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [para(t("Fertig"))] }, { type: "tableCell", content: [para(t("A")), para(t("B <br> C"))] }] },
    ] },
    { type: "details", attrs: { open: true }, content: [{ type: "detailsSummary", content: [t("Mehr *Details*")] }, { type: "detailsContent", content: [para(t("Innen"))] }] },
    { type: "noteCallout", attrs: { emoji: "📌" }, content: [para(t("Hinweis")), para(t("> zweiter"))] },
    { type: "noteSubpage", attrs: { refKind: "page", refId: ID.page } },
    { type: "noteTaskGroup", content: [{ type: "noteTaskItem", attrs: { refKind: "task", refId: ID.task, number: 12 } }, { type: "noteTaskItem", attrs: { refKind: "task", refId: ID.other, number: 13 } }] },
    { type: "noteTaskList", attrs: { refKind: "project", refId: ID.project, filter: "due", dueBy: "2026-12-01" } },
    { type: "noteProject", attrs: { refKind: "project", refId: ID.project } },
    { type: "noteAppointment", attrs: { refKind: "appointment", refId: ID.appointment } },
    { type: "noteLinkCard", attrs: { href: "https://example.com/a", title: "Example", description: "Was die Seite sagt", site: "example.com", image: null } },
    para(t("# kein Titel")),
    para(t("1. keine Liste")),
  ],
});
const labels = {
  pages: { [ID.page]: "Protokoll" },
  tasks: { [ID.task]: { number: 12, title: "Logo liefern", status: "Offen" } },
  projects: { [ID.project]: { name: "Website", status: "In Umsetzung" } },
  appointments: { [ID.appointment]: { title: "Kickoff", when: "Mo., 24. Nov., 10:00–11:00", status: "Bestätigt" } },
};
const clean = (doc) => JSON.stringify(validateNoteDoc(doc).doc);

test("Markdown: a page reads as Markdown and comes back as the very same page", () => {
  const page = richPage();
  const text = md.noteToMarkdown(page, labels);
  // The blocks of the hub, with their state for Claude to read.
  assert.match(text, /^\[#12 Logo liefern · Offen\]\(oalab:task\/11111111-1111-4111-8111-111111111111\)$/m);
  assert.match(text, /^\[Aufgabe #13 \(nicht sichtbar\)\]\(oalab:task\/55555555/m);
  assert.match(text, /^\[Unterseite: Protokoll\]\(oalab:page\/44444444/m);
  assert.match(text, /^\[Aufgabenliste: Website · Fällig bis 2026-12-01\]\(oalab:tasklist\/22222222-2222-4222-8222-222222222222\?filter=due&due=2026-12-01\)$/m);
  assert.match(text, /^\[Termin: Kickoff · Mo\., 24\. Nov\., 10:00–11:00 · Bestätigt\]\(oalab:appointment\//m);
  assert.match(text, /^\[Example\]\(https:\/\/example\.com\/a "Linkkarte"\)$/m);
  // A mention alone on its line says so, or it would come back as a task box.
  assert.match(text, /^\[#12 Logo liefern\]\(oalab:task\/11111111-1111-4111-8111-111111111111\?mention\)$/m);
  // Text that only looks like Markdown stays text.
  assert.ok(text.includes("\\*Sterne\\* \\_unter\\_ snake_case 5 \\* 3 \\~\\~nicht\\~\\~"));
  assert.match(text, /^\\# kein Titel$/m);
  assert.match(text, /^1\\\. keine Liste$/m);
  assert.ok(text.includes("> 📌 Hinweis\n>\n> \\> zweiter"));
  assert.ok(text.includes("| Fertig | A<br>B \\<br> C |"));

  const back = md.markdownToNote(text, { before: page });
  assert.equal(back.ok, true);
  assert.equal(clean(back.doc), clean(page), "every block, mark and attribute comes back");
  assert.equal(md.noteToMarkdown(back.doc, labels), text, "and reads the same again");
});

test("Markdown: what Claude writes becomes blocks the editor knows, tasks by project and number", () => {
  const written = [
    "# Protokoll",
    "",
    "**Teilnehmer:** Ali, Omed",
    "*Ort:* Teams",
    "",
    "1. Relaunch bis 15.12.",
    "2. Logo kommt vom Kunden",
    "   - als SVG",
    "",
    "- [ ] Logo anfordern",
    "- [x] Termin bestätigen",
    "",
    "> 💡 Freigabe bis Freitag.",
    "",
    "| Punkt | Wer |",
    "|---|:---:|",
    "| Texte | Kunde |",
    "",
    `[Logo liefern](oalab:task/${ID.project}/12)`,
    `[Briefing](oalab:task/${ID.project}/7)`,
    `Siehe [#7](oalab:task/${ID.project}/7), [die Seite](oalab:page/${ID.page}) und https://oalab.de.`,
    "[böse](javascript:alert(1)) [alt](http://example.com)",
    "<details>",
    "<summary>Mehr</summary>",
    "",
    "Innen",
    "</details>",
  ].join("\n");
  const tasks = { [`${ID.project}/12`]: { id: ID.task, number: 12 }, [`${ID.project}/7`]: { id: ID.other, number: 7 } };
  assert.deepEqual(md.taskNumbersIn(written), [{ projectId: ID.project, number: 12 }, { projectId: ID.project, number: 7 }]);
  const parsed = md.markdownToNote(written, { origin: "https://hub.oalab.de", task: (project, number) => tasks[`${project}/${number}`] ?? null });
  assert.equal(parsed.ok, true);
  const checked = validateNoteDoc(parsed.doc);
  assert.equal(checked.ok, true);
  assert.deepEqual(parsed.doc.content.map((node) => node.type), ["heading", "paragraph", "orderedList", "taskList", "noteCallout", "table", "noteTaskGroup", "paragraph", "details"]);
  assert.deepEqual(parsed.doc.content[1].content.map((node) => node.type), ["text", "text", "hardBreak", "text", "text"], "a new line is a line break");
  assert.equal(parsed.doc.content[4].attrs.emoji, "💡");
  assert.deepEqual(parsed.doc.content[6].content.map((node) => [node.attrs.refId, node.attrs.number]), [[ID.task, 12], [ID.other, 7]], "two task lines are one box");
  const sentence = parsed.doc.content[7].content;
  assert.deepEqual(sentence.find((node) => node.type === "noteTaskMention").attrs, { refKind: "task", refId: ID.other, number: 7 });
  assert.equal(sentence.find((node) => node.text === "die Seite").marks[0].attrs.href, `https://hub.oalab.de/dashboard/projects/notes?page=${ID.page}`, "a page inside a sentence links into the hub");
  assert.equal(sentence.find((node) => node.text === "https://oalab.de").marks[0].attrs.href, "https://oalab.de");
  assert.deepEqual(sentence.slice(-2), [{ type: "hardBreak" }, { type: "text", text: "böse alt" }], "links the hub does not allow keep their text only");
  assert.deepEqual(checked.refs.map((ref) => `${ref.kind}:${ref.id}`).sort(), [`task:${ID.task}`, `task:${ID.other}`]);

  // A task that is not there is refused with the way to find the right one.
  const missing = md.markdownToNote(`[x](oalab:task/${ID.project}/99)`, { task: () => null });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Aufgabe #99 gibt es im Projekt .* nicht.*get_project oder list_tasks/);
  assert.equal(md.markdownToNote("x".repeat(md.MAX_MARKDOWN + 1)).ok, false);
});

test("Markdown: what Markdown cannot say comes back from the page as it was, and adding keeps the page", () => {
  const before = { type: "doc", content: [
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", attrs: { colType: "person", colwidth: [180] }, content: [para(t("Wer"))] }, { type: "tableHeader", attrs: { colType: "check" }, content: [para(t("Fertig"))] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [para(t("Ali"))] }, { type: "tableCell", content: [para(t("ja"))] }] },
    ] },
    { type: "noteLinkCard", attrs: { href: "https://example.com/a", title: "Example", description: "Beschreibung", site: "example.com", image: `notes/${ID.page}/links/${ID.other}.webp` } },
    para(t("Hover", [{ type: "link", attrs: { href: "https://oalab.de", title: "OALAB", description: "Agentur" } }])),
  ] };
  const edited = "| Wer | Fertig |\n| --- | --- |\n| Omed | nein |\n\n[Neuer Titel](https://example.com/a \"Linkkarte\")\n\n[Hover](https://oalab.de) bleibt.";
  const parsed = md.markdownToNote(edited, { before });
  assert.equal(parsed.ok, true);
  const [table, card, text] = parsed.doc.content;
  assert.equal(table.content[0].content[0].attrs.colType, "person");
  assert.deepEqual(table.content[0].content[0].attrs.colwidth, [180]);
  assert.equal(table.content[0].content[1].attrs.colType, "check");
  assert.deepEqual(card.attrs, before.content[1].attrs, "the card keeps what the server read from the page");
  assert.equal(text.content[0].marks[0].attrs.title, "OALAB");
  // A new card without a page behind it: title and site from the line.
  const fresh = md.markdownToNote("[Doku](https://docs.example.com/x \"Linkkarte\")");
  assert.deepEqual(fresh.doc.content[0], { type: "noteLinkCard", attrs: { href: "https://docs.example.com/x", title: "Doku", site: "docs.example.com" } });

  const page = noteTemplate("meeting", { title: "Kickoff", date: "2026-11-24" }).doc;
  const added = md.addToNote(page, md.markdownToNote("## Ergebnis\nAlles klar.").doc, "end");
  assert.deepEqual(added.content.slice(0, -2), page.content.slice(0, -1), "the page stays, its empty last line goes");
  assert.deepEqual(added.content.slice(-2).map((node) => node.type), ["heading", "paragraph"]);
  assert.equal(md.addToNote(page, md.markdownToNote("Oben").doc, "start").content[0].content[0].text, "Oben");
  // Templates read and come back unchanged (their empty lines aside).
  for (const id of ["meeting", "acceptance", "blank"]) {
    const doc = noteTemplate(id, { title: "X", date: "2026-11-24" }).doc;
    const filled = (value) => ({ ...value, content: value.content.filter((node) => node.type !== "paragraph" || node.content) });
    assert.equal(clean(filled(md.markdownToNote(md.noteToMarkdown(doc)).doc)), clean(filled(doc)), id);
  }
});
