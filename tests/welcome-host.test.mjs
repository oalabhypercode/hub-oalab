import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import * as welcomeHost from "../lib/welcome-host.ts";
import { HOST_CUES, THINK_CUES, cueCount, hostCue } from "../lib/welcome-host.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** Track handlers of an MP4 (`hdlr` box: the type sits 8 bytes after the tag). */
async function trackKinds(path) {
  const mp4 = await readFile(new URL(`../${path}`, import.meta.url));
  const kinds = [];
  for (let at = mp4.indexOf("hdlr"); at >= 0; at = mp4.indexOf("hdlr", at + 4)) kinds.push(mp4.toString("latin1", at + 12, at + 16));
  return kinds;
}

test("the bubble's lines follow Ali's words", () => {
  assert.deepEqual(HOST_CUES, [0.5, 1.45]);
  assert.equal(hostCue(0), 0);
  assert.equal(hostCue(0.49), 0);
  assert.equal(hostCue(0.5), 1);
  assert.equal(hostCue(1.45), 2);
  assert.equal(hostCue(5.04), 2);
});

test("customers get Ali in the welcome card, admins keep their card", async () => {
  const overview = await source("components/hub/screens/overview.tsx");
  assert.match(overview, /\{account\.admin\s+\? <div className="section-first welcome-row"><WelcomeCard account=\{account\} initials=\{initials\} logo=\{logo\} \/><ServiceCard account=\{account\} \/><\/div>\s+: <div className="section-first welcome-row has-host"><WelcomeStage account=\{account\} logo=\{logo\} preview=\{preview\} \/>\{account\.freelancer\s+\? <FreelancerCard [^\n]+\s+: <ServiceCard account=\{account\} \/>\}<\/div>\}/);
  const layout = await source("app/layout.tsx");
  assert.doesNotMatch(layout, /hostInlineScript/, "no pre-paint mark: Ali plays on every visit");
  assert.match(layout, /import "\.\/glass\.css";\r?\nimport "\.\/welcome-host\.css";/);
  const stage = await source("components/hub/welcome-stage.tsx");
  for (const file of ["ali-welcome.mp4", "ali-welcome.webp"]) {
    assert.match(stage, new RegExp(`"/brand/${file.replace(".", "\\.")}"`));
    assert.ok((await stat(new URL(`../public/brand/${file}`, import.meta.url))).size > 10_000, `public/brand/${file}`);
  }
});

