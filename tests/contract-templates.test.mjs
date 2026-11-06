import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8 } from "fflate";
import { decodeXml, docxPlaceholders, fillDocx, fillXml, looksLikeDocx, readDocx, scanPlaceholders } from "../lib/contract-templates/docx.ts";
import {
  blankValues, checkTemplateScan, computedValues, contractFields, contractFileName, contractTemplateIds, contractTemplates, contractValues, domainFromWebsite,
  formatMoney, initialInput, knownPlaceholders, nextMonthStart, parseDay, parseMoney, parsePercent, parseVersionName, placeholderLabel, sortedVersions,
  suggestedTemplate, versionFileName,
} from "../lib/contract-templates/catalog.ts";
import { OPERATOR } from "../lib/legal-details.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const templateBytes = async (id) => new Uint8Array(await readFile(new URL(`../lib/contract-templates/templates/${contractTemplates[id].file}`, import.meta.url)));
const operator = { street: OPERATOR.street, city: OPERATOR.city, partners: OPERATOR.partners };
const paragraph = (...runs) => `<w:p><w:pPr><w:pStyle w:val="Titel"/></w:pPr>${runs.map((text) => `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`).join("")}</w:p>`;
const texts = (xml) => [...xml.matchAll(/<w:t(?=[\s>])[^>]*>([^<]*)<\/w:t>/g)].map((match) => decodeXml(match[1]));

test("placeholders split by Word across runs are found and filled in the first run", () => {
  const xml = `<w:body>${paragraph("Firma: {{kun", "de_fir", "ma}} in ", "{{KUNDE_PLZ_ORT }}")}</w:body>`;
  assert.deepEqual(scanPlaceholders(xml).keys, ["kunde_firma", "kunde_plz_ort"]);
  const filled = fillXml(xml, (key) => ({ kunde_firma: "Nalbach & Hinkel GmbH", kunde_plz_ort: "56566 Neuwied" })[key]);
  assert.deepEqual(texts(filled), ["Firma: Nalbach & Hinkel GmbH", "", " in ", "56566 Neuwied"]);
  assert.match(filled, /Nalbach &amp; Hinkel GmbH/, "values are escaped for XML");
  assert.equal((filled.match(/<w:i\/>/g) ?? []).length, 4, "every run keeps its formatting");
});

test("unknown placeholders stay, broken ones are reported, paragraphs never merge", () => {
  const xml = `<w:body>${paragraph("{{bekannt}} und {{unbekannt}}")}${paragraph("Preis {{preis_mon")}${paragraph("at}} Euro")}</w:body>`;
  const filled = fillXml(xml, (key) => (key === "bekannt" ? "ja" : undefined));
  assert.deepEqual(texts(filled), ["ja und {{unbekannt}}", "Preis {{preis_mon", "at}} Euro"]);
  const scan = scanPlaceholders(xml);
  assert.deepEqual(scan.keys, ["bekannt", "unbekannt"]);
  assert.equal(scan.broken.length, 2, "an opening and a closing half in two paragraphs");
});

test("tabs, empty text nodes, self-closing paragraphs and text boxes do not confuse the scan", () => {
  const xml = `<w:body><w:p/><w:p><w:r><w:t>A</w:t></w:r><w:r><w:tab/><w:t/></w:r><w:r><w:t>{{x}}</w:t></w:r>`
    + `<w:r><w:pict><w:txbxContent><w:p><w:r><w:t>{{y}}</w:t></w:r></w:p></w:txbxContent></w:pict></w:r><w:r><w:t>B</w:t></w:r></w:p></w:body>`;
  const filled = fillXml(xml, (key) => key.toUpperCase());
  assert.deepEqual(texts(filled), ["A", "X", "Y", "B"]);
  assert.match(filled, /<w:tab\/>/);
  assert.match(filled, /^<w:body><w:p\/>/);
});

