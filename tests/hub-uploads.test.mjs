import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { daysBetween, expiryOf, GiB, limitLabel, partCount, partRange, spaceMeter, UPLOAD_MAX_BYTES, UPLOAD_PART_BYTES, uploadKind } from "../lib/hub-uploads/rules.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((text) => text.replace(/\r\n/g, "\n"));
const at = (iso) => Date.parse(iso);

test("uploads go up in parts below Cloudflare's 100 MB per request; 5 GB take 80 parts", () => {
  assert.ok(UPLOAD_PART_BYTES < 100 * 1000 * 1000);
  assert.equal(UPLOAD_MAX_BYTES, 5 * GiB);
  assert.equal(partCount(UPLOAD_MAX_BYTES), 80);
  assert.equal(partCount(1), 1);
  assert.equal(partCount(UPLOAD_PART_BYTES + 1), 2);
  assert.deepEqual(partRange(UPLOAD_PART_BYTES + 10, 2), { start: UPLOAD_PART_BYTES, end: UPLOAD_PART_BYTES + 10 });
});

test("time left counts Berlin's calendar days: calm for admins, yellow and red on the last days", () => {
  const now = at("2026-11-28T10:00:00Z");
  assert.equal(daysBetween(now, at("2026-11-28T22:30:00Z")), 0);
  assert.equal(daysBetween(now, at("2026-11-28T23:30:00Z")), 1, "after midnight in Berlin it is the next day");
  assert.deepEqual(expiryOf(at("2026-12-05T10:00:00Z"), now, "admin"), { days: 7, text: "noch 7 Tage", short: "7 Tage", tone: "off" });
  assert.deepEqual(expiryOf(at("2026-11-30T09:00:00Z"), now, "admin"), { days: 2, text: "noch 2 Tage", short: "2 Tage", tone: "todo" });
  assert.deepEqual(expiryOf(at("2026-11-29T09:00:00Z"), now, "customer"), { days: 1, text: "noch 1 Tag", short: "1 Tag", tone: "bad" });
  assert.deepEqual(expiryOf(at("2026-11-28T18:00:00Z"), now, "admin"), { days: 0, text: "läuft heute ab", short: "heute", tone: "bad" });
  assert.equal(expiryOf(at("2026-12-01T09:00:00Z"), now, "customer").tone, "todo");
});

test("icons by kind, limits in GB and the meter's tones", () => {
  assert.equal(uploadKind("Imagefilm.MOV"), "video");
  assert.equal(uploadKind("Fotos.zip"), "archive");
  assert.equal(uploadKind("Shooting.CR2"), "image");
  assert.equal(uploadKind("scan", "image/heic"), "image");
  assert.equal(uploadKind("Briefing.pdf"), "doc");
  assert.equal(limitLabel(5 * GiB), "5 GB");
  assert.equal(limitLabel(1.5 * GiB), "1,5 GB");
  assert.deepEqual(spaceMeter(0, 5 * GiB), { percent: 0, tone: "" });
  assert.deepEqual(spaceMeter(4 * GiB, 5 * GiB), { percent: 80, tone: "warn" });
  assert.deepEqual(spaceMeter(4.72 * GiB, 5 * GiB), { percent: 94, tone: "full" });
});

test("the actions check the login, leave decisions to the database and never trust the browser for the size", async () => {
  const actions = await source("lib/hub-uploads/actions.ts");
  assert.match(actions, /^"use server";/);
  // Only the actions are exported; the helpers stay private (an exported function in a „use server“ file is an endpoint).
  const exported = [...actions.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]);
  assert.deepEqual(exported.sort(), ["finishCustomerUpload", "removeUpload", "saveUploadLimits", "startCustomerUpload", "takeUpload", "uploadFileUrl", "uploadPartUrls"]);
  assert.match(actions, /if \(await secondFactorMissing\(supabase, data\.claims\.aal\)\) return null;/);
  assert.match(actions, /rpc\("hub_upload_begin", \{ p_customer: customerId,/);
  assert.match(actions, /rpc\("hub_upload_take", \{ p_upload: id,/);
  assert.match(actions, /if \(!session\?\.admin\) return denied;/);
  // The finished size is the stored object's, from the storage, not what the browser announced.
  assert.match(actions, /const stored = await multipart\.head\(HUB_FILES_BUCKET, row\.storage_path\);\n {4}const finished = await session\.supabase\.rpc\("hub_upload_finish", \{ p_upload: id, p_size: stored\?\.size \?\? 0 \}\);/);
  // Part links only for the caller's own running upload.
  assert.match(actions, /return data && data\.status === "uploading" && data\.uploaded_by === session\.userId && data\.upload_ref \? data : null;/);
  assert.match(actions, /await notifyFileShared\(answer\.fileId, \[row\.customer_id\], fileNotice\(title, answer\.fileId\)\);/);
});

test("the asset management shows the area to admins and customers, the schedule tells and cleans up", async () => {
  const screen = await source("components/hub/screens/asset-management.tsx");
  assert.match(screen, /type View = \{ kind: "customer"; id: string \} \| \{ kind: "all" \} \| \{ kind: "inbox" \} \| \{ kind: "uploads" \};/);
  assert.match(screen, /const uploadsShown = canManage && Boolean\(uploads\?\.ready\);/);
  assert.match(screen, /const takes = \(canAssign \|\| canDrop\) && dropId !== "all" && dropId !== "uploads";/);
  assert.match(screen, /\{uploadArea && <CustomerUploadArea uploads=\{uploads!\} \/>\}/);
  const page = await source("app/dashboard/[section]/page.tsx");
  assert.match(page, /validSection === "files" \? loadHubUploads\(\) : undefined,/);
  const notify = await source("lib/hub-notify/server.ts");
  assert.match(notify, /const uploads = await collectUploadNotices\(db, origin, \{/);
  const sweep = await source("app/api/notifications/sweep/route.ts");
  assert.match(sweep, /await sweepExpiredUploads\(\)\.then\(/);
  const cleanup = await source("lib/hub-uploads/sweep.ts");
  assert.match(cleanup, /where \(status = 'waiting' and expires_at <= now\(\)\) or \(status = 'uploading' and created_at < now\(\) - interval '1 day'\)/);
  // Without the migration there is nothing to read; the hub shows nothing of the area then.
  assert.match(cleanup, /select to_regclass\('public\.hub_uploads'\)::text as table/);
  const loader = await source("lib/hub-uploads/server.ts");
  assert.match(loader, /if \(rows\.error\) return missing\(rows\.error\) \? NO_UPLOADS :/);
});

test("the bell, the mail and Telegram know both kinds; the motion switch is the hub's own", async () => {
  const rules = await source("lib/hub-notify/rules.ts");
  assert.match(rules, /\| "upload\.received" \| "upload\.expiring";/);
  assert.match(rules, /export const UPLOADS_HREF = "\/dashboard\/files\?uploads=1";/);
  const mail = await source("lib/hub-mail/templates.ts");
  assert.match(mail, /"upload\.received": \{ area: "files"/);
  assert.match(mail, /"upload\.expiring": \{ area: "files"/);
  const symbols = await source("components/hub/notice-symbols.ts");
  assert.match(symbols, /if \(kind === "upload\.received"\) return \{ icon: CloudUpload/);
  const telegram = await source("lib/hub-telegram/rules.ts");
  assert.match(telegram, /export function telegramUploadReceived\(/);
  const css = await source("app/uploads.css");
  assert.doesNotMatch(css, /prefers-reduced-motion/);
  assert.match(css, /:root\[data-reduce-motion="true"\] \.up-progress > span \{ transition: none; \}/);
});
