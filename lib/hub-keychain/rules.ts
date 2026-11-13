/**
 * Rules of the „Schlüsselbund“ (admin tab, migration 202611130001 in service-oalab): how long it stays open, when wrong
 * codes lock it, what a category and a recovery code look like. Pure functions without imports at run time, so the
 * tests load this file directly. The database checks the same limits again.
 */

/** Open for this long after the last action (look, copy, change) … */
export const UNLOCK_MINUTES = 10;
/** … and at most this long in one go; then the app's code is needed again. */
export const MAX_OPEN_MINUTES = 60;
/** Wrong codes (app or recovery) within LOCK_MINUTES that shut the keychain for LOCK_MINUTES. */
export const CODE_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
/** In the block the app's code waits, a recovery code still opens: until this many wrong codes in the window. */
export const RECOVERY_CAP = 10;
/** The recovery codes of one setup, each valid once. */
export const RECOVERY_CODE_COUNT = 8;
/** The mail code before linking the app: valid this long, this many tries. */
export const SETUP_CODE_MINUTES = 10;
export const SETUP_CODE_ATTEMPTS = 5;
/** After the mail code, this long to scan the QR code and confirm the app. */
export const SETUP_WINDOW_MINUTES = 15;
/** The app's entry in the authenticator, as the person sees it there. */
export const APP_ISSUER = "oalab Schlüsselbund";

const MINUTE = 60_000;

/** The end of an unlock after an action at `now`: ten more minutes, never past its hard end. */
export function nextExpiry(now: number, hardUntil: number) {
  return Math.min(now + UNLOCK_MINUTES * MINUTE, hardUntil);
}

/** A fresh unlock at `now`: its first end and its hard end. */
export function unlockWindow(now: number) {
  const hardUntil = now + MAX_OPEN_MINUTES * MINUTE;
  return { expiresAt: nextExpiry(now, hardUntil), hardUntil };
}

/**
 * Whether wrong codes lock the keychain now. `wrong` are the times of wrong codes, any order. Locked while the last
 * LOCK_MINUTES hold CODE_ATTEMPTS of them; open again when the oldest of those leaves the window.
 */
export function lockState(wrong: readonly number[], now: number): { locked: boolean; until: number | null; left: number } {
  const recent = wrong.filter((time) => time > now - LOCK_MINUTES * MINUTE && time <= now).sort((a, b) => b - a);
  if (recent.length >= CODE_ATTEMPTS) return { locked: true, until: recent[CODE_ATTEMPTS - 1] + LOCK_MINUTES * MINUTE, left: 0 };
  return { locked: false, until: null, left: CODE_ATTEMPTS - recent.length };
}

/** Whether a recovery code may be tried now (in the block too), else until when not. */
export function recoveryState(wrong: readonly number[], now: number): { allowed: boolean; until: number | null } {
  const recent = wrong.filter((time) => time > now - LOCK_MINUTES * MINUTE && time <= now).sort((a, b) => b - a);
  if (recent.length >= RECOVERY_CAP) return { allowed: false, until: recent[RECOVERY_CAP - 1] + LOCK_MINUTES * MINUTE };
  return { allowed: true, until: null };
}

/* ---------- Categories ---------- */

/** The symbols a category may carry (the database checks the same list). */
export const CATEGORY_ICONS = [
  "inbox", "globe", "server", "layout-template", "share-2", "chart-column", "app-window", "key-round", "cloud",
  "shopping-cart", "credit-card", "megaphone", "database", "wifi", "building-2",
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];
export const isCategoryIcon = (value: unknown): value is CategoryIcon => typeof value === "string" && (CATEGORY_ICONS as readonly string[]).includes(value);
/** The symbols the settings offer for a new category; the others belong to the categories from the start. */
export const NEW_CATEGORY_ICONS: readonly CategoryIcon[] = ["key-round", "cloud", "shopping-cart", "credit-card", "megaphone", "database", "wifi", "building-2"];

/** The categories of migration 202611130001, in their order: the examples of the preview and a fallback. */
export const DEFAULT_CATEGORIES: readonly { id: string; name: string; icon: CategoryIcon; fixed: boolean }[] = [
  { id: "mailbox", name: "Postfächer", icon: "inbox", fixed: true },
  { id: "registrar", name: "Domain-Anbieter", icon: "globe", fixed: false },
  { id: "dns", name: "DNS", icon: "globe", fixed: false },
  { id: "hosting", name: "Hosting", icon: "server", fixed: false },
  { id: "cms", name: "Website & CMS", icon: "layout-template", fixed: false },
  { id: "social", name: "Social Media", icon: "share-2", fixed: false },
  { id: "google", name: "Google & Statistik", icon: "chart-column", fixed: false },
  { id: "tools", name: "Software & Tools", icon: "app-window", fixed: false },
  { id: "other", name: "Sonstiges", icon: "key-round", fixed: false },
];

/** Postfächer: the mailboxes from „Vertrag & Domain“ always belong here, so it never goes. */
export const MAILBOX_CATEGORY = "mailbox";
export const MAX_CATEGORY_NAME = 40;

const CATEGORY_ID = /^[a-z][a-z0-9-]{1,39}$/;
export const isCategoryId = (value: unknown): value is string => typeof value === "string" && CATEGORY_ID.test(value);

/** A category's name as typed: one line, trimmed, at most 40 characters; null if empty. */
export function readCategoryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_CATEGORY_NAME).trim();
  return name || null;
}

/** Whether a name is taken already, regardless of case (the database's unique index does the same). */
export function nameTaken(name: string, others: readonly { id: string; name: string }[], except?: string) {
  const wanted = name.toLocaleLowerCase("de");
  return others.some((category) => category.id !== except && category.name.toLocaleLowerCase("de") === wanted);
}

/** A stable id for a new category from its name: „Online-Shop“ → „c-online-shop“, with a number when taken. */
export function categoryId(name: string, taken: readonly string[]) {
  const base = `c-${name.toLocaleLowerCase("de").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "kategorie"}`;
  if (!taken.includes(base)) return base;
  for (let number = 2; ; number++) if (!taken.includes(`${base}-${number}`)) return `${base}-${number}`;
}

/* ---------- Recovery codes ---------- */

/** No 0/O, 1/I/L: read off a printout without doubt. */
export const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** „7kq2 m9xd“ → „7KQ2M9XD“; null for anything that is not eight letters of the alphabet. */
export function normalizeRecoveryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === 8 && [...code].every((char) => RECOVERY_ALPHABET.includes(char)) ? code : null;
}

/** „7KQ2M9XD“ → „7KQ2-M9XD“, as the page shows it. */
export const formatRecoveryCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** The app's key in groups of four for typing („JBSW Y3DP …“). */
export const groupedKey = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();