test("amounts, percentages, days and domains are read and written the German way", () => {
  assert.equal(parseMoney("30"), 3000);
  assert.equal(parseMoney("30,5"), 3050);
  assert.equal(parseMoney("1.140,00 €"), 114000);
  assert.equal(parseMoney("95.00"), 9500);
  assert.equal(parseMoney("drei"), null);
  assert.equal(parseMoney("1,2,3"), null);
  assert.equal(formatMoney(114000), "1.140,00");
  assert.equal(parsePercent("7,5 %"), 7.5);
  assert.equal(parsePercent("120"), null);
  assert.equal(parseDay("2026-10-01"), "2026-10-01");
  assert.equal(parseDay("1.10.2026"), "2026-10-01");
  assert.equal(parseDay("2026-02-30"), null);
  assert.equal(nextMonthStart("2026-11-05"), "2026-12-01");
  assert.equal(nextMonthStart("2026-12-31"), "2027-01-01");
  assert.equal(domainFromWebsite("https://www.Nalbach-Hinkel.de/kontakt?x=1"), "nalbach-hinkel.de");
  assert.equal(domainFromWebsite(""), "");
});

test("annual price, discount and minute steps follow the contracts", () => {
  assert.deepEqual(computedValues(3000, 30, 10), { preis_jahr_regulaer: "360,00", rabatt_betrag: "36,00", preis_jahr: "324,00", minuten_stufe_1: "90", minuten_stufe_2: "150" });
  assert.deepEqual(computedValues(1500, 60, 10), { preis_jahr_regulaer: "180,00", rabatt_betrag: "18,00", preis_jahr: "162,00", minuten_stufe_1: "120", minuten_stufe_2: "180" });
});

const nalbach = {
  kunde_firma: "Nalbach & Hinkel GmbH", kunde_strasse: "Allensteiner Straße 18", kunde_plz_ort: "56566 Neuwied", kunde_domain: "nalbach-hinkel.de",
  vertragsbeginn: "2026-10-01", preis_monat: "30,00", minuten_monat: "30", preis_zusatzblock: "95", rabatt_prozent: "10",
  dienstleister_name: "Sebastian Heinen IT", dienstleister_strasse: "Volkeshaus 6a", dienstleister_plz_ort: "42857 Remscheid",
  ort_datum: "Münster, 03.08.2026", ag_name: "", ag_funktion: "", an_name: "Mohammad Ali Sameh", an_funktion: "Geschäftsführer",
};

test("the form's values become every placeholder; required fields and bad numbers are refused", () => {
  const result = contractValues(contractTemplates["website-pflege"], nalbach, operator);
  assert.ok(result.ok);
  assert.equal(result.values.vertragsbeginn, "01.10.2026");
  assert.equal(result.values.preis_zusatzblock, "95,00");
  assert.equal(result.values.preis_jahr, "324,00");
  assert.equal(result.values.ag_name, "_".repeat(contractFields.ag_name.line), "an empty optional field becomes a line");
  assert.equal(result.values.oalab_strasse, OPERATOR.street, "oalab's address comes from the imprint");
  assert.equal(result.values.oalab_plz_ort, OPERATOR.city);
  for (const key of knownPlaceholders(contractTemplates["website-pflege"])) assert.ok(result.values[key], key);

  const broken = contractValues(contractTemplates["website-pflege"], { ...nalbach, kunde_firma: " ", preis_monat: "dreißig", vertragsbeginn: "31.02.2026" }, operator);
  assert.ok(!broken.ok);
  assert.deepEqual(Object.keys(broken.errors).sort(), ["kunde_firma", "preis_monat", "vertragsbeginn"]);
});

test("the form starts from the customer master and each template's own values", () => {
  const customer = { company: "Nalbach & Hinkel GmbH", street: "Allensteiner Straße 18", postalCode: "56566", city: "Neuwied", website: "https://nalbach-hinkel.de" };
  const pflege = initialInput(contractTemplates["website-pflege"], customer, "2026-11-05", operator);
  assert.equal(pflege.kunde_plz_ort, "56566 Neuwied");
  assert.equal(pflege.kunde_domain, "nalbach-hinkel.de");
  assert.equal(pflege.vertragsbeginn, "2026-12-01");
  assert.equal(pflege.ort_datum, "Münster, 05.11.2026");
  assert.equal(pflege.an_name, OPERATOR.partners[0]);
  assert.equal(pflege.an_funktion, "Geschäftsführer");
  assert.equal(pflege.preis_monat, "30,00");
  const komplett = initialInput(contractTemplates["website-domain-mail"], customer, "2026-11-05", operator);
  assert.deepEqual([komplett.preis_monat, komplett.minuten_monat, komplett.hoster], ["15,00", "60", "netcup GmbH"]);
  assert.equal(suggestedTemplate(["domain-mail", "service-lite"]), "website-domain-mail");
  assert.equal(suggestedTemplate([null, "service-max"]), "website-pflege");
});

