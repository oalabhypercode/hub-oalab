"use client";

import { useEffect, useRef, useState } from "react";
import { BriefcaseBusiness, Building2, CalendarClock, CalendarDays, Eye, FolderOpen, History, Image as ImageIcon, Link2, Lock, MessageCircle, PenLine, Rows3, Smile, SquareKanban, Trash2, Users, X, Bell } from "lucide-react";
import { ACCESS_LABELS, accessLabel, accessOf, accessSentence, audienceChoices, audienceLabel, editedAgo, NOTE_ACCESS, viewerEdits } from "@/lib/hub-notes/rules";
import { galleryCover } from "@/lib/hub-notes/covers";
import type { NoteAccess, NoteAudience, NoteCustomer, NotePageMeta, NoteProject, NoteReader, NoteRights, NoteSettings, NotesTextSize, NoteViewer, NoteWidth } from "@/lib/hub-notes/types";
import { Switch } from "../controls";
import { Select } from "../select";
import { Modal } from "../modal";
import { EmojiGlyph } from "./notes-blocks";

// Everything about a page lives behind its gear (plan 1.4), the defaults for all notes behind the gear of the list,
// and the text size behind „Aa“ (1.2): it belongs to this device only, so it is never in the page's gear.

export const audienceIcons: Record<NoteAudience, React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = { team: Lock, both: Users, customer: Eye, freelancer: BriefcaseBusiness };

type Mark = { Icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>; tone: "team" | "read" | "edit"; label: string };

/**
 * How a page shows who reads and who writes it (23.11.2026), on top of the page and in the list. The team sees every
 * page's state: the lock for „Nur Team“, the eye where the customer reads, the pen where somebody outside writes along.
 * Customers and freelancers see whether they may write along.
 */
export function accessMark(page: NoteRights, viewer: NoteViewer, hasFreelancer = true): Mark {
  if (viewer !== "admin") return viewerEdits(viewer, page) ? { Icon: PenLine, tone: "edit", label: "Du kannst mitschreiben" } : { Icon: Eye, tone: "read", label: "Nur lesen" };
  const access = accessOf(page);
  const freelancer = hasFreelancer ? access.freelancer : "none";
  const label = accessLabel(page, hasFreelancer);
  if (access.customer === "none" && freelancer === "none") return { Icon: Lock, tone: "team", label };
  if (access.customer === "edit" || (access.customer === "none" && freelancer === "edit")) return { Icon: PenLine, tone: "edit", label };
  return { Icon: access.customer === "none" ? BriefcaseBusiness : Eye, tone: "read", label };
}

/** Closes a popup on Escape and on a click outside it (not on the button that opened it). */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void, ignore?: string) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (ref.current?.contains(target) || (ignore && target.closest(ignore)) || target.closest(".nz-ep, .hub-modal")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    return () => { document.removeEventListener("keydown", onKey); window.clearTimeout(timer); document.removeEventListener("pointerdown", onPointer); };
  }, [ref, onClose, ignore]);
}

