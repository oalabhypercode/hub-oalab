import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { GREETING_STORAGE_KEY, greetingInlineScript, greetsAt } from "../lib/greeting.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** Runs the pre-paint script on a page with the given address and stored note; returns what it left behind. */
function runGreeting(path, note, now = 1_000_000) {
  const storage = new Map(note === undefined ? [] : [[GREETING_STORAGE_KEY, JSON.stringify(note)]]);
  const variables = {};
  const root = { dataset: {}, style: { setProperty: (name, value) => { variables[name] = value; }, removeProperty: (name) => { delete variables[name]; } } };
  const timers = [];
  vm.runInNewContext(greetingInlineScript(), {
    location: { pathname: path },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, removeItem: (key) => storage.delete(key) },
    document: { documentElement: root },
    performance: { now: () => 240.4 },
    Date: { now: () => now },
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
  });
  return { root, variables, storage, timers };
}

test("only hub addresses open with the greeting", () => {
  for (const path of ["/dashboard", "/dashboard/files", "/dashboard?section=files"]) assert.equal(greetsAt(path), true, path);
  for (const path of ["/auth/mfa?next=%2Fdashboard", "/auth/pending", "/auth/update-password", "/dashboardx", "https://service.example/team"]) assert.equal(greetsAt(path), false, path);
});

test("a fresh note greets by first name before the first paint, once", () => {
  const { root, variables, storage, timers } = runGreeting("/dashboard", { at: 1_000_000 - 1500, name: " Jana " });
  assert.equal(root.dataset.greeting, "on");
  assert.equal(root.dataset.greetingAt, "240");
  assert.equal(root.dataset.greetingName, "");
  assert.equal(variables["--greeting-name"], '"Jana"', "a CSS string for app/loader.css");
  assert.equal(storage.has(GREETING_STORAGE_KEY), false, "a reload does not greet again");
  // Should the page never report back, the greeting still gives way.
  assert.equal(timers.length, 1);
  timers[0].callback();
  assert.equal(root.dataset.greeting, "leaving");
  timers[1].callback();
  assert.deepEqual(root.dataset, {});
  assert.deepEqual(variables, {});
});

test("without a first name the greeting goes without one", () => {
  const { root, variables } = runGreeting("/dashboard", { at: 1_000_000, name: "" });
  assert.equal(root.dataset.greeting, "on");
  assert.equal("greetingName" in root.dataset, false);
  assert.deepEqual(variables, {});
});

test("old notes and other pages stay without a greeting", () => {
  const stale = runGreeting("/dashboard", { at: 1_000_000 - 30_000, name: "Jana" });
  assert.deepEqual(stale.root.dataset, {}, "a login that never reached the hub");
  assert.equal(stale.storage.has(GREETING_STORAGE_KEY), false);
  const future = runGreeting("/dashboard", { at: 1_000_000 + 5000, name: "Jana" });
  assert.deepEqual(future.root.dataset, {});
  const login = runGreeting("/auth/login", { at: 1_000_000, name: "Jana" });
  assert.deepEqual(login.root.dataset, {});
  assert.equal(login.storage.has(GREETING_STORAGE_KEY), true, "the note waits for the hub page");
  assert.deepEqual(runGreeting("/dashboard", "kaputt").root.dataset, {});
  assert.deepEqual(runGreeting("/dashboard").root.dataset, {});
});

test("sign-ins note the greeting, and the hub shows it outside its load boundary", async () => {
  const form = await source("components/auth-form.tsx");
  assert.match(form, /if \(\(mode === "login" \|\| mode === "mfa"\) && greetsAt\(result\.redirect\)\) noteGreeting\(result\.greeting \?\? ""\);/);
  assert.match(form, /finally \{\s+if \(!leaving\) setLoading\(false\);/);
  assert.match(await source("components/demo-account-picker.tsx"), /onSubmit=\{\(\) => \{ noteGreeting\(account\.name\.split\(" "\)\[0\] \?\? ""\);/);
  const actions = await source("lib/hub-auth/actions.ts");
  assert.equal(actions.match(/greeting: await greetingFor\(/g)?.length, 3, "password sign-in, app code and e-mail code");
  assert.match(await source("app/layout.tsx"), /<script dangerouslySetInnerHTML=\{\{ __html: greetingInlineScript\(\) \}\} \/>/);
  assert.match(await source("app/dashboard/layout.tsx"), /<><HubGreeting \/><HubLoadBoundary>/);
});

test("loading shows the turning logo: pages, auth fallbacks and every former spinner", async () => {
  const loading = await source("components/hub/loading.tsx");
  assert.match(loading, /<BrandLoader label="Dein Workspace wird geladen" className=\{section \? "section-first" : undefined\} \/>/);
  assert.match(await source("components/brand-loader.tsx"), /<div role="status" aria-label=\{label\} className=\{cn\("brand-loader", className\)\}>/);
  for (const page of ["app/auth/mfa/page.tsx", "app/auth/pending/page.tsx"]) {
    assert.match(await source(page), /fallback=\{<div className="auth-form auth-form-loading" role="status" aria-label="Wird geladen"><MiniLoader size=\{24\} \/><\/div>\}/, page);
  }
  const files = [];
  for (const dir of ["app", "components"]) {
    for (const entry of await readdir(new URL(`../${dir}`, import.meta.url), { recursive: true })) if (entry.endsWith(".tsx")) files.push(`${dir}/${entry.replaceAll("\\", "/")}`);
  }
  for (const file of files) assert.doesNotMatch(await source(file), /Loader2|className="spin"/, `${file}: the small logo replaces the spinner`);
  assert.match(await source("components/auth-form.tsx"), /\{loading \? <><MiniLoader size=\{18\} \/>\{action\.loading\}<\/> :/);
});

test("the small logo turns white on filled buttons and in the dark theme, and rests with reduced motion", async () => {
  const css = await source("app/loader.css");
  assert.match(css, /:root\[data-theme="dark"\] \{ --loader-mini: var\(--loader-mini-white\); \}/);
  assert.match(css, /:is\(\.button-primary, \.sheet-button-primary, \.sheet-button-danger, \.sheet-action\.is-primary, \.assistant-send, \.proposal-save\) \.mini-loader \{ background-image: var\(--loader-mini-white\); \}/);
  assert.doesNotMatch(css, /prefers-reduced-motion/, "motion rules live in app/motion.css");
  const motion = await source("app/motion.css");
  const still = /\{ --loader: url\("\/brand\/oalab-loader-still\.png"\); --loader-greeting: url\("\/brand\/oalab-loader-still\.png"\); --loader-mini-bordeaux: url\("\/brand\/oalab-loader-mini-bordeaux\.png"\); --loader-mini-white: url\("\/brand\/oalab-loader-mini-white\.png"\); \}/;
  assert.match(motion, new RegExp(`:root\\[data-reduce-motion="true"\\] ${still.source}`));
  // Only the switch stills the logo, not the device's own setting (5.11.2026).
  assert.doesNotMatch(motion, /:root:not\(\[data-reduce-motion\]\)/);
  assert.match(motion, /:root\[data-greeting="on"\] \.hub-content \* \{ animation-play-state: paused; \}/);
  assert.match(await source("app/layout.tsx"), /import "\.\/loader\.css";\r?\nimport "\.\/motion\.css";/);
});
