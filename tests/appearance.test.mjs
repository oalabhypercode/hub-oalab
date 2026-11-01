import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { appearanceInlineScript, backgroundPresets, DARK_BACKGROUND_SHADE, normalizeAppearance, resolveAppearance } from "../lib/appearance.ts";

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

// glass.css: the light tokens come first, the dark theme swaps them in one block further down.
const themes = async () => {
  const [light, dark] = (await source("app/glass.css")).split(':root[data-theme="dark"] {');
  return { light, dark: dark.slice(0, dark.indexOf("\n}")) };
};
const token = (block, name) => block.match(new RegExp(`--${name}: (#[0-9a-f]{6})`, "i"))[1];
const channels = (block, name) => block.match(new RegExp(`--${name}: (\\d+) (\\d+) (\\d+);`)).slice(1).map(Number);
const textTokens = ["label-body", "label-secondary", "insights-text", "system-gray", "cat-projects-text", "cat-files-text", "cat-messages-text", "cat-calendar-text"];

test("text colours on glass keep 4.5:1 at 70 % opacity over any background", async () => {
  const { light } = await themes();
  const brand = await source("app/brand.css");
  const tokens = Object.fromEntries(textTokens.map((name) => [name, token(light, name)]));
  tokens["accent-text (bordeaux)"] = brand.match(/--oalab-bordeaux: (#[0-9a-f]{6})/i)[1];
  // Categories colour their text with these tokens, so the dark theme can swap them.
  const categories = [...(await source("lib/categories.ts")).matchAll(/text: "var\(--cat-(\w+)-text\)"/g)];
  assert.deepEqual(categories.map((match) => match[1]), ["projects", "files", "messages", "calendar"]);
  for (const [name, hex] of Object.entries(tokens)) {
    assert.ok(contrast(rgb(hex), worstGlass) >= 4.5, `${name} ${hex}: ${contrast(rgb(hex), worstGlass).toFixed(2)}:1`);
  }
});

test("dark theme: light text keeps 4.5:1 on dark glass at 70 % over every background, also a light custom colour", async () => {
  const { dark } = await themes();
  const glass = channels(dark, "glass-rgb");
  const tokens = Object.fromEntries([...textTokens, "accent-text", "label", "danger"].map((name) => [name, token(dark, name)]));
  const over = (background) => glass.map((value, index) => value * 0.7 + background[index] * 0.3);
  const shaded = (hex, shade) => rgb(hex).map((value) => value * shade);
  const backgrounds = [];
  for (const preset of backgroundPresets.filter((item) => item.id !== "custom")) {
    const shade = parseInt(resolveAppearance({ backgroundPreset: preset.id, colorScheme: "dark" }, backgroundPresets, false).variables["--bg-shade"], 10) / 100;
    backgrounds.push([`${preset.name} base`, shaded(preset.base, shade)], ...preset.orbs.map((orb) => [`${preset.name} orb ${orb}`, shaded(orb, 0.75)]));
  }
  for (const color of ["#FFFFFF", "#F5E6A8", "#FFFF00", "#00FFFF", "#FF00FF", "#2B3A55"]) {
    const shade = parseInt(resolveAppearance({ backgroundPreset: "custom", customColor: color, colorScheme: "dark" }, backgroundPresets, false).variables["--bg-shade"], 10) / 100;
    const base = shaded(color, shade);
    // The brightest orb of the custom preset, white at 16 % mixed with black like in glass.css (75 %), over the base.
    backgrounds.push([`custom ${color}`, base], [`custom ${color} with orb`, base.map((value) => 0.75 * 0.16 * 255 + value * (1 - 0.75 * 0.16 - 0.25))]);
  }
  for (const [name, hex] of Object.entries(tokens)) {
    for (const [where, background] of backgrounds) {
      const ratio = contrast(rgb(hex), over(background));
      assert.ok(ratio >= 4.5, `${name} ${hex} on ${where}: ${ratio.toFixed(2)}:1`);
    }
  }
});

test("tones, sheets and text on fills keep 4.5:1 in both themes", async () => {
  for (const [theme, block] of Object.entries(await themes())) {
    const value = (name) => token(block, name);
    for (const tone of ["todo", "info", "ok", "off", "bad"]) {
      const ratio = contrast(rgb(value(`tone-${tone}`)), rgb(value(`tone-${tone}-bg`)));
      assert.ok(ratio >= 4.5, `${theme} tone ${tone}: ${ratio.toFixed(2)}:1`);
    }
    for (const [text, fill] of [["sheet-muted", "sheet"], ["sheet-muted", "sheet-hover"], ["label-body", "sheet"], ["on-label", "label-body"]]) {
      const ratio = contrast(rgb(value(text)), rgb(value(fill)));
      assert.ok(ratio >= 4.5, `${theme} ${text} on ${fill}: ${ratio.toFixed(2)}:1`);
    }
  }
  const { dark } = await themes();
  const brand = await source("app/brand.css");
  // Text on an accent fill: white on bordeaux in light, dark on pink in dark.
  assert.ok(contrast([255, 255, 255], rgb(brand.match(/--oalab-bordeaux: (#[0-9a-f]{6})/i)[1])) >= 4.5);
  assert.ok(contrast(rgb(token(dark, "on-accent")), rgb(token(dark, "accent-text"))) >= 4.5);
});

test("the colour scheme follows the device until the user picks light or dark", () => {
  const theme = (stored, systemDark) => resolveAppearance(stored, backgroundPresets, false, false, systemDark).theme;
  assert.equal(theme(null, true), "dark");
  assert.equal(theme(null, false), "light");
  assert.equal(theme({ colorScheme: "light" }, true), "light", "an explicit choice wins over the device");
  assert.equal(theme({ colorScheme: "dark" }, false), "dark");
  assert.equal(theme({ colorScheme: "blue" }, true), "dark", "anything else follows the device");
  assert.equal(normalizeAppearance(null).colorScheme, "system");
  assert.equal(normalizeAppearance({ colorScheme: "dark" }).colorScheme, "dark");
  // The light theme shows the background as chosen; the dark one darker.
  assert.equal(resolveAppearance(null, backgroundPresets, false).variables["--bg-shade"], "100%");
  assert.equal(resolveAppearance({ colorScheme: "dark" }, backgroundPresets, false).variables["--bg-shade"], `${DARK_BACKGROUND_SHADE * 100}%`);
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

test("reduce motion follows the system until the user decides", () => {
  assert.equal(resolveAppearance(null, backgroundPresets, false).reduceMotion, false);
  assert.equal(resolveAppearance(null, backgroundPresets, false, true).reduceMotion, true, "system preference preselects the switch");
  assert.equal(resolveAppearance({ reduceMotion: false }, backgroundPresets, false, true).reduceMotion, false, "an explicit choice wins over the system");
  assert.equal(resolveAppearance({ reduceMotion: "yes" }, backgroundPresets, false, false).reduceMotion, false);
});

test("the waterfall stylesheet is loaded everywhere and switches off with reduce motion", async () => {
  const layout = await source("app/layout.tsx");
  const motion = await source("app/motion.css");
  assert.match(layout, /import "\.\/motion\.css";/);
  assert.match(layout, /<PageWaterfall \/>/);
  assert.match(motion, /:root\[data-reduce-motion="true"\] \{ --waterfall: none; \}/);
  assert.match(motion, /@media \(prefers-reduced-motion: reduce\) \{\s*:root:not\(\[data-reduce-motion\]\) \{ --waterfall: none; \}/);
  for (const path of ["app/globals.css", "app/hub.css", "app/glass.css"]) {
    assert.doesNotMatch(await source(path), /prefers-reduced-motion/, `${path}: motion rules live in app/motion.css`);
  }
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
    window: { matchMedia: (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" || query === "(prefers-color-scheme: dark)" }) },
    document: { documentElement: root },
  });
  assert.equal(variables["--bg-base"], "#0A2A6B");
  assert.equal(variables["--glass-alpha"], "0.9");
  assert.equal(root.dataset.reduceTransparency, "true");
  assert.equal(root.dataset.reduceMotion, "true", "the system setting applies before the first paint");
  assert.equal(root.dataset.theme, "dark", "a dark device gets the dark theme before the first paint");
  assert.equal(root.style.colorScheme, "dark");
});
