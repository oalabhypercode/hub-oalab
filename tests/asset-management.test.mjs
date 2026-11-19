import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeAppearance } from "../lib/appearance.ts";
import { fileDayGroup, formatFileDay, guessFileCategory } from "../lib/hub-files/catalog.ts";
import { assignLabel, assignMessage, assignSubtitle } from "../lib/hub-files/assign.ts";

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
  // Freelancers work in the same Asset Management, read only (4.11.2026).
  assert.match(files, /return props\.admin \|\| props\.freelancer \? <AssetManagement \{\.\.\.props\} \/> : <CustomerFiles \{\.\.\.props\} \/>;/);
  const screen = await source("components/hub/screens/asset-management.tsx");
  // The switch and the setting under Darstellung are one value.
  assert.match(screen, /trailing=\{<DensitySwitch view=\{listView\} onChange=\{\(next\) => update\(\{ listView: next \}\)\} \/>\}/);
  assert.match(screen, /data-tip="Minimalistische Sicht"/);
  assert.match(screen, /data-tip="Detailsicht"/);
  // The shared views stay on top of the customers; a notice's link still opens its file.
  assert.match(screen, /"Alle Dateien"/);
  assert.match(screen, /"Ablage"/);
  assert.match(screen, /const params = useSearchParams\(\);\n  const linkedFile = params\.get\("file"\);/);
  // The project dialog links a customer (?customer=<id>): the page opens on that customer's files.
  assert.match(screen, /if \(linkedCustomer\) return \{ kind: "customer", id: linkedCustomer \};/);
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
  // Files from the computer only for real uploads, and the folder under the mouse is the target; folders also take
  // files dragged within the page (19.11.2026).
  assert.match(screen, /const canDrop = canUpload && !queue\.working;/);
  assert.match(screen, /className="am-min-group" role="presentation" data-drop-folder=\{canDrop \|\| canDragRows \? group\.key : undefined\}/);
  assert.match(screen, /dropKey=\{canDrop \|\| canDragRows \? group\.key : undefined\}/);
  assert.match(screen, /startUpload\(\{ customerId: current\?\.id \?\? null, folderId: current && folder !== NO_FOLDER \? folder : "" \}, Array\.from\(event\.dataTransfer\.files\)\);/);
  assert.match(await source("components/hub/sheet.tsx"), /<tbody className=\{`table-group-body\$\{className \? ` \$\{className\}` : ""\}`\} data-drop-folder=\{dropKey\}>/);

  const panel = await source("components/hub/screens/asset-panel.tsx");
  // Escape closes the panel, except while it uploads or while a ⓘ card or a window inside it takes the key.
  assert.match(panel, /if \(event\.key !== "Escape" \|\| closeDisabled \|\| escapeIsTaken\(event, ref\.current\)\) return;/);
  assert.match(panel, /if \(!left && opener\?\.isConnected\) opener\.focus\(\{ preventScroll: true \}\);/);
});

