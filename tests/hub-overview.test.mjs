import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { addHiddenIds, EARLIER_LIMIT, HIDDEN_LIMIT, readHiddenIds, relativeWhen, splitNotices, stackByArea } from "../lib/hub-overview/rules.ts";

// The overview (design „V5“, 18.11.2026): one long welcome card and the bell's notices like a phone's. Fictional data only.

// Windows checkouts may carry CRLF line endings; the source checks below compare LF text.
const source = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const notice = (id, kind, createdAt, read = false) => ({ id, kind, title: `Meldung ${id}`, body: "", href: "/dashboard", createdAt, read });
const areaOf = (item) => item.kind.split(".")[0];

test("new and earlier notices: unread first, read ones under „Früher“, hidden ones gone, newest first", () => {
  const items = [
    notice(1, "file.shared", "2026-11-24T09:00:00Z", true),
    notice(2, "chat.reply", "2026-11-25T07:00:00Z"),
    notice(3, "file.shared", "2026-11-25T08:00:00Z"),
    notice(4, "task.customer", "2026-11-25T06:00:00Z"),
  ];
  const plain = splitNotices(items, new Set(), new Set());
  assert.deepEqual(plain.fresh.map((item) => item.id), [3, 2, 4]);
  assert.deepEqual(plain.earlier.map((item) => item.id), [1]);
  assert.equal(plain.more, false);
  const after = splitNotices(items, new Set([2]), new Set([4]));
  assert.deepEqual(after.fresh.map((item) => item.id), [3], "read on this page moves to „Früher“, × hides");
  assert.deepEqual(after.earlier.map((item) => item.id), [2, 1]);
});

test("„Früher“ keeps the newest few and says whether the bell holds more", () => {
  const many = Array.from({ length: EARLIER_LIMIT + 3 }, (_, index) => notice(index + 1, "file.shared", `2026-11-${String(10 + index).padStart(2, "0")}T08:00:00Z`, true));
  const { earlier, more } = splitNotices(many, new Set(), new Set());
  assert.equal(earlier.length, EARLIER_LIMIT);
  assert.equal(earlier[0].id, EARLIER_LIMIT + 3, "the newest first");
  assert.equal(more, true);
});

test("one stack per area like the phone's, in the order of each area's newest notice", () => {
  const stacks = stackByArea([
    notice(1, "file.shared", "2026-11-25T07:00:00Z"),
    notice(2, "chat.reply", "2026-11-25T07:30:00Z"),
    notice(3, "file.shared", "2026-11-25T08:00:00Z"),
    notice(4, "appointment.confirmed", "2026-11-24T08:00:00Z"),
  ], areaOf);
  assert.deepEqual(stacks.map((stack) => [stack.area, stack.items.map((item) => item.id)]), [["file", [3, 1]], ["chat", [2]], ["appointment", [4]]]);
});

test("times as the phone says them, in German time", () => {
  const now = Date.parse("2026-11-25T08:00:00Z"); // Wednesday, 09:00 in Berlin
  assert.equal(relativeWhen("2026-11-25T07:59:40Z", now), "jetzt");
  assert.equal(relativeWhen("2026-11-25T08:00:30Z", now), "jetzt", "a clock a little ahead");
  assert.equal(relativeWhen("2026-11-25T07:48:00Z", now), "vor 12 Min.");
  assert.equal(relativeWhen("2026-11-24T23:30:00Z", now), "vor 8 Std.", "00:30 in Berlin is today");
  assert.equal(relativeWhen("2026-11-24T22:30:00Z", now), "gestern", "23:30 in Berlin was yesterday");
  assert.equal(relativeWhen("2026-11-23T09:00:00Z", now), "Mo.");
  assert.equal(relativeWhen("2026-11-17T09:00:00Z", now), "17. Nov.");
  assert.equal(relativeWhen("kein Datum", now), "");
});

