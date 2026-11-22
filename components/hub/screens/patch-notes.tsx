"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, FileBadge, Files, FolderOpen, LayoutGrid, MessageSquare, Settings, type LucideIcon } from "lucide-react";
import { categories } from "@/lib/categories";
import { formatPatchDate, patchAreaLabels, patchAreaOrder, patchKindLabels, patchPackagesFor, type PatchArea, type PatchChange, type PatchChangeKind, type PatchPackage } from "@/lib/patch-notes";
import { matchesSearch } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { SegmentedControl } from "../controls";
import { TitleIcon } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { sectionIcons } from "../navigation";
import { useHubShell } from "../shell-context";
import { SheetEmpty, SheetFooter, SheetToolbar, TableGroup, useCollapsedGroups } from "../sheet";

/** Symbol and colour of each area: the hub's category colours where an area is one of them. */
const areaLook: Record<PatchArea, { icon: LucideIcon; fill: string; text: string }> = {
  start: { icon: LayoutGrid, fill: "#a3175f", text: "var(--accent-text)" },
  projects: { icon: FolderOpen, fill: categories.projects.fill, text: categories.projects.text },
  files: { icon: Files, fill: categories.files.fill, text: categories.files.text },
  customers: { icon: FileBadge, fill: categories.contracts.fill, text: categories.contracts.text },
  messages: { icon: MessageSquare, fill: categories.messages.fill, text: categories.messages.text },
  hub: { icon: Settings, fill: "#8e8e93", text: "var(--label-secondary)" },
};

const kindOrder: readonly PatchChangeKind[] = ["new", "improved", "fixed", "security"];

type Audience = "all" | "customers" | "freelancers" | "internal";
const audienceLook = {
  customers: { label: "Kunden", dot: categories.messages.fill },
  freelancers: { label: "Freelancer", dot: "#af52de" },
  internal: { label: "Intern", dot: "#8e8e93" },
} as const;
const audiencesOf = (change: PatchChange): (keyof typeof audienceLook)[] => {
  const list: (keyof typeof audienceLook)[] = [];
  if (change.customers) list.push("customers");
  if (change.freelancers) list.push("freelancers");
  return list.length ? list : ["internal"];
};
const seenBy = (change: PatchChange, audience: Audience) => audience === "all" || audiencesOf(change).includes(audience);

type Row = { key: string; pkg: PatchPackage; change: PatchChange };
type Grouping = "package" | "area";
const changes = (count: number) => (count === 1 ? "1 Änderung" : `${count} Änderungen`);

/** A text cut to two lines; „Ganzen Text anzeigen“ appears only when something is cut off. */
function ClampText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || open) return;
    // The observer reports once right away and again whenever the column changes its width.
    const observer = new ResizeObserver(() => setClipped(element.scrollHeight > element.clientHeight + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, text]);
  return (
    <>
      <p ref={ref} className={`patch-change-text${open ? "" : " is-clamped"}`}>{text}</p>
      {(clipped || open) && <button type="button" className="patch-more" aria-expanded={open} onClick={() => setOpen((now) => !now)}>{open ? "Weniger anzeigen" : "Ganzen Text anzeigen"}</button>}
    </>
  );
}

/**
 * Every change to the hub as a table (design „Patch Notes V2“, user 21.11.2026): Art · Bereich & Stelle · Änderung,
 * for admins also „Sichtbar für“. Grouped by package (go-live) or by one of the six areas, with search and filters for
 * kind, area and, for admins, audience. Real admins see all entries, freelancers the ones for them (since 18.11.2026),
 * everyone else the ones for customers.
 */
