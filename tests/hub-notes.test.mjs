import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  audienceChoices, audienceLabel, cleanIcon, cleanNoteTitle, descendantsOf, fitAudience, gains, isSafeHref, meet, narrowedBelow, newPageAudience, noteText,
  pathOf, statusTone, validateNoteDoc, viewerEdits, viewerReads, within,
} from "../lib/hub-notes/rules.ts";
import { EMOJIS, emojiCode, emojiSrc, searchEmojis, stripVariation } from "../lib/hub-notes/emoji.ts";
import { GALLERY_COVERS, nextCoverPosition } from "../lib/hub-notes/covers.ts";

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
