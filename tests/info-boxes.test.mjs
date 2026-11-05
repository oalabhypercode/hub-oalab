import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DAILY_QUESTION_LIMIT, RETENTION_HOURS } from "../lib/hub-whatsapp/messages.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * Rule of the user since 5.11.2026: every feature beyond plain viewing explains itself with an ⓘ right where it is
 * used (components/hub/info-box.tsx). One row per place: the file, where the button sits and the box's title.
 */
const places = [
  { file: "components/hub/screens/asset-upload.tsx", title: "So funktioniert das Hochladen", button: /title="Hochladen" subtitle=\{subtitle\} actions=\{info\.button\}/, box: "{info.box}" },
  { file: "components/hub/screens/asset-details.tsx", title: "Freigabe, Ordner und Sichtbarkeit", button: /"Freigegeben für"\}\s*\{canAssign && shareInfo\.button\}/, box: "{canAssign && shareInfo.box}" },
  { file: "components/hub/screens/files-dialogs.tsx", title: "So funktionieren Ordner", button: /<Modal title=\{title\} onClose=\{onClose\} actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/customer-logo-dialog.tsx", title: "So funktioniert das Kundenlogo", button: /className="logo-window" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/asset-freelancers.tsx", title: "So funktioniert „Betreut von“", button: /`Betreut von · \$\{customer\.company\}`\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/asset-management.tsx", title: "Was du hier siehst", button: /<span>\{customerCount\}<\/span>\{freelancerView && freelancerInfo\.button\}<\/h2>/, box: "{freelancerView && freelancerInfo.box}" },
  { file: "components/hub/screens/users-dialogs.tsx", title: "So funktioniert die Freigabe", button: /<Modal title="Registrierung prüfen" onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/users-dialogs.tsx", title: "So funktioniert ein neues Konto", button: /<Modal title=\{user \? fullName\(user\) : "Konto anlegen"\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/users-dialogs.tsx", title: "Zugang verwalten", button: /useInfo\(user \? "Zugang verwalten" : "So funktioniert ein neues Konto"/, box: "{info.box}" },
  { file: "components/hub/screens/users-dialogs.tsx", title: "So funktioniert der Kundenstamm", button: /<Modal title=\{customer \? customer\.company : "Kunde anlegen"\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/users-dialogs.tsx", title: "So funktioniert ein Freelancer", button: /<Modal title=\{freelancer \? freelancer\.company : "Freelancer anlegen"\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-parts.tsx", title: "So funktionieren Pakete", button: /\{info\.button\}\s*<button type="submit" className="sheet-action is-primary"/, box: "{canManage && info.box}" },
  { file: "components/hub/screens/contracts-parts.tsx", title: "So funktioniert der Verlauf", button: /"Zeitpunkt eintragen"\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/private-chat.tsx", title: "So funktioniert der Chat", button: /<h2>Gespräche\{info\.button\}<\/h2>/, box: "{info.box}" },
  { file: "components/hub/screens/private-chat.tsx", title: "So funktionieren die privaten Chats", button: /useInfo\(admin \? "So funktionieren die privaten Chats" : "So funktioniert der Chat"/, box: "{info.box}" },
  { file: "components/hub/screens/calendar-dialogs.tsx", title: "So funktioniert eine Terminanfrage", button: /<Modal title="Termin anfragen" onClose=\{onClose\} actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/calendar-dialogs.tsx", title: "So beantwortest du eine Anfrage", button: /<Modal title=\{appointment\.title\} onClose=\{onClose\} actions=\{answering \? info\.button : undefined\}>/, box: "{answering && info.box}" },
  { file: "components/hub/screens/calendar-dialogs.tsx", title: "Termin und Teams-Link", button: /"Neuer Termin"\} onClose=\{onClose\} actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/assistant-panel.tsx", title: "So funktionieren Aufgaben-Vorschläge", button: /\{info\.button\}\s*<span className=\{`proposal-status/, box: "{info.box}" },
  { file: "components/hub/second-factor-card.tsx", title: "So funktioniert der zweite Faktor", button: /Zwei-Faktor-Schutz\{info\.button\}<\/h2>/, box: "{info.box}" },
  { file: "components/hub/whatsapp-card.tsx", title: "So funktioniert WhatsApp", button: /WhatsApp verbinden\{usable && info\.button\}<\/h2>/, box: "{usable && info.box}" },
];

test("every special feature has its ⓘ right where it is used", async () => {
  for (const place of places) {
    const code = await source(place.file);
    assert.match(code, /import \{ useInfo \} from "\.\.?\/info-box";/, `${place.file} uses the shared hook`);
    assert.ok(code.includes(`"${place.title}"`), `${place.file}: box „${place.title}“`);
    assert.match(code, place.button, `${place.file}: button of „${place.title}“`);
    assert.ok(code.includes(place.box), `${place.file}: box of „${place.title}“ is shown`);
  }
});

test("every box explains in three to six points", async () => {
  for (const file of new Set(places.map((place) => place.file))) {
    if (file.endsWith("assistant-panel.tsx")) continue;
    const code = await source(file);
    // Each hook call up to the end of its (first) list; a list that depends on the role counts its own points.
    const lists = [...code.matchAll(/useInfo\([^]*?<\/ul>/g)].map((match) => match[0]);
    assert.ok(lists.length > 0, `${file} has a box`);
    for (const list of lists) {
      const points = (list.match(/<li[ >]/g) ?? []).length;
      assert.ok(points >= 3 && points <= 6, `${file}: ${points} points in ${list.slice(0, 80)} …`);
    }
  }
  const panel = await source("components/hub/assistant-panel.tsx");
  for (const kind of ["tasks.create", "tasks.update", "project.update", "customer.create"]) {
    assert.match(panel, new RegExp(`"${kind.replace(".", "\\.")}": \\{ title: "`), `the proposal card ${kind} explains itself`);
  }
});

test("the boxes say what the code does", async () => {
  const whatsapp = await source("components/hub/whatsapp-card.tsx");
  assert.ok(whatsapp.includes(`bis zu ${DAILY_QUESTION_LIMIT} am Tag`), "WhatsApp: questions per day");
  assert.equal(RETENTION_HOURS, 48, "WhatsApp: the box says two days of history");
  assert.match(whatsapp, /nach zwei Tagen/);
  assert.doesNotMatch(whatsapp, /lib\/hub-whatsapp\/messages"/, "the card stays free of the server's node:crypto");

  const upload = await source("components/hub/screens/asset-upload.tsx");
  assert.match(upload, /Bis zu \{MAX_UPLOAD_BATCH\} Dateien auf einmal, jede bis \{formatBytes\(MAX_FILE_BYTES\)\}/, "upload limits come from the catalog");
  const calendar = await source("components/hub/screens/calendar-dialogs.tsx");
  assert.match(calendar, /von \{WORKDAY\.start\} bis \{WORKDAY\.end\} Uhr/, "working hours come from the rules");
  assert.match(calendar, /Höchstens \{MAX_OPEN_REQUESTS\} Anfragen/, "open requests come from the rules");

  // Freelancers never reach the service platform; their texts name the hub only.
  const factor = await source("components/hub/second-factor-card.tsx");
  assert.match(factor, /status\?\.required \? "Die Methode, die du hier wählst, fragt der Hub/);
  const chat = await source("components/hub/screens/private-chat.tsx");
  assert.match(chat, /\{!freelancer && <li>Aufträge und Änderungen an deiner Website/);
  // The chat note and the privacy policy describe the Telegram message; the box does not repeat what it contains.
  const telegram = chat.match(/<li>Ist die Telegram-Gruppe eingerichtet[^<]*<\/li>/)?.[0];
  assert.ok(telegram, "the admins' box names the Telegram group");
  assert.doesNotMatch(telegram, /Text|Name|Firma/);
});

test("the ⓘ sits beside labels, list heads and proposals without pushing them apart", async () => {
  const css = await source("app/glass.css");
  assert.match(css, /\.hub-modal > \.info-box \{ margin-bottom: 14px; \}/);
  assert.match(css, /\.am-label \.info-button \{[^}]*margin-right: auto;/, "the label's own action stays on the right");
  assert.match(css, /\.chat-list > \.info-box \{/);
  assert.match(css, /\.proposal-card > \.info-box \{/);
});
