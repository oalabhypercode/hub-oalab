import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { appearanceInlineScript, backgroundPresets, resolveAppearance } from "../lib/appearance.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const rgb = (hex) => hex.replace("#", "").match(/../g).map((part) => parseInt(part, 16));
const luminance = (color) => {
  const [r, g, b] = color.map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
};
const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
// Worst case for dark text on glass: the lowest allowed opacity (70 %) over pure black.
const worstGlass = [255, 255, 255].map((value) => value * 0.7);

test("white text keeps 4.5:1 on every background preset colour", () => {
  for (const preset of backgroundPresets.filter((item) => item.id !== "custom")) {
    for (const color of [preset.base, ...preset.orbs]) {
      assert.ok(contrast([255, 255, 255], rgb(color)) >= 4.5, `${preset.name} ${color}`);
    }
  }
});

test("text colours on glass keep 4.5:1 at 70 % opacity over any background", async () => {
  const css = await source("app/glass.css");
  const brand = await source("app/brand.css");
  const tokens = {
    "label-body": css.match(/--label-body: (#[0-9a-f]{6})/i)[1],
    "label-secondary": css.match(/--label-secondary: (#[0-9a-f]{6})/i)[1],
    "insights-text": css.match(/--insights-text: (#[0-9a-f]{6})/i)[1],
    "system-gray": css.match(/--system-gray: (#[0-9a-f]{6})/i)[1],
    "accent-text (bordeaux)": brand.match(/--oalab-bordeaux: (#[0-9a-f]{6})/i)[1],
  };
  const categories = [...(await source("lib/categories.ts")).matchAll(/name: "([^"]+)"[^\n]*text: "(#[0-9A-Fa-f]{6})"/g)];
  assert.equal(categories.length, 3, "every category defines a text colour");
  for (const [, name, hex] of categories) tokens[`category ${name}`] = hex;
  for (const [name, hex] of Object.entries(tokens)) {
    assert.ok(contrast(rgb(hex), worstGlass) >= 4.5, `${name} ${hex}: ${contrast(rgb(hex), worstGlass).toFixed(2)}:1`);
  }
});

test("stored appearance values are clamped and validated", () => {
  const resolved = resolveAppearance({ backgroundPreset: "unknown", glassAlpha: 0.2, glassBlur: 400 }, backgroundPresets, false);
  assert.equal(resolved.variables["--bg-base"], backgroundPresets[0].base);
  assert.equal(resolved.variables["--glass-alpha"], "0.7");
  assert.equal(resolved.variables["--glass-blur"], "40px");
  assert.equal(resolved.reduceTransparency, false);
  assert.equal(resolveAppearance(null, backgroundPresets, true).reduceTransparency, true, "system preference preselects the switch");
  assert.equal(resolveAppearance({ backgroundPreset: "custom", customColor: "javascript:alert(1)" }, backgroundPresets, false).variables["--bg-base"], backgroundPresets.at(-1).base);
});

test("text on a very light custom background switches to black", () => {
  assert.equal(resolveAppearance({ backgroundPreset: "custom", customColor: "#F5E6A8" }, backgroundPresets, false).variables["--on-bg"], "#000000");
  assert.equal(resolveAppearance({ backgroundPreset: "custom", customColor: "#1B2A44" }, backgroundPresets, false).variables["--on-bg"], "#FFFFFF");
});

test("the pre-paint script applies the stored appearance without outside references", () => {
  const variables = {};
  const root = { style: { setProperty: (name, value) => { variables[name] = value; } }, dataset: {} };
  vm.runInNewContext(appearanceInlineScript(), {
    localStorage: { getItem: () => JSON.stringify({ backgroundPreset: "ocean", glassAlpha: 0.9, reduceTransparency: true }) },
    window: { matchMedia: () => ({ matches: false }) },
    document: { documentElement: root },
  });
  assert.equal(variables["--bg-base"], "#0A2A6B");
  assert.equal(variables["--glass-alpha"], "0.9");
  assert.equal(root.dataset.reduceTransparency, "true");
});