test("both default templates carry exactly their placeholders and no customer's data", async () => {
  const forbidden = ["Nalbach", "Hinkel", "Neuwied", "Remscheid", "Heinen", "Lüring", "Berler", "Auftraggeberin", "Neustr", "48167"];
  for (const id of contractTemplateIds) {
    const template = contractTemplates[id];
    const bytes = await templateBytes(id);
    assert.ok(looksLikeDocx(bytes), id);
    const scan = docxPlaceholders(bytes);
    assert.deepEqual(scan.broken, [], `${id}: no broken placeholders`);
    for (const key of scan.keys) assert.ok(knownPlaceholders(template).includes(key), `${id}: {{${key}}} is a known placeholder`);
    for (const key of template.fields) assert.ok(scan.keys.includes(key), `${id}: the field ${key} appears in the template`);
    const text = Object.entries(readDocx(bytes)).filter(([name]) => name.startsWith("word/")).map(([, data]) => strFromU8(data)).join("");
    for (const word of forbidden) assert.ok(!text.includes(word), `${id} contains ${word}`);
    assert.ok(bytes.length < 200_000, `${id}: small enough (${bytes.length} bytes)`);
  }
});

test("a filled or blank contract keeps the template's other parts byte for byte and has no placeholder left", async () => {
  const bytes = await templateBytes("website-pflege");
  const values = contractValues(contractTemplates["website-pflege"], nalbach, operator);
  assert.ok(values.ok);
  const filled = fillDocx(bytes, (key) => values.values[key]);
  assert.deepEqual(docxPlaceholders(filled), { keys: [], broken: [] });
  const before = readDocx(bytes);
  const after = readDocx(filled);
  assert.deepEqual(Object.keys(after), Object.keys(before), "same parts in the same order");
  assert.deepEqual(after["word/media/image1.png"], before["word/media/image1.png"], "the logo is untouched");
  const body = strFromU8(after["word/document.xml"]);
  for (const expected of ["Nalbach &amp; Hinkel GmbH", "nalbach-hinkel.de", "324,00", "Sebastian Heinen IT", "01.10.2026", OPERATOR.street]) assert.ok(body.includes(expected), expected);

  for (const id of contractTemplateIds) {
    const blank = blankValues(contractTemplates[id], operator);
    const out = fillDocx(await templateBytes(id), (key) => blank[key]);
    assert.deepEqual(docxPlaceholders(out).keys, [], `${id}: blank has no placeholder left`);
  }
});

test("uploaded versions are named by time, read back and sorted newest first", () => {
  const name = versionFileName("upload", new Date("2026-11-05T12:05:09.500Z"), "k3x9ab");
  assert.equal(name, "20261105-120509-upload-k3x9ab.docx");
  assert.deepEqual(parseVersionName(name), { name, kind: "upload", createdAt: "2026-11-05T12:05:09Z" });
  assert.equal(parseVersionName("../../evil.docx"), null);
  assert.equal(parseVersionName("20261105-120509-hack-k3x9ab.docx"), null);
  const older = versionFileName("standard", new Date("2026-11-04T08:00:00Z"), "aaaa");
  const newer = versionFileName("restore", new Date("2026-11-06T08:00:00Z"), "bbbb");
  assert.deepEqual(sortedVersions([older, ".emptyFolderPlaceholder", name, newer]).map((version) => version.kind), ["restore", "upload", "standard"]);
});

