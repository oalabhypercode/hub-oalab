"use client";

import { Fragment, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, ListFilter, Package } from "lucide-react";
import { categories } from "@/lib/categories";
import { formatPatchDay, formatPatchDayShort, formatPatchSpan, patchAreaLabels, patchAreaOrder, patchBlocksFor, patchKindLabels, type PatchArea, type PatchEntry, type PatchView } from "@/lib/patch-notes";
import { matchesSearch } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { SegmentedControl } from "../controls";
import { TitleIcon } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { sectionIcons } from "../navigation";
import { Select, type SelectOption } from "../select";
import { useHubShell } from "../shell-context";
import { SheetEmpty, SheetFooter, SheetToolbar } from "../sheet";

/** The colour of each area: the hub's category colours where an area is one of them. */
const areaFill: Record<PatchArea, string> = {
  start: "#a3175f",
  projects: categories.projects.fill,
  files: categories.files.fill,
  customers: categories.contracts.fill,
  messages: categories.messages.fill,
  hub: "#8e8e93",
};

type Audience = "all" | "customers" | "freelancers" | "internal";
const audienceLook = {
  customers: { label: "Kunden", dot: categories.messages.fill },
  freelancers: { label: "Freelancer", dot: "#af52de" },
  internal: { label: "Intern", dot: "#8e8e93" },
} as const;
const audiencesOf = (entry: PatchEntry): (keyof typeof audienceLook)[] => {
  const list: (keyof typeof audienceLook)[] = [];
  if (entry.customers) list.push("customers");
  if (entry.freelancers) list.push("freelancers");
  return list.length ? list : ["internal"];
};

const changes = (count: number) => (count === 1 ? "1 Änderung" : `${count} Änderungen`);
const searchFields = (entry: PatchEntry) => [entry.title, entry.text, entry.place, patchAreaLabels[entry.area], patchKindLabels[entry.kind]];
const color = (fill: string) => ({ "--c": fill }) as CSSProperties;

/**
 * The patch notes as patch blocks in a quiet list (user 27.11.2026), after the Asset Management's „Liste“ (fl-*): each
 * patch a line with its number, how many changes and when, each change a line with Art, Bereich, Stelle, Änderung and
 * Datum; a click (or Enter) opens its text below the line, across the whole width. Search and the area filter sit on
 * top. Customers and freelancers see their entries; admins see all, with dots for who sees them, and „Sichtbar für:
 * Kunden“ or „Freelancer“ shows exactly that role's list. Phones keep the dot in the area's colour, the title and the
 * day; kind, area and place stand above the opened text.
 */
