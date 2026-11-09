"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Bot, Building2, KeyRound, Layers, ListFilter, LogOut, MessageCircleQuestion, Palette, Rows3, Scale, ScrollText, ShieldCheck, Sparkles, UserCog, UserRound } from "lucide-react";
import { categories, categoriesFor, categoryLabel, type CategoryId } from "@/lib/categories";
import { appearanceHref, currentMilestone, deadlineHint, formatDeadline, hubHref, previewAccount, sectionLabels, type Project } from "@/lib/hub-data";
import { packageCatalog } from "@/lib/service-packages";
import { LegalLinks } from "@/components/legal-links";
import { LEGAL_PATHS } from "@/lib/legal-links";
import { metricMeta, metricOrder } from "@/lib/hub-metrics";
import { matchesSearch, sortRows, type SortState, type SortValue } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { MetricCard } from "../cards";
import { SearchField, SegmentedControl } from "../controls";
import { CategoryIcon, GlassCard, SectionHeader, TitleIcon } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { InsetGroupedList, ListRow, MiniProgress } from "../list";
import { sectionIcons } from "../navigation";
import { useHubShell } from "../shell-context";
import { MenuChoices, SheetEmpty, SheetFooter, SheetToolbar, StatusGlyph, TableGroup, ToolbarMenu, useCollapsedGroups, type GlyphKind } from "../sheet";
import { alphabetical, FilterSelect, SortControl, SortHeader, type SortOption } from "../table-tools";
import { WhatsAppCard } from "../whatsapp-card";
import { NotificationSettingsCard } from "../notification-settings-card";
import { SecondFactorCard } from "../second-factor-card";
import { EmptyState, LoadNotice } from "./overview";
import type { ScreenProps } from "./types";

export function CategoryTitle({ category }: { category: CategoryId }) {
  return <span className="title-icon"><CategoryIcon category={category} size={24} /></span>;
}

export function CategoryMetrics({ model, category }: Pick<ScreenProps, "model"> & { category: CategoryId }) {
  const metrics = metricOrder.filter((id) => metricMeta[id].category === category);
  return <div className="metric-grid section-first">{metrics.map((id) => <MetricCard key={id} metric={model.metrics[id]} />)}</div>;
}