test("a new version needs known, complete placeholders; fields the text dropped only warn", () => {
  const template = contractTemplates["website-pflege"];
  const all = { keys: knownPlaceholders(template), broken: [] };
  assert.deepEqual(checkTemplateScan(template, all), { keys: all.keys, unknown: [], missing: [], broken: [], ok: true });
  const typo = checkTemplateScan(template, { keys: ["kunde_frima", ...template.fields.slice(1)], broken: [] });
  assert.equal(typo.ok, false);
  assert.deepEqual(typo.unknown, ["kunde_frima"]);
  assert.deepEqual(typo.missing, ["kunde_firma"]);
  const dropped = checkTemplateScan(template, { keys: template.fields.filter((key) => key !== "ag_funktion"), broken: [] });
  assert.equal(dropped.ok, true, "a field the text no longer uses does not block");
  assert.deepEqual(dropped.missing, ["ag_funktion"]);
  assert.equal(checkTemplateScan(template, { keys: template.fields, broken: ["Preis {{preis_mon"] }).ok, false);
  assert.equal(checkTemplateScan(template, { keys: [], broken: [] }).ok, false, "a file without placeholders is no template");
  assert.equal(placeholderLabel("dienstleister_name"), "Externer IT-Dienstleister: Name");
  assert.match(placeholderLabel("preis_jahr"), /berechnet/);
});

test("versions live in the admins-only bucket, uploads are checked twice and macros are refused", async () => {
  const actions = await source("lib/contract-templates/actions.ts");
  assert.match(actions, /vbaProject\\\.bin/, "Word files with macros are refused");
  const activate = actions.slice(actions.indexOf("export async function activateTemplateUpload"));
  assert.match(activate.slice(0, activate.indexOf("\n}\n")), /checkStaged\(/, "the check runs again before a version becomes active");
  const server = await source("lib/contract-templates/server.ts");
  assert.match(server, /if \(!versions\) return null;/, "no silent fallback to the default text when the storage cannot be read");
  assert.match(server, /HUB_FILES_BUCKET/);
});

test("every contract feature explains itself with an ⓘ right where it is used", async () => {
  const generator = await source("components/hub/screens/contract-generator.tsx");
  assert.match(generator, /<Modal title="Vertrag erstellen"[^>]*actions=\{generatorInfo\.button\}/);
  assert.match(generator, /<legend>Beim Kunden ablegen\{fileInfo\.button\}<\/legend>/, "the ⓘ sits in the first legend, so a disabled fieldset keeps it usable");
  const versions = await source("components/hub/screens/contract-template-versions.tsx");
  assert.match(versions, /label="Vertragsvorlagen"[^\n]*actions=\{info\.button\}>/, "the templates are a group of rows with the ⓘ at its heading");
  assert.equal((versions.match(/<Modal [^>]*actions=\{info\.button\}/g) ?? []).length, 2, "both template dialogs carry an ⓘ");
  assert.match(await source("components/hub/info-box.tsx"), /aria-expanded=\{open\}/);
});

test("file names are safe on every system", () => {
  assert.equal(contractFileName(contractTemplates["website-pflege"], "Nalbach & Hinkel GmbH"), "Servicevertrag Website-Pflege – Nalbach & Hinkel GmbH.docx");
  assert.equal(contractFileName(contractTemplates["website-domain-mail"], "A/B: C*D?", "pdf"), "Servicevereinbarung Website, Domain & Mail – A-B- C-D-.pdf");
});

test("the generator lives in Vertrag & Domain, for admins only, and its templates reach the server bundle", async () => {
  const screen = await source("components/hub/screens/contracts.tsx");
  assert.match(screen, /tab === "contract" && state\.canManage && <div className="am-pane-actions"><ContractGeneratorButton/);
  assert.match(await source("components/hub/screens/contracts-overview.tsx"), /<ContractTemplatesSection canManage=\{state\.canManage\} \/>/);
  assert.doesNotMatch(screen.slice(screen.indexOf("function ContractsCustomer")), /ContractGenerator|ContractTemplatesSection/, "customers never see the generator");
  const actions = await source("lib/contract-templates/actions.ts");
  const exported = [...actions.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
  assert.ok(exported.length >= 11, "every action is listed");
  for (const name of exported) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, body.indexOf("\n}\n")), /adminSession\(\)/, `${name} checks the admin`);
  }
  assert.match(actions, /category: "contract"/, "filed contracts are contracts, which the database shows to the customer only");
  assert.match(await source("next.config.ts"), /outputFileTracingIncludes: \{ "\/dashboard\/\*\*": \["\.\/lib\/contract-templates\/templates\/\*\.docx"\] \}/);
});
