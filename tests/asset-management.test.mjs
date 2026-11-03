import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeAppearance } from "../lib/appearance.ts";
import { fileDayGroup, formatFileDay, guessFileCategory } from "../lib/hub-files/catalog.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));

test("quiet lists name the day: today, yesterday, then the date, in Berlin time", () => {
  assert.equal(formatFileDay("2026-11-02T09:14:00+01:00", "2026-11-02"), "Heute");
  // Shortly after midnight in Berlin it is already the next day, although UTC still says the 1st.
  assert.equal(formatFileDay("2026-11-01T23:30:00Z", "2026-11-02"), "Heute");
  assert.equal(formatFileDay("2026-11-01T10:00:00+01:00", "2026-11-02"), "Gestern");
  assert.equal(formatFileDay("2026-10-28T16:40:00+01:00", "2026-11-02"), "28. Okt.");
  // Fixtures carry no zone and count as UTC wall time, measured against their own reference day.
  assert.equal(formatFileDay("2026-10-15T08:00", "2026-10-15"), "Heute");
});

test("all files fall into Heute, Gestern, Diese Woche and Früher", () => {
  const today = "2026-11-02";
  assert.equal(fileDayGroup("2026-11-02T08:00:00+01:00", today), "Heute");
  assert.equal(fileDayGroup("2026-11-01T08:00:00+01:00", today), "Gestern");
  assert.equal(fileDayGroup("2026-10-28T08:00:00+01:00", today), "Diese Woche");
  assert.equal(fileDayGroup("2026-10-20T08:00:00+01:00", today), "Früher");
});

test("the list view is a setting of its own: minimal unless someone chose detail", () => {
  assert.equal(normalizeAppearance(null).listView, "minimal");
  assert.equal(normalizeAppearance({ listView: "detail" }).listView, "detail");
  assert.equal(normalizeAppearance({ listView: "table" }).listView, "minimal");
});

