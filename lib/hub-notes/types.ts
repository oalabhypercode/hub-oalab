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
/**
 * Who looks: the oalab team, a customer or a freelancer. Customers and freelancers read what is shared with them and
 * write where the team lets them (23.11.2026); freelancers also write the pages they add themselves.
 */
export type NoteViewer = "admin" | "customer" | "freelancer";
/** What the customer, or the customer's freelancers, may do on a page: nothing, read it, or edit it too (23.11.2026). */
export type NoteAccess = "none" | "read" | "edit";
/** „Sichtbar für“ with the rights to edit, as hub_note_pages keeps them (migration 202611230002 in service-oalab). */
export type NoteRights = { audience: NoteAudience; customerEdits: boolean; freelancerEdits: boolean };
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
  /** The customer edits the page („Bearbeiten“); only while the customer sees it. */
  customerEdits: boolean;
  /** The customer's freelancers edit it; only while they see it. Their own pages are theirs to write. */
  freelancerEdits: boolean;
  /** When somebody outside the team (customer, freelancer) last wrote on it; set by the database. */
  outsideEditedAt: string | null;
  /** When the viewer last opened the page (the team's list marks pages with news from outside); null: never. */
  seenAt?: string | null;
  /** YYYY-MM-DD; pages with a date show in the calendar (step 3). */
  datedOn: string | null;
  position: number;
  /** Rises with every save; a save is written only while the version it started from still holds. */
  version: number;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
};

/** A login that may open a page, and when they last did (the team's „Zugriff“ on a page). */
export type NoteReader = { id: string; name: string; seenAt: string | null };
/** Who of the customer and of the customer's freelancers may open a page. */
export type NoteReaders = { customer: NoteReader[]; freelancer: NoteReader[] };

/** A task of the board as a note shows it, read with the viewer's rights; null in NoteRefs: not released for them. */
export type NoteTaskView = {
  id: string;
  number: number;
  title: string;
  status: "backlog" | "todo" | "progress" | "review" | "done";
  dueOn: string | null;
  projectId: string;
  projectName: string;
  assignees: { id: string; name: string; initials: string }[];
  /** Open, released and labelled „Kunde“: the customer has to act („Beim Kunden“, for customers „Du bist am Zug“). */
  customerTurn: boolean;
  /** Who sees it besides the team (team and freelancers only; customers never learn it). */
  audience: "team" | "shared" | "customer" | null;
  /** Studio's row version for the tick; null where the viewer may not change it (customers). */
  version: number | null;
};

/** A project block: status, progress and target date as in the projects table. */
export type NoteProjectView = { id: string; name: string; status: string; progress: number; dueOn: string | null };

/** An appointment of the calendar as a note shows it (step 3), read with the viewer's rights. */
export type NoteAppointmentView = {
  id: string;
  title: string;
  /** ISO instants. */
  start: string;
  end: string;
  status: "requested" | "confirmed" | "declined" | "cancelled";
  /** Only for confirmed appointments that have one. */
  teamsUrl: string | null;
  customerId: string | null;
};

/** What a page's references show, resolved in one go with the viewer's rights when the page opens. */
export type NoteRefs = {
  tasks: Record<string, NoteTaskView | null>;
  projects: Record<string, NoteProjectView | null>;
  /** The open tasks a task list block shows, per project; null: the project is not visible to the viewer. */
  projectTasks: Record<string, NoteTaskView[] | null>;
  /** Signed links to the preview images of link cards, by storage path. */
  images: Record<string, string>;
  /** Appointments (step 3); null: the viewer does not see it (freelancers never see a customer's appointments). */
  appointments: Record<string, NoteAppointmentView | null>;
};

export const NO_REFS: NoteRefs = { tasks: {}, projects: {}, projectTasks: {}, images: {}, appointments: {} };

export type NotePage = NotePageMeta & { content: NoteDoc; refs?: NoteRefs };

/** A page in the trash (team only): it goes for good after 30 days. */
export type NoteTrashItem = { id: string; title: string; icon: string; deletedAt: string; deletedBy: string | null; parentId: string | null };

/** What a link card keeps in the document: read once from the page by the hub's server. */
export type NoteLinkPreview = { href: string; title: string; description: string; site: string; image: string | null };

export type NoteCustomer = {
  id: string;
  name: string;
  number: string;
  logo?: CustomerLogo;
  /** Some freelancer looks after the customer: „Sichtbar für“ then offers four levels instead of two. */
  hasFreelancer: boolean;
  /**
   * oalab's own entry (kind team, stage 2 of the plan „oalab als Unternehmen“): first in the list, tagged „Intern“,
   * „Sichtbar für“ only „Nur Team“ or „Team und Freelancer“, „Team informieren“ instead of „Änderung mitteilen“.
   */
  team?: boolean;
};

export type NoteProject = { id: string; name: string };

/** The defaults for all notes, set once by the team (hub_note_settings). */
export type NoteSettings = {
  defaultAudience: NoteAudience;
  notifyOnShare: boolean;
  groupByProject: boolean;
  meetingTemplate: NoteTemplateId;
  defaultWidth: NoteWidth;
  /** What customers may do on a page the team newly shares with them (23.11.2026; default „Bearbeiten“). */
  customerAccess: "read" | "edit";
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
  /** The viewer may create and tick tasks from a note (an admin with a confirmed code, or a freelancer). */
  taskWriter: boolean;
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

// ---- Step 3 -------------------------------------------------------------------------------------------------------

/** A former version of a page (team only): kept before edits at most every 10 minutes and before „Sichtbar für“ changes. */
export type NoteRevision = {
  id: string;
  version: number;
  title: string;
  icon: string;
  audience: NoteAudience;
  /** Why it was kept: an edit, a change of „Sichtbar für“, or the state before a restore. */
  reason: "edit" | "audience" | "restore";
  savedBy: string | null;
  savedAt: string;
  createdAt: string;
  /** The text of that version, for reading before restoring. */
  text: string;
};

/** Pages with a date, and meeting notes at their appointments, for the calendar (only what the viewer sees). */
export type CalendarNote = { id: string; title: string; icon: string; customerId: string; day: string };
export type CalendarNotes = {
  dated: CalendarNote[];
  byAppointment: Record<string, { id: string; customerId: string; title: string }>;
  /** Meeting notes of appointments without a customer go to oalab (admins, once the database knows it, stage 2). */
  internal?: boolean;
};
export const NO_CALENDAR_NOTES: CalendarNotes = { dated: [], byAppointment: {} };

/** A hit of the hub's search in the notes. */
export type NoteSearchHit = { id: string; title: string; icon: string; customerId: string; customer: string; snippet: string };

/** The free start times a request may use on a day, with the durations oalab offers. */
export type NoteRequestSlots = { durations: number[]; minutes: number; starts: string[]; lastDay: string };
