/**
 * Central appearance configuration for the Client Hub: background presets,
 * glass limits and the logic that turns a stored preference into CSS variables.
 * Self-contained on purpose so the inline pre-paint script and tests can reuse it.
 */

export type BackgroundPresetId = "oalab" | "ocean" | "aubergine" | "emerald" | "ember" | "graphite" | "custom";

/** Erscheinungsbild: follow the device, or always light or dark. */
export type ColorScheme = "system" | "light" | "dark";

/** Listen: one quiet line per entry (symbol, title, date) or every column. */
export type ListView = "minimal" | "detail";

export type BackgroundPreset = {
  id: BackgroundPresetId;
  name: string;
  base: string;
  orbs: [string, string, string];
};

export type Appearance = {
  colorScheme: ColorScheme;
  backgroundPreset: BackgroundPresetId;
  customColor: string;
  glassAlpha: number;
  glassBlur: number;
  reduceTransparency: boolean;
  reduceMotion: boolean;
  listView: ListView;
};

/** White text reaches at least 4.5:1 on every base and orb colour (see tests/appearance.test.mjs). */
export const backgroundPresets: BackgroundPreset[] = [
  { id: "oalab", name: "oalab", base: "#3A0624", orbs: ["#7E004B", "#8F1D21", "#B4400F"] },
  { id: "ocean", name: "Ozean", base: "#0A2A6B", orbs: ["#1E5BD6", "#6A2BD9", "#0B6E80"] },
  { id: "aubergine", name: "Aubergine", base: "#2A0E3D", orbs: ["#7B2CBF", "#C2185B", "#3D1A8C"] },
  { id: "emerald", name: "Smaragd", base: "#06352B", orbs: ["#0E7C5A", "#1B5E8C", "#4C7A12"] },
  { id: "ember", name: "Glut", base: "#5C1608", orbs: ["#C2410C", "#B3125E", "#7A2E00"] },
  { id: "graphite", name: "Graphit", base: "#141418", orbs: ["#3A3A48", "#1F3A5F", "#4A2F5C"] },
  { id: "custom", name: "Eigene", base: "#2B3A55", orbs: ["rgba(255,255,255,0.16)", "rgba(255,255,255,0.08)", "rgba(0,0,0,0.22)"] },
];

export const GLASS_ALPHA_RANGE = { min: 0.7, max: 0.95 } as const;
export const GLASS_BLUR_RANGE = { min: 8, max: 40 } as const;
export const APPEARANCE_STORAGE_KEY = "oalab-hub-appearance";

export const defaultAppearance: Appearance = {
  colorScheme: "system",
  backgroundPreset: "oalab",
  customColor: "#2B3A55",
  glassAlpha: 0.8,
  glassBlur: 24,
  reduceTransparency: false,
  reduceMotion: false,
  listView: "minimal",
};

export type AppearanceDom = { variables: Record<string, string>; reduceTransparency: boolean; reduceMotion: boolean; onBackground: "light" | "dark"; theme: "light" | "dark" };

/** The dark theme shows the background at this brightness at most (glass.css mixes it with black, --bg-shade). */
export const DARK_BACKGROUND_SHADE = 0.62;

/**
 * Resolves a stored (possibly invalid) preference into CSS variables.
 * Must not reference anything outside its own body: it is serialised into the
 * inline script that runs before the first paint.
 */
export function resolveAppearance(stored: unknown, presets: BackgroundPreset[], systemReducedTransparency: boolean, systemDark = false): AppearanceDom {
  const input = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, number));
  };
  const isHex = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  const preset = presets.find((item) => item.id === input.backgroundPreset) || presets[0];
  const base = preset.id === "custom" ? (isHex(input.customColor) ? input.customColor : preset.base) : preset.base;
  const scheme = input.colorScheme === "light" || input.colorScheme === "dark" ? input.colorScheme : "system";
  const theme = scheme === "system" ? (systemDark ? "dark" : "light") : scheme;
  const channel = (offset: number, shade: number) => {
    const value = parseInt(base.slice(offset, offset + 2), 16) / 255 * shade;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminanceAt = (shade: number) => 0.2126 * channel(1, shade) + 0.7152 * channel(3, shade) + 0.0722 * channel(5, shade);
  // The dark theme shows the background darker: 62 % (DARK_BACKGROUND_SHADE, repeated because this body is
  // serialised), and less for a light custom colour, so light text on dark glass keeps 4.5:1 (see the tests).
  let shade = theme === "dark" ? 0.62 : 1;
  while (theme === "dark" && shade > 0.2 && luminanceAt(shade) > 0.04) shade -= 0.02;
  const luminance = luminanceAt(shade);
  const onBackground = luminance > 0.2 ? "dark" : "light";
  return {
    variables: {
      "--bg-base": base,
      "--bg-orb-1": preset.orbs[0],
      "--bg-orb-2": preset.orbs[1],
      "--bg-orb-3": preset.orbs[2],
      "--bg-shade": `${Math.round(shade * 100)}%`,
      "--on-bg": onBackground === "dark" ? "#000000" : "#FFFFFF",
      "--glass-alpha": String(clamp(input.glassAlpha, 0.7, 0.95, 0.8)),
      "--glass-blur": `${clamp(input.glassBlur, 8, 40, 24)}px`,
    },
    reduceTransparency: typeof input.reduceTransparency === "boolean" ? input.reduceTransparency : systemReducedTransparency,
    // Animations run until the person switches them off, whatever the device says (decision of 5.11.2026).
    reduceMotion: typeof input.reduceMotion === "boolean" ? input.reduceMotion : false,
    onBackground,
    theme,
  };
}