export function PatchNotesScreen() {
  const { manageUsers, account } = useHubShell();
  const admin = manageUsers;
  const view: PatchView = admin ? "admin" : account.freelancer ? "freelancer" : "customer";
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<"all" | PatchArea>("all");
  const [audience, setAudience] = useState<Audience>("all");
  // Every patch starts open; the set holds the closed ones. The opened lines are keyed by patch and position.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);

  const asRole = admin && (audience === "customers" || audience === "freelancers");
  const blocks = useMemo(() => patchBlocksFor(asRole ? (audience === "customers" ? "customer" : "freelancer") : view), [asRole, audience, view]);
  const allEntries = useMemo(() => (admin ? patchBlocksFor("admin").flatMap((block) => block.entries) : []), [admin]);
  const tagged = admin && !asRole;

  const searched = (entry: PatchEntry) => matchesSearch(query, searchFields(entry));
  const inAudience = (entry: PatchEntry) => !admin || audience !== "internal" || (!entry.customers && !entry.freelancers);
  const inArea = (entry: PatchEntry) => area === "all" || entry.area === area;
  // The area filter counts what the search and the audience leave, before the area itself is chosen.
  const pool = blocks.flatMap((block) => block.entries).filter((entry) => inAudience(entry) && searched(entry));
  const narrowed = Boolean(query.trim()) || area !== "all";
  const groups = blocks
    .map((block) => ({ block, entries: block.entries.map((entry, index) => ({ entry, key: `${block.version}:${index}` })).filter(({ entry }) => inAudience(entry) && inArea(entry) && searched(entry)) }))
    .filter(({ entries }) => entries.length || !narrowed);
  const shown = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const audiencePool = allEntries.filter((entry) => inArea(entry) && searched(entry));

  const flip = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };
  const chooseArea = (value: string) => { setArea(value as "all" | PatchArea); setOpened(new Set()); };
  const chooseAudience = (value: Audience) => { setAudience(value); setOpened(new Set()); };
  const reset = () => { setQuery(""); setArea("all"); };

  // Enter and the space bar open a line, the arrow keys walk the lines.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-row]") : null;
    if (!row) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.click(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  }

  const areaOptions: SelectOption[] = [
    { value: "all", label: "Alle Bereiche", meta: String(pool.length) },
    ...patchAreaOrder.filter((item) => item === area || pool.some((entry) => entry.area === item)).map((item) => ({
      value: item,
      label: patchAreaLabels[item],
      lead: <i className="pn-dot-mark" style={color(areaFill[item])} />,
      meta: String(pool.filter((entry) => entry.area === item).length),
    })),
  ];

  let stripe = 0;
  const lines = groups.map(({ block, entries }) => {
    const open = narrowed || !closed.has(block.version);
    const patchAlt = stripe++ % 2 ? " is-alt" : "";
    return (
      <Fragment key={block.version}>
        <div className={`fl-row is-folder pn-patch${patchAlt}`} role="row" aria-level={1} aria-expanded={open} tabIndex={0} data-row="" onClick={() => setClosed((now) => flip(now, block.version))}>
          <span role="gridcell" className="fl-cell pn-patch-cell">
            <span className="fl-twist" aria-hidden="true"><ChevronRight size={13} /></span>
            <span className="fl-icon"><Package size={16} strokeWidth={1.8} aria-hidden="true" /></span>
            <span className="fl-title">Patch {block.version}</span>
            <span className="pn-count">{changes(entries.length)}</span>
            <span className="pn-span">{formatPatchSpan(block.from, block.to)}</span>
          </span>
        </div>
        {open && entries.map(({ entry, key }) => {
          const alt = stripe++ % 2 ? " is-alt" : "";
          const expanded = opened.has(key);
          const areaLabel = patchAreaLabels[entry.area];
          const kindLabel = patchKindLabels[entry.kind];
          return (
            <Fragment key={key}>
              <div className={`fl-row pn-line${alt}`} role="row" aria-level={2} aria-expanded={expanded} tabIndex={0} data-row="" onClick={() => setOpened((now) => flip(now, key))}>
                <span role="gridcell" className="fl-cell pn-kind">
                  <span className="fl-twist" aria-hidden="true"><ChevronRight size={13} /></span>
                  <span className={`pn-dot pn-dot-${entry.kind}`}><i /></span>
                  <span className="pn-area-dot" style={color(areaFill[entry.area])} />
                  <span className="pn-kind-label">{kindLabel}</span>
                </span>
                <span role="gridcell" className="fl-cell pn-area-col"><span className="pn-area" style={color(areaFill[entry.area])}><i /><span>{areaLabel}</span></span></span>
                <span role="gridcell" className="fl-cell pn-place-col"><span className="fl-title">{entry.place}</span></span>
                <span role="gridcell" className="fl-cell pn-change">
                  <span className="pn-main">
                    <span className="fl-title">{entry.title}</span>
                    {tagged && (
                      <span className="pn-tags" data-tip={entry.customers || entry.freelancers ? `Sichtbar für ${audiencesOf(entry).map((item) => audienceLook[item].label).join(" und ")}` : "Nur intern"}>
                        {audiencesOf(entry).map((item) => <i key={item} style={{ background: audienceLook[item].dot }} />)}
                      </span>
                    )}
                  </span>
                </span>
                <span role="gridcell" className="fl-cell pn-date"><span className="pn-date-long">{formatPatchDay(entry.date)}</span><span className="pn-date-short">{formatPatchDayShort(entry.date)}</span></span>
              </div>
              {expanded && (
                <div className={`pn-detail${alt}`} role="row">
                  <div className="pn-detail-body" role="gridcell">
                    <span className="pn-detail-meta"><span className="pn-meta-kind">{kindLabel} · </span>{areaLabel} · {entry.place}</span>
                    <p>{entry.text}</p>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </Fragment>
    );
  });

  return (
    <>
      <LargeTitleHeader title="Patch Notes" icon={<TitleIcon icon={sectionIcons["patch-notes"]!} />} actions={<HeaderActions />} />
      <div className="sheet section-first sheet-fill pn-sheet">
        <SheetToolbar query={query} onQuery={(value) => { setQuery(value); setOpened(new Set()); }} placeholder="Änderung, Bereich oder Stelle …" label="Patch Notes durchsuchen">
          <label className={`pn-filter${area === "all" ? "" : " is-set"}`} data-tip="Nach Bereich filtern">
            <ListFilter size={15} aria-hidden="true" />
            <Select variant="bare" chevron showLead label="Bereich" value={area} onChange={chooseArea} options={areaOptions} />
          </label>
          {admin && <>
            <span className="pn-toolbar-label" aria-hidden="true">Sichtbar für</span>
            <SegmentedControl label="Sichtbar für" value={audience} onChange={chooseAudience}
              options={[{ id: "all", label: "Alle", name: "Alle Einträge", count: audiencePool.length }, ...(["customers", "freelancers", "internal"] as const).map((item) => ({ id: item, label: audienceLook[item].label, name: `Sichtbar für ${audienceLook[item].label}`, count: audiencePool.filter((entry) => audiencesOf(entry).includes(item)).length }))]} />
          </>}
        </SheetToolbar>
        {asRole && <p className="sheet-hint pn-hint">So sehen <b>{audienceLook[audience].label}</b> die Patch Notes, mit ihren eigenen Texten.</p>}
        {groups.length ? (
          <div className="sheet-scroll">
            <div ref={list} className="fl pn-list" role="treegrid" aria-label="Patch Notes" onKeyDown={onKeyDown}>
              <div className="fl-head" role="row">
                <span role="columnheader" className="fl-col pn-kind"><span>Art</span></span>
                <span role="columnheader" className="fl-col pn-area-col">Bereich</span>
                <span role="columnheader" className="fl-col pn-place-col">Stelle</span>
                <span role="columnheader" className="fl-col pn-change">Änderung</span>
                <span role="columnheader" className="fl-col pn-date">Datum</span>
              </div>
              <div className="fl-body" role="rowgroup">{lines}</div>
            </div>
          </div>
        ) : (
          <SheetEmpty text={query.trim() ? `Keine Änderung zu „${query.trim()}“${area === "all" ? "" : ` in ${patchAreaLabels[area]}`}.` : "Keine Änderung in diesem Bereich."} onReset={reset} />
        )}
        <SheetFooter hint="Klick auf eine Zeile zeigt die Beschreibung">{changes(shown)} · {groups.length === 1 ? "1 Patch" : `${groups.length} Patches`}</SheetFooter>
      </div>
    </>
  );
}