export function DiscoverScreen({ model, preview, populated, admin, freelancer }: ScreenProps) {
  const { openPanel, manageUsers } = useHubShell();
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shownCategories = categoriesFor(freelancer).filter((id) => categoryLabel(id, admin || freelancer).toLowerCase().includes(term) || (term && metricOrder.some((metric) => metricMeta[metric].category === id && metricMeta[metric].name.toLowerCase().includes(term))));
  const shownMetrics = term && populated ? metricOrder.filter((id) => metricMeta[id].name.toLowerCase().includes(term)) : [];
  const showInsights = sectionLabels.insights.toLowerCase().includes(term);
  return (
    <>
      <LargeTitleHeader title="Mehr" icon={<TitleIcon icon={sectionIcons.discover!} />} actions={<HeaderActions />} />
      <div className="section-first"><SearchField glass value={query} onChange={setQuery} placeholder="Bereiche und Kennzahlen" label="Bereiche und Kennzahlen durchsuchen" /></div>
      {shownMetrics.length > 0 && <>
        <SectionHeader title="Kennzahlen" />
        <InsetGroupedList label="Kennzahlen" className="list-icons">
          {shownMetrics.map((id) => <ListRow key={id} compact href={model.metrics[id].href} icon={<CategoryIcon category={metricMeta[id].category} size={24} />} title={metricMeta[id].name} trailing={<span className="numeric list-value">{model.metrics[id].value} {model.metrics[id].unit}</span>} />)}
        </InsetGroupedList>
      </>}
      {/* "Mehr" is the last tab on phones: first what the tab bar has no room for, as at the top of the sidebar. */}
      {showInsights && (
        <InsetGroupedList label="Insights" className="list-icons section-first">
          <ListRow compact href={hubHref(preview, "insights")} icon={<Sparkles size={24} color="var(--insights)" aria-hidden="true" />} title={sectionLabels.insights} subtitle="Zusammenfassung und Highlights" />
        </InsetGroupedList>
      )}
      <SectionHeader title="Bereiche" />
      {shownCategories.length ? (
        <InsetGroupedList label="Bereiche" className="list-icons">
          {shownCategories.map((id) => <ListRow key={id} compact href={hubHref(preview, categories[id].section)} icon={<CategoryIcon category={id} size={24} />} title={categoryLabel(id, admin || freelancer)} />)}
        </InsetGroupedList>
      ) : <GlassCard><p className="t-subheadline t-secondary">Keine Treffer für „{query}“.</p></GlassCard>}
      {/* The tab bar has no room for them, so phones reach the user management and the AI log from here. */}
      {/* Same split as the sidebar: admins find the patch notes under "Verwaltung", customers under "Neuigkeiten". */}
      <SectionHeader title={manageUsers ? "Verwaltung" : "Neuigkeiten"} />
      <InsetGroupedList label={manageUsers ? "Verwaltung" : "Neuigkeiten"} className="list-icons">
        {manageUsers && <ListRow compact href={hubHref(preview, "users")} icon={<UserCog size={24} color="var(--accent-text)" aria-hidden="true" />} title={sectionLabels.users} subtitle="Registrierungen, Zugänge und Kunden" />}
        {manageUsers && <ListRow compact href={hubHref(preview, "ai-log")} icon={<Bot size={24} color="var(--accent-text)" aria-hidden="true" />} title={sectionLabels["ai-log"]} subtitle="Vorschläge des Assistenten und was daraus wurde" />}
        <ListRow compact href={hubHref(preview, "patch-notes")} icon={<ScrollText size={24} color="var(--accent-text)" aria-hidden="true" />} title={sectionLabels["patch-notes"]} subtitle="Alle Änderungen am Hub, Paket für Paket" />
      </InsetGroupedList>
      <SectionHeader title="Konto" />
      <InsetGroupedList label="Konto" className="list-icons">
        <ListRow compact href={hubHref(preview, "settings")} icon={<UserRound size={24} color="var(--system-gray)" aria-hidden="true" />} title="Profil" />
        <ListRow compact href={appearanceHref(preview)} icon={<Palette size={24} color="var(--system-gray)" aria-hidden="true" />} title="Darstellung" />
        <ListRow compact onClick={() => openPanel("help")} icon={<MessageCircleQuestion size={24} color="var(--system-gray)" aria-hidden="true" />} title="Assistent & Hilfe" />
      </InsetGroupedList>
      {/* Phones and tablets reach imprint and privacy policy from here: two taps from every page (§ 5 DDG, Art. 13 DSGVO). */}
      <SectionHeader title="Rechtliches" />
      <InsetGroupedList label="Rechtliches" className="list-icons">
        <ListRow compact href={LEGAL_PATHS.imprint} icon={<Scale size={24} color="var(--system-gray)" aria-hidden="true" />} title="Impressum" />
        <ListRow compact href={LEGAL_PATHS.privacy} icon={<ShieldCheck size={24} color="var(--system-gray)" aria-hidden="true" />} title="Datenschutz" />
      </InsetGroupedList>
    </>
  );
}

const filters = ["Alle Projekte", "Aktiv", "Abgeschlossen"] as const;
const ALL = "all";

type ProjectSortKey = "deadline" | "start" | "title" | "area" | "status" | "progress" | "customer";
const projectSorts: Record<ProjectSortKey, SortOption<ProjectSortKey>> = {
  deadline: { id: "deadline", label: "Nächster Termin", dirLabels: { asc: "früheste zuerst", desc: "späteste zuerst" } },
  start: { id: "start", label: "Startzeitpunkt", dirLabels: { asc: "früheste zuerst", desc: "späteste zuerst" } },
  title: { id: "title", label: "Titel", dirLabels: alphabetical },
  area: { id: "area", label: "Bereich", dirLabels: alphabetical },
  status: { id: "status", label: "Status" },
  progress: { id: "progress", label: "Fortschritt", firstDir: "desc", dirLabels: { asc: "niedrigster zuerst", desc: "höchster zuerst" } },
  customer: { id: "customer", label: "Kunde", dirLabels: alphabetical },
};
// "Dein Feedback" first: that is where the customer has to act.
const statusRank: Record<Project["status"], number> = { "Dein Feedback": 0, "In Umsetzung": 1, Abgeschlossen: 2 };
const projectSortValue: Record<ProjectSortKey, (project: Project) => SortValue> = {
  // Projects without a date sort after every dated one.
  deadline: (project) => project.dueOn ?? "9999-12-31",
  start: (project) => project.startedOn ?? "9999-12-31",
  title: (project) => project.name,
  area: (project) => project.category,
  status: (project) => statusRank[project.status],
  progress: (project) => project.progress,
  customer: (project) => project.company ?? "",
};

const projectGroups: Project["status"][] = ["Dein Feedback", "In Umsetzung", "Abgeschlossen"];
const projectGlyph: Record<Project["status"], GlyphKind> = { "Dein Feedback": "feedback", "In Umsetzung": "progress", Abgeschlossen: "done" };
type ProjectGrouping = "status" | "none";

