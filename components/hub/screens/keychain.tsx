"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronsDownUp, ChevronsUpDown, Inbox, KeyRound, LayoutGrid, LayoutList, Plus, Search, Settings, Table2, Tag } from "lucide-react";
import type { ListView } from "@/lib/appearance";
import { REVEAL_SECONDS, type VaultOwner } from "@/lib/hub-domains/rules";
import { MAILBOX_CATEGORY, UNLOCK_MINUTES } from "@/lib/hub-keychain/rules";
import type { KeychainCategory, KeychainEntry, KeychainOwner, KeychainState } from "@/lib/hub-keychain/types";
import { useAppearance } from "../appearance-provider";
import { HeaderActions } from "../app-shell";
import { SegmentedControl } from "../controls";
import { GlassCard, TitleIcon } from "../glass";
import { useInfo } from "../info-box";
import { LargeTitleHeader } from "../large-title-header";
import { MenuChoices, SheetFooter, SheetToolbar, TableGroup, ToolbarMenu } from "../sheet";
import { SecretDialog } from "./contracts-access";
import { LockBar, LockControl, SetupDialog, UnlockDialog, lockNow, useKeychainLock } from "./keychain-lock";
import { EntryForm, EntryPanel, OwnerSign, SettingsPanel, type EntryDraft } from "./keychain-panels";
import { AccessRow, CategoryGlyph, SecretCell } from "./keychain-rows";

/**
 * „Schlüsselbund“ (admins): every access of oalab and its customers in one place, sorted into fixed categories. The
 * accounts are always visible; a password only opens with the code from the admin's authenticator app, for ten
 * minutes after the last action. Left the customers (like „Vertrag & Domain“), right „Alle Zugänge“ as categories that
 * fold, the customers inside them and their accesses after a click; one customer shows its accesses by category.
 */

type View = { kind: "all" } | { kind: "owner"; id: string | null };
type Panel = { kind: "entry"; id: string } | { kind: "form"; draft: EntryDraft } | { kind: "settings"; back: EntryDraft | null };
type Dialog = { kind: "unlock"; hint?: string; then?: () => void } | { kind: "setup"; relink: boolean } | { kind: "secret"; owner: VaultOwner; name: string; replace: boolean };
type OwnerSort = { key: "name" | "count" | "number"; dir: "asc" | "desc" };
type EntrySort = { key: "name" | "changed"; dir: "asc" | "desc" };

const OWN = "own";
const ownerKey = (id: string | null) => id ?? OWN;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const pairKey = (category: string, owner: string | null) => `${category}|${ownerKey(owner)}`;
const byText = (a: string, b: string) => a.localeCompare(b, "de");

