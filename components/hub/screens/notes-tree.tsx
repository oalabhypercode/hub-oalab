"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, FileText, PanelLeftClose, Plus, Search, Settings } from "lucide-react";
import { childrenOf, hasOutsideNews } from "@/lib/hub-notes/rules";
import type { NoteCustomer, NotePageMeta, NoteProject, NoteViewer } from "@/lib/hub-notes/types";
import { companyInitials, LogoMark } from "../logo-mark";
import { EmojiGlyph } from "./notes-blocks";
import { accessMark, useDismiss } from "./notes-settings";

// The quiet page list on the left (plan 1.2): the customer with its logo (a click switches, for admins and freelancers),
// search, the gear for all notes (team only) and folding it away; below it „Neue Seite“ and the pages, grouped by the
// customer's projects and „Allgemein“, subpages opening with an arrow. A small symbol shows who else sees a page; „+“ at
// a page adds a subpage, and below the open page „Neue Unterseite“ stays in sight (23.11.2026).

type TreeProps = {
  viewer: NoteViewer;
  customers: NoteCustomer[];
  customer: NoteCustomer;
  projects: NoteProject[];
  pages: NotePageMeta[];
  openId: string | null;
  groupByProject: boolean;
  canCreate: boolean;
  open: Record<string, boolean>;
  onToggle: (id: string, open: boolean) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
  /** „+“ at every page and „Neue Unterseite“ below the open one, where the viewer may add pages under it. */
  canAddUnder: (page: NotePageMeta) => boolean;
  onCreateUnder: (page: NotePageMeta) => void;
  onCustomer: (id: string) => void;
  onArea: () => void;
  areaOpen: boolean;
  onCollapse: () => void;
  phone: boolean;
  /** Below the list: the trash (team only). */
  footer?: React.ReactNode;
};

