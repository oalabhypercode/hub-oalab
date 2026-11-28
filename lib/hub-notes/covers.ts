/**
 * Covers of note pages (plan 1.6): a band over the whole width of the page. Step 1 offers the gallery: the six
 * backgrounds of the hub (oalab, Ozean, Aubergine, Smaragd, Glut, Graphit), calm colours and patterns, all drawn with
 * CSS (app/notes.css, .nz-cv-<key>), so nothing loads from elsewhere. Images from the customer's files and uploads
 * follow in step 2. Self-contained so tests load it directly.
 */

import type { NoteCover } from "./types";

export type CoverGroup = "hub" | "calm" | "pattern";
export type GalleryCover = { key: string; name: string; group: CoverGroup };

export const COVER_GROUPS: { id: CoverGroup; label: string }[] = [
  { id: "hub", label: "Wie die Hintergründe des Hubs" },
  { id: "calm", label: "Ruhige Farben" },
  { id: "pattern", label: "Muster" },
];

export const GALLERY_COVERS: GalleryCover[] = [
  { key: "oalab", name: "oalab", group: "hub" },
  { key: "ocean", name: "Ozean", group: "hub" },
  { key: "aubergine", name: "Aubergine", group: "hub" },
  { key: "emerald", name: "Smaragd", group: "hub" },
  { key: "ember", name: "Glut", group: "hub" },
  { key: "graphite", name: "Graphit", group: "hub" },
  { key: "sand", name: "Sand", group: "calm" },
  { key: "nebel", name: "Nebel", group: "calm" },
  { key: "salbei", name: "Salbei", group: "calm" },
  { key: "rose", name: "Rosé", group: "calm" },
  { key: "linien", name: "Linien", group: "pattern" },
  { key: "punkte", name: "Punkte", group: "pattern" },
  { key: "raster", name: "Raster", group: "pattern" },
];

export const isGalleryCover = (key: unknown): key is string => typeof key === "string" && GALLERY_COVERS.some((cover) => cover.key === key);
export const galleryCover = (key: string) => GALLERY_COVERS.find((cover) => cover.key === key) ?? null;

/** Position steps the cover's hover button cycles through (top, middle, bottom); the database keeps 0–100 %. */
export const COVER_POSITIONS = [{ value: 50, label: "Mitte" }, { value: 0, label: "oben" }, { value: 100, label: "unten" }] as const;
export const nextCoverPosition = (current: number) => {
  const index = COVER_POSITIONS.findIndex((step) => step.value === current);
  return COVER_POSITIONS[(index + 1) % COVER_POSITIONS.length].value;
};
export const coverPositionLabel = (value: number) => COVER_POSITIONS.find((step) => step.value === value)?.label ?? `${value} %`;
export const cleanCoverPosition = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 50;

/**
 * A cover from the files or an upload shows through a short-lived signed link that only the open page carries (read
 * with the viewer's rights); the list knows image and position. The band takes the open page's link while both mean
 * the same image (found live on 22.11.2026: after a reload an uploaded cover showed a calm colour).
 */
export function coverWithLink<T extends NoteCover | null>(listed: T, open: NoteCover | null | undefined): T {
  if (!listed || listed.kind === "gallery" || listed.url || !open?.url || open.kind !== listed.kind || open.value !== listed.value) return listed;
  const name = listed.name ?? open.name;
  return { ...listed, url: open.url, ...(name !== undefined ? { name } : {}) };
}

/** The cover after a save on the page or in the list: the same image keeps its signed link and name, e.g. at a new position. */
export function keepCoverLink(previous: NoteCover | null, next: NoteCover | null): NoteCover | null {
  if (!next || !previous || next.kind !== previous.kind || next.value !== previous.value) return next;
  const url = next.url ?? previous.url;
  const name = next.name ?? previous.name;
  return { ...next, ...(url !== undefined ? { url } : {}), ...(name !== undefined ? { name } : {}) };
}