test("the upload sends every file with its own category, the same way as before, and skips files that can never go up", async () => {
  const upload = await source("components/hub/screens/asset-upload.tsx");
  assert.match(upload, /export const isFileDrag = \(event: React\.DragEvent\) => Array\.from\(event\.dataTransfer\.types\)\.includes\("Files"\);/);
  // Each file goes up with the name the panel shows for it (its title, or a new name after a pattern).
  assert.match(upload, /await sendUpload\(item\.file, \{ title: name\.title, fileName: name\.fileName, category: item\.category, description, customerIds, folderId: targetFolder \|\| null \}/);
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

test("ticks and a file's details exclude each other, so the details never cover the selection bar", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.match(screen, /const closeDetails = \(\) => setPanel\(\(now\) => now\?\.kind === "file" \? null : now\);/);
  assert.match(screen, /const toggle = \(id: string\) => \{ closeDetails\(\); setSelected\(/);
  assert.match(screen, /const toggleAll = \(\) => \{ closeDetails\(\); setSelected\(/);
  assert.match(screen, /const open = \(file: HubStoredFile, assign = false\) => \{ setSelected\(\[\]\); setPanel\(\{ kind: "file", id: file\.id, assign \}\); \};/);
  // A tick takes the focus with it; closing the details must not pull it back to the file that was open.
  const panel = await source("components/hub/screens/asset-panel.tsx");
  assert.match(panel, /const left = active !== null && active !== document\.body && !panel\?\.contains\(active\);/);
});

test("panels sit over the files, and on phones fill the screen with the tab bar out of the way", async () => {
  const css = await source("app/glass.css");
  assert.match(css, /\.am-panel \{ position: absolute; z-index: 8; top: 0; right: 0; bottom: 0; width: min\(420px, 100%\);/);
  assert.match(css, /@media \(max-width: 767px\) \{\n {2}\.am-panel \{ position: fixed; z-index: 60; inset: 0;/);
  assert.match(css, /:root:has\(\.am-panel\) :is\(\.tab-bar-wrap, \.scroll-edge\) \{ display: none; \}/);
  assert.match(css, /\.am-min-section\.is-drop \{/);
  // An upload in progress shows the small turning logo at the end of its row, without a second busy bar.
  const upload = await source("components/hub/screens/asset-upload.tsx");
  assert.match(upload, /item\.status === "working" \? <span className="am-upload-state"><MiniLoader size=\{16\} \/><\/span>/);
  assert.doesNotMatch(upload + css, /am-progress/);
});

test("„Zuordnen“ says where the files come from, what the button does and what happened", () => {
  const morgenrot = { kind: "customer", id: "c1", company: "Café Morgenrot" };
  assert.equal(assignSubtitle(3, { kind: "inbox" }), "3 Dateien aus der Ablage");
  assert.equal(assignSubtitle(1, { kind: "all" }), "1 Datei aus „Alle Dateien“");
  assert.equal(assignSubtitle(2, morgenrot), "2 Dateien von Café Morgenrot");
  assert.equal(assignLabel(1, { kind: "inbox" }, "move"), "Zuordnen");
  assert.equal(assignLabel(3, { kind: "inbox" }, "move"), "3 Dateien zuordnen");
  assert.equal(assignLabel(2, morgenrot, "move"), "2 Dateien verschieben");
  assert.equal(assignLabel(2, morgenrot, "keep"), "2 Dateien freigeben");
  assert.equal(assignLabel(1, { kind: "all" }, "move"), "Freigeben");
  const base = { count: 3, added: 3, company: "Studio Horizont", folder: null, source: { kind: "inbox" }, mode: "move" };
  assert.equal(assignMessage(base), "3 Dateien Studio Horizont zugeordnet.");
  assert.equal(assignMessage({ ...base, folder: "Briefings" }), "3 Dateien Studio Horizont zugeordnet und in „Briefings“ abgelegt.");
  assert.equal(assignMessage({ ...base, count: 2, source: morgenrot }), "2 Dateien von Café Morgenrot zu Studio Horizont verschoben.");
  assert.equal(assignMessage({ ...base, count: 1, added: 1, source: morgenrot, mode: "keep", folder: "Fotos" }), "1 Datei zusätzlich bei Studio Horizont in „Fotos“ abgelegt. Café Morgenrot behält sie.");
  assert.equal(assignMessage({ ...base, source: { kind: "all" } }), "3 Dateien auch für Studio Horizont freigegeben.");
  assert.equal(assignMessage({ ...base, added: 0 }), "Die Dateien liegen schon bei Studio Horizont.");
});

test("„Zuordnen“ is the admins' own action: one call for all files, with the folder, „Sichtbar für“ and one notice", async () => {
  const actions = await source("lib/hub-files/actions.ts");
  const assign = actions.split("export async function assignFiles(")[1].split("\nexport ")[0];
  assert.match(assign, /> \{\n {2}const supabase = await adminClient\(\);\n {2}if \(!supabase\) return denied;/);
  assert.match(assign, /\.from\("hub_file_assignments"\)\.insert\(added\.map\(\(fileId\) => \(\{ file_id: fileId, customer_id: customerId, folder_id: folderId \}\)\)\)/);
  // From another customer the visibility moves along, written by the server like setFileAudience does.
  assert.match(assign, /const db = createAdminClient\(\);/);
  assert.match(assign, /\.update\(\{ audience \}\)\.eq\("customer_id", customerId\)\.in\("file_id", fileIds\)/);
  assert.match(assign, /if \(from && input\?\.move\) \{\n {4}const \{ data, error \} = await supabase\.from\("hub_file_assignments"\)\.delete\(\)\.eq\("customer_id", from\)\.in\("file_id", ids\)/);
  assert.match(assign, /await notifyFilesShared\(added\.map/);
  const screen = await source("components/hub/screens/asset-management.tsx");
  // The selection bar and a file in the Ablage open the same panel; it keeps its files and starts afresh each time.
  assert.match(screen, /\{canAssign && <button type="button" className="sheet-action" aria-pressed=\{panel\?\.kind === "assign"\} onClick=\{\(\) => openAssign\(selection\.map\(\(file\) => file\.id\), null\)\}/);
  assert.match(screen, /onClick=\{\(\) => openAssign\(\[file\.id\], null\)\}><UserPlus size=\{15\} aria-hidden="true" \/>Zuordnen<\/button>/);
  assert.match(screen, /<AssignPanel key=\{panel\.key\} request=\{panel\.request\} files=\{assigning\}/);
  // Deactivated freelancers are no target (lib/hub-users/deactivated.ts).
  assert.match(screen, /customers\.filter\(\(customer\) => !\(customer\.kind === "freelancer" && customer\.inactive\)\)/);
  const panel = await source("components/hub/screens/asset-assign.tsx");
  // The hub's own lists, never the browser's.
  assert.doesNotMatch(panel, /<select|<datalist/);
  assert.match(panel, /<Select variant="bare" showLead label="An welchen Kunden\?"/);
  assert.match(panel, /move: from !== null && mode === "move"/);
});

test("files are dragged onto a customer (it asks first) or a folder (it moves at once); files from the computer onto a customer's name", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  // The ticked files go along when a ticked row is grabbed, else only the grabbed one.
  assert.match(screen, /idsFor: \(id\) => selected\.includes\(id\) \? shown\.filter\(\(file\) => selected\.includes\(file\.id\)\)\.map\(\(file\) => file\.id\) : \[id\],/);
  // A customer takes them only for admins and never the one they come from; a folder only where files may be organized.
  assert.match(screen, /\? canAssign && target\.id !== "inbox" && target\.id !== current\?\.id\n {4}: current !== null && canOrganize;/);
  // Dropped on a customer, „Zuordnen“ opens with that customer (the confirmation); on a folder, the files move there.
  assert.match(screen, /onDrop: \(ids, target\) => target\.kind === "customer" \? openAssign\(ids, target\.id\) : moveInto\(ids, target\.key\),/);
  assert.match(screen, /data-drop-customer=\{takes \? dropId : undefined\} data-drop-state=\{dropState\(dropId\)\}/);
  assert.match(screen, /<div className="chat-list" \{\.\.\.listDropHandlers\}>/);
  assert.match(screen, /startUpload\(\{ customerId: id === "inbox" \? null : id, folderId: "" \}, Array\.from\(event\.dataTransfer\.files\)\);/);
  const drag = await source("components/hub/screens/asset-drag.ts");
  // Mouse after a few pixels, a finger after holding still; Escape cancels; the click that ends a drag opens nothing.
  assert.match(drag, /const HOLD_MS = 240;/);
  assert.match(drag, /if \(event\.key === "Escape" && live\.current\?\.started\)/);
  assert.match(drag, /if \(Date\.now\(\) - quiet\.current < 250\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); \}/);
  assert.match(drag, /querySelectorAll<HTMLElement>\("\.chat-convs, \.am-scroll"\)/);
  const css = await source("app/glass.css");
  assert.match(css, /\.chat-conv\.is-drop-target \{/);
  assert.match(css, /\.am-ghost-count \{/);
});