export function ProjectsScreen({ preview, populated, projects, admin, asOf, liveProjects }: ScreenProps) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("Alle Projekte");
  const [companyFilter, setCompanyFilter] = useState(ALL);
  const [areaFilter, setAreaFilter] = useState(ALL);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<ProjectSortKey>>({ key: "deadline", dir: "asc" });
  const [grouping, setGrouping] = useState<ProjectGrouping>("status");
  const groups = useCollapsedGroups();
  const matches = (item: (typeof filters)[number], status: string) => item === "Alle Projekte" || (item === "Aktiv" ? status !== "Abgeschlossen" : status === "Abgeschlossen");
  const areas = Array.from(new Set(projects.flatMap((project) => project.category ? [project.category] : []))).sort();
  // Studio projects have no area, so the column and its filter only appear for the fixtures.
  const showArea = areas.length > 0;
  const companies = Array.from(new Set(projects.flatMap((project) => project.company ? [project.company] : []))).sort();
  // Search, area and customer narrow the list; the status filter counts within that result.
  const found = projects.filter((project) => {
    const milestone = currentMilestone(project, asOf);
    return (areaFilter === ALL || project.category === areaFilter) && (companyFilter === ALL || project.company === companyFilter)
      && matchesSearch(query, [project.category, project.name, admin ? project.company : null, milestone?.title, milestone?.description, project.status, formatDeadline(project.startedOn), formatDeadline(project.dueOn)]);
  });
  // Completed projects stay at the end whatever the sort, so running and completed work stay apart.
  const shown = sortRows(found.filter((project) => matches(filter, project.status)), projectSortValue[sort.key], sort.dir, {
    group: (project) => Number(project.status === "Abgeschlossen"),
    tieBreak: (project) => project.name,
  });
  const sortOptions = Object.values(projectSorts).filter((option) => (admin || option.id !== "customer") && (showArea || option.id !== "area"));
  const menuFilters = [areaFilter !== ALL, companyFilter !== ALL].filter(Boolean).length;
  const narrowed = query.trim() !== "" || filter !== "Alle Projekte" || menuFilters > 0;
  const reset = () => { setQuery(""); setAreaFilter(ALL); setCompanyFilter(ALL); setFilter("Alle Projekte"); };
  const columns = 6 + (admin ? 1 : 0) + (showArea ? 1 : 0);

  const row = (project: Project) => {
    const milestone = currentMilestone(project, asOf);
    const done = project.status === "Abgeschlossen";
    const hint = deadlineHint(project.dueOn, done, asOf);
    return (
      <tr key={project.id} className={`project-row${done ? " is-done" : ""}`}>
        {admin && <td className="cell-customer">{project.company ?? "–"}</td>}
        <td className="cell-project">
          <span className="cell-title"><StatusGlyph kind={projectGlyph[project.status]} /><Link href={`${hubHref(preview, "projects")}?project=${project.id}`} className="project-card">{project.name}</Link></span>
        </td>
        {showArea && <td className="cell-area col-area">{project.category}</td>}
        {/* One fact per cell: the milestone's title; its description is in the project dialog and in the tooltip. */}
        <td className="cell-milestone" title={milestone?.description || undefined}>{milestone ? milestone.title : <span className="cell-none">Noch kein Meilenstein</span>}</td>
        <td className="cell-status col-status">{project.status}</td>
        <td className="cell-start col-start"><span className="cell-start-label">Start </span><span className="numeric">{formatDeadline(project.startedOn)}</span></td>
        <td className="cell-deadline">
          {project.dueOn ? (
            <Link className="deadline-link" href={`${hubHref(preview, "calendar")}?day=${project.dueOn}`} title="Im Kalender anzeigen" aria-label={`Nächster Termin ${formatDeadline(project.dueOn)} im Kalender anzeigen`}>
              <span className="numeric">{formatDeadline(project.dueOn)}</span>
            </Link>
          ) : <span className="numeric cell-none">–</span>}
          {!done && <small className={hint.endsWith("überfällig") ? "is-overdue" : undefined}>{hint}</small>}
        </td>
        <td className="cell-progress">
          <span className="progress-line"><MiniProgress value={project.progress} color={categories.projects.fill} /><span className="list-percent numeric">{project.progress} %</span></span>
        </td>
      </tr>
    );
  };

  return (
    <>
      <LargeTitleHeader title="Projekte" icon={<CategoryTitle category="projects" />} actions={<HeaderActions />} />
      {liveProjects?.error ? <LoadNotice text={liveProjects.error} />
      : populated || projects.length ? (
        <div className="sheet section-first">
          <SheetToolbar query={query} onQuery={setQuery} placeholder="Projekte durchsuchen" label="Projekte durchsuchen"
            trailing={<SegmentedControl label="Projekte filtern" value={filter} onChange={setFilter} options={filters.map((item) => {
              const count = found.filter((project) => matches(item, project.status)).length;
              return { id: item, label: item === "Alle Projekte" ? "Alle" : item, count, name: `${item}: ${count}` };
            })} />}>
            {(showArea || admin) && (
              <ToolbarMenu icon={ListFilter} label="Filter" badge={menuFilters}>
                {showArea && <FilterSelect icon={Layers} name="Nach Bereich filtern" value={areaFilter} onChange={setAreaFilter} options={[{ value: ALL, label: "Alle Bereiche" }, ...areas.map((area) => ({ value: area, label: area }))]} />}
                {admin && <FilterSelect icon={Building2} name="Kunden filtern" value={companyFilter} onChange={setCompanyFilter} options={[{ value: ALL, label: "Alle Kunden" }, ...companies.map((company) => ({ value: company, label: company }))]} />}
              </ToolbarMenu>
            )}
            <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={projectSorts[sort.key].label}><SortControl options={sortOptions} sort={sort} onChange={setSort} /></ToolbarMenu>
            <ToolbarMenu icon={Rows3} label="Gruppe" value={grouping === "status" ? "Status" : "Keine"}>
              <MenuChoices label="Gruppieren nach" value={grouping} onChange={setGrouping} options={[{ id: "status", label: "Status" }, { id: "none", label: "Keine Gruppen" }]} />
            </ToolbarMenu>
          </SheetToolbar>
          {shown.length ? (
            <div className="sheet-scroll">
              <table className="project-table">
                <caption className="visually-hidden">{admin ? "Projekte mit Kunde, " : "Projekte mit "}{showArea ? "Bereich, " : ""}aktuellem Meilenstein, Status, Startzeitpunkt, nächstem Termin und Fortschritt</caption>
                <thead>
                  <tr>
                    {/* Admins see every customer's projects, so the customer leads the row. */}
                    {admin && <SortHeader option={projectSorts.customer} sort={sort} onChange={setSort} />}
                    <SortHeader option={projectSorts.title} label="Projekt" sort={sort} onChange={setSort} />
                    {showArea && <SortHeader option={projectSorts.area} className="col-area" sort={sort} onChange={setSort} />}
                    <th scope="col" className="col-milestone">Meilenstein</th>
                    <SortHeader option={projectSorts.status} className="col-status" sort={sort} onChange={setSort} />
                    <SortHeader option={projectSorts.start} label="Start" className="col-start" sort={sort} onChange={setSort} />
                    <SortHeader option={projectSorts.deadline} sort={sort} onChange={setSort} />
                    <SortHeader option={projectSorts.progress} className="col-progress" sort={sort} onChange={setSort} />
                  </tr>
                </thead>
                {grouping === "status" ? projectGroups.map((status) => {
                  const rows = shown.filter((project) => project.status === status);
                  return rows.length ? (
                    <TableGroup key={status} colSpan={columns} label={status} count={rows.length} glyph={<StatusGlyph kind={projectGlyph[status]} />} collapsed={groups.isCollapsed(status)} onToggle={() => groups.toggle(status)}>
                      {rows.map(row)}
                    </TableGroup>
                  ) : null;
                }) : <tbody>{shown.map(row)}</tbody>}
              </table>
            </div>
          ) : <SheetEmpty text={query.trim() ? `Keine Projekte zu „${query.trim()}“.` : "Keine Projekte für diesen Filter."} onReset={narrowed ? reset : undefined} />}
          <SheetFooter hint="Ein Klick auf eine Zeile öffnet das Projekt">{shown.length === 1 ? "1 Projekt" : `${shown.length} Projekte`}</SheetFooter>
        </div>
      ) : <EmptyState section="projects" />}
    </>
  );
}