function AudienceTiles({ choices, value, onPick, disabled }: { choices: { id: NoteAudience; label: string; tip?: string; off?: boolean }[]; value: NoteAudience; onPick: (value: NoteAudience) => void; disabled?: boolean }) {
  return (
    <div className="nz-grid2" role="radiogroup" aria-label="Sichtbar für">
      {choices.map((choice) => {
        const Icon = audienceIcons[choice.id];
        const on = choice.id === value;
        return (
          <button key={choice.id} type="button" role="radio" aria-checked={on} className={`nz-opt${on ? " is-on" : ""}`} disabled={disabled || choice.off} data-tip={choice.tip} onClick={() => onPick(choice.id)}>
            <Icon size={16} aria-hidden={true} /><span>{choice.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One side of „Zugriff“: its name, „Kein Zugriff · Lesen · Bearbeiten“, a sentence and who opened the page when. */
function AccessRow({ icon, label, value, closed, tip, note, readers, onPick }: { icon: React.ReactNode; label: string; value: NoteAccess; closed: NoteAccess[]; tip?: string; note: string; readers: NoteReader[] | null | undefined; onPick: (value: NoteAccess) => void }) {
  return (
    <div className="nz-access-row">
      <div className="nz-access-name">{icon}<span>{label}</span></div>
      <span className="nz-seg nz-access-seg" role="radiogroup" aria-label={`Zugriff: ${label}`}>
        {NOTE_ACCESS.map((id) => {
          const off = closed.includes(id);
          return <button key={id} type="button" role="radio" aria-checked={value === id} className={`nz-seg-btn${value === id ? " is-on" : ""}`} disabled={off} data-tip={off ? tip : undefined} onClick={() => onPick(id)}>{ACCESS_LABELS[id]}</button>;
        })}
      </span>
      <p className="nz-pop-note">{note}</p>
      {value !== "none" && readers === null && <p className="nz-access-seen">Wird geladen …</p>}
      {value !== "none" && readers && (readers.length
        ? <ul className="nz-access-readers">{readers.map((reader) => <li key={reader.id}><span>{reader.name}</span><span className={reader.seenAt ? "" : "is-new"}>{reader.seenAt ? `geöffnet ${editedAgo(reader.seenAt)}` : "noch nicht geöffnet"}</span></li>)}</ul>
        : <p className="nz-access-seen">Noch kein aktiver Zugang.</p>)}
    </div>
  );
}

function WidthSwitch({ value, onChange, disabled }: { value: NoteWidth; onChange: (value: NoteWidth) => void; disabled?: boolean }) {
  return (
    <span className="nz-seg" role="group" aria-label="Breite">
      {(["normal", "wide"] as const).map((width) => (
        <button key={width} type="button" className={`nz-seg-btn${value === width ? " is-on" : ""}`} aria-pressed={value === width} disabled={disabled} onClick={() => onChange(width)}>{width === "normal" ? "Normal" : "Breit"}</button>
      ))}
    </span>
  );
}

type GearProps = {
  page: NotePageMeta;
  viewer: NoteViewer;
  customer: NoteCustomer;
  projects: NoteProject[];
  parent: NotePageMeta | null;
  people: Record<string, string>;
  canEdit: boolean;
  /** Project, date, cover and width: the team's and the freelancers', never a customer's who writes along. */
  canArrange: boolean;
  /** „Zugriff“ (team): the customer's or the freelancers' choice of „Kein Zugriff · Lesen · Bearbeiten“. */
  onAccess: (side: "customer" | "freelancer", access: NoteAccess) => void;
  /** Who may open the page and when they last did; null while it loads (team only). */
  readers?: { customer: NoteReader[]; freelancer: NoteReader[] } | null;
  /** Customers who only read find their way to the chat. */
  chatHref?: string;
  onProject: (projectId: string | null) => void;
  onDate: (date: string | null) => void;
  onWidth: (width: NoteWidth) => void;
  onIcon: () => void;
  onCover: () => void;
  onCopyLink: () => void;
  onClose: () => void;
  /** Step 2: tell everybody who sees the page about a change, the trash, and open checklist points as tasks. */
  onNotify?: () => void;
  onTrash?: () => void;
  openItems?: number;
  onOpenItems?: () => void;
  /** Step 3: the page's history (team) and, for a meeting note, its appointment in the calendar. */
  onHistory?: () => void;
  appointmentHref?: string | null;
};

/** „Diese Seite“: who sees it, project, date, symbol, cover, width, the link; last edited at the bottom. */
export function PageGear({ page, viewer, customer, projects, parent, people, canEdit, canArrange, onAccess, readers, chatHref, onProject, onDate, onWidth, onIcon, onCover, onCopyLink, onClose, onNotify, onTrash, openItems = 0, onOpenItems, onHistory, appointmentHref }: GearProps) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, onClose, "[data-gear-button]");
  const admin = viewer === "admin";
  const project = projects.find((item) => item.id === page.projectId);
  const access = accessOf(page);
  // A subpage is at most as visible as its parent; writing along is the page's own choice.
  const above = parent ? accessOf(parent) : null;
  const closed = (side: "customer" | "freelancer"): NoteAccess[] => above && above[side] === "none" ? ["read", "edit"] : [];
  const narrowedByParent = Boolean(parent) && (closed("customer").length > 0 || (customer.hasFreelancer && closed("freelancer").length > 0));
  const editedBy = page.updatedBy ? people[page.updatedBy] : "";
  const cover = page.cover?.kind === "gallery" ? galleryCover(page.cover.value)?.name ?? "Bild" : page.cover ? "Bild" : "Keins";
  return (
    <div ref={box} className="nz-pop nz-gear-pop nz-glass" role="dialog" aria-label="Einstellungen dieser Seite">
      <div className="nz-pop-head"><strong>Diese Seite</strong><button type="button" className="nz-ibtn" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button></div>
      {admin && (
        <div className="nz-pop-sec">
          <div className="nz-pop-label">Zugriff</div>
          <AccessRow
            icon={<Building2 size={16} aria-hidden="true" />}
            label={customer.name}
            value={access.customer}
            closed={closed("customer")}
            tip={parent ? `Höchstens so sichtbar wie „${parent.title}“` : undefined}
            note={accessSentence("customer", access.customer, customer.name)}
            readers={readers === undefined ? undefined : readers?.customer ?? null}
            onPick={(value) => onAccess("customer", value)}
          />
          {customer.hasFreelancer && (
            <AccessRow
              icon={<BriefcaseBusiness size={16} aria-hidden="true" />}
              label="Freelancer des Kunden"
              value={access.freelancer}
              closed={closed("freelancer")}
              tip={parent ? `Höchstens so sichtbar wie „${parent.title}“` : undefined}
              note={accessSentence("freelancer", access.freelancer, customer.name)}
              readers={readers === undefined ? undefined : readers?.freelancer ?? null}
              onPick={(value) => onAccess("freelancer", value)}
            />
          )}
          {narrowedByParent && parent && <p className="nz-pop-note">Als Unterseite von „{parent.title}“ höchstens so sichtbar wie sie.</p>}
        </div>
      )}
      {viewer === "customer" && (
        <div className="nz-pop-sec">
          <p className="nz-pop-note is-first">{canEdit ? "oalab hat diese Seite mit dir geteilt, zum Mitschreiben. Was du schreibst, speichert sich von selbst, und oalab sieht, was neu ist." : "oalab hat diese Seite mit dir geteilt, zum Lesen. Möchtest du etwas ergänzen oder fragen, schreib uns im Chat."}</p>
          {!canEdit && chatHref && <a className="nz-pop-row nz-pop-link" href={chatHref}><MessageCircle size={16} aria-hidden="true" /><span>Im Chat schreiben</span></a>}
        </div>
      )}
      {viewer === "freelancer" && (
        <div className="nz-pop-sec">
          <div className="nz-pop-label">Sichtbar für</div>
          <p className="nz-pop-note is-first">{page.audience === "freelancer" ? "Das oalab-Team und die Freelancer des Kunden." : page.audience === "both" ? "Das oalab-Team, der Kunde und seine Freelancer." : "Das oalab-Team."} {canEdit ? "Du kannst mitschreiben." : "Du kannst sie lesen."} Das legt das oalab-Team fest.</p>
        </div>
      )}
      <div className="nz-pop-sep" />
      <div className="nz-pop-row">
        <FolderOpen size={16} aria-hidden="true" /><span>Projekt</span>
        {canArrange && !page.parentId ? (
          <span className="nz-pop-select">
            <Select value={page.projectId ?? ""} onChange={(value) => onProject(value || null)} label="Projekt" options={[{ value: "", label: "Allgemein" }, ...projects.map((item) => ({ value: item.id, label: item.name }))]} />
          </span>
        ) : <span className="nz-pop-val">{project?.name ?? "Allgemein"}</span>}
      </div>
      <label className="nz-pop-row">
        <CalendarDays size={16} aria-hidden="true" /><span>Datum</span>
        {canArrange ? (
          <span className="nz-pop-date">
            <input type="date" value={page.datedOn ?? ""} onChange={(event) => onDate(event.target.value || null)} aria-label="Datum der Seite" />
            {page.datedOn && <button type="button" className="nz-ibtn is-sm" aria-label="Datum entfernen" onClick={() => onDate(null)}><X size={14} aria-hidden="true" /></button>}
          </span>
        ) : <span className="nz-pop-val">{page.datedOn ? new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${page.datedOn}T00:00:00Z`)) : "Kein Datum"}</span>}
      </label>
      {appointmentHref && <a className="nz-pop-row" href={appointmentHref}><CalendarClock size={16} aria-hidden="true" /><span>Termin</span><span className="nz-pop-val">Im Kalender öffnen</span></a>}
      {canEdit && <button type="button" className="nz-pop-row" onClick={onIcon}><Smile size={16} aria-hidden="true" /><span>Symbol</span><span className="nz-pop-val">{page.icon ? <EmojiGlyph char={page.icon} size={18} /> : "–"}</span></button>}
      {canArrange && <>
        <button type="button" className="nz-pop-row" onClick={onCover}><ImageIcon size={16} aria-hidden="true" /><span>Titelbild</span><span className="nz-pop-val">{cover}</span></button>
        <div className="nz-pop-row"><Rows3 size={16} aria-hidden="true" /><span>Breite</span><span className="nz-pop-right"><WidthSwitch value={page.width} onChange={onWidth} /></span></div>
      </>}
      <div className="nz-pop-sep" />
      {onNotify && page.audience !== "team" && <button type="button" className="nz-pop-row" onClick={onNotify}><Bell size={16} aria-hidden="true" /><span>Änderung mitteilen</span></button>}
      {onOpenItems && openItems > 0 && <button type="button" className="nz-pop-row" onClick={onOpenItems}><SquareKanban size={16} aria-hidden="true" /><span>Offene Punkte als Aufgaben</span><span className="nz-pop-val">{openItems}</span></button>}
      {onHistory && <button type="button" className="nz-pop-row" data-history-button onClick={onHistory}><History size={16} aria-hidden="true" /><span>Verlauf</span><span className="nz-pop-val">Frühere Fassungen</span></button>}
      <button type="button" className="nz-pop-row" onClick={onCopyLink}><Link2 size={16} aria-hidden="true" /><span>Link kopieren</span></button>
      {onTrash && <button type="button" className="nz-pop-row is-danger" onClick={onTrash}><Trash2 size={16} aria-hidden="true" /><span>In den Papierkorb</span></button>}
      {viewer !== "customer" && <p className="nz-pop-foot">Zuletzt bearbeitet{editedBy ? ` von ${editedBy}` : ""} · {editedAgo(page.updatedAt)}</p>}
    </div>
  );
}

/** „Notizen · für alle Kunden“ (only the team): set once, valid for every customer. */
export function AreaGear({ settings, onChange, onClose }: { settings: NoteSettings; onChange: (patch: Partial<NoteSettings>) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, onClose, "[data-area-button]");
  return (
    <div ref={box} className="nz-pop nz-area-pop nz-glass" role="dialog" aria-label="Einstellungen für alle Notizen">
      <div className="nz-pop-head"><strong>Notizen · für alle Kunden</strong><button type="button" className="nz-ibtn" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button></div>
      <div className="nz-pop-sec">
        <div className="nz-pop-label">Neue Seiten sind sichtbar für</div>
        <AudienceTiles choices={audienceChoices(true).map((id) => ({ id, label: audienceLabel(id) }))} value={settings.defaultAudience} onPick={(defaultAudience) => onChange({ defaultAudience })} />
        <p className="nz-pop-note">Bei Kunden ohne Freelancer gilt „Kunde und Freelancer“ als „Kunde“ und „Nur Freelancer“ als „Nur Team“. Unterseiten übernehmen die Stufe ihrer Seite.</p>
      </div>
      <div className="nz-pop-sec">
        <div className="nz-pop-label">Kunden auf neu geteilten Seiten</div>
        <span className="nz-seg nz-access-seg is-two" role="radiogroup" aria-label="Kunden auf neu geteilten Seiten">
          {(["read", "edit"] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={settings.customerAccess === value} className={`nz-seg-btn${settings.customerAccess === value ? " is-on" : ""}`} onClick={() => onChange({ customerAccess: value })}>{ACCESS_LABELS[value]}</button>
          ))}
        </span>
        <p className="nz-pop-note">Gilt, wenn eine Seite neu für den Kunden sichtbar wird, etwa mit „Mit Kunde teilen“. Jede Seite lässt sich im Zahnrad umstellen.</p>
      </div>
      <div className="nz-pop-sep" />
      <div className="nz-pop-row"><Bell size={16} aria-hidden="true" /><span>Beim Freigeben melden</span><span className="nz-pop-right"><Switch checked={settings.notifyOnShare} onChange={(notifyOnShare) => onChange({ notifyOnShare })} label="Beim Freigeben melden" /></span></div>
      <div className="nz-pop-row"><FolderOpen size={16} aria-hidden="true" /><span>Nach Projekten gliedern</span><span className="nz-pop-right"><Switch checked={settings.groupByProject} onChange={(groupByProject) => onChange({ groupByProject })} label="Nach Projekten gliedern" /></span></div>
      <div className="nz-pop-row"><Rows3 size={16} aria-hidden="true" /><span>Seitenbreite</span><span className="nz-pop-right"><WidthSwitch value={settings.defaultWidth} onChange={(defaultWidth) => onChange({ defaultWidth })} /></span></div>
      <p className="nz-pop-foot">Einmal festgelegt, gilt das für alle Kunden. Jede Seite lässt sich über ihr eigenes Zahnrad anpassen.</p>
    </div>
  );
}

const SIZES: { id: NotesTextSize; label: string; px: string; className: string }[] = [
  { id: "small", label: "Klein", px: "15 px", className: "is-s" },
  { id: "medium", label: "Mittel", px: "16,5 px", className: "is-m" },
  { id: "large", label: "Groß", px: "18,5 px", className: "is-l" },
];

/** „Aa“: the text size of the notes on this device (Darstellung keeps the same value). */
export function TextSizePop({ value, onChange, onClose }: { value: NotesTextSize; onChange: (value: NotesTextSize) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, onClose, "[data-size-button]");
  return (
    <div ref={box} className="nz-pop nz-text-pop nz-glass" role="dialog" aria-label="Schriftgröße">
      <div className="nz-pop-head"><strong>Schriftgröße</strong><button type="button" className="nz-ibtn" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button></div>
      <div className="nz-pop-sec">
        <TextSizeTiles value={value} onChange={onChange} />
        <p className="nz-pop-note">Gilt nur auf diesem Gerät und für alle Notizen. So stellst du Handy, Laptop und großen Bildschirm einzeln ein; für andere ändert sich nichts.</p>
      </div>
    </div>
  );
}

export function TextSizeTiles({ value, onChange }: { value: NotesTextSize; onChange: (value: NotesTextSize) => void }) {
  return (
    <div className="nz-sizes" role="radiogroup" aria-label="Schriftgröße der Notizen">
      {SIZES.map((size) => (
        <button key={size.id} type="button" role="radio" aria-checked={value === size.id} className={`nz-size${value === size.id ? " is-on" : ""}`} onClick={() => onChange(size.id)}>
          <span className={`nz-size-aa ${size.className}`} aria-hidden="true">Aa</span>
          <span className="nz-size-name">{size.label}</span>
          <span className="nz-size-px">{size.px}</span>
        </button>
      ))}
    </div>
  );
}

export type AudienceAsk = { page: NotePageMeta; target: NoteAudience; rights: NoteRights; narrowed: { title: string; audience: NoteAudience }[]; hidden: string[] };

/**
 * Before „Sichtbar für“ widens or takes subpages along: who will see the page afterwards and which subpages become
 * narrower too. Releasing goes anyway; the team decides.
 */
export function AudienceDialog({ ask, customer, notifyDefault, onConfirm, onClose }: { ask: AudienceAsk; customer: NoteCustomer; notifyDefault: boolean; onConfirm: (notify: boolean) => void; onClose: () => void }) {
  const [notify, setNotify] = useState(notifyDefault);
  const before = ask.page.audience;
  const gainCustomer = (ask.target === "both" || ask.target === "customer") && !(before === "both" || before === "customer");
  const gainFreelancer = (ask.target === "both" || ask.target === "freelancer") && !(before === "both" || before === "freelancer");
  const release = gainCustomer || gainFreelancer;
  const who = gainCustomer && gainFreelancer ? `${customer.name} und den Freelancern des Kunden` : gainCustomer ? customer.name : "den Freelancern des Kunden";
  const title = release ? (gainCustomer && gainFreelancer ? "Für Kunde und Freelancer freigeben?" : gainCustomer ? `Für ${customer.name} freigeben?` : "Für die Freelancer freigeben?") : "Unterseiten werden mit eingeschränkt";
  const count = ask.narrowed.length;
  const writeCustomer = gainCustomer && ask.rights.customerEdits;
  const writeFreelancer = gainFreelancer && ask.rights.freelancerEdits;
  const writes = writeCustomer && writeFreelancer ? " Beide können dort mitschreiben." : writeCustomer ? ` ${customer.name} kann dort mitschreiben.` : writeFreelancer ? " Die Freelancer können dort mitschreiben." : gainCustomer || gainFreelancer ? " Dort wird nur gelesen." : "";
  return (
    <Modal title={title} onClose={onClose} className="nz-dialog">
      <p className="modal-description">
        {release
          ? `„${ask.page.title}“ steht danach bei ${who} unter Projekte › Notizen.${writes}${count ? ` ${count} ${count === 1 ? "Unterseite wird" : "Unterseiten werden"} dabei eingeschränkt.` : ""}`
          : `„${ask.page.title}“ wird „${audienceLabel(ask.target, customer.hasFreelancer)}“. Diese Unterseiten wären sonst sichtbarer als die Seite darüber:`}
      </p>
      {count > 0 && (
        <div className="nz-warn">
          <strong>Danach sichtbar für:</strong>
          {ask.narrowed.map((item) => <span key={item.title} className="nz-warn-row">{item.title}: {audienceLabel(item.audience, customer.hasFreelancer)}</span>)}
        </div>
      )}
      {release && ask.hidden.length > 0 && (
        <div className="nz-warn">
          <strong>{gainCustomer && !gainFreelancer ? `Das sieht ${customer.name} auf dieser Seite nicht:` : gainFreelancer && !gainCustomer ? "Das sehen die Freelancer auf dieser Seite nicht:" : "Nicht alles auf dieser Seite ist für beide sichtbar:"}</strong>
          {ask.hidden.map((item) => <span key={item} className="nz-warn-row">{item}</span>)}
          <small>Dort steht für sie nur „Nicht freigegeben“. Freigeben geht trotzdem.</small>
        </div>
      )}
      {release && <label className="nz-check-row"><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} /><span>Meldung in der Glocke und gebündelt per Mail senden</span></label>}
      <div className="nz-dialog-actions">
        <button type="button" className="nz-btn" onClick={onClose}>Abbrechen</button>
        <button type="button" className="nz-btn is-primary" onClick={() => onConfirm(release && notify)}>{release ? "Freigeben" : "Einschränken"}</button>
      </div>
    </Modal>
  );
}