export function PatchNotesScreen() {
  const { manageUsers, account } = useHubShell();
  const admin = manageUsers;
  const view = admin ? "admin" : account.freelancer ? "freelancer" : "customer";
  const packages = useMemo(() => patchPackagesFor(view), [view]);
  const rows = useMemo<Row[]>(() => packages.flatMap((pkg) => pkg.changes.map((change) => ({ key: `${pkg.number}:${change.title}`, pkg, change }))), [packages]);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | PatchChangeKind>("all");
  const [area, setArea] = useState<"all" | PatchArea>("all");
  const [audience, setAudience] = useState<Audience>("all");
  const [grouping, setGrouping] = useState<Grouping>("package");
  const [summaries, setSummaries] = useState<ReadonlySet<number>>(new Set());
  const groups = useCollapsedGroups();

  const audienceNow: Audience = admin ? audience : "all";
  const found = rows.filter((row) => matchesSearch(query, [row.change.title, row.change.text, row.change.place, patchAreaLabels[row.change.area], ...(row.change.also ?? []).map((other) => patchAreaLabels[other])]));
  const inArea = (row: Row) => area === "all" || row.change.area === area;
  const ofKind = (row: Row) => kind === "all" || row.change.kind === kind;
  const base = found.filter((row) => seenBy(row.change, audienceNow));
  const shown = base.filter((row) => inArea(row) && ofKind(row));

  const kindPool = base.filter(inArea);
  const areaPool = base.filter(ofKind);
  const audiencePool = found.filter((row) => inArea(row) && ofKind(row));
  const areaCounts = new Map(patchAreaOrder.map((key) => [key, areaPool.filter((row) => row.change.area === key).length]));
  // Only the kinds this reader has at all (customers have no security entries, say).
  const kinds = kindOrder.filter((item) => rows.some((row) => row.change.kind === item));
  const columns = admin ? 4 : 3;
  const reset = () => { setQuery(""); setKind("all"); setArea("all"); setAudience("all"); };
  const filtered = Boolean(query.trim()) || kind !== "all" || area !== "all" || audienceNow !== "all";
  const packageLabel = (pkg: PatchPackage) => `${admin ? `Paket ${pkg.number} · ` : ""}${formatPatchDate(pkg.date)}`;
  const toggleSummary = (number: number) => setSummaries((current) => {
    const next = new Set(current);
    if (next.has(number)) next.delete(number); else next.add(number);
    return next;
  });

  function changeRow({ key, pkg, change }: Row) {
    const look = areaLook[change.area];
    const Icon = look.icon;
    return (
      <tr key={key} className="patch-row">
        <td className="cell-kind"><span className={`project-status patch-kind patch-kind-${change.kind}`}>{patchKindLabels[change.kind]}</span></td>
        <td className="cell-where">
          <span className="patch-where">
            {grouping === "package" && <span className="patch-area-icon" style={{ "--c": look.fill } as CSSProperties} aria-hidden="true"><Icon size={14} /></span>}
            <span className="patch-where-text">
              {grouping === "package"
                ? <strong style={{ color: look.text }}>{patchAreaLabels[change.area]}</strong>
                : <strong>{packageLabel(pkg)}</strong>}
              <span>{change.place}</span>
              {change.also?.length ? <small>auch: {change.also.map((other) => patchAreaLabels[other]).join(", ")}</small> : null}
            </span>
          </span>
        </td>
        <td className="cell-change">
          <p className="patch-change-title">{change.title}</p>
          <ClampText text={change.text} />
        </td>
        {admin && (
          <td className="cell-aud">
            <span className="patch-auds">
              {audiencesOf(change).map((item) => <span key={item} className="patch-aud" style={{ "--c": audienceLook[item].dot } as CSSProperties}><i aria-hidden="true" />{audienceLook[item].label}</span>)}
            </span>
          </td>
        )}
      </tr>
    );
  }

  function packageGroup(pkg: PatchPackage, list: Row[]) {
    const key = `package:${pkg.number}`;
    const collapsed = groups.isCollapsed(key);
    const open = summaries.has(pkg.number);
    const touched = patchAreaOrder.filter((item) => list.some((row) => row.change.area === item));
    return (
      <tbody key={key} className="table-group-body patch-group">
        <tr className="table-group patch-head-row">
          <th colSpan={columns} scope="rowgroup">
            <div className="patch-head">
              <button type="button" className="table-group-toggle patch-toggle" aria-expanded={!collapsed} onClick={() => groups.toggle(key)}>
                <ChevronDown size={14} className="table-group-chevron" aria-hidden="true" />
                <span className="patch-head-text">
                  <span className="patch-eyebrow">{packageLabel(pkg)} · {changes(list.length)}</span>
                  <span className="patch-head-title">{pkg.title}</span>
                </span>
              </button>
              <span className="patch-kinds">
                {kindOrder.filter((item) => list.some((row) => row.change.kind === item)).map((item) => (
                  <span key={item} className={`project-status patch-kind patch-kind-${item}`}>{patchKindLabels[item]} <span className="numeric">{list.filter((row) => row.change.kind === item).length}</span></span>
                ))}
              </span>
            </div>
            <div className="patch-touches">
              <span>Betrifft</span>
              {touched.map((item) => {
                const count = list.filter((row) => row.change.area === item).length;
                return (
                  <button key={item} type="button" className="patch-touch" style={{ "--c": areaLook[item].fill } as CSSProperties} aria-label={`${patchAreaLabels[item]}: ${changes(count)}, nur diesen Bereich zeigen`} onClick={() => setArea(item)}>
                    <i aria-hidden="true" />{patchAreaLabels[item]}<span className="numeric">{count}</span>
                  </button>
                );
              })}
            </div>
            {admin && <>
              <button type="button" className="patch-summary-toggle" aria-expanded={open} onClick={() => toggleSummary(pkg.number)}><ChevronRight size={13} aria-hidden="true" />Zusammenfassung für Admins</button>
              {open && <p className="patch-summary">{pkg.summary}</p>}
            </>}
          </th>
        </tr>
        {!collapsed && list.map(changeRow)}
      </tbody>
    );
  }

  function areaGroup(item: PatchArea, list: Row[]) {
    const key = `area:${item}`;
    const look = areaLook[item];
    const Icon = look.icon;
    return (
      <TableGroup key={key} colSpan={columns} label={patchAreaLabels[item]} count={list.length} collapsed={groups.isCollapsed(key)} onToggle={() => groups.toggle(key)} className="patch-group"
        glyph={<span className="patch-area-icon" style={{ "--c": look.fill } as CSSProperties}><Icon size={14} aria-hidden="true" /></span>}
        sub={`zuletzt ${formatPatchDate(list[0].pkg.date)}`}>
        {list.map(changeRow)}
      </TableGroup>
    );
  }

  const bodies = grouping === "package"
    ? packages.map((pkg) => ({ pkg, list: shown.filter((row) => row.pkg === pkg) })).filter(({ list }) => list.length).map(({ pkg, list }) => packageGroup(pkg, list))
    : patchAreaOrder.map((item) => ({ item, list: shown.filter((row) => row.change.area === item) })).filter(({ list }) => list.length).map(({ item, list }) => areaGroup(item, list));
  const packageCount = new Set(shown.map((row) => row.pkg.number)).size;

  return (
    <>
      <LargeTitleHeader title="Patch Notes" icon={<TitleIcon icon={sectionIcons["patch-notes"]!} />} actions={<HeaderActions />} />
      <p className="section-first t-subheadline patch-intro">
        {admin
          ? "Alle Änderungen am Hub, ein Paket pro Livegang. Jede Zeile nennt Art, Bereich und genaue Stelle; „Sichtbar für“ zeigt, wer den Eintrag sieht."
          : "Was sich am Client Hub geändert hat, ein Paket pro Livegang, mit Bereich und genauer Stelle."}
      </p>
      <div className="sheet sheet-fill patch-sheet">
        <SheetToolbar query={query} onQuery={setQuery} placeholder="Titel, Text oder Stelle …" label="Patch Notes durchsuchen"
          trailing={<>
            <span className="patch-toolbar-label" aria-hidden="true">Gruppieren</span>
            <SegmentedControl label="Gruppieren nach" value={grouping} onChange={setGrouping} options={[{ id: "package", label: "Paket", name: "Nach Paket gruppieren" }, { id: "area", label: "Bereich", name: "Nach Bereich gruppieren" }]} />
          </>}>
          <SegmentedControl label="Art der Änderung" value={kind} onChange={setKind}
            options={[{ id: "all", label: "Alle", name: "Alle Arten", count: kindPool.length }, ...kinds.map((item) => ({ id: item, label: patchKindLabels[item], name: patchKindLabels[item], count: kindPool.filter((row) => row.change.kind === item).length }))]} />
          {admin && <>
            <span className="patch-toolbar-label" aria-hidden="true">Sichtbar für</span>
            <SegmentedControl label="Sichtbar für" value={audience} onChange={setAudience}
              options={[{ id: "all", label: "Alle", name: "Alle Einträge", count: audiencePool.length }, ...(["customers", "freelancers", "internal"] as const).map((item) => ({ id: item, label: audienceLook[item].label, name: `Sichtbar für ${audienceLook[item].label}`, count: audiencePool.filter((row) => seenBy(row.change, item)).length }))]} />
          </>}
        </SheetToolbar>
        <div className="patch-areas" role="group" aria-label="Bereiche">
          <button type="button" className="patch-chip" aria-pressed={area === "all"} onClick={() => setArea("all")}>Alle Bereiche<span className="numeric">{areaPool.length}</span></button>
          {patchAreaOrder.filter((item) => (areaCounts.get(item) ?? 0) > 0 || item === area).map((item) => (
            <button key={item} type="button" className="patch-chip" aria-pressed={area === item} style={{ "--c": areaLook[item].fill } as CSSProperties} onClick={() => setArea(area === item ? "all" : item)}>
              <i aria-hidden="true" />{patchAreaLabels[item]}<span className="numeric">{areaCounts.get(item) ?? 0}</span>
            </button>
          ))}
        </div>
        {shown.length ? (
          <div className="sheet-scroll">
            <table className="data-table patch-table">
              <caption className="visually-hidden">Änderungen am Hub mit Art, {grouping === "package" ? "Bereich" : admin ? "Paket" : "Datum"} und Stelle, Änderung{admin ? " und wer sie sieht" : ""}</caption>
              <thead>
                <tr>
                  <th scope="col" className="cell-kind">Art</th>
                  <th scope="col" className="cell-where">{grouping === "package" ? "Bereich & Stelle" : admin ? "Paket & Stelle" : "Datum & Stelle"}</th>
                  <th scope="col">Änderung</th>
                  {admin && <th scope="col" className="cell-aud">Sichtbar für</th>}
                </tr>
              </thead>
              {bodies}
            </table>
          </div>
        ) : <SheetEmpty text="Keine Änderungen für diese Suche oder Filter." onReset={filtered ? reset : undefined} />}
        <SheetFooter>{changes(shown.length)} von {rows.length} · {packageCount === 1 ? "1 Paket" : `${packageCount} Pakete`}</SheetFooter>
      </div>
    </>
  );
}