/** What the user management keeps about this login and its customer, read-only for the customer. */
function AccountDetailsCard() {
  const { account } = useHubShell();
  const details = account.customerDetails;
  // The country alone (the default "Deutschland") is no address yet.
  const address = details && (details.street || details.city) ? [details.street, [details.postalCode, details.city].filter(Boolean).join(" "), details.country].filter(Boolean).join(", ") : "";
  const rows = [
    ["Name", account.name],
    ["Position", account.person?.position],
    ["Telefon", account.person?.phone],
    ["Unternehmen", account.company],
    ["Kundennummer", account.customerNumber],
    ["Pakete", account.packages.map((id) => packageCatalog[id].name).join(", ")],
    ["Anschrift", address],
    ["Kontakt", [details?.contactEmail, details?.phone].filter(Boolean).join(" · ")],
    ["Website", details?.website.replace(/^https?:\/\//, "")],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <GlassCard className="settings-card">
      <h2 className="t-headline settings-card-title"><Building2 size={20} color="var(--accent-text)" aria-hidden="true" />Deine Angaben</h2>
      <dl className="account-details">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label === "Kundennummer" ? "numeric" : undefined}>{value}</dd></div>)}</dl>
      <p className="t-footnote t-secondary">Diese Angaben pflegt dein oalab-Team. Wenn sich etwas ändert, gib ihm einfach Bescheid.</p>
    </GlassCard>
  );
}