test("what × hid: ids only, each once, the oldest dropped beyond the limit", () => {
  assert.deepEqual(readHiddenIds(null), []);
  assert.deepEqual(readHiddenIds("kaputt"), []);
  assert.deepEqual(readHiddenIds(JSON.stringify([3, "4", -1, 2.5, 7])), [3, 7]);
  assert.deepEqual(addHiddenIds([1, 2], [2, 3]), [1, 2, 3]);
  const full = Array.from({ length: HIDDEN_LIMIT }, (_, index) => index + 1);
  assert.deepEqual(addHiddenIds(full, [HIDDEN_LIMIT + 1]).slice(0, 2), [2, 3]);
  assert.equal(addHiddenIds(full, [HIDDEN_LIMIT + 1]).length, HIDDEN_LIMIT);
});

test("the overview: one long welcome card, then the notifications; freelancers keep their card and files", async () => {
  const overview = await source("components/hub/screens/overview.tsx");
  assert.match(overview, /: <div className="section-first welcome-row is-merged">\{admin\n\s+\? <WelcomeCard account=\{account\} initials=\{initials\} logo=\{logo\} facts=\{facts \?\? \(preview \? previewFacts : null\)\} \/>\n\s+: <WelcomeStage account=\{account\} logo=\{logo\} preview=\{preview\} \/>\}<\/div>\}/);
  assert.match(overview, /<NotificationCenter items=\{preview \? previewNotices\(asOf, admin\) : inbox\?\.items \?\? \[\]\} preview=\{preview\} admin=\{admin\} insightsHref=\{hubHref\(preview, "insights"\)\} userKey=\{userKey\} \/>/);
  assert.match(overview, /\? <FreelancerOverview preview=\{preview\} fileState=\{fileState\} asOf=\{asOf\} \/>/);
  assert.doesNotMatch(overview, /Favoriten|Highlights|LiveOverview|InsightsCard/, "what stands where lives on Insights");
  const stage = await source("components/hub/welcome-stage.tsx");
  assert.match(stage, /const customer = !account\.admin && !account\.freelancer;/);
  assert.match(stage, /\{customer && <ServiceButton \/>\}/, "the way to the service platform sits in the customers' welcome card");
  const cards = await source("components/hub/cards.tsx");
  assert.match(cards, /<div><dt>Organisation<\/dt><dd>oalab-Team<\/dd><\/div>/);
  assert.doesNotMatch(cards, /export function ServiceCard/);
});

test("notifications: a card marks read, × hides it in this browser, the preview stores nothing", async () => {
  const center = await source("components/hub/notification-center.tsx");
  assert.match(center, /<Link href=\{item\.href\} className="glass nt-card" onClick=\{\(\) => markRead\(\[item\.id\]\)\}>/);
  assert.match(center, /if \(preview\) return;\n\s+void markNoticesRead\(unread\)/);
  assert.match(center, /if \(preview\) return;\n\s+void markNoticesRead\(\)\.then/, "„Alle gelesen“ marks everything");
  assert.match(center, /const hiddenKey = \(userKey: string\) => `oalab-hub-notices-hidden:\$\{userKey\}`;/);
  assert.match(center, /const when = \(iso: string\) => now \? relativeWhen\(iso, now\) : noticeWhen\(iso\);/, "server and first render show the clock time");
});

test("the admins' facts load on the overview only, after the admin check, without freelancers and archived ones", async () => {
  const server = await source("lib/hub-overview/server.ts");
  assert.match(server, /if \(role !== "oalab_admin"\) return null;\n\s+const admin = await verifyHubAdmin\(\);\n\s+const db = admin \? createAdminClient\(\) : null;/);
  assert.match(server, /row\.kind !== "freelancer" && !archive\.customerIds\.has\(row\.id\)/);
  assert.match(server, /heldPackages\(packagesOf\(packages\.byCustomer, id\)\)\.some\(isServicePackageId\)/);
  assert.match(await source("app/dashboard/page.tsx"), /loadOverviewFacts\(identity\.account\?\.role \?\? null\)/);
  assert.match(await source("app/dashboard/[section]/page.tsx"), /validSection === "overview" \? loadOverviewFacts\(identity\.account\?\.role \?\? null\) : undefined/);
  assert.match(await source("components/hub/hub-view.tsx"), /<OverviewScreen \{\.\.\.screen\} userKey=\{userKey\} facts=\{preview \? undefined : overviewFacts\} \/>/);
});
