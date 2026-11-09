import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DAILY_QUESTION_LIMIT, RETENTION_HOURS } from "../lib/hub-whatsapp/messages.ts";
import { MAX_FILE_BYTES, MAX_UPLOAD_BATCH } from "../lib/hub-files/catalog.ts";
import { MAX_OPEN_REQUESTS, WORKDAY } from "../lib/hub-calendar/rules.ts";
import { LOOK_LIMIT, LOOK_WINDOW_MINUTES, mailSecurities, REVEAL_SECONDS } from "../lib/hub-domains/rules.ts";
import { serviceRequestLimits } from "../lib/service-packages.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * Rule of the user since 5.11.2026: every feature beyond plain viewing explains itself with an ⓘ right where it is
 * used (components/hub/info-box.tsx). Since 6.11.2026 the card says it in at most three short lines and hands the
 * details to the assistant. One row per place: the file, the card's title, where the button sits and the box.
 */
const places = [
  { file: "components/hub/screens/asset-upload.tsx", call: 'useInfo("Hochladen"', button: /title="Hochladen" subtitle=\{subtitle\} actions=\{info\.button\}/, box: "{info.box}" },
  { file: "components/hub/screens/asset-details.tsx", call: 'useInfo("Freigabe und Sichtbarkeit"', button: /"Freigegeben für"\}\s*\{canAssign && shareInfo\.button\}/, box: "{canAssign && shareInfo.box}" },
  { file: "components/hub/screens/files-dialogs.tsx", call: 'useInfo("Ordner"', button: /<Modal title=\{title\} onClose=\{onClose\} actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/customer-logo-dialog.tsx", call: 'useInfo("Kundenlogo"', button: /className="logo-window" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/asset-freelancers.tsx", call: 'useInfo("Betreut von"', button: /`Betreut von · \$\{customer\.company\}`\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/asset-management.tsx", call: 'useInfo("Was du hier siehst"', button: /<span>\{customerCount\}<\/span>\{freelancerView && freelancerInfo\.button\}<\/h2>/, box: "{freelancerView && freelancerInfo.box}" },
  // The User Management's panels (since 9.11.2026): in the head, or at the section the card is about.
  { file: "components/hub/screens/users-dialogs.tsx", call: 'useInfo("Freigabe"', button: /label=\{`Registrierung von \$\{name\}`\}[^\n]*actions=\{<>\{info\.button\}<EntryNav onPrev=\{onPrev\} onNext=\{onNext\} \/><\/>\}/, box: "{info.box}" },
  { file: "components/hub/screens/users-dialogs.tsx", call: 'useInfo(user ? "Zugang verwalten" : "Neuer Zugang"', button: /<PanelSection title="Anmeldung und Sicherheit" info=\{info\.button\} meta="wirkt sofort">[^]*actions=\{user \? <EntryNav onPrev=\{onPrev\} onNext=\{onNext\} \/> : info\.button\}/, box: "{info.box}" },
  { file: "components/hub/screens/users-dialogs.tsx", call: 'useInfo("Kundenstamm"', button: /<PanelSection title="Firma und Kontakt" info=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/users.tsx", call: 'useInfo("Zugänge, Kunden und Freelancer"', button: /<TabSwitch [^\n]*\/>\{tabsInfo\.button\}\{tabsInfo\.box\}<\/span>/, box: "{tabsInfo.box}" },
  { file: "components/hub/screens/users-logins.tsx", call: 'useInfo("Zugänge anlegen"', button: /<Modal title="Zugänge anlegen" onClose=\{close\} className="users-modal import-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/users-logins.tsx", call: 'useInfo("Einladungen"', button: /<Modal title="Einladungen senden" onClose=\{close\} className="users-modal import-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/users-import.tsx", call: 'useInfo("Import aus Sevdesk"', button: /<Modal title="Kunden importieren" onClose=\{close\} className="users-modal import-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/users-dialogs.tsx", call: 'useInfo("Freelancer"', button: /title=\{freelancer \? freelancer\.company : "Freelancer anlegen"\}[^]*?actions=\{<>\{info\.button\}\{freelancer && <EntryNav/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-parts.tsx", call: 'useInfo("Pakete"', button: /label="Pakete"[^\n]*actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-parts.tsx", call: 'useInfo("Freigabe im Verlauf"', button: /actions=\{index === 0 \? info\.button : undefined\}/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-parts.tsx", call: 'useInfo("Verlauf"', button: /"Zeitpunkt eintragen"\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-domains.tsx", call: 'useInfo("Domains"', button: /"Domain eintragen"\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-domains.tsx", call: 'useInfo("Mail-Server"', button: /label="Mail-Server"[^]*?actions=\{<>\{serverInfo\.button\}/, box: "{serverInfo.box}" },
  { file: "components/hub/screens/contracts-domains.tsx", call: 'useInfo("E-Mail-Adressen"', button: /"E-Mail-Adresse eintragen"\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-customer.tsx", call: 'useInfo("Deine Pakete"', button: /label="Pakete"[^\n]*actions=\{packagesInfo\.button\}>/, box: "{packagesInfo.box}" },
  { file: "components/hub/screens/contracts-customer.tsx", call: 'useInfo("Deine Adressen"', button: /label="E-Mail-Adressen"[^\n]*actions=\{addressesInfo\.button\}>/, box: "{addressesInfo.box}" },
  { file: "components/hub/screens/contracts-access.tsx", call: 'useInfo("Zugangsdaten"', button: /label="Postfächer"[^\n]*actions=\{info\.button\}/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-access.tsx", call: 'useInfo("Anbieter-Login"', button: /"Login anlegen"\} onClose=\{onClose\} className="users-modal" actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-quota.tsx", call: 'useInfo("Service-Kontingente"', button: /label="Service-Kontingente"[^\n]*actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-quota.tsx", call: 'useInfo("Service-Anfragen"', button: /label=\{`Service-Anfragen\$\{month \? ` im \$\{month\.month\}` : ""\}`\}[^]*?actions=\{info\.button\}/, box: "{info.box}" },
  { file: "components/hub/screens/contracts-quota.tsx", call: 'useInfo("Deine Anfragen"', button: /<td className="cell-action">\{info\.button\}\{info\.box\}<\/td>/, box: "{info.box}" },
  { file: "components/hub/screens/private-chat.tsx", call: 'useInfo(admin ? "Private Chats" : "Chat"', button: /<h2>Gespräche\{info\.button\}<\/h2>/, box: "{info.box}" },
  { file: "components/hub/screens/calendar-dialogs.tsx", call: 'useInfo("Termin anfragen"', button: /<Modal title="Termin anfragen" onClose=\{onClose\} actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/calendar-dialogs.tsx", call: 'useInfo("Anfrage beantworten"', button: /<Modal title=\{appointment\.title\} onClose=\{onClose\} actions=\{answering \? info\.button : undefined\}>/, box: "{answering && info.box}" },
  { file: "components/hub/screens/calendar-dialogs.tsx", call: 'useInfo("Termin und Teams-Link"', button: /"Neuer Termin"\} onClose=\{onClose\} actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/contract-generator.tsx", call: 'useInfo("Vertragsgenerator"', button: /<Modal title="Vertrag erstellen"[^>]*actions=\{generatorInfo\.button\}/, box: "{generatorInfo.box}" },
  { file: "components/hub/screens/contract-generator.tsx", call: 'useInfo("Beim Kunden ablegen"', button: /<legend>Beim Kunden ablegen\{fileInfo\.button\}<\/legend>/, box: "{fileInfo.box}" },
  { file: "components/hub/screens/contract-template-versions.tsx", call: 'useInfo("Vertragsvorlagen"', button: /label="Vertragsvorlagen"[^\n]*actions=\{info\.button\}>/, box: "{info.box}" },
  { file: "components/hub/screens/contract-template-versions.tsx", call: 'useInfo("Prüfung vor dem Übernehmen"', button: /actions=\{info\.button\}/, box: "{info.box}" },
  { file: "components/hub/screens/contract-template-versions.tsx", call: 'useInfo("Fassungen"', button: /actions=\{info\.button\}/, box: "{info.box}" },
  { file: "components/hub/assistant-panel.tsx", call: "useInfo(help.title, help.card)", button: /\{info\.button\}\s*<span className=\{`proposal-status/, box: "{info.box}" },
  { file: "components/hub/second-factor-card.tsx", call: 'useInfo("Zweiter Faktor"', button: /Zwei-Faktor-Schutz\{info\.button\}<\/h2>/, box: "{info.box}" },
  { file: "components/hub/whatsapp-card.tsx", call: 'useInfo("WhatsApp"', button: /WhatsApp verbinden\{usable && info\.button\}<\/h2>/, box: "{usable && info.box}" },
];

/** The whole call `useInfo(…)`, brackets balanced. */
function callAt(code, start) {
  let depth = 0;
  for (let index = code.indexOf("(", start); index < code.length; index += 1) {
    if (code[index] === "(") depth += 1;
    else if (code[index] === ")" && --depth === 0) return code.slice(start, index + 1);
  }
  throw new Error("unbalanced useInfo call");
}

/** Every card of a file: its steps (one per line, a role may swap a line), warning and question. */
async function cardsOf(file) {
  const code = await source(file);
  return [...code.matchAll(/useInfo\((?:"|admin|user)/g)].map((match) => {
    const call = callAt(code, match.index);
    const lists = [...call.matchAll(/steps: \[\r?\n([^]*?)\r?\n\s*\],/g)].map((list) => list[1].split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("//")));
    return { call, lists, asks: [...call.matchAll(/ask: "([^"]+)"/g)].map((ask) => ask[1]) };
  });
}

const words = (line) => line.replace(/<\/?[a-z]*>/g, "").replace(/\{[^}]*\}/g, "00").replace(/^[\w?.]+ \? /, "").replace(/,$/, "");

test("every special feature has its ⓘ right where it is used", async () => {
  for (const place of places) {
    const code = await source(place.file);
    assert.match(code, /import \{ useInfo(, type InfoCard)? \} from "\.\.?\/info-box";/, `${place.file} uses the shared hook`);
    assert.ok(code.includes(place.call), `${place.file}: ${place.call}`);
    assert.match(code, place.button, `${place.file}: button of ${place.call}`);
    assert.ok(code.includes(place.box), `${place.file}: the card of ${place.call} is placed`);
  }
});

test("every card says it in at most three short lines and hands the rest to the assistant", async () => {
  let cards = 0;
  for (const file of new Set(places.map((place) => place.file))) {
    if (file.endsWith("assistant-panel.tsx")) continue;
    for (const card of await cardsOf(file)) {
      cards += 1;
      assert.ok(card.lists.length > 0, `${file}: ${card.call.slice(0, 60)} has steps`);
      for (const steps of card.lists) {
        assert.ok(steps.length >= 2 && steps.length <= 3, `${file}: ${steps.length} steps in ${card.call.slice(0, 60)}`);
        for (const line of steps) {
          assert.match(line, /<b>/, `${file}: every step starts with a bold word: ${line}`);
          // A line that depends on the role holds two short lines.
          for (const variant of line.split(/ : (?=<>)/)) assert.ok(words(variant).length <= 64, `${file}: too long: ${words(variant)}`);
        }
      }
      assert.ok(card.asks.length === card.lists.length, `${file}: every card asks the assistant`);
      for (const ask of card.asks) assert.match(ask, /\?$/, `${file}: „${ask}“ is a question`);
      const warn = card.call.match(/warn: (?:[^"]*\? )?"([^"]+)"/)?.[1];
      if (warn) assert.ok(warn.length <= 60, `${file}: the warning stays one line: ${warn}`);
    }
  }
  assert.equal(cards, places.length - 1, "every card of these files is listed above (the proposals counted apart)");
  const panel = await source("components/hub/assistant-panel.tsx");
  for (const kind of ["tasks.create", "tasks.update", "project.update", "customer.create"]) {
    assert.match(panel, new RegExp(`"${kind.replace(".", "\\.")}": \\{ title: "[^"]+", card: `), `the proposal card ${kind} explains itself`);
  }
  for (const steps of panel.matchAll(/steps: \[([^\]]*)\]/g)) assert.ok((steps[1].match(/<><b>|expiryStep/g) ?? []).length <= 3, steps[1]);
});

test("the cards and the assistant's details say what the code does", async () => {
  const upload = await source("components/hub/screens/asset-upload.tsx");
  assert.match(upload, /<b>Bis \{MAX_UPLOAD_BATCH\} Dateien,<\/b> je höchstens \{formatBytes\(MAX_FILE_BYTES\)\}/, "upload limits come from the catalog");
  const calendar = await source("components/hub/screens/calendar-dialogs.tsx");
  assert.match(calendar, /\{WORKDAY\.start\}–\{WORKDAY\.end\} Uhr/, "working hours come from the rules");
  const access = await source("components/hub/screens/contracts-access.tsx");
  assert.match(access, /\{REVEAL_SECONDS\} Sekunden<\/b>/, "reveal time comes from the rules");
  const whatsapp = await source("components/hub/whatsapp-card.tsx");
  assert.ok(whatsapp.includes(`Bis zu ${DAILY_QUESTION_LIMIT} Fragen`), "WhatsApp: questions per day");
  assert.doesNotMatch(whatsapp, /lib\/hub-whatsapp\/messages"/, "the card stays free of the server's node:crypto");
  // The request limits of the Service packages come from the catalog, in every card that names them.
  const quota = await source("components/hub/screens/contracts-quota.tsx");
  assert.match(quota, /const LITE = serviceRequestLimits\["service-lite"\];\r?\nconst MAX = serviceRequestLimits\["service-max"\];/);
  assert.equal((quota.match(/<b>Service Lite \{LITE\}, Max \{MAX\}<\/b>/g) ?? []).length, 2, "the admins' and the customers' card");
  const packages = await source("components/hub/screens/contracts-parts.tsx");
  assert.match(packages, /<b>Service Lite \{serviceRequestLimits\["service-lite"\]\}, Max \{serviceRequestLimits\["service-max"\]\}<\/b>/);
  assert.doesNotMatch(packages, /noch nicht (mit der Serviceplattform )?verbunden/i, "the packages are connected to the service platform now");

  // The details moved into the assistant's knowledge, with the numbers of the code.
  const knowledge = await source("lib/hub-assistant/knowledge.ts");
  const details = knowledge.slice(knowledge.indexOf("## Ausführlich zu den Karten am ⓘ"), knowledge.indexOf("## Demo und Vorschau"));
  assert.ok(details.length > 10000, "the long explanations are kept for the assistant");
  assert.ok(details.includes(`Bis zu ${MAX_UPLOAD_BATCH} Dateien auf einmal, jede bis ${MAX_FILE_BYTES / 1024 / 1024} MB`));
  assert.ok(details.includes(`von ${WORKDAY.start} bis ${WORKDAY.end} Uhr`));
  assert.ok(details.includes(`Höchstens ${MAX_OPEN_REQUESTS} Anfragen`));
  assert.ok(details.includes(`SSL/TLS ${mailSecurities.ssl.ports.imap} und ${mailSecurities.ssl.ports.smtp}, STARTTLS ${mailSecurities.starttls.ports.imap} und ${mailSecurities.starttls.ports.smtp}`));
  assert.ok(details.includes(`${REVEAL_SECONDS} Sekunden lang`));
  assert.ok(details.includes(`mehr als ${LOOK_LIMIT} Passwörter in ${LOOK_WINDOW_MINUTES} Minuten`));
  assert.ok(details.includes(`bis zu ${DAILY_QUESTION_LIMIT} am Tag`));
  assert.ok(details.includes(`Service Lite erlaubt ${serviceRequestLimits["service-lite"]}, Service Max ${serviceRequestLimits["service-max"]} neue Anfragen je Kalendermonat`));
  assert.equal(RETENTION_HOURS, 48, "WhatsApp: the details say two days of history");
  assert.match(details, /nach zwei Tagen/);
  // Every card's question lands where the details are: one bullet per feature.
  assert.ok((details.match(/^- /gm) ?? []).length >= 28);

  // Freelancers never reach the service platform; their lines name the hub only.
  const factor = await source("components/hub/second-factor-card.tsx");
  assert.match(factor, /status\?\.required \? <><b>Bei jeder Anmeldung<\/b> fragt der Hub danach\.<\/>/);
  const chat = await source("components/hub/screens/private-chat.tsx");
  assert.match(chat, /freelancer \? <><b>Antworten<\/b>[^:]*: <><b>Aufträge<\/b> bitte über die Serviceplattform\.<\/>/);
  // The chat note and the privacy policy describe the Telegram message; the card does not touch it.
  assert.doesNotMatch(callAt(chat, chat.indexOf("useInfo(")), /Telegram/);
});

test("the card floats at its ⓘ and hands its question to the assistant", async () => {
  const hook = await source("components/hub/info-box.tsx");
  assert.match(hook, /popover="auto"/, "the browser keeps it above pages, panes and dialogs");
  assert.match(hook, /popoverTarget=\{floating \? id : undefined\}/, "the ⓘ opens and closes it, Escape and a click elsewhere close it");
  assert.match(hook, /aria-expanded=\{open\}/);
  assert.match(hook, /Kurz erklärt/);
  assert.match(hook, /shell\.askAssistant\(card\.ask\)/);
  assert.match(hook, /Mehr dazu im Assistenten/);
  assert.match(await source("components/hub/app-shell.tsx"), /askAssistant: \(question\) => \{ setAssistantQuestion\(/);
  const panel = await source("components/hub/assistant-panel.tsx");
  assert.match(panel, /if \(question && question\.key !== questionKey\) \{/, "a new question replaces the draft");
  assert.doesNotMatch(panel, /ask\(question\.text\)/, "it waits in the input; sending stays the user's choice");

  const css = await source("app/glass.css");
  assert.match(css, /\.info-card\[popover\] \{ position: fixed; inset: auto; margin: 0; overflow: visible; \}/);
  assert.match(css, /@media \(max-width: 767px\) \{\s*\.info-card\[popover\] \{ top: auto !important; left: 8px !important;/, "phones show it as a sheet at the bottom");
  assert.match(css, /\.am-label \.info-button \{[^}]*margin-right: auto;/, "the label's own action stays on the right");
  assert.doesNotMatch(css, /\.info-box\b/, "the old box is gone");
});