test("the company has its own row under Ali's bubble, with its logo as a plate or its letters (user 4.11.2026)", async () => {
  const stage = await source("components/hub/welcome-stage.tsx");
  assert.match(stage, /<div className="welcome-company-row">\r?\n\s*\{account\.company && <LogoMark logo=\{logo\} initials=\{companyInitials\(account\.company\)\} className="avatar welcome-company-logo" plate \/>\}/);
  assert.match(stage, /<dt className="visually-hidden">Unternehmen<\/dt><dd className="welcome-company">\{account\.company \?\? "Noch nicht zugeordnet"\}<\/dd>/);
  assert.match(stage, /<div className="welcome-company-number"><dt>\{account\.freelancer \? "Freelancer-Nr\." : "Kundennummer"\}<\/dt><dd className="numeric">\{account\.customerNumber \?\? "–"\}<\/dd><\/div>/);
  const mark = await source("components/hub/logo-mark.tsx");
  assert.match(mark, /className=\{`\$\{className\} has-logo\$\{plate \? " is-plate" : ""\}`\}/, "a plate keeps the tile's ground");
  const css = await source("app/welcome-host.css");
  assert.match(css, /\.welcome-company-row \{ grid-area: facts;/);
  // As large as the old welcome avatar; the width follows the logo, so a wordmark stays readable.
  assert.match(css, /\.hub-app \.welcome-company-logo, \.hub-app \.welcome-company-logo\.has-logo \{ flex: none; width: 56px; height: 56px;/);
  assert.match(css, /\.hub-app \.welcome-company-logo\.is-plate \{ width: auto; min-width: 56px; max-width: 168px;/);
  assert.match(css, /\.hub-app \.welcome-company-logo\.is-plate > img \{ width: auto; max-width: 100%; height: 78%; \}/);
});

test("Ali plays without sound: no loudspeaker, a muted video, a file without audio", async () => {
  const stage = await source("components/hub/welcome-stage.tsx");
  assert.doesNotMatch(stage, /Volume2|Ton abspielen|sound:/);
  assert.doesNotMatch(await source("app/welcome-host.css"), /welcome-replay/);
  const avatar = await source("components/hub/host-avatar.tsx");
  assert.match(avatar, /video\.muted = true;/);
  assert.doesNotMatch(avatar, /sound =|muted = !/);
  const kinds = await trackKinds("public/brand/ali-welcome.mp4");
  assert.ok(kinds.includes("vide"), "a video track");
  assert.ok(!kinds.includes("soun"), "no audio track");
});

test("Ali thinks along at the bottom of a customer's conversation column, on every visit", async () => {
  assert.deepEqual(THINK_CUES, [0.6, 0.72, 0.85, 1.7]);
  assert.deepEqual([0, 0.6, 0.72, 0.85, 1.69, 1.7, 4.96].map((seconds) => cueCount(THINK_CUES, seconds)), [0, 1, 2, 3, 3, 4, 4]);
  assert.equal(hostCue(1.45), cueCount(HOST_CUES, 1.45));
  const screen = await source("components/hub/screens/private-chat.tsx");
  // At the bottom of the customer's column, below the private chat and the way to the service platform; admins see no avatar.
  assert.match(screen, /<div className="chat-service">[\s\S]*?\)\}\r?\n\s*\{!admin && <MessagesHost \/>\}\r?\n\s*<\/section>/);
  const host = await source("components/hub/messages-host.tsx");
  for (const file of ["ali-thinking.mp4", "ali-thinking.webp"]) {
    assert.match(host, new RegExp(`"/brand/${file.replace(".", "\\.")}"`));
    assert.ok((await stat(new URL(`../public/brand/${file}`, import.meta.url))).size > 10_000, `public/brand/${file}`);
  }
  const kinds = await trackKinds("public/brand/ali-thinking.mp4");
  assert.ok(kinds.includes("vide") && !kinds.includes("soun"), "picture, no sound");
  // Leaving resets him, so the next visit thinks again; with reduced motion he only stands there.
  assert.match(host, /return \(\) => \{ window\.clearTimeout\(timer\); setRun\("idle"\); \};/);
  assert.match(host, /const phase = reduced \? "still" :/);
  const css = await source("app/welcome-host.css");
  assert.match(css, /:root:not\(\[data-reduce-motion="true"\]\) \.chat-think\[data-phase="ready"\] :is\(\.host-avatar, \.think-bubble, \.think-dot\) \{ opacity: 0; \}/);
  assert.match(css, /\.chat-list \.chat-think \{ position: relative; flex: none;/);
});

test("Ali greets each time the overview opens, after the greeting after sign-in, and stands still with reduced motion (user 4.11.2026)", async () => {
  const stage = await source("components/hub/welcome-stage.tsx");
  // No once-per-sign-in mark any more: only the greeting after sign-in and "Bewegung reduzieren" hold him back.
  assert.match(stage, /const phase = reduced \? "still" : run === "idle" \|\| run === "starting" \? "ready" : run;/);
  assert.match(stage, /if \(reduced \|\| greeting\) return;/, "it starts once the greeting after sign-in has given way");
  assert.match(stage, /attributeFilter: \["data-greeting", "data-reduce-motion"\]/);
  assert.match(stage, /const serverSnapshot = \(\) => "\|";/, "the server renders him due");
  // Next keeps the overview hidden for the next visit; resetting as it hides lets him rise again without a flash.
  assert.match(stage, /useLayoutEffect\(\(\) => \(\) => setRun\("idle"\), \[\]\);/);
  for (const gone of ["hostPending", "hostInlineScript", "consumeHost", "HOST_PREVIEW_KEY"]) assert.ok(!(gone in welcomeHost), gone);
  for (const path of ["app/layout.tsx", "app/welcome-host.css", "components/hub/welcome-stage.tsx"]) {
    assert.doesNotMatch(await source(path), /data-host|dataset\.host|consumeHost/, path);
  }
  // Hidden until he rises, also in the server HTML; with reduced motion he stands there at once, in place.
  const css = await source("app/welcome-host.css");
  assert.match(css, /:root:not\(\[data-reduce-motion="true"\]\) \.welcome-stage\[data-phase="ready"\] :is\(\.host-avatar, \.speech-bubble\) \{ opacity: 0; \}/);
  assert.match(css, /:root:not\(\[data-reduce-motion="true"\]\) \.welcome-stage\[data-phase="ready"\] \.host-avatar \{ transform: translateY\(22px\); \}/);
  assert.doesNotMatch(css, /^\.welcome-stage\[data-phase="ready"\]/m, "no rule hides or moves him with reduced motion");
  const avatar = await source("components/hub/host-avatar.tsx");
  assert.match(avatar, /<video className="host-avatar-video" ref=\{videoRef\} muted playsInline preload="none" onEnded=\{ended\} \/>/);
});
