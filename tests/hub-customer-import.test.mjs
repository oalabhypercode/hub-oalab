import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  categorySkip, countryFrom, customerNumberFrom, decodeImportFile, detectDelimiter, dropInvalidValues, effectiveStatus, fillsFor, guessMapping, IMPORT_BATCH,
  isPreselected, isSelectable, mappingProblem, parseCsv, planImport, postalCodeFrom, readRows,
} from "../lib/hub-customer-import/rules.ts";
import { normalizeCompany, readCustomer, serviceCustomerRefusal } from "../lib/hub-users/rules.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** The hub's own check of a draft, as the import dialog runs it. */
const check = (draft) => {
  const result = readCustomer(draft);
  return result.ok ? serviceCustomerRefusal(result.value) : result.error;
};

/** A seeded random source, so generated numbers are the same on every run. */
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

const sevdeskHeader = ["Kunden-Nr.", "Kategorie", "Name", "Vorname", "Nachname", "Straße", "PLZ", "Ort", "Land", "Telefon", "Mobil", "E-Mail", "Webseite", "USt-IdNr.", "IBAN"];
const csv = (rows) => [sevdeskHeader, ...rows].map((row) => row.map((cell) => (/[;"\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(";")).join("\r\n");

test("the file is read as UTF-8 or, from Excel on Windows, as Windows-1252", () => {
  const utf8 = new TextEncoder().encode("﻿Name;Ort\r\nMüller GmbH;Köln\r\n");
  assert.equal(decodeImportFile(utf8), "Name;Ort\r\nMüller GmbH;Köln\r\n");
  const ansi = Uint8Array.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x4b, 0xf6, 0x6c, 0x6e]); // "Müller;Köln" in Windows-1252
  assert.equal(decodeImportFile(ansi), "Müller;Köln");
});

test("CSV with semicolons, commas, quotes and line breaks inside fields", () => {
  assert.equal(detectDelimiter("Name;Ort;PLZ\nA;B;C"), ";");
  assert.equal(detectDelimiter("Name,Ort,PLZ\nA,B,C"), ",");
  assert.equal(detectDelimiter('"Firma; mit Semikolon",Ort,PLZ\n'), ",", "separators inside quotes do not count");
  assert.deepEqual(parseCsv('Name;Notiz\r\n"Nalbach & Hinkel; GmbH";"Zeile 1\nZeile 2 ""zitiert"""\r\n\r\n;\r\nLetzte;x'), [
    ["Name", "Notiz"],
    ["Nalbach & Hinkel; GmbH", 'Zeile 1\nZeile 2 "zitiert"'],
    ["Letzte", "x"],
  ]);
});

test("the columns of a Sevdesk export are found by their headers", () => {
  const mapping = guessMapping(sevdeskHeader);
  assert.deepEqual(
    Object.fromEntries(Object.entries(mapping).filter(([, column]) => column !== null).map(([field, column]) => [field, sevdeskHeader[column]])),
    { customerNumber: "Kunden-Nr.", category: "Kategorie", company: "Name", firstName: "Vorname", lastName: "Nachname", street: "Straße", postalCode: "PLZ", city: "Ort", country: "Land", phone: "Telefon", mobile: "Mobil", contactEmail: "E-Mail", website: "Webseite" },
  );
  const other = guessMapping(["Organisation", "E-Mail (geschäftlich)", "Mobiltelefon", "Telefonnummer", "Postleitzahl", "Hausnummer", "Straße"]);
  assert.equal(other.company, 0);
  assert.equal(other.contactEmail, 1);
  assert.equal(other.mobile, 2, "a mobile column is no phone column");
  assert.equal(other.phone, 3);
  assert.equal(other.postalCode, 4);
  assert.equal(other.houseNumber, 5);
  assert.equal(other.street, 6);
  assert.equal(guessMapping(["Vorname", "Nachname"]).company, null, "a last name is not a company");
  assert.ok(mappingProblem(guessMapping(["E-Mail", "Ort"])));
  assert.equal(mappingProblem(guessMapping(["Nachname"])), null, "persons alone are enough");
});

test("numbers, countries, postal codes and categories as the hub needs them", () => {
  assert.equal(customerNumberFrom("1003"), "OA-1003");
  assert.equal(customerNumberFrom("12"), "OA-0012", "Service wants at least four characters");
  assert.equal(customerNumberFrom("OA-48213"), "OA-48213");
  assert.equal(customerNumberFrom(" oa 4821 "), "OA-4821");
  assert.equal(customerNumberFrom("KD-24017"), "OA-KD24017");
  assert.equal(customerNumberFrom(""), "");
  assert.equal(countryFrom("DE"), "Deutschland");
  assert.equal(countryFrom("Austria"), "Österreich");
  assert.equal(countryFrom(""), "Deutschland");
  assert.equal(countryFrom("Portugal"), "Portugal");
  assert.equal(postalCodeFrom("1067", "Deutschland"), "01067", "Excel dropped the leading zero");
  assert.equal(postalCodeFrom("1010", "Österreich"), "1010", "Austria has four digits");
  assert.equal(categorySkip("Kunde"), null);
  assert.equal(categorySkip(""), null);
  assert.equal(categorySkip("Lieferant"), "Kategorie „Lieferant“");
});

test("rows become drafts; contact persons fill their company instead of becoming customers", () => {
  const table = parseCsv(csv([
    ["1003", "Kunde", "Nalbach & Hinkel GmbH", "", "", "Hauptstraße 5", "1067", "Dresden", "DE", "", "", "", "nalbach-hinkel.de", "DE123456789", "DE00 0000"],
    ["1004", "Kunde", "Nalbach & Hinkel GmbH", "Max", "Muster", "", "", "", "", "+49 351 123456", "", "max@nalbach-hinkel.de", "", "", ""],
    ["1005", "Lieferant", "Druckerei Beispiel", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "Kunde", "", "Erika", "Probe", "Weg 1", "48149", "Münster", "", "", "0171 1234567", "erika@example.de", "", "", ""],
    ["1007", "Kunde", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ]));
  const rows = readRows(table, guessMapping(table[0]), normalizeCompany);
  assert.equal(rows.length, 4, "the contact person's row went into its company");
  const [company, supplier, person, empty] = rows;
  assert.deepEqual(company.draft, {
    company: "Nalbach & Hinkel GmbH", customerNumber: "OA-1003", contactEmail: "max@nalbach-hinkel.de", phone: "+49 351 123456", website: "nalbach-hinkel.de",
    street: "Hauptstraße 5", postalCode: "01067", city: "Dresden", country: "Deutschland",
  });
  assert.ok(company.notes.some((note) => note.includes("Max Muster (Zeile 3)")));
  assert.ok(company.notes.includes("Führende Null der PLZ ergänzt"));
  assert.equal(supplier.skip, "Kategorie „Lieferant“");
  assert.equal(person.draft.company, "Erika Probe", "a person without a company is named by their name");
  assert.equal(person.draft.phone, "0171 1234567", "the mobile number when there is no phone");
  assert.equal(person.draft.customerNumber, "");
  assert.equal(empty.problem, "Ohne Unternehmen und ohne Namen");
  const json = JSON.stringify(rows);
  assert.doesNotMatch(json, /DE123456789|DE00 0000/, "tax and bank data never reach a draft");
});

test("a company row after its contact person leads and keeps the person's details", () => {
  const table = parseCsv(csv([
    ["", "Kunde", "KalaClo", "Lea", "Kala", "", "", "", "", "", "", "lea@kalaclo.de", "", "", ""],
    ["2001", "Kunde", "KalaClo", "", "", "Ring 2", "50667", "Köln", "", "", "", "", "kalaclo.de", "", ""],
  ]));
  const rows = readRows(table, guessMapping(table[0]), normalizeCompany);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line, 3);
  assert.equal(rows[0].draft.customerNumber, "OA-2001");
  assert.equal(rows[0].draft.contactEmail, "lea@kalaclo.de");
  assert.equal(rows[0].draft.city, "Köln");
});

test("values the hub would refuse are left empty with a note, the customer stays", () => {
  const row = { line: 2, draft: { company: "Beispiel GmbH", customerNumber: "OA-1009", contactEmail: "kein-mail", phone: "ruf an", website: "", street: "", postalCode: "", city: "", country: "Deutschland" }, sourceNumber: "1009", person: "", skip: null, problem: null, notes: [] };
  const clean = dropInvalidValues(row, check);
  assert.equal(clean.problem, null);
  assert.equal(clean.draft.contactEmail, "");
  assert.equal(clean.draft.phone, "");
  assert.equal(clean.notes.length, 2);
  const long = dropInvalidValues({ ...row, draft: { ...row.draft, company: "x".repeat(170) } }, check);
  assert.match(long.problem, /höchstens 160 Zeichen/);
  const number = dropInvalidValues({ ...row, draft: { ...row.draft, customerNumber: `OA-${"1".repeat(25)}` } }, check);
  assert.match(number.problem, /4 bis 20/);
});

test("filling never overwrites; the country only counts while there is no address", () => {
  const current = { contactEmail: "info@a.de", phone: "", website: "", street: "", postalCode: "", city: "", country: "Deutschland" };
  const incoming = { contactEmail: "neu@a.de", phone: "0251 1", website: "a.de", street: "Weg 1", postalCode: "1010", city: "Wien", country: "Österreich" };
  assert.deepEqual(fillsFor(current, incoming), ["phone", "website", "street", "postalCode", "city", "country"]);
  assert.deepEqual(fillsFor({ ...current, city: "Münster" }, incoming), ["phone", "website", "street", "postalCode"]);
  assert.deepEqual(fillsFor(current, { ...incoming, street: "", postalCode: "", city: "" }), ["phone", "website"], "a country alone is no address");
});

test("the preview compares with the hub's customers by number, then by name", () => {
  const customers = [
    { id: "c1", customerNumber: "OA-55821", company: "AP Beckum", contactEmail: "", phone: "0252 1", website: "", street: "", postalCode: "", city: "", country: "Deutschland" },
    { id: "c2", customerNumber: "OA-1003", company: "Nalbach & Hinkel", contactEmail: "info@nh.de", phone: "", website: "", street: "", postalCode: "", city: "", country: "Deutschland" },
    { id: "c3", customerNumber: "OA-2000", company: "Neon Forge Games", contactEmail: "a@b.de", phone: "1234567", website: "https://neon.de", street: "x", postalCode: "48149", city: "Münster", country: "Deutschland" },
  ];
  const draft = (company, customerNumber, extra = {}) => ({ company, customerNumber, contactEmail: "", phone: "", website: "", street: "", postalCode: "", city: "", country: "Deutschland", ...extra });
  const row = (line, company, customerNumber, extra = {}, more = {}) => ({ line, draft: draft(company, customerNumber, extra), sourceNumber: customerNumber, person: "", skip: null, problem: null, notes: [], ...more });
  const plan = planImport([
    row(2, "AP Beckum GmbH", "OA-1001", { contactEmail: "info@ap-beckum.de", phone: "0999 9" }),
    row(3, "Nalbach und Hinkel GmbH", "OA-1003", { contactEmail: "neu@nh.de" }),
    row(4, "Neue Firma", "OA-1004", { city: "Münster" }),
    row(5, "Andere Firma", "OA-1003"),
    row(6, "Ganz Neu", ""),
    row(7, "Doppelt", "OA-1004"),
    row(8, "AP Beckum", "", {}),
    row(9, "Lieferant AG", "OA-1009", {}, { skip: "Kategorie „Lieferant“" }),
    row(10, "Neon Forge Games", "OA-2000"),
    row(11, "", "", {}, { problem: "Ohne Unternehmen und ohne Namen" }),
  ], customers, normalizeCompany, seeded());
  const byLine = Object.fromEntries(plan.map((item) => [item.line, item]));

  assert.equal(byLine[2].status, "update", "found by name");
  assert.equal(byLine[2].customerId, "c1");
  assert.deepEqual(byLine[2].fills, ["contactEmail"], "the phone the hub has stays");
  assert.equal(byLine[2].renumber, true, "the number from the accounting replaces the hub's random one");
  assert.equal(byLine[3].status, "same", "found by number, nothing empty to fill");
  assert.equal(byLine[3].renumber, false);
  assert.equal(byLine[4].status, "new");
  assert.equal(byLine[5].status, "error");
  assert.match(byLine[5].problem, /steht schon in Zeile 3/);
  assert.equal(byLine[6].status, "new");
  assert.match(byLine[6].draft.customerNumber, /^OA-\d{5}$/, "a free number like „Kunde anlegen“ gives");
  assert.ok(!customers.some((customer) => customer.customerNumber === byLine[6].draft.customerNumber));
  assert.ok(byLine[6].notes.some((note) => note.includes("freie Nummer")));
  assert.equal(byLine[7].status, "error", "the same number twice in the file");
  assert.equal(byLine[8].status, "error", "two rows for one customer");
  assert.match(byLine[8].problem, /Zeile 2/);
  assert.equal(byLine[9].status, "skip");
  assert.equal(byLine[10].status, "same");
  assert.equal(byLine[11].status, "error");

  assert.deepEqual(plan.filter(isPreselected).map((item) => item.line), [2, 4, 6]);
  assert.ok(isSelectable(byLine[9]), "a skipped row can be ticked on purpose");
  assert.equal(effectiveStatus(byLine[9]), "new");
  assert.ok(!isSelectable(byLine[5]) && !isSelectable(byLine[3]));

  const taken = planImport([row(2, "Fremd GmbH", "OA-2000")], customers, normalizeCompany, seeded());
  assert.match(taken[0].problem, /gehört im Hub zu „Neon Forge Games“/, "a number never moves to another company");
});

test("the server action goes the way of „Kunde anlegen“ and never overwrites", async () => {
  const actions = await source("lib/hub-users/actions.ts");
  const start = actions.indexOf("export async function importCustomers");
  const body = actions.slice(start, actions.indexOf("\n}\n", start));
  assert.match(body, /const ctx = await context\(\);\s*if \(!ctx\) return denied;/, "admins only");
  assert.match(body, /rows\.length > IMPORT_BATCH/);
  assert.match(body, /readCustomer\(/);
  assert.match(body, /createServiceCustomer\(ctx, value\)/);
  assert.match(body, /noteServiceCustomer\(ctx, created\.data, "hub_customer_import"\)/);
  assert.match(body, /const fills = fillsFor\(now, value\);/, "the fills are worked out again from the stored customer");
  assert.match(body, /writeCustomer\(ctx, customerId, current\.organization_id, merged\)/);
  assert.match(body, /kindOf\(ctx, customerId\) !== "customer"/, "freelancers are never touched");
  assert.doesNotMatch(body, /auth\.admin|mailPasswordLink|hub_customer_packages/, "no logins, no mails, no packages");
  assert.match(body, /refreshWorkspace\(\);/);
  assert.equal(IMPORT_BATCH, 20);
  // saveCustomer and the import write through the same function.
  assert.equal((actions.match(/await writeCustomer\(/g) ?? []).length, 2);
});

test("the dialog sits in the customers' toolbar and checks drafts like the form", async () => {
  const screen = await source("components/hub/screens/users.tsx");
  assert.match(screen, /if \(tab === "customers"\) return <>\s*<button type="button" className="sheet-action" onClick=\{onImport\}/);
  assert.match(screen, /dialog\?\.kind === "import" && <CustomerImportDialog customers=\{entries\}/);
  const dialog = await source("components/hub/screens/users-import.tsx");
  assert.match(dialog, /const result = readCustomer\(draft\);\s*return result\.ok \? serviceCustomerRefusal\(result\.value\) : result\.error;/);
  assert.match(dialog, /customer\.kind === "customer"/, "only customers are compared, not freelancers");
  assert.match(dialog, /accept="\.csv,text\/csv"/);
  assert.match(dialog, /customerNumber: row\.customerId && !row\.renumber \? row\.existingNumber/, "a match keeps its number unless the file brings another one");
  const knowledge = await source("lib/hub-assistant/knowledge.ts");
  assert.match(knowledge, /^- Import aus Sevdesk \(nur Admin\): /m);
});
