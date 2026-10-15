import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const bytes = (path) => readFile(new URL(`../${path}`, import.meta.url));

test("all app surfaces use the shared Inter font and oalab identity", async () => {
  const layout = await source("app/layout.tsx");
  assert.match(layout, /import \{ Inter \} from "next\/font\/google"/);
  assert.match(layout, /variable: "--font-inter"/);
  assert.match(layout, /oalab — Dein Client Hub/);
  assert.match(layout, /import "\.\/brand\.css"/);
  assert.match(await source("tailwind.config.ts"), /sans: \["var\(--font-inter\)"/);
  const css = await source("app/brand.css");
  assert.match(css, /html, body \{ font-family: var\(--font-inter\)/);
  assert.match(css, /button, input, textarea, select \{ font-family: inherit/);
});

test("the supplied logos are present and the app icon uses the original icon", async () => {
  const logo = await bytes("public/brand/oalab-logo.png");
  assert.equal(logo.subarray(1, 4).toString(), "PNG");
  assert.equal(logo.readUInt32BE(16), 876);
  assert.equal(logo.readUInt32BE(20), 777);
  assert.deepEqual(await bytes("app/icon.png"), await bytes("public/brand/oalab-icon.png"));
  assert.match(await source("components/hub/wordmark.tsx"), /src="\/brand\/oalab-logo\.png"/);
});

test("primary brand text colors retain accessible contrast against white", async () => {
  const css = await source("app/brand.css");
  const luminance = (hex) => {
    const channels = hex.match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const token of ["bordeaux", "red", "ink", "muted"]) {
    const hex = css.match(new RegExp(`--oalab-${token}: #([a-f0-9]{6})`))[1];
    assert.ok(1.05 / (luminance(hex) + 0.05) >= 4.5, `${token} must support normal-sized text on white`);
  }
  assert.match(css, /--oalab-gradient: linear-gradient\(160deg/);
  assert.match(css, /--oalab-orange: #f37222/);
});

test("the previous platform name is absent from rendered frontend sources", async () => {
  for (const directory of ["app", "components"]) {
    const entries = await readdir(new URL(`../${directory}/`, import.meta.url), { recursive: true });
    for (const entry of entries.filter((name) => /\.(tsx|css)$/.test(name))) {
      assert.doesNotMatch(await source(`${directory}/${entry}`), /wola|geist/i, `${directory}/${entry}`);
    }
  }
});