export function NotesTree({ viewer, customers, customer, projects, pages, openId, groupByProject, canCreate, open, onToggle, onOpen, onCreate, canAddUnder, onCreateUnder, onCustomer, onArea, areaOpen, onCollapse, phone, footer }: TreeProps) {
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [switching, setSwitching] = useState(false);
  const switcher = useRef<HTMLDivElement>(null);
  useDismiss(switcher, () => setSwitching(false), "[data-customer-button]");
  const term = query.trim().toLowerCase();
  const known = new Set(projects.map((project) => project.id));
  // Pages of a project the viewer may not name stand under „Allgemein“.
  const groupOf = (page: NotePageMeta) => page.projectId && known.has(page.projectId) ? page.projectId : "";
  const groups = groupByProject
    ? [...projects.map((project) => ({ id: project.id, name: project.name })), { id: "", name: "Allgemein" }]
    : [{ id: "*", name: "Alle Seiten" }];
  // A subpage stands in its parent's group, whatever its own project says.
  const topOf = (page: NotePageMeta) => {
    let current = page;
    const byId = new Map(pages.map((item) => [item.id, item]));
    for (let step = 0; current.parentId && byId.has(current.parentId) && step < 10; step++) current = byId.get(current.parentId)!;
    return current;
  };

  const rows = (groupId: string) => {
    const inGroup = groupId === "*" ? pages : pages.filter((page) => groupOf(topOf(page)) === groupId);
    const out: React.ReactNode[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const page of childrenOf(inGroup, parentId)) {
        const kids = inGroup.some((item) => item.parentId === page.id);
        const expanded = Boolean(open[page.id]) || Boolean(term);
        const on = page.id === openId;
        const matches = !term || page.title.toLowerCase().includes(term);
        const addable = canCreate && canAddUnder(page);
        if (matches) {
          // Every page says who reads and writes it; a dot marks news from outside the team since the last look.
          const mark = accessMark(page, viewer, customer.hasFreelancer);
          const news = viewer === "admin" && hasOutsideNews(page);
          out.push(
            <div key={page.id} className={`nz-row${on ? " is-on" : ""}`} style={{ paddingLeft: 4 + depth * 16 }}>
              {kids && !term
                ? <button type="button" className={`nz-disc${expanded ? " is-open" : ""}`} aria-expanded={expanded} aria-label={`${expanded ? "Unterseiten von" : "Unterseiten anzeigen:"} „${page.title}“`} onClick={() => onToggle(page.id, !expanded)}><ChevronRight size={14} aria-hidden="true" /></button>
                : <span className="nz-disc-gap" />}
              <button type="button" className="nz-row-main" aria-current={on ? "page" : undefined} onClick={() => onOpen(page.id)}>
                <span className="nz-row-icon">{page.icon ? <EmojiGlyph char={page.icon} size={16} /> : <FileText size={16} aria-hidden="true" />}</span>
                <span className="nz-row-title">{page.title}</span>
                {news && <span className="nz-row-news" data-tip="Neu von außerhalb des Teams"><span className="visually-hidden">Neu bearbeitet</span></span>}
                {(viewer === "admin" || mark.tone === "edit") && <span className={`nz-row-aud is-${mark.tone}`} data-tip={mark.label}><mark.Icon size={14} aria-hidden={true} /><span className="visually-hidden">{mark.label}</span></span>}
              </button>
              {addable && <button type="button" className="nz-row-add" aria-label={`Unterseite in „${page.title}“ anlegen`} data-tip="Unterseite anlegen" onClick={() => onCreateUnder(page)}><Plus size={15} aria-hidden="true" /></button>}
            </div>,
          );
        }
        if (kids && (expanded || term)) walk(page.id, depth + 1);
        // Below the open page, after its subpages: „Neue Unterseite“, always in sight while one works on that page.
        if (on && addable && !term) {
          out.push(
            <button key={`${page.id}-new`} type="button" className="nz-row nz-row-new" style={{ paddingLeft: 4 + (depth + 1) * 16 }} onClick={() => onCreateUnder(page)}>
              <span className="nz-disc-gap" />
              <span className="nz-row-icon"><Plus size={15} aria-hidden="true" /></span>
              <span className="nz-row-title">Neue Unterseite</span>
            </button>,
          );
        }
      }
    };
    walk(null, 0);
    return out;
  };

  const sections = groups.map((group) => ({ ...group, rows: rows(group.id) })).filter((group) => group.rows.length > 0);
  const switchable = customers.length > 1;
  const empty = term ? "Keine Seite passt zur Suche."
    : viewer === "admin" ? `Noch keine Seiten für ${customer.name}.`
    : viewer === "freelancer" ? `Für dich ist bei ${customer.name} noch nichts freigegeben.`
    : "oalab hat noch keine Notizen für dich freigegeben.";

  return (
    <aside className="nz-tree" aria-label="Seiten">
      <div className="nz-tree-head">
        <div className="nz-cust-wrap" ref={switcher}>
          <button type="button" className="nz-cust" data-customer-button aria-haspopup={switchable ? "listbox" : undefined} aria-expanded={switchable ? switching : undefined} disabled={!switchable} onClick={() => setSwitching((value) => !value)}>
            <LogoMark logo={customer.logo ?? null} initials={companyInitials(customer.name)} className="nz-logo" />
            <strong>{customer.name}</strong>
            {switchable && <ChevronDown size={14} aria-hidden="true" />}
          </button>
          {switching && (
            <div className="nz-pop nz-cust-pop nz-glass" role="listbox" aria-label="Kunde wählen">
              {customers.map((item) => (
                <button key={item.id} type="button" role="option" aria-selected={item.id === customer.id} className={`nz-cust-item${item.id === customer.id ? " is-on" : ""}`} onClick={() => { setSwitching(false); onCustomer(item.id); }}>
                  <LogoMark logo={item.logo ?? null} initials={companyInitials(item.name)} className="nz-logo is-sm" />
                  <span className="nz-cust-text"><strong>{item.name}</strong><span>{item.number}</span></span>
                  {item.id === customer.id && <Check size={16} className="nz-accent" aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className={`nz-ibtn${search ? " is-on" : ""}`} aria-label="Seiten durchsuchen" data-tip="Seiten durchsuchen" aria-pressed={search} onClick={() => { setSearch((value) => !value); setQuery(""); }}><Search size={16} aria-hidden="true" /></button>
        {viewer === "admin" && <button type="button" className={`nz-ibtn${areaOpen ? " is-on" : ""}`} data-area-button aria-label="Einstellungen für alle Notizen" data-tip="Einstellungen für alle Notizen" aria-expanded={areaOpen} onClick={onArea}><Settings size={16} aria-hidden="true" /></button>}
        {!phone && <button type="button" className="nz-ibtn" aria-label="Seitenliste einklappen" data-tip="Seitenliste einklappen" onClick={onCollapse}><PanelLeftClose size={16} aria-hidden="true" /></button>}
      </div>
      {search && (
        <label className="nz-tsearch"><Search size={14} aria-hidden="true" /><input type="search" autoFocus placeholder="Seiten durchsuchen" aria-label="Seiten durchsuchen" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      )}
      {canCreate && <button type="button" className="nz-new" onClick={onCreate}><Plus size={16} aria-hidden="true" /><span>Neue Seite</span></button>}
      <div className="nz-tree-scroll">
        {sections.map((section) => (
          <div key={section.id || "general"} className="nz-group">
            {groupByProject && <div className="nz-sec">{section.name}</div>}
            {section.rows}
          </div>
        ))}
        {!sections.length && <p className="nz-tree-empty">{empty}</p>}
      </div>
      {footer && <div className="nz-tree-foot">{footer}</div>}
    </aside>
  );
}
