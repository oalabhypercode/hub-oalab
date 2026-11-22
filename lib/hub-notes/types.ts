/**
 * Shapes of the notes area („Notizen“ under Projekte, plan docs/planung/notizen.md, approved 22.11.2026): per customer
 * a writing space like Notion with pages and subpages. Rows live in hub_note_pages (migration 202611221001 in
 * service-oalab); the database decides who reads and writes what. Type imports only, so tests load it directly.
 */
import type { CustomerLogo } from "../hub-logos/rules";

/**
 * „Sichtbar für“: „Nur Team“ (the default), „Kunde und Freelancer“, „Nur Kunde“ or „Nur Freelancer“ – the three levels
 * of the files plus the board's „Nur Team“.
 */
export type NoteAudience = "team" | "both" | "customer" | "freelancer";
export type NoteWidth = "normal" | "wide";
/** Who looks: the oalab team, a customer (reads what is shared) or a freelancer (reads and writes „Nur Freelancer“). */
export type NoteViewer = "admin" | "customer" | "freelancer";
/** Text size of the writing area, per device (Darstellung, stored in this browser only). */
export type NotesTextSize = "small" | "medium" | "large";
export type NoteTemplateId = "meeting" | "briefing" | "acceptance" | "blank";

/** A cover over the page: one of the hub's gallery images, an image from the customer's files, or an upload. */
export type NoteCover = {
  kind: "gallery" | "file" | "upload";
  value: string;
  /** Vertical position of the image, 0 (top) to 100 (bottom). */
  position: number;
  /** Files and uploads: a short-lived signed link, read with the viewer's rights; null shows a calm colour instead. */
  url?: string | null;
  /** Files: the file's title, shown on the cover as its source. */
  name?: string;
};

/** ProseMirror/Tiptap JSON as stored in hub_note_pages.content. */
export type NoteMark = { type: string; attrs?: Record<string, unknown> };
export type NoteNode = { type: string; attrs?: Record<string, unknown>; content?: NoteNode[]; marks?: NoteMark[]; text?: string };
export type NoteDoc = { type: "doc"; content?: NoteNode[] };

/** A page as the list knows it: everything but the document. */
export type NotePageMeta = {
  id: string;
  customerId: string;
  /** Studio project of the customer; null is „Allgemein“. */
  projectId: string | null;
  parentId: string | null;
  /** Meeting notes hang at their appointment (step 3). */
  appointmentId: string | null;
  title: string;
  /** One emoji, stored as the Unicode character; "" for none. */
  icon: string;
  cover: NoteCover | null;
  width: NoteWidth;
  audience: NoteAudience;
  /** YYYY-MM-DD; pages with a date show in the calendar (step 3). */
  datedOn: string | null;
  position: number;
  /** Rises with every save; a save is written only while the version it started from still holds. */
  version: number;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
};

export type NotePage = NotePageMeta & { content: NoteDoc };

export type NoteCustomer = {
  id: string;
  name: string;
  number: string;
  logo?: CustomerLogo;
  /** Some freelancer looks after the customer: „Sichtbar für“ then offers four levels instead of two. */
  hasFreelancer: boolean;
};

export type NoteProject = { id: string; name: string };

/** The defaults for all notes, set once by the team (hub_note_settings). */
export type NoteSettings = {
  defaultAudience: NoteAudience;
  notifyOnShare: boolean;
  groupByProject: boolean;
  meetingTemplate: NoteTemplateId;
  defaultWidth: NoteWidth;
};

/** Everything the notes page needs for one customer; the documents of other pages load when they open. */
export type NotesArea = {
  viewer: NoteViewer;
  viewerId: string;
  customers: NoteCustomer[];
  customerId: string | null;
  projects: NoteProject[];
  pages: NotePageMeta[];
  /** The open page with its document; null when the customer has none (yet) or none is visible. */
  page: NotePage | null;
  settings: NoteSettings;
  /** Names of the people who last edited a page, by user id (not for customers). */
  people: Record<string, string>;
  /** The database knows notes (migration 202611221001); without it the page says that they are not set up yet. */
  ready: boolean;
  error: string | null;
};

/** What a customer switch or an opened page brings along. */
export type NotesCustomerView = Pick<NotesArea, "customerId" | "projects" | "pages" | "people">;

/** `stale`: somebody saved in the meantime; `current` is the page as it is now, so nothing gets overwritten. */
export type NoteResult<T> = { ok: true; data: T } | { ok: false; error: string; stale?: boolean; current?: NotePage };

/** The fields a save may change; the document only with its plain text, which the server computes itself. */
export type NotePatch = {
  title?: string;
  content?: NoteDoc;
  icon?: string;
  cover?: Pick<NoteCover, "kind" | "value" | "position"> | null;
  width?: NoteWidth;
  datedOn?: string | null;
  projectId?: string | null;
};

/** After a save: the new version and when, so the next save starts from it. */
export type NoteSaved = { id: string; version: number; updatedAt: string; updatedBy: string | null };