/** Normalises a stored value for React state; mirrors the ranges used by resolveAppearance. */
export function normalizeAppearance(stored: unknown, systemReducedTransparency = false): Appearance {
  const input = (stored && typeof stored === "object" ? stored : {}) as Partial<Record<keyof Appearance, unknown>>;
  const preset = backgroundPresets.find((item) => item.id === input.backgroundPreset)?.id ?? defaultAppearance.backgroundPreset;
  const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const scheme = input.colorScheme;
  return {
    colorScheme: scheme === "light" || scheme === "dark" ? scheme : "system",
    backgroundPreset: preset,
    customColor: typeof input.customColor === "string" && /^#[0-9a-f]{6}$/i.test(input.customColor) ? input.customColor : defaultAppearance.customColor,
    glassAlpha: Math.min(GLASS_ALPHA_RANGE.max, Math.max(GLASS_ALPHA_RANGE.min, number(input.glassAlpha, defaultAppearance.glassAlpha))),
    glassBlur: Math.min(GLASS_BLUR_RANGE.max, Math.max(GLASS_BLUR_RANGE.min, number(input.glassBlur, defaultAppearance.glassBlur))),
    reduceTransparency: typeof input.reduceTransparency === "boolean" ? input.reduceTransparency : systemReducedTransparency,
    reduceMotion: typeof input.reduceMotion === "boolean" ? input.reduceMotion : defaultAppearance.reduceMotion,
    listView: input.listView === "detail" ? "detail" : "minimal",
  };
}

/** Applies resolved values to <html>; shared by the inline script and the React provider. */
export function applyAppearanceToDocument(dom: AppearanceDom, root: HTMLElement) {
  for (const [name, value] of Object.entries(dom.variables)) root.style.setProperty(name, value);
  root.dataset.reduceTransparency = String(dom.reduceTransparency);
  root.dataset.reduceMotion = String(dom.reduceMotion);
  root.dataset.onBackground = dom.onBackground;
  root.dataset.theme = dom.theme;
  // Native controls and scrollbars follow the theme as well.
  root.style.colorScheme = dom.theme;
}

/** Inline script for the root layout: applies the stored appearance before the first paint. */
export function appearanceInlineScript() {
  return `(function(){try{var r=(${resolveAppearance.toString()});var a=(${applyAppearanceToDocument.toString()});var s=null;try{s=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)})||"null")}catch(e){}var q=function(x){return !!(window.matchMedia&&window.matchMedia(x).matches)};a(r(s,${JSON.stringify(backgroundPresets)},q("(prefers-reduced-transparency: reduce)"),q("(prefers-color-scheme: dark)")),document.documentElement)}catch(e){}})()`;
}

/** Carries "Bewegung reduzieren" to Service OALab (service-oalab: app/layout.tsx reads it), where it counts as well. */
export const REDUCE_MOTION_COOKIE = "oalab_reduce_motion";

/**
 * The cookie for `document.cookie`: set while "Bewegung reduzieren" is on, removed while it is off, so without a
 * choice there is none. Under oalab.de it carries `Domain=oalab.de` like the shared login (lib/supabase/cookies.ts),
 * elsewhere (previews, localhost) it stays with the host. It holds nothing but the choice.
 */
export function reduceMotionCookie(reduce: boolean, hostname: string, secure: boolean) {
  const host = hostname.toLowerCase();
  const domain = host === "oalab.de" || host.endsWith(".oalab.de") ? "; Domain=oalab.de" : "";
  const flags = `; Path=/; SameSite=Lax${secure ? "; Secure" : ""}${domain}`;
  return reduce ? `${REDUCE_MOTION_COOKIE}=1; Max-Age=31536000${flags}` : `${REDUCE_MOTION_COOKIE}=; Max-Age=0${flags}`;
}
