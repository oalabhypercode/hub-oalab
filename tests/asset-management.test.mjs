import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeAppearance } from "../lib/appearance.ts";
import { fileDayGroup, fileKind, formatFileDay, formatFileStamp, guessFileCategory } from "../lib/hub-files/catalog.ts";
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

test("the list view is a setting of its own: minimal unless someone chose the list or detail", () => {
  assert.equal(normalizeAppearance(null).listView, "minimal");
  assert.equal(normalizeAppearance({ listView: "detail" }).listView, "detail");
  assert.equal(normalizeAppearance({ listView: "list" }).listView, "list");
  assert.equal(normalizeAppearance({ listView: "table" }).listView, "minimal");
  // „Kacheln“ (23.11.2026) and their size, medium unless someone chose another.
  assert.equal(normalizeAppearance({ listView: "tiles" }).listView, "tiles");
  assert.equal(normalizeAppearance(null).tileSize, "medium");
  assert.equal(normalizeAppearance({ tileSize: "large" }).tileSize, "large");
  assert.equal(normalizeAppearance({ tileSize: "huge" }).tileSize, "medium");
});

test("„Liste“ writes dates and kinds as the Finder does, in Berlin time", () => {
  assert.equal(formatFileStamp("2026-11-19T09:12:00+01:00", "2026-11-19"), "Heute, 09:12");
  assert.equal(formatFileStamp("2026-11-18T15:40:00Z", "2026-11-19"), "Gestern, 16:40");
  assert.equal(formatFileStamp("2026-10-01T10:00", "2026-11-19"), "01.10.2026, 12:00");
  assert.equal(fileKind("Angebot Relaunch.pdf"), "PDF-Dokument");
  assert.equal(fileKind("IMG-20261118-WA0007.JPG"), "JPEG-Bild");
  assert.equal(fileKind("Briefing.docx"), "Word-Dokument");
  assert.equal(fileKind("Startseite.fig"), "Figma-Datei");
  assert.equal(fileKind("Notizen.xyz"), "XYZ-Datei");
  assert.equal(fileKind("README"), "Datei");
});

