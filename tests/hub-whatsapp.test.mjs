import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractMessages, historyTurns, isTeamRequest, linkMessageUrl, maskPhone, MAX_REPLY_CHARS, parseLinkCode, toWhatsAppText, verifySignature,
} from "../lib/hub-whatsapp/messages.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const secret = "test-app-secret";
const sign = (body, key = secret) => `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;

test("only bodies signed with the app secret are accepted", () => {
  const body = new TextEncoder().encode(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
  assert.equal(verifySignature(body, sign(body), secret), true);
  assert.equal(verifySignature(body, sign(body, "other"), secret), false);
  assert.equal(verifySignature(body, sign(body).replace("sha256=", ""), secret), false);
  assert.equal(verifySignature(body, null, secret), false);
  assert.equal(verifySignature(body, sign(body), ""), false);
  const tampered = new TextEncoder().encode(JSON.stringify({ object: "whatsapp_business_account", entry: [1] }));
  assert.equal(verifySignature(tampered, sign(body), secret), false);
});

test("incoming messages are taken only for our number, statuses are skipped", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [
      { field: "messages", value: { metadata: { phone_number_id: "111" }, messages: [
        { id: "wamid.A", from: "4915112345678", type: "text", text: { body: "  Wie lade ich hoch?  " } },
        { id: "wamid.B", from: "4915112345678", type: "image", image: {} },
        { id: "wamid.C", from: "+49 151", type: "text", text: { body: "ungültiger Absender" } },
      ] } },
      { field: "messages", value: { metadata: { phone_number_id: "999" }, messages: [{ id: "wamid.D", from: "4915112345678", type: "text", text: { body: "fremde Nummer" } }] } },
      { field: "messages", value: { metadata: { phone_number_id: "111" }, statuses: [{ id: "wamid.E", status: "read" }] } },
    ] }],
  };
  assert.deepEqual(extractMessages(payload, "111"), [
    { id: "wamid.A", from: "4915112345678", type: "text", text: "Wie lade ich hoch?" },
    { id: "wamid.B", from: "4915112345678", type: "image", text: null },
  ]);
  assert.deepEqual(extractMessages({ object: "page", entry: [] }, "111"), []);
  assert.deepEqual(extractMessages(null, "111"), []);
});

test("link codes, the TEAM keyword and the wa.me link", () => {
  assert.equal(parseLinkCode("VERBINDEN 123456"), "123456");
  assert.equal(parseLinkCode("  verbinden:123456. "), "123456");
  assert.equal(parseLinkCode("Verbinden 12345"), null);
  assert.equal(parseLinkCode("Bitte verbinden 123456 danke"), null);
  assert.equal(isTeamRequest("Team"), true);
  assert.equal(isTeamRequest("MENSCH!"), true);
  assert.equal(isTeamRequest("Wie arbeitet das Team?"), false);
  assert.equal(linkMessageUrl("+49 30 1234567", "123456"), "https://wa.me/49301234567?text=VERBINDEN%20123456");
  assert.equal(maskPhone("4915112345678"), "+49 … 5678");
});

test("answers use WhatsApp bold and stay within the message limit", () => {
  assert.equal(toWhatsAppText("Öffne **Kalender** und dann **Termin anfragen**."), "Öffne *Kalender* und dann *Termin anfragen*.");
  const long = toWhatsAppText("x".repeat(MAX_REPLY_CHARS + 500));
  assert.equal(long.length, MAX_REPLY_CHARS);
  assert.ok(long.endsWith("…"));
});

test("the stored history becomes alternating turns that start and end with the user", () => {
  assert.deepEqual(historyTurns([
    { role: "assistant", content: "Hallo!" },
    { role: "user", content: "Frage 1" },
    { role: "user", content: "" },
    { role: "user", content: "Nachtrag" },
    { role: "assistant", content: "Antwort 1" },
    { role: "user", content: "Frage 2" },
    { role: "assistant", content: "noch nicht geschickt" },
  ]), [
    { role: "user", content: "Frage 1\nNachtrag" },
    { role: "assistant", content: "Antwort 1" },
    { role: "user", content: "Frage 2" },
  ]);
});

test("the webhook is public only behind the signature check, and the tables are guarded by RLS", async () => {
  const route = await source("app/api/whatsapp/route.ts");
  assert.ok(route.indexOf("verifySignature(") < route.indexOf("JSON.parse("), "signature before parsing");
  assert.ok(route.indexOf("after(") > route.indexOf("verifySignature("), "work only after the check");
  assert.match(await source("lib/supabase/proxy.ts"), /pathname === "\/api\/whatsapp"/);
  const sql = await source("supabase/migrations/20261022150000_hub_whatsapp.sql");
  for (const table of ["hub_whatsapp_links", "hub_whatsapp_link_codes", "hub_whatsapp_messages"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), table);
  }
  assert.match(sql, /revoke all on public\.hub_whatsapp_links, public\.hub_whatsapp_link_codes, public\.hub_whatsapp_messages from anon, authenticated/);
  assert.match(sql, /grant select, delete on public\.hub_whatsapp_links to authenticated;/);
  assert.doesNotMatch(sql, /grant [^;]*insert[^;]*to authenticated/, "users never write links, codes or messages directly");
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /now\(\) \+ interval '15 minutes'/);
});