test("admins get the Asset Management with customers first; customers keep their files table", async () => {
  const files = await source("components/hub/screens/files.tsx");
  assert.match(files, /return props\.admin \? <AssetManagement \{\.\.\.props\} \/> : <CustomerFiles \{\.\.\.props\} \/>;/);
  const screen = await source("components/hub/screens/asset-management.tsx");
  // The switch and the setting under Darstellung are one value.
  assert.match(screen, /trailing=\{<DensitySwitch view=\{listView\} onChange=\{\(next\) => update\(\{ listView: next \}\)\} \/>\}/);
  assert.match(screen, /title="Minimalistische Sicht"/);
  assert.match(screen, /title="Detailsicht"/);
  // The shared views stay on top of the customers; a notice's link still opens its file.
  assert.match(screen, /"Alle Dateien"/);
  assert.match(screen, /"Ablage"/);
  assert.match(screen, /const linkedFile = useSearchParams\(\)\.get\("file"\);/);
  // Admins no longer see the two metric cards above the list.
  assert.doesNotMatch(screen, /CategoryMetrics/);
  const appearance = await source("components/hub/screens/appearance.tsx");
  assert.match(appearance, /\{admin && \(\s*<GlassCard aria-labelledby="appearance-lists">/);
  const css = await source("app/glass.css");
  assert.match(css, /\.am-min-lead \{ position: relative; width: 34px; height: 34px;[^}]*color: var\(--cat\);/);
  assert.match(css, /@container sheet \(max-width: 820px\) \{\s*\.am-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(hover: none\) \{\s*\.am-min-section-acts \{ opacity: 1; \}/);
});

test("a picked file gets a first category from its name and type; every one can be changed before uploading", () => {
  assert.equal(guessFileCategory("Servicevertrag 2026.pdf", "application/pdf"), "contract");
  assert.equal(guessFileCategory("NDA_Kunde.pdf", "application/pdf"), "contract");
  assert.equal(guessFileCategory("Angebot Relaunch.pdf", "application/pdf"), "offer");
  assert.equal(guessFileCategory("Rechnung 2026-11.pdf", "application/pdf"), "invoice");
  assert.equal(guessFileCategory("Logo weiss.svg", "image/svg+xml"), "brand");
  assert.equal(guessFileCategory("Protokoll-Kickoff.docx", ""), "documentation");
  assert.equal(guessFileCategory("Moodboard_Herbst.jpg", "image/jpeg"), "design");
  assert.equal(guessFileCategory("Startseite.fig", ""), "design");
  assert.equal(guessFileCategory("Agenda.pdf", "application/pdf"), "other");
});

test("upload and details open as panels over the files, not as dialogs", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.doesNotMatch(screen, /FileUploadCard|FileDetailDialog|<Modal/);
  assert.match(screen, /\{panel\?\.kind === "upload" && <UploadPanel queue=\{queue\}/);
  assert.match(screen, /<FilePanel file=\{openFile\} customers=\{customers\} folders=\{folders\} here=\{current\}/);
  // Another customer closes a file's details; an upload keeps its files and its target.
  assert.match(screen, /setPanel\(\(now\) => now\?\.kind === "file" \? null : now\);/);
  // Only files from the computer, only for real uploads, and the folder under the mouse is the target.
  assert.match(screen, /const canDrop = canUpload && !queue\.working;/);
  assert.match(screen, /className="am-min-group" role="presentation" data-drop-folder=\{canDrop \? group\.key : undefined\}/);
  assert.match(screen, /dropKey=\{canDrop \? group\.key : undefined\}/);
  assert.match(screen, /startUpload\(\{ customerId: current\?\.id \?\? null, folderId: current && folder !== NO_FOLDER \? folder : "" \}, Array\.from\(event\.dataTransfer\.files\)\);/);
  assert.match(await source("components/hub/sheet.tsx"), /<tbody className=\{`table-group-body\$\{className \? ` \$\{className\}` : ""\}`\} data-drop-folder=\{dropKey\}>/);

  const panel = await source("components/hub/screens/asset-panel.tsx");
  assert.match(panel, /if \(event\.key !== "Escape" \|\| closeDisabled\) return;/);
  assert.match(panel, /if \(opener\?\.isConnected\) opener\.focus\(\{ preventScroll: true \}\);/);
});

test("the upload sends every file with its own category, the same way as before, and skips files that can never go up", async () => {
  const upload = await source("components/hub/screens/asset-upload.tsx");
  assert.match(upload, /export const isFileDrag = \(event: React\.DragEvent\) => Array\.from\(event\.dataTransfer\.types\)\.includes\("Files"\);/);
  assert.match(upload, /await sendUpload\(item\.file, \{ title: item\.title, category: item\.category, description, customerIds, folderId: targetFolder \|\| null \}/);
  assert.match(upload, /const ready = items\.filter\(\(item\) => !item\.blocked && \(item\.status === "ready" \|\| item\.status === "error"\)\);/);
  assert.match(upload, /blocked: !check\.ok/);
  // The old upload card and the panel share one way of sending a file.
  const card = await source("components/hub/screens/files-upload.tsx");
  assert.match(card, /export async function sendUpload\(/);
  assert.match(card, /await sendUpload\(item\.file, \{ title: item\.title, category, description, customerIds, folderId: targetFolder \|\| null \}/);
});

test("the details change folder and customers in place, and an image of the open customer becomes its logo in one click", async () => {
  const details = await source("components/hub/screens/asset-details.tsx");
  assert.match(details, /const logoFor = here && canAssign && canBeLogo\(file\) && file\.customers\.some\(\(customer\) => customer\.id === here\.id\) \? here : null;/);
  assert.match(details, /saveCustomerLogo\(\{ customerId: customer\.id, source: \{ kind: "file", fileId: file\.id \}/);
  assert.match(details, /await setFileAssignments\(file\.id, selected\);/);
  assert.match(details, /await onMove\(customer\.id, folderId \|\| null\);/);
  assert.match(details, /\/dashboard\/files\?file=\$\{encodeURIComponent\(file\.id\)\}/);
  // Images preview through the same short-lived links as downloads.
  assert.match(details, /createDownloadUrls\(\[file\.id\]\)/);
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.match(screen, /onMove=\{\(customerId, folderId\) => store\.move\(\[openFile\.id\], customerId, folderId\)\}/);
});

test("only an admin edits or deletes files; deleting takes the record first, then the stored file", async () => {
  const actions = await source("lib/hub-files/actions.ts");
  const body = (name) => actions.split(`export async function ${name}(`)[1].split("\nexport ")[0];
  for (const name of ["updateFileDetails", "deleteFiles"]) assert.match(body(name), /> \{\n {2}const supabase = await adminClient\(\);\n {2}if \(!supabase\) return denied;/, name);
  // Editing tells no customer.
  assert.doesNotMatch(body("updateFileDetails"), /notifyCustomers/);
  assert.match(body("updateFileDetails"), /isFileCategory\(input\?\.category\)/);
  assert.match(body("deleteFiles"), /\.from\("hub_files"\)\.delete\(\)\.in\("id", ids\)\.select\("storage_path"\)/);
  assert.match(body("deleteFiles"), /if \(paths\.length\) await supabase\.storage\.from\(HUB_FILES_BUCKET\)\.remove\(paths\);/);
});

test("the pencil edits a file, „…“ deletes it, the selection deletes several; deleting always asks first", async () => {
  const details = await source("components/hub/screens/asset-details.tsx");
  assert.match(details, /const pencil = props\.canAssign && \(/);
  assert.match(details, /\{canAssign && <MoreMenu onDelete=\{onDelete\}/);
  assert.match(details, /role="menuitem" className="is-danger"/);
  assert.match(details, /await updateFileDetails\(file\.id, \{ title, category, description \}\);/);
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.match(screen, /\{canUpload && <button type="button" className="sheet-action is-danger" onClick=\{\(\) => setDeleting\(selection\)\}/);
  assert.match(screen, /onDelete=\{\(\) => setDeleting\(\[openFile\]\)\}/);
  assert.match(screen, /\{deleting && <DeleteFilesDialog files=\{deleting\}/);
  const dialogs = await source("components/hub/screens/files-dialogs.tsx");
  assert.match(dialogs, /Das lässt sich nicht rückgängig machen\./);
  assert.match(dialogs, /Endgültig löschen/);
});

test("panels sit over the files, and on phones fill the screen with the tab bar out of the way", async () => {
  const css = await source("app/glass.css");
  assert.match(css, /\.am-panel \{ position: absolute; z-index: 8; top: 0; right: 0; bottom: 0; width: min\(420px, 100%\);/);
  assert.match(css, /@media \(max-width: 767px\) \{\n {2}\.am-panel \{ position: fixed; z-index: 60; inset: 0;/);
  assert.match(css, /:root:has\(\.am-panel\) :is\(\.tab-bar-wrap, \.scroll-edge\) \{ display: none; \}/);
  assert.match(css, /\.am-min-section\.is-drop \{/);
  // "Bewegung reduzieren" stops the busy bar; like every motion rule it lives in motion.css.
  assert.match(await source("app/motion.css"), /:root\[data-reduce-motion="true"\] \.am-progress i \{ animation: none;/);
});