test("„Liste“ is the third view: a Finder-like tree of folders and files that shares ticks, sorting and dragging", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.match(screen, /data-tip="Listensicht wie im Finder" onClick=\{\(\) => onChange\("list"\)\}><List size=\{14\} aria-hidden="true" \/>Liste<\/button>/);
  assert.match(screen, /const customerBody = tiles \? tileList\([^\n]*\) : finder \? finderList\(/);
  assert.match(screen, /const allBody = tiles \? tileList\([^\n]*\) : finder \? finderList\(null, "Alle Dateien", true\)/);
  assert.match(screen, /const inboxBody = tiles \? tileList\([^\n]*\) : finder \? finderList\(null, "Dateien ohne Kunden", false\)/);
  assert.match(screen, /onSelect=\{\(ids\) => \{ closeDetails\(\); setSelected\(ids\); \}\}/);
  const list = await source("components/hub/screens/asset-list.tsx");
  // A tree grid: rows with levels, folders open in place, a selection of several, the keyboard of the Finder.
  assert.match(list, /role="treegrid" aria-label=\{label\} aria-multiselectable="true" tabIndex=\{0\}/);
  assert.match(list, /aria-level=\{1\} aria-expanded=\{open\}/);
  assert.match(list, /if \(event\.shiftKey\) \{ event\.preventDefault\(\); range\(id\); \}\n {4}else if \(event\.metaKey \|\| event\.ctrlKey\) toggle\(id\);/);
  assert.match(list, /key\.toLowerCase\(\) === "a" && \(event\.metaKey \|\| event\.ctrlKey\)/);
  // A double click opens the line its first click hit, even if the lines moved in between (23.11.2026: the browser's
  // own double click landed on the line above after the selection bar had pushed the list down).
  assert.match(list, /if \(event\.detail >= 2 && pointer\.current === "mouse"\) \{\n {6}const first = firstClick\.current \?\? line;/);
  assert.match(list, /if \(event\.detail === 2\) \{ if \(first\.kind === "folder"\) onToggle\(first\.group\.key\); else onOpen\(first\.file\); \}/);
  assert.doesNotMatch(list, /onDoubleClick/);
  assert.match(list, /\{head\("title", "Name", "fl-name"\)\}/);
  assert.match(list, /\{head\("format", "Art", "fl-kind"\)\}/);
  const css = await source("app/glass.css");
  assert.match(css, /\.fl-row\.is-alt \{/);
  // The selection takes the accent of the main buttons (white text holds in both themes); the ring only for the keyboard.
  assert.match(css, /\.fl:focus-within \.fl-row\.is-selected \{ background: var\(--accent-gradient\); \}/);
  assert.match(css, /\.fl\[data-keys\]:focus-within \.fl-row\.is-active \{/);
  assert.match(css, /@container fl \(max-width: 720px\)/);
  // Profil › Darstellung offers it too; the keychain, which has no such list, shows it as Minimal.
  assert.match(await source("components/hub/screens/appearance.tsx"), /\{ id: "list", label: "Liste" \}/);
  assert.match(await source("components/hub/screens/keychain.tsx"), /const listView: ListView = appearance\.listView === "detail" \? "detail" : "minimal";/);
});

test("everyone gets the Asset Management: admins with the customers first, customers with their own files", async () => {
  const files = await source("components/hub/screens/files.tsx");
  // Freelancers work in the same Asset Management, read only (4.11.2026); customers too since 27.11.2026, so their
  // „Dateien“ have the same four views instead of a table of their own.
  assert.match(files, /export function FilesScreen\(props: ScreenProps & \{ uploads\?: HubUploadsState \}\) \{\n {2}return <AssetManagement \{\.\.\.props\} \/>;\n\}/);
  assert.doesNotMatch(files, /CustomerFiles/);
  const screen = await source("components/hub/screens/asset-management.tsx");
  // The switch and the setting under Darstellung are one value.
  assert.match(screen, /<DensitySwitch view=\{listView\} onChange=\{\(next\) => update\(\{ listView: next \}\)\} \/><\/>\}>/);
  assert.match(screen, /data-tip="Minimalistische Sicht"/);
  assert.match(screen, /data-tip="Detailsicht"/);
  // The shared views stay on top of the customers; a notice's link still opens its file.
  assert.match(screen, /"Alle Dateien"/);
  assert.match(screen, /"Ablage"/);
  assert.match(screen, /const params = useSearchParams\(\);\n  const linkedFile = params\.get\("file"\);/);
  // The project dialog links a customer (?customer=<id>): the page opens on that customer's files.
  assert.match(screen, /if \(linkedCustomer\) return \{ kind: "customer", id: linkedCustomer \};/);
  // Admins no longer see the two metric cards above the list, and customers neither since 27.11.2026.
  assert.doesNotMatch(screen, /CategoryMetrics/);
  // Every role has these lists now, so every role gets the card under Darstellung.
  const appearance = await source("components/hub/screens/appearance.tsx");
  assert.match(appearance, /\n {8}<GlassCard aria-labelledby="appearance-lists">/);
  assert.doesNotMatch(appearance, /\{admin && \(\s*<GlassCard aria-labelledby="appearance-lists">/);
  assert.match(appearance, /Die Wahl gilt heute für \{admin \|\| freelancer \? "das Asset Management" : "die Dateien"\}/);
  const css = await source("app/glass.css");
  assert.match(css, /\.am-min-lead \{ position: relative; width: 34px; height: 34px;[^}]*color: var\(--cat\);/);
  assert.match(css, /@container sheet \(max-width: 820px\) \{\s*\.am-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(hover: none\) \{\s*\.am-min-section-acts \{ opacity: 1; \}/);
});

test("customers see their own files in the same four views, without the list of customers (27.11.2026)", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  // A customer's login (and the preview) neither uploads nor assigns; one company fills the page on its own.
  assert.match(screen, /const customerView = !admin && !canManage && !freelancer && !freelancerView;\n {2}const single = customerView && customers\.length <= 1;/);
  assert.match(screen, /if \(single && customers\[0\]\) return \{ kind: "customer", id: customers\[0\]\.id \};/);
  assert.match(screen, /\{!single && customerList\}/);
  assert.match(screen, /\$\{single \? " is-single" : ""\}/);
  assert.match(screen, /data-open=\{paneOpen \|\| single \? "" : undefined\}/);
  assert.match(screen, /const back = single \? null : <button type="button" className="chat-back"/);
  // Their page keeps its name „Dateien“; the Ablage stays with the admins; a login with several companies lists them.
  assert.match(screen, /title=\{customerView \? categoryLabel\("files", false\) : "Asset Management"\}/);
  assert.match(screen, /\{!term && !freelancerView && !customerView && pinned\(\{ kind: "inbox" \}/);
  assert.match(screen, /const word = customerView \? \{ one: "Firma", many: "Firmen" \} : \{ one: "Kunde", many: "Kunden" \};/);
  // The details speak to the customer: the file lies at their company, the link is their own.
  assert.match(screen, /freelancerView=\{freelancerView\} customerView=\{customerView\}/);
  const details = await source("components/hub/screens/asset-details.tsx");
  assert.match(details, /\{freelancerView \|\| customerView \? "Liegt bei" : "Freigegeben für"\}/);
  assert.match(details, /freelancerView \|\| customerView \? "Link kopieren" : "Link für den Kunden kopieren"/);
  // The table, its dialog and the metric cards of the customers' old page are gone.
  const dialogs = await source("components/hub/screens/files-dialogs.tsx");
  assert.doesNotMatch(dialogs, /FileDetailDialog/);
  assert.doesNotMatch(await source("components/hub/screens/workspace.tsx"), /CategoryMetrics/);
  const css = await source("app/glass.css");
  assert.match(css, /\.am\.is-single \.am-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
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
  // Every image shows itself through a preview the server makes, whatever its size or reported type (23.11.2026); a
  // see-through image stands on the ground that fits it, an iPhone photo says why it has none.
  assert.match(details, /const source = kind !== "image" \? null : file\.sampleHref \?\? \(live \? previewUrl\(file, "l"\) : null\);/);
  assert.match(details, /if \(clear\) detectLogoGround\(src\)\.then/);
  assert.match(details, /iPhone-Fotos im HEIC-Format kann der Browser nicht zeigen\./);
  assert.doesNotMatch(details, /PREVIEW_MAX_BYTES|createDownloadUrls/);
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
  const action = actions.split("export async function assignFiles(")[1].split("\nexport ")[0];
  assert.match(action, /> \{\n {2}const supabase = await adminClient\(\);\n {2}if \(!supabase\) return denied;\n {2}const result = await assignFilesAs\(supabase, input\);/);
  // The work itself is the shared core (lib/hub-files/write.ts), which the Claude connector uses as well (23.11.2026).
  const assign = (await source("lib/hub-files/write.ts")).split("export async function assignFilesAs(")[1].split("\nexport ")[0];
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
  // The customers come before the freelancers, each from A to Z (live check 19.11.2026: the server's order put the
  // freelancers first).
  // oalab first (stage 2 of „oalab als Unternehmen“), then customers, then freelancers, each from A to Z.
  assert.match(panel, /const rank = \(customer: HubFileCustomer\) => customer\.kind === "team" \? 0 : customer\.kind === "freelancer" \? 2 : 1;/);
  assert.match(panel, /\.sort\(\(a, b\) => rank\(a\) - rank\(b\) \|\| a\.company\.localeCompare\(b\.company, "de"\)\);/);
});

test("files are dragged onto a customer (it asks first) or a folder (it moves at once); files from the computer onto a customer's name", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  // The ticked files go along when a ticked row is grabbed, else only the grabbed one.
  assert.match(screen, /idsFor: \(id\) => selected\.includes\(id\) \? shown\.filter\(\(file\) => selected\.includes\(file\.id\)\)\.map\(\(file\) => file\.id\) : \[id\],/);
  // A customer takes them only for admins and never the one they come from; a folder only where files may be organized.
  assert.match(screen, /\? canAssign && target\.id !== "inbox" && target\.id !== current\?\.id\n {4}: current !== null && canOrganize;/);
  // Dropped on a customer, „Zuordnen“ opens with that customer (the confirmation); on a folder, the files move there,
  // except those already in it.
  assert.match(screen, /onDrop: \(ids, target\) => target\.kind === "customer" \? openAssign\(ids, target\.id\) : moveInto\(ids\.filter\(\(id\) => folderOf\(id\) !== target\.key\), target\.key\),/);
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

test("the selection bar lies over the search line, so the files never move between two clicks (23.11.2026)", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.match(screen, /<div className="am-bars">\n {16}<SheetToolbar /);
  const css = await source("app/glass.css");
  // One cell for both: it keeps the larger height; the search line hides behind the bar while files are selected.
  assert.match(css, /\.am-bars \{ display: grid; min-width: 0; \}\n\.am-bars > \* \{ grid-area: 1 \/ 1; min-width: 0; \}/);
  assert.match(css, /\.am-bars:has\(> \.am-selection\) > \.sheet-toolbar \{ visibility: hidden; \}/);
  // Phones keep the bar below the search, where it sticks under the title while the list scrolls.
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*?\.am-bars \{ display: contents; \}/);
  // The count shortens before the actions run into it (at 1440 px „1 Datei ausgewählt“ was cut).
  assert.match(css, /@container sheet \(max-width: 1179px\) \{\n {2}\.am \.am-sel-long \{ display: none; \}/);
});
test("„Kacheln“ is the fourth view: cards with a preview picture, opened with a click, ticked in the corner (23.11.2026)", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.match(screen, /data-tip="Kacheln mit Vorschaubildern" onClick=\{\(\) => onChange\("tiles"\)\}><LayoutGrid size=\{14\} aria-hidden="true" \/>Kacheln<\/button>/);
  assert.match(screen, /const compact = minimal \|\| finder \|\| tiles;/);
  // The open customer's folders, the days of „Alle Dateien“, the Ablage without a heading.
  assert.match(screen, /const customerBody = tiles \? tileList\(asTiles\(/);
  assert.match(screen, /const allBody = tiles \? tileList\(dayGroups\.map/);
  assert.match(screen, /const inboxBody = tiles \? tileList\(\[\{ key: "inbox", label: "", folder: false, files: shown \}\]/);
  // Ticks and details exclude each other as in the other views; a click opens the details.
  assert.match(screen, /<AssetTiles label=\{label\} groups=\{list\} size=\{appearance\.tileSize\} selected=\{selected\} onSelect=\{\(ids\) => \{ closeDetails\(\); setSelected\(ids\); \}\}/);
  assert.match(screen, /onOpen=\{\(file\) => open\(file\)\}/);
  // The size: at the bottom right in the footer, and next to the view switch where the footer may be out of sight.
  assert.match(screen, /<SheetFooter trailing=\{tiles \? <TileSizeSwitch size=\{appearance\.tileSize\} onChange=\{\(tileSize\) => update\(\{ tileSize \}\)\} place="bottom" \/> : undefined\}/);
  assert.match(screen, /trailing=\{<>\{tiles && <TileSizeSwitch size=\{appearance\.tileSize\} onChange=\{\(tileSize\) => update\(\{ tileSize \}\)\} place="top" \/>\}/);
  const tiles = await source("components/hub/screens/asset-tiles.tsx");
  // Images through the server's preview, small; only when they scroll into view; the ground fits the image.
  assert.match(tiles, /const source = kind !== "image" \? null : file\.sampleHref \?\? \(live \? previewUrl\(file, "s"\) : null\);/);
  assert.match(tiles, /loading="lazy"/);
  assert.match(tiles, /if \(clear\) detectLogoGround\(shown\)\.then\(setGround\);/);
  // ⇧ adds a range, Strg or ⌘ one more, a plain click opens.
  assert.match(tiles, /if \(event\.shiftKey\) \{ event\.preventDefault\(\); range\(file\.id\); return; \}\n {4}if \(event\.metaKey \|\| event\.ctrlKey\) \{ toggle\(file\.id\); return; \}/);
  // Cards drag like rows and carry their symbol.
  assert.match(tiles, /\{\.\.\.dragAttrs\(file\)\}/);
  assert.match(await source("components/hub/screens/asset-drag.ts"), /state\.row\.querySelector\("\[data-drag-icon\] svg"\) \?\? state\.row\.querySelector\("svg"\)/);
  const css = await source("app/glass.css");
  assert.match(css, /\.at-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(min\(var\(--at-min\), 100%\), 1fr\)\);/);
  // Bottom right only while the footer stays in sight; else up next to the view switch.
  assert.match(css, /@media \(min-width: 1024px\) and \(min-height: 560px\) \{ \.at-size-wrap\.is-top \{ display: none; \} \}/);
  assert.match(css, /@media \(max-width: 1023px\), \(max-height: 559px\) \{ \.at-size-wrap\.is-bottom \{ display: none; \} \}/);
  // A light logo keeps a dark ground, a dark one a light ground, in both themes.
  assert.match(css, /:root\[data-theme="dark"\] \.at-thumb\.is-clear \{ background: repeating-conic-gradient\(#d6d0d3/);
  // Profil › Darstellung offers it as well; lists without pictures (the keychain) show Minimal.
  assert.match(await source("components/hub/screens/appearance.tsx"), /\{ id: "tiles", label: "Kacheln" \}/);
  assert.match(await source("components/hub/sheet.tsx"), /export function SheetFooter\(\{ children, hint, trailing \}/);
});