export function KeychainScreen({ state }: { state: KeychainState }) {
  const api = useKeychainLock(state.lock);
  const { lock, open, left } = api;
  const { appearance, update } = useAppearance();
  const listView: ListView = appearance.listView;
  const [view, setView] = useState<View>({ kind: "all" });
  const [paneOpen, setPaneOpen] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [query, setQuery] = useState("");
  const [seg, setSeg] = useState<"all" | "missing">("all");
  const [cat, setCat] = useState("all");
  const [ownerSort, setOwnerSort] = useState<OwnerSort>({ key: "name", dir: "asc" });
  const [entrySort, setEntrySort] = useState<EntrySort>({ key: "name", dir: "asc" });
  const [closedCats, setClosedCats] = useState<ReadonlySet<string>>(new Set());
  const [openPairs, setOpenPairs] = useState<ReadonlySet<string>>(new Set());
  // While a search or filter runs, everything with a hit stands open; what is folded by hand then is kept here.
  const [foldedWhileFiltering, setFoldedWhileFiltering] = useState<ReadonlySet<string>>(new Set());
  const [panel, setPanel] = useState<Panel | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState("");
  const [busyLock, setBusyLock] = useState(false);
  const lockKey = lock.status === "unlocked" && open ? `open:${lock.hardUntil}` : "shut";

  const categories = state.categories;
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const ownerById = useMemo(() => new Map(state.owners.map((owner) => [ownerKey(owner.id), owner])), [state.owners]);
  const fallbackCategory = (id: string): KeychainCategory => categoryById.get(id) ?? { id, name: id, icon: "key-round", position: 9999, fixed: false, count: 0 };
  const ownerOf = (entry: KeychainEntry) => ownerById.get(ownerKey(entry.ownerId)) ?? state.owners[0];
  const countOf = (id: string | null) => state.entries.filter((entry) => entry.ownerId === id).length;
  const missingAll = state.entries.filter((entry) => !entry.hasPassword).length;

  const filtering = Boolean(query.trim()) || seg !== "all";
  const term = query.trim().toLocaleLowerCase("de");
  const inScope = state.entries.filter((entry) => view.kind === "all" || entry.ownerId === view.id);
  const visible = inScope
    .filter((entry) => cat === "all" || entry.categoryId === cat)
    .filter((entry) => seg === "all" || !entry.hasPassword)
    .filter((entry) => !term || [entry.title, entry.username, entry.loginUrl, entry.person, fallbackCategory(entry.categoryId).name, ownerOf(entry).company, ownerOf(entry).customerNumber].some((value) => value?.toLocaleLowerCase("de").includes(term)));
  const sortedEntries = [...visible].sort((a, b) => {
    const flip = entrySort.dir === "desc" ? -1 : 1;
    return flip * (entrySort.key === "changed" ? a.changedAt.localeCompare(b.changedAt) : byText(a.title, b.title)) || byText(a.title, b.title);
  });

  const catOpen = (id: string) => filtering ? !foldedWhileFiltering.has(`cat:${id}`) : !closedCats.has(id);
  const pairOpen = (key: string) => filtering ? !foldedWhileFiltering.has(`pair:${key}`) : openPairs.has(key);
  const toggleIn = (set: ReadonlySet<string>, key: string, on: boolean) => { const next = new Set(set); if (on) next.add(key); else next.delete(key); return next; };
  const setCatOpen = (id: string, value: boolean) => filtering ? setFoldedWhileFiltering((current) => toggleIn(current, `cat:${id}`, !value)) : setClosedCats((current) => toggleIn(current, id, !value));
  const setPairOpen = (key: string, value: boolean) => filtering ? setFoldedWhileFiltering((current) => toggleIn(current, `pair:${key}`, !value)) : setOpenPairs((current) => toggleIn(current, key, value));

  const info = useInfo("Schlüsselbund", {
    steps: [
      <><b>Zugänge</b> immer sichtbar, <b>Passwörter</b> nur mit App-Code.</>,
      <><b>{UNLOCK_MINUTES} Minuten</b> offen, dann sperrt er sich selbst.</>,
      <><b>Jeder Blick</b> steht im Protokoll.</>,
    ],
    ask: "Wie funktioniert der Schlüsselbund?",
  });

  function choose(next: View) {
    setView(next);
    setPaneOpen(true);
    setCat("all");
    setPanel(null);
  }
  function needUnlock(hint: string, then: () => void) {
    if (lock.status === "setup") { setDialog({ kind: "setup", relink: false }); return; }
    setDialog({ kind: "unlock", hint, then });
  }
  const say = (message: string) => setNotice(message);
  // A new or lost phone: the server swaps the app only while the keychain is open, so the code (or a recovery code) comes first.
  const relink = () => lock.status === "setup" ? setDialog({ kind: "setup", relink: false })
    : open ? setDialog({ kind: "setup", relink: true })
    : setDialog({ kind: "unlock", hint: "Danach verbindest du die App neu.", then: () => setDialog({ kind: "setup", relink: true }) });
  const newDraft = (): EntryDraft => ({ ownerId: view.kind === "owner" ? view.id : null, categoryId: cat !== "all" && cat !== MAILBOX_CATEGORY ? cat : "other", label: "", loginUrl: "", username: "", secret: "", note: "" });
  const startNew = () => open ? setPanel({ kind: "form", draft: newDraft() }) : needUnlock("Danach legst du den neuen Zugang an.", () => setPanel({ kind: "form", draft: newDraft() }));

  const secretFor = (entry: KeychainEntry) => (
    <SecretCell entry={entry} open={open} lockKey={lockKey} onNeedUnlock={needUnlock} onUntil={api.extend} onLock={api.setLock} onNotice={say}
      onSet={() => setDialog({ kind: "secret", owner: { kind: entry.kind, id: entry.id }, name: entry.title, replace: entry.hasPassword })} />
  );
  const rowFor = (entry: KeychainEntry, showKind: boolean) => (
    <AccessRow key={entry.id} entry={entry} category={fallbackCategory(entry.categoryId)} current={panel?.kind === "entry" && panel.id === entry.id} showKind={showKind} secret={secretFor(entry)} onOpen={() => setPanel({ kind: "entry", id: entry.id })} />
  );

  /* ---------- List (left) ---------- */
  const listTerm = listQuery.trim().toLocaleLowerCase("de");
  const customers = state.owners.filter((owner) => owner.id !== null && (!listTerm || `${owner.company} ${owner.customerNumber}`.toLocaleLowerCase("de").includes(listTerm)));
  const current = (target: View) => view.kind === target.kind && (target.kind === "all" || (view.kind === "owner" && view.id === target.id));
  const navItem = (target: View, sign: React.ReactNode, title: string, sub: React.ReactNode, total: number) => (
    <li key={target.kind === "all" ? "all" : ownerKey(target.id)}>
      <button type="button" className="kc-nav-item" aria-current={current(target) ? "true" : undefined} onClick={() => choose(target)}>
        {sign}<span className="kc-nav-text"><strong>{title}</strong><small>{sub}</small></span><span className="kc-count" aria-label={plural(total, "Zugang", "Zugänge")}>{total}</span>
      </button>
    </li>
  );
  const own = state.owners.find((owner) => owner.id === null)!;
  const list = (
    <div className="chat-list">
      <div className="chat-list-head"><h2>Schlüsselbund<span>{state.entries.length}</span></h2></div>
      <label className="chat-search"><Search size={15} aria-hidden="true" /><input type="search" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="Kunde suchen" aria-label="Kunden nach Name oder Kundennummer suchen" /></label>
      <ul className="kc-nav" role="list">
        {!listTerm && <li className="kc-nav-label">Übersicht</li>}
        {!listTerm && navItem({ kind: "all" }, <span className="am-tile cdm-tile-icon" aria-hidden="true"><LayoutGrid size={18} /></span>, "Alle Zugänge", missingAll ? <b>{missingAll} ohne Passwort</b> : "Alle mit Passwort", state.entries.length)}
        {!listTerm && navItem({ kind: "owner", id: null }, <OwnerSign owner={own} />, "oalab intern", "Eigene Konten", countOf(null))}
        <li className="kc-nav-label">Kunden von A bis Z <span>{customers.length}</span></li>
        {customers.map((owner) => navItem({ kind: "owner", id: owner.id }, <OwnerSign owner={owner} />, owner.company, <>{owner.customerNumber}{owner.cancelled && <> · <b>Gekündigt</b></>}</>, countOf(owner.id)))}
        {!customers.length && <li className="kc-nav-empty">{listTerm ? `Kein Kunde passt zu „${listQuery.trim()}“.` : "Es sind noch keine Kunden angelegt."}</li>}
      </ul>
    </div>
  );

  /* ---------- Pane head ---------- */
  const viewOwner = view.kind === "owner" ? ownerById.get(ownerKey(view.id)) ?? own : null;
  const scopeMissing = inScope.filter((entry) => !entry.hasPassword).length;
  const usedCategories = categories.filter((category) => state.entries.some((entry) => entry.categoryId === category.id)).length;
  const head = (
    <header className="am-pane-head">
      <button type="button" className="chat-back" onClick={() => setPaneOpen(false)} aria-label="Zurück zur Liste"><ChevronLeft size={24} aria-hidden="true" /></button>
      {viewOwner ? <OwnerSign owner={viewOwner} size="lg" /> : <span className="am-tile is-lg cdm-tile-icon" aria-hidden="true"><LayoutGrid size={22} /></span>}
      <div className="am-pane-title">
        <strong>{viewOwner ? viewOwner.company : "Alle Zugänge"}</strong>
        <span>{(viewOwner
          ? [viewOwner.customerNumber || "Eigene Konten", plural(inScope.length, "Zugang", "Zugänge"), scopeMissing ? `${scopeMissing} ohne Passwort` : ""]
          : [plural(state.entries.length, "Zugang", "Zugänge"), plural(usedCategories, "Kategorie", "Kategorien"), missingAll ? `${missingAll} ohne Passwort` : ""]).filter(Boolean).join(" · ")}</span>
      </div>
      <button type="button" className="sheet-action kc-head-new" onClick={startNew} aria-label="Zugang anlegen" data-tip="Zugang anlegen"><Plus size={15} aria-hidden="true" /><span className="kc-head-label">Zugang</span></button>
      <button type="button" className="sheet-action kc-head-gear" onClick={() => setPanel({ kind: "settings", back: null })} aria-label="Einstellungen" data-tip="Einstellungen" data-tip-sub="Kategorien und deine App" aria-pressed={panel?.kind === "settings"}><Settings size={16} aria-hidden="true" /></button>
      <LockControl lock={lock} left={left} busy={busyLock} onUnlock={() => setDialog({ kind: "unlock" })} onSetup={() => setDialog({ kind: "setup", relink: false })} onLock={async () => { setBusyLock(true); await lockNow(api); setBusyLock(false); }} />
    </header>
  );

  /* ---------- Toolbar ---------- */
  const presentCategories = categories.filter((category) => inScope.some((entry) => entry.categoryId === category.id));
  const catLabel = cat === "all" ? "Alle" : fallbackCategory(cat).name;
  const sortChoices = view.kind === "all"
    ? [{ id: "name", label: "Kunde" }, { id: "count", label: "Zugänge" }, { id: "number", label: "Kundennummer" }]
    : [{ id: "name", label: "Name" }, { id: "changed", label: "Zuletzt geändert" }];
  const sortValue = view.kind === "all" ? ownerSort.key : entrySort.key;
  const density = (
    <div className="segmented-control am-density kc-density" role="group" aria-label="Ansicht der Liste">
      <button type="button" className="segment" aria-pressed={listView === "minimal"} data-tip="Minimalistische Sicht" data-tip-sub="Niedrige Zeilen, eine Liste" onClick={() => update({ listView: "minimal" })}><LayoutList size={14} aria-hidden="true" /><span className="segment-label">Minimal</span></button>
      <button type="button" className="segment" aria-pressed={listView === "detail"} data-tip="Detailsicht" onClick={() => update({ listView: "detail" })}><Table2 size={14} aria-hidden="true" /><span className="segment-label">Detail</span></button>
    </div>
  );
  const toolbar = (
    <SheetToolbar query={query} onQuery={(value) => { setQuery(value); setFoldedWhileFiltering(new Set()); }} placeholder="Zugang suchen" label="Zugänge nach Name, Login, Website oder Kunde suchen"
      trailing={<>
        <SegmentedControl label="Zugänge zeigen" value={seg} onChange={(value) => { setSeg(value); setFoldedWhileFiltering(new Set()); }} options={[
          { id: "all", label: "Alle", name: "Alle", count: inScope.filter((entry) => cat === "all" || entry.categoryId === cat).length },
          { id: "missing", label: "Ohne Passwort", name: "Ohne Passwort", count: inScope.filter((entry) => (cat === "all" || entry.categoryId === cat) && !entry.hasPassword).length },
        ]} />
        {density}
      </>}>
      <div className={cat === "all" ? undefined : "kc-menu-set"}>
        <ToolbarMenu icon={Tag} label="Kategorie" value={catLabel}>
          <div className="sheet-choices" role="radiogroup" aria-label="Kategorie">
            <button type="button" role="radio" aria-checked={cat === "all"} className="sheet-choice" onClick={() => setCat("all")}>Alle Kategorien<span className="kc-choice-meta numeric">{inScope.length}</span><Check className="hub-option-check" size={15} aria-hidden="true" /></button>
            {presentCategories.map((category) => (
              <button key={category.id} type="button" role="radio" aria-checked={cat === category.id} className="sheet-choice" onClick={() => setCat(category.id)}>
                <span className="kc-choice-lead"><CategoryGlyph category={category} size={14} /></span>{category.name}<span className="kc-choice-meta numeric">{inScope.filter((entry) => entry.categoryId === category.id).length}</span><Check className="hub-option-check" size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="kc-pop-foot"><button type="button" className="am-label-action" onClick={() => setPanel({ kind: "settings", back: null })}><Settings size={13} aria-hidden="true" />Kategorien verwalten</button></div>
        </ToolbarMenu>
      </div>
      <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={sortChoices.find((choice) => choice.id === sortValue)?.label}>
        <MenuChoices label="Sortierung" value={sortValue} options={sortChoices} onChange={(key) => view.kind === "all"
          ? setOwnerSort({ key: key as OwnerSort["key"], dir: key === "count" ? "desc" : "asc" })
          : setEntrySort({ key: key as EntrySort["key"], dir: key === "changed" ? "desc" : "asc" })} />
      </ToolbarMenu>
    </SheetToolbar>
  );

  /* ---------- „Alle Zugänge“: categories, the customers inside, their accesses after a click ---------- */
  const ownerSortHeader = (key: OwnerSort["key"], label: string) => {
    const active = ownerSort.key === key;
    const Icon = active ? (ownerSort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return <button type="button" className={`sort-header${active ? " is-active" : ""}`} onClick={() => setOwnerSort(active ? { key, dir: ownerSort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "count" ? "desc" : "asc" })} data-tip={`Nach ${label} sortieren`}>{label}<Icon size={13} aria-hidden="true" /></button>;
  };
  const ariaSort = (key: OwnerSort["key"]) => ownerSort.key === key ? (ownerSort.dir === "asc" ? "ascending" : "descending") : undefined;
  const sections = categories.map((category) => {
    const items = sortedEntries.filter((entry) => entry.categoryId === category.id);
    const rows = state.owners.map((owner) => ({ owner, items: items.filter((entry) => entry.ownerId === owner.id) })).filter((row) => row.items.length);
    const flip = ownerSort.dir === "desc" ? -1 : 1;
    const first = (a: { owner: KeychainOwner; items: KeychainEntry[] }, b: { owner: KeychainOwner; items: KeychainEntry[] }) => ownerSort.key === "count" ? a.items.length - b.items.length : ownerSort.key === "number" ? byText(a.owner.customerNumber, b.owner.customerNumber) : byText(a.owner.company, b.owner.company);
    // „oalab intern“ stays on top, as in the list on the left.
    const ordered = [...rows.filter((row) => row.owner.id === null), ...rows.filter((row) => row.owner.id !== null).sort((a, b) => flip * first(a, b) || byText(a.owner.company, b.owner.company))];
    return { category, items, rows: ordered };
  }).filter((section) => section.items.length);
  const shownPairs = sections.flatMap((section) => section.rows.map((row) => pairKey(section.category.id, row.owner.id)));
  const allOpen = sections.length > 0 && sections.every((section) => catOpen(section.category.id)) && shownPairs.every(pairOpen);
  const foldAll = () => {
    const next = !allOpen;
    for (const section of sections) setCatOpen(section.category.id, next);
    for (const key of shownPairs) setPairOpen(key, next);
  };
  const totalIn = (categoryId: string, ownerId?: string | null) => state.entries.filter((entry) => entry.categoryId === categoryId && (ownerId === undefined || entry.ownerId === ownerId)).length;
  const countCell = (shown: number, total: number) => <>{filtering && shown !== total ? <><span className="numeric">{shown}</span><span className="kc-of"> von {total}</span></> : <span className="numeric">{total}</span>}<span className="kc-ounit"> {total === 1 && !(filtering && shown !== total) ? "Zugang" : "Zugänge"}</span></>;
  const emptyText = query.trim() ? `Kein Zugang passt zu „${query.trim()}“.` : seg === "missing" ? "Alle Zugänge haben ein Passwort." : cat !== "all" ? `In „${catLabel}“ gibt es noch keine Zugänge.` : "Hier gibt es noch keine Zugänge. Leg den ersten mit „+ Zugang“ an.";

  const categoryTable = (
    <table className="project-table kc-otable kc-ctable">
      <caption className="visually-hidden">Zugänge nach Kategorien; in jeder Kategorie die Kunden mit der Zahl ihrer Zugänge, Kundennummer und Status. Ein Klick auf einen Kunden zeigt seine Zugänge dieser Kategorie.</caption>
      <thead><tr>
        <th scope="col" className="kc-ocol-name" aria-sort={ariaSort("name")}><span className="kc-ohead"><button type="button" className="kc-fold-all" onClick={foldAll} aria-label={allOpen ? "Alle zuklappen" : "Alle aufklappen"} data-tip={allOpen ? "Alle zuklappen" : "Alle aufklappen"}>{allOpen ? <ChevronsDownUp size={15} aria-hidden="true" /> : <ChevronsUpDown size={15} aria-hidden="true" />}</button>{ownerSortHeader("name", "Kunde")}</span></th>
        <th scope="col" className="kc-ocol-count" aria-sort={ariaSort("count")}>{ownerSortHeader("count", "Zugänge")}</th>
        <th scope="col" className="kc-ocol-number" aria-sort={ariaSort("number")}>{ownerSortHeader("number", "Kundennummer")}</th>
        <th scope="col" className="kc-ocol-status"><span className="kc-ohead">Status<span className="kc-ohead-end">{info.button}</span></span></th>
      </tr></thead>
      {!sections.length ? <tbody><tr><td colSpan={4} className="kc-ptable-empty">{emptyText}</td></tr></tbody> : sections.map(({ category, items, rows }) => {
        const opened = catOpen(category.id);
        const total = totalIn(category.id);
        return (
          <tbody key={category.id} className="table-group-body kc-cbody">
            <tr className="table-group kc-cgroup" onClick={(event) => { if (!(event.target instanceof Element && event.target.closest("button, a"))) setCatOpen(category.id, !opened); }}>
              <th scope="rowgroup" className="kc-cgroup-name"><span className="table-group-in">
                <button type="button" className="table-group-toggle" aria-expanded={opened} onClick={() => setCatOpen(category.id, !opened)} aria-label={`${category.name}, ${plural(total, "Zugang", "Zugänge")}`}>
                  <ChevronDown size={14} className="table-group-chevron" aria-hidden="true" /><span className="table-group-glyph"><CategoryGlyph category={category} /></span><span className="table-group-label">{category.name}</span>
                </button>
              </span></th>
              <td className="kc-cgroup-count">{countCell(items.length, total)}</td>
              <td className="kc-cgroup-end" />
              <td className="kc-cgroup-end" />
            </tr>
            {opened && rows.map(({ owner, items: mine }) => {
              const key = pairKey(category.id, owner.id);
              const shown = pairOpen(key);
              return [
                <tr key={key} className={`kc-orow${shown ? " is-open" : ""}`} onClick={(event) => { if (!(event.target instanceof Element && event.target.closest("button, a, input"))) setPairOpen(key, !shown); }}>
                  <td className="kc-ocell-name"><button type="button" className="kc-otoggle" aria-expanded={shown} onClick={() => setPairOpen(key, !shown)} aria-label={`${owner.company}: ${category.name} ${shown ? "zuklappen" : "aufklappen"}`}>
                    <ChevronDown size={15} className="kc-ochev" aria-hidden="true" /><span className="kc-osign"><OwnerSign owner={owner} size="sm" /></span><span className="kc-oname">{owner.company}</span>
                  </button></td>
                  <td className="kc-ocell-count">{countCell(mine.length, totalIn(category.id, owner.id))}</td>
                  <td className="kc-ocell-number">{owner.customerNumber ? <span className="kc-onumber">{owner.customerNumber}</span> : <span className="cell-none" aria-label="keine">–</span>}</td>
                  <td className="kc-ocell-status">{owner.cancelled ? <span className="kc-opill">Gekündigt</span> : <span className="cell-none" aria-hidden="true" />}</td>
                </tr>,
                shown && (
                  <tr key={`${key}:detail`} className="kc-odetail"><td colSpan={4}>
                    <table className="project-table kc-ptable kc-nested kc-no-kind">
                      <thead><tr>
                        <th scope="col">Zugang</th><th scope="col" className="kc-col-kind">Kategorie</th><th scope="col" className="kc-col-user">Benutzername</th>
                        <th scope="col" className="kc-col-secret">Passwort</th><th scope="col" className="kc-col-changed">Geändert</th><th scope="col" className="kc-col-open"><span className="visually-hidden">Details</span></th>
                      </tr></thead>
                      <tbody>{mine.map((entry) => rowFor(entry, true))}</tbody>
                    </table>
                  </td></tr>
                ),
              ];
            })}
          </tbody>
        );
      })}
    </table>
  );

  /* ---------- One customer: the categories as groups, the accesses inside ---------- */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const entrySortHeader = (key: EntrySort["key"], label: string) => {
    const active = entrySort.key === key;
    const Icon = active ? (entrySort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return <button type="button" className={`sort-header${active ? " is-active" : ""}`} onClick={() => setEntrySort(active ? { key, dir: entrySort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "changed" ? "desc" : "asc" })} data-tip={`Nach ${label} sortieren`}>{label}<Icon size={13} aria-hidden="true" /></button>;
  };
  const ownerGroups = categories.map((category) => ({ category, items: sortedEntries.filter((entry) => entry.categoryId === category.id) })).filter((group) => group.items.length);
  const ownerTable = (
    <table className="project-table kc-ptable kc-no-kind">
      <caption className="visually-hidden">Zugänge mit Benutzername, Passwort und letzter Änderung, nach Kategorien gruppiert</caption>
      <thead><tr>
        <th scope="col" aria-sort={entrySort.key === "name" ? (entrySort.dir === "asc" ? "ascending" : "descending") : undefined}>{entrySortHeader("name", "Zugang")}</th>
        <th scope="col" className="kc-col-kind">Kategorie</th>
        <th scope="col" className="kc-col-user">Benutzername</th>
        <th scope="col" className="kc-col-secret">Passwort</th>
        <th scope="col" className="kc-col-changed" aria-sort={entrySort.key === "changed" ? (entrySort.dir === "asc" ? "ascending" : "descending") : undefined}>{entrySortHeader("changed", "Geändert")}</th>
        <th scope="col" className="kc-col-open"><span className="visually-hidden">Details</span></th>
      </tr></thead>
      {!ownerGroups.length ? <tbody><tr><td colSpan={6} className="kc-ptable-empty">{emptyText}</td></tr></tbody> : ownerGroups.map((group, index) => (
        <TableGroup key={group.category.id} colSpan={6} label={group.category.name} count={group.items.length} glyph={<CategoryGlyph category={group.category} />}
          collapsed={collapsed.has(group.category.id)} onToggle={() => setCollapsed((current) => toggleIn(current, group.category.id, !current.has(group.category.id)))} actions={index === 0 ? info.button : undefined}>
          {group.items.map((entry) => rowFor(entry, true))}
        </TableGroup>
      ))}
    </table>
  );

  /* ---------- Panels and dialogs ---------- */
  const entry = panel?.kind === "entry" ? state.entries.find((item) => item.id === panel.id) : undefined;
  const all = inScope.length;
  const missing = inScope.filter((item) => !item.hasPassword).length;

  return (
    <>
      <LargeTitleHeader title="Schlüsselbund" icon={<TitleIcon icon={KeyRound} />} actions={<HeaderActions />} />
      {state.error && <GlassCard className="section-first"><p className="t-headline">Gerade nicht verfügbar</p><p className="t-subheadline t-secondary">{state.error}</p></GlassCard>}
      {notice && <p className="calendar-notice section-first" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      {state.ready && !state.error && (
        <div className={`sheet section-first am cdm kc kc-v4${listView === "minimal" ? " kc-minimal" : ""}`} data-open={paneOpen ? "" : undefined}>
          <div className="am-grid">
            {list}
            <section className="am-pane" aria-label={viewOwner ? viewOwner.company : "Alle Zugänge"}>
              {head}
              {toolbar}
              <LockBar lock={lock} open={open} onRelink={relink} />
              <div className="am-scroll kc-scroll"><div className="kc-ptable-wrap"><div className="sheet-scroll">{view.kind === "all" ? categoryTable : ownerTable}</div></div>{info.box}</div>
              <SheetFooter hint={view.kind === "all" ? "Ein Klick auf einen Kunden zeigt seine Zugänge" : "Ein Klick auf eine Zeile öffnet die Details"}>
                {[plural(all, "Zugang", "Zugänge"), `${all - missing} mit Passwort`, missing ? `${missing} ohne` : ""].filter(Boolean).join(" · ")}
                {state.keyId ? null : " · Auf dem Server fehlt der Schlüssel (HUB_VAULT_KEY)"}
              </SheetFooter>
            </section>
          </div>
        </div>
      )}
      {!state.ready && !state.error && <GlassCard className="section-first file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Der Schlüsselbund ist noch nicht bereit.</p></GlassCard>}

      {entry && (
        <EntryPanel entry={entry} category={fallbackCategory(entry.categoryId)} owner={ownerOf(entry)} open={open} secret={secretFor(entry)}
          onEdit={() => setPanel({ kind: "form", draft: { id: entry.id, ownerId: entry.ownerId, categoryId: entry.categoryId, label: entry.title, loginUrl: entry.loginUrl, username: entry.username, secret: "", note: "" } })}
          onClose={() => setPanel(null)} onNeedUnlock={needUnlock} onUntil={api.extend} onLock={api.setLock} onNotice={say} />
      )}
      {panel?.kind === "form" && (
        <EntryForm key={panel.draft.id ?? "new"} draft={panel.draft} owners={state.owners} categories={categories} onLock={api.setLock}
          onSettings={(draft) => setPanel({ kind: "settings", back: draft })} onClose={() => setPanel(null)}
          onSaved={(id, until, message) => { api.extend(until); say(message); setPanel({ kind: "entry", id }); }} />
      )}
      {panel?.kind === "settings" && (
        <SettingsPanel categories={categories} lock={lock} fromForm={panel.back !== null} onRelink={relink} onClose={() => setPanel(null)} onNotice={say}
          onBack={() => setPanel(panel.back ? { kind: "form", draft: panel.back } : null)} />
      )}
      {dialog?.kind === "unlock" && (
        <UnlockDialog lock={lock} hint={dialog.hint} onClose={() => setDialog(null)} onLock={api.setLock} onUnlocked={(next) => {
          const then = dialog.then;
          api.setLock(next);
          setDialog(null);
          if (then) window.setTimeout(then, 0);
        }} />
      )}
      {dialog?.kind === "setup" && (
        <SetupDialog email={state.email} relink={dialog.relink} onClose={() => setDialog(null)} onDone={(next) => { api.setLock(next); setDialog(null); say(dialog.relink ? "Die neue App ist verbunden. Die alte und ihre Notfall-Codes zählen nicht mehr." : "Der Schlüsselbund ist eingerichtet und entsperrt."); }} />
      )}
      {dialog?.kind === "secret" && (
        <SecretDialog owner={dialog.owner} name={dialog.name} replace={dialog.replace} onClose={() => setDialog(null)} onSaved={say} />
      )}
      <p className="visually-hidden" aria-live="polite">{open ? `Schlüsselbund entsperrt, Passwörter bleiben ${REVEAL_SECONDS} Sekunden lesbar.` : ""}</p>
    </>
  );
}