export function ProfileScreen({ preview, email, publicDemo }: ScreenProps & { email: string; publicDemo: boolean }) {
  const { openPanel, signOut, signingOut, logoutError, account } = useHubShell();
  return (
    <>
      <LargeTitleHeader title="Profil" icon={<TitleIcon icon={sectionIcons.settings!} />} actions={<HeaderActions />} />
      <div className="settings-grid section-first">
        {(account.person || account.company) && !account.admin && <AccountDetailsCard />}
        <GlassCard className="settings-card">
          <h2 className="t-headline settings-card-title"><KeyRound size={20} color="var(--accent-text)" aria-hidden="true" />Dein Konto</h2>
          <label className="settings-label" htmlFor="account-email">E-Mail-Adresse</label>
          <input id="account-email" className="account-input" readOnly value={preview ? previewAccount.email : email} />
          <p className="t-footnote t-secondary">{preview ? "Fiktives Beispielkonto für die Designvorschau." : publicDemo ? "Fiktive Testidentität. Diese Adresse gehört zu keinem persönlichen Konto." : "Die E-Mail-Adresse deines angemeldeten Kontos."}</p>
          {!publicDemo && <Link className="text-link" href="/auth/forgot-password">Passwort zurücksetzen</Link>}
        </GlassCard>
        {!preview && !publicDemo ? <SecondFactorCard /> : <GlassCard className="settings-card">
          <h2 className="t-headline settings-card-title"><ShieldCheck size={20} color="var(--accent-text)" aria-hidden="true" />{preview ? "Du siehst die Vorschau." : publicDemo ? "Du testest die öffentliche Demo." : "Dein Zugang ist geschützt."}</h2>
          <p className="t-subheadline t-secondary">{preview ? "Die Vorschau verwendet ausschließlich Beispieldaten. Melde dich an, um deinen persönlichen Workspace zu öffnen." : publicDemo ? "Alle Besucher können diese Testansicht öffnen. Sie enthält nur Beispieldaten und keine echte Supabase-Sitzung. Bitte keine persönlichen Daten eingeben." : account.admin ? "Dein Workspace ist nur nach Anmeldung erreichbar. Als Admin verwaltest du Konten und Kunden im User Management." : "Dein Workspace ist nur nach Anmeldung erreichbar und zeigt ausschließlich die Daten deines Unternehmens."}</p>
          {preview && <Link className="text-link" href="/auth/login">Zur Anmeldung</Link>}
        </GlassCard>}
        {!preview && !publicDemo && <NotificationSettingsCard admin={account.admin} />}
        {!preview && !publicDemo && <WhatsAppCard />}
      </div>
      <SectionHeader title="Einstellungen" />
      <InsetGroupedList label="Einstellungen" className="list-icons">
        <ListRow compact href={appearanceHref(preview)} icon={<Palette size={24} color="var(--system-gray)" aria-hidden="true" />} title="Darstellung" subtitle="Hell oder dunkel, Hintergrund, Glas und Bewegung" />
        <ListRow compact onClick={() => openPanel("help")} icon={<MessageCircleQuestion size={24} color="var(--system-gray)" aria-hidden="true" />} title="Assistent & Hilfe" />
        <ListRow compact onClick={signOut} icon={<LogOut size={24} color="var(--system-gray)" aria-hidden="true" />} title={preview ? "Vorschau verlassen" : signingOut ? "Wird abgemeldet …" : "Abmelden"} chevron={false} />
      </InsetGroupedList>
      {logoutError && <p role="alert" className="form-error stack-gap">{logoutError}</p>}
      <LegalLinks className="legal-links hub-legal-links" />
    </>
  );
}
