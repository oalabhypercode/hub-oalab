"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, CalendarDays, FileText, Layers, LogOut, MessageSquare, Palette, ShieldCheck, UserRound } from "lucide-react";
import { categories, categoryOrder, type CategoryId } from "@/lib/categories";
import { appearanceHref, currentMilestone, deadlineHint, demoConversation, formatDeadline, hubHref, previewAccount, type Project } from "@/lib/hub-data";
import { metricMeta, metricOrder } from "@/lib/hub-metrics";
import { matchesSearch, sortRows, type SortState, type SortValue } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { MetricCard } from "../cards";
import { SearchField, SegmentedControl } from "../controls";
import { CategoryIcon, GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { InsetGroupedList, ListRow, MiniProgress } from "../list";
import { ProjectStatus } from "../project-status";
import { useHubShell } from "../shell-context";
import { alphabetical, FilterSelect, SortControl, SortHeader, TableSearch, type SortOption } from "../table-tools";
import { WhatsAppCard } from "../whatsapp-card";
import { EmptyState } from "./overview";
import type { ScreenProps } from "./types";

export function CategoryTitle({ category }: { category: CategoryId }) {
  return <span className="title-icon"><CategoryIcon category={category} size={24} /></span>;
}

export function CategoryMetrics({ model, category }: Pick<ScreenProps, "model"> & { category: CategoryId }) {
  const metrics = metricOrder.filter((id) => metricMeta[id].category === category);
  return <div className="metric-grid section-first">{metrics.map((id) => <MetricCard key={id} metric={model.metrics[id]} />)}</div>;
}

export function DiscoverScreen({ model, preview, populated }: ScreenProps) {
  const { openPanel } = useHubShell();
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shownCategories = categoryOrder.filter((id) => categories[id].name.toLowerCase().includes(term) || (term && metricOrder.some((metric) => metricMeta[metric].category === id && metricMeta[metric].name.toLowerCase().includes(term))));
  const shownMetrics = term && populated ? metricOrder.filter((id) => metricMeta[id].name.toLowerCase().includes(term)) : [];
  return (
    <>
      <LargeTitleHeader title="Entdecken" />
      <div className="section-first"><SearchField glass value={query} onChange={setQuery} placeholder="Kategorien und Kennzahlen" label="Kategorien und Kennzahlen durchsuchen" /></div>
      {shownMetrics.length > 0 && <>
        <SectionHeader title="Kennzahlen" />
        <InsetGroupedList label="Kennzahlen" className="list-icons">
          {shownMetrics.map((id) => <ListRow key={id} compact href={model.metrics[id].href} icon={<CategoryIcon category={metricMeta[id].category} size={24} />} title={metricMeta[id].name} trailing={<span className="numeric list-value">{model.metrics[id].value} {model.metrics[id].unit}</span>} />)}
        </InsetGroupedList>
      </>}
      <SectionHeader title="Kategorien" />
      {shownCategories.length ? (
        <InsetGroupedList label="Kategorien" className="list-icons">
          {shownCategories.map((id) => <ListRow key={id} compact href={hubHref(preview, categories[id].section)} icon={<CategoryIcon category={id} size={24} />} title={categories[id].name} />)}
        </InsetGroupedList>
      ) : <GlassCard><p className="t-subheadline t-secondary">Keine Treffer für „{query}“.</p></GlassCard>}
      <SectionHeader title="Konto" />
      <InsetGroupedList label="Konto" className="list-icons">
        <ListRow compact href={appearanceHref(preview)} icon={<Palette size={24} color="var(--system-gray)" aria-hidden="true" />} title="Darstellung" />
        <ListRow compact href={hubHref(preview, "settings")} icon={<UserRound size={24} color="var(--system-gray)" aria-hidden="true" />} title="Profil & Zugang" />
        <ListRow compact onClick={() => openPanel("help")} icon={<MessageSquare size={24} color="var(--system-gray)" aria-hidden="true" />} title="Assistent & Hilfe" />
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
  deadline: (project) => project.dueOn,
  start: (project) => project.startedOn,
  title: (project) => project.name,
  area: (project) => project.category,
  status: (project) => statusRank[project.status],
  progress: (project) => project.progress,
  customer: (project) => project.company ?? "",
};

export function ProjectsScreen({ preview, populated, projects, admin, asOf }: ScreenProps) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("Alle Projekte");
  const [companyFilter, setCompanyFilter] = useState(ALL);
  const [areaFilter, setAreaFilter] = useState(ALL);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<ProjectSortKey>>({ key: "deadline", dir: "asc" });
  const matches = (item: (typeof filters)[number], status: string) => item === "Alle Projekte" || (item === "Aktiv" ? status !== "Abgeschlossen" : status === "Abgeschlossen");
  const areas = Array.from(new Set(projects.map((project) => project.category))).sort();
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
  const sortOptions = Object.values(projectSorts).filter((option) => admin || option.id !== "customer");
  const activeFilters = [filter !== "Alle Projekte", areaFilter !== ALL, companyFilter !== ALL].filter(Boolean).length;
  const narrowed = query.trim() !== "" || activeFilters > 0;
  const reset = () => { setQuery(""); setAreaFilter(ALL); setCompanyFilter(ALL); setFilter("Alle Projekte"); };
  return (
    <>
      <LargeTitleHeader title="Projekte" icon={<CategoryTitle category="projects" />} actions={<HeaderActions />} />
      {populated ? <>
        <SectionHeader title="Alle Projekte" />
        <TableSearch value={query} onChange={setQuery} placeholder="Titel, Bereich, Meilenstein, Status …" label="Projekte durchsuchen" activeFilters={activeFilters}>
          <SegmentedControl label="Projekte filtern" value={filter} onChange={setFilter} options={filters.map((item) => {
            const count = found.filter((project) => matches(item, project.status)).length;
            return { id: item, label: item === "Alle Projekte" ? "Alle" : item, count, name: `${item}: ${count}` };
          })} />
          <FilterSelect icon={Layers} name="Nach Bereich filtern" value={areaFilter} onChange={setAreaFilter} options={[{ value: ALL, label: "Alle Bereiche" }, ...areas.map((area) => ({ value: area, label: area }))]} />
          {admin && <FilterSelect icon={Building2} name="Kunden filtern" value={companyFilter} onChange={setCompanyFilter} options={[{ value: ALL, label: "Alle Kunden" }, ...companies.map((company) => ({ value: company, label: company }))]} />}
          <SortControl options={sortOptions} sort={sort} onChange={setSort} />
        </TableSearch>
        {shown.length ? (
          <div className="table-blobs">
            <table className="project-table">
              <caption className="visually-hidden">Projekte mit Bereich, aktuellem Meilenstein, Status, Startzeitpunkt, nächstem Termin und Fortschritt</caption>
              <thead>
                <tr>
                  <SortHeader option={projectSorts.area} sort={sort} onChange={setSort} />
                  <SortHeader option={projectSorts.title} sort={sort} onChange={setSort} />
                  {/* Soft hyphens let the long headers break on narrower screens. */}
                  <th scope="col">Meilenstein&shy;beschreibung</th>
                  <SortHeader option={projectSorts.status} label="Aktueller Status" sort={sort} onChange={setSort} />
                  <SortHeader option={projectSorts.start} label={"Start­zeitpunkt"} sort={sort} onChange={setSort} />
                  <SortHeader option={projectSorts.deadline} sort={sort} onChange={setSort} />
                  <SortHeader option={projectSorts.progress} sort={sort} onChange={setSort} />
                </tr>
              </thead>
              <tbody>
                {shown.map((project) => {
                  const milestone = currentMilestone(project, asOf);
                  const done = project.status === "Abgeschlossen";
                  const hint = deadlineHint(project.dueOn, done, asOf);
                  return (
                    <tr key={project.id} className={`project-row${done ? " is-done" : ""}`}>
                      <td className="cell-area">{project.category}</td>
                      <td className="cell-project">
                        <Link href={`${hubHref(preview, "projects")}?project=${project.id}`} className="project-card">{project.name}</Link>
                        {admin && project.company && <small>{project.company}</small>}
                      </td>
                      <td className="cell-milestone">
                        {milestone ? <><strong>{milestone.title}</strong><span>{milestone.description}</span></> : <span>Noch kein Meilenstein</span>}
                      </td>
                      <td className="cell-status"><ProjectStatus value={project.status} /></td>
                      <td className="cell-start"><span className="cell-start-label">Start </span><span className="numeric">{formatDeadline(project.startedOn)}</span></td>
                      <td className="cell-deadline">
                        <Link className="deadline-link" href={`${hubHref(preview, "calendar")}?day=${project.dueOn}`} title="Im Kalender anzeigen" aria-label={`Nächster Termin ${formatDeadline(project.dueOn)} im Kalender anzeigen`}>
                          <CalendarDays size={15} aria-hidden="true" /><span className="numeric">{formatDeadline(project.dueOn)}</span>
                        </Link>
                        <small className={hint.endsWith("überfällig") ? "is-overdue" : undefined}>{hint}</small>
                      </td>
                      <td className="cell-progress">
                        <span className="progress-line"><MiniProgress value={project.progress} color={categories.projects.fill} /><span className="list-percent numeric">{project.progress} %</span></span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <GlassCard className="table-empty">
            <p className="t-subheadline t-secondary">{query.trim() ? `Keine Projekte zu „${query.trim()}“.` : "Keine Projekte für diesen Filter."}</p>
            {narrowed && <button type="button" className="table-reset" onClick={reset}>Suche und Filter zurücksetzen</button>}
          </GlassCard>
        )}
      </> : <EmptyState section="projects" />}
    </>
  );
}

export function MessagesScreen({ model, preview, populated, firstName, admin, company }: ScreenProps) {
  return (
    <>
      <LargeTitleHeader title="Nachrichten" icon={<CategoryTitle category="messages" />} actions={<HeaderActions />} />
      {populated ? <>
        <CategoryMetrics model={model} category="messages" />
        <SectionHeader title="Gespräche" />
        <GlassCard feature className="message-card">
          <div className="thread-heading"><span className="avatar" aria-hidden="true">{demoConversation.initials}</span><div><strong>{demoConversation.person}</strong><span>Dein Designteam · {demoConversation.title}</span></div></div>
          <p className="thread-date">14. Oktober 2026 · Beispielunterhaltung</p>
          <div className="message-bubble">
            <p>Hallo {firstName || "Jana"}! Die erste Designrichtung für {admin ? "einen unserer Testkunden" : company || "Nordlicht"} ist fertig. Wir haben die Klarheit eurer Marke mit einem frischen, eigenständigen Look verbunden.</p>
            <p>Schau dir die Brand Direction in Ruhe an. Wir freuen uns auf deine Gedanken!</p>
            <Link className="message-attachment" href={hubHref(preview, "files")}><FileText size={22} color={categories.files.fill} aria-hidden="true" /><span>Brand Direction – V01.pdf<small>PDF · 4,2 MB</small></span><ArrowUpRight size={17} aria-hidden="true" /></Link>
          </div>
          <p className="message-preview-note"><MessageSquare size={17} aria-hidden="true" /><span>{preview ? "Dies ist eine Designvorschau. Echte Gespräche folgen mit der Projektanbindung." : "Demo-Unterhaltung für Frontend-Tests. Live-Nachrichten folgen mit der Datenbankanbindung."}</span></p>
        </GlassCard>
      </> : <EmptyState section="messages" />}
    </>
  );
}

export function ProfileScreen({ preview, email, publicDemo }: ScreenProps & { email: string; publicDemo: boolean }) {
  const { openPanel, signOut, signingOut } = useHubShell();
  return (
    <>
      <LargeTitleHeader title="Profil" actions={<HeaderActions />} />
      <div className="settings-grid section-first">
        <GlassCard className="settings-card">
          <h2 className="t-headline">Dein Konto</h2>
          <label className="settings-label" htmlFor="account-email">E-Mail-Adresse</label>
          <input id="account-email" className="account-input" readOnly value={preview ? previewAccount.email : email} />
          <p className="t-footnote t-secondary">{preview ? "Fiktives Beispielkonto für die Designvorschau." : publicDemo ? "Fiktive Testidentität. Diese Adresse gehört zu keinem persönlichen Konto." : "Die E-Mail-Adresse deines angemeldeten Kontos."}</p>
          {!publicDemo && <Link className="text-link" href="/auth/forgot-password">Passwort zurücksetzen</Link>}
        </GlassCard>
        <GlassCard className="settings-card">
          <h2 className="t-headline settings-card-title"><ShieldCheck size={20} color="var(--switch-on)" aria-hidden="true" />{preview ? "Du siehst die Vorschau." : publicDemo ? "Du testest die öffentliche Demo." : "Dein Zugang ist geschützt."}</h2>
          <p className="t-subheadline t-secondary">{preview ? "Die Vorschau verwendet ausschließlich Beispieldaten. Melde dich an, um deinen persönlichen Workspace zu öffnen." : publicDemo ? "Alle Besucher können diese Testansicht öffnen. Sie enthält nur Beispieldaten und keine echte Supabase-Sitzung. Bitte keine persönlichen Daten eingeben." : "Dein Workspace ist nur nach Anmeldung erreichbar. Projektzuordnungen und Berechtigungen ergänzen wir im nächsten Schritt."}</p>
          {preview && <Link className="text-link" href="/auth/login">Zum Login</Link>}
        </GlassCard>
        {!preview && !publicDemo && <WhatsAppCard />}
      </div>
      <SectionHeader title="Einstellungen" />
      <InsetGroupedList label="Einstellungen" className="list-icons">
        <ListRow compact href={appearanceHref(preview)} icon={<Palette size={24} color="var(--system-gray)" aria-hidden="true" />} title="Darstellung" subtitle="Hintergrund, Glas und Transparenz" />
        <ListRow compact onClick={() => openPanel("help")} icon={<MessageSquare size={24} color="var(--system-gray)" aria-hidden="true" />} title="Assistent & Hilfe" />
        <ListRow compact onClick={signOut} icon={<LogOut size={24} color="var(--system-gray)" aria-hidden="true" />} title={preview ? "Vorschau verlassen" : signingOut ? "Wird abgemeldet …" : "Abmelden"} chevron={false} />
      </InsetGroupedList>
    </>
  );
}
