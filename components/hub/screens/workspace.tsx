"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileText, LogOut, MessageSquare, Palette, ShieldCheck, UserRound } from "lucide-react";
import { categories, categoryOrder, type CategoryId } from "@/lib/categories";
import { appearanceHref, demoConversation, hubHref, previewAccount } from "@/lib/hub-data";
import { metricMeta, metricOrder } from "@/lib/hub-metrics";
import { HeaderActions } from "../app-shell";
import { MetricCard } from "../cards";
import { SearchField, SegmentedControl } from "../controls";
import { CategoryIcon, GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { InsetGroupedList, ListRow, MiniProgress } from "../list";
import { ProjectStatus } from "../project-status";
import { useHubShell } from "../shell-context";
import { EmptyState } from "./overview";
import type { ScreenProps } from "./types";

function CategoryTitle({ category }: { category: CategoryId }) {
  return <span className="title-icon"><CategoryIcon category={category} size={24} /></span>;
}

function CategoryMetrics({ model, category }: Pick<ScreenProps, "model"> & { category: CategoryId }) {
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
        <ListRow compact onClick={() => openPanel("help")} icon={<MessageSquare size={24} color="var(--system-gray)" aria-hidden="true" />} title="Hilfe & Kontakt" />
      </InsetGroupedList>
    </>
  );
}

const filters = ["Alle Projekte", "Aktiv", "Abgeschlossen"] as const;

export function ProjectsScreen({ model, preview, populated, projects, admin }: ScreenProps) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("Alle Projekte");
  const [companyFilter, setCompanyFilter] = useState("Alle Kunden");
  const matches = (item: (typeof filters)[number], status: string) => item === "Alle Projekte" || (item === "Aktiv" ? status !== "Abgeschlossen" : status === "Abgeschlossen");
  const shown = projects.filter((project) => matches(filter, project.status) && (companyFilter === "Alle Kunden" || project.company === companyFilter));
  return (
    <>
      <LargeTitleHeader title="Projekte" icon={<CategoryTitle category="projects" />} actions={<HeaderActions />} />
      {populated ? <>
        <CategoryMetrics model={model} category="projects" />
        <SectionHeader title="Alle Projekte" />
        <div className="list-toolbar">
          <SegmentedControl label="Projekte filtern" value={filter} onChange={setFilter} options={filters.map((item) => ({ id: item, label: `${item === "Alle Projekte" ? "Alle" : item} ${projects.filter((project) => matches(item, project.status)).length}`, name: `${item}: ${projects.filter((project) => matches(item, project.status)).length}` }))} />
          {admin && <label className="glass customer-filter"><span>Kunde</span><select aria-label="Kunden filtern" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}><option>Alle Kunden</option>{Array.from(new Set(projects.map((project) => project.company))).map((company) => <option key={company}>{company}</option>)}</select></label>}
        </div>
        {shown.length ? (
          <ul className="glass inset-list" aria-label="Projekte">
            {shown.map((project) => (
              <li key={project.id} className="list-item">
                <Link href={`${hubHref(preview, "projects")}?project=${project.id}`} className="project-card">
                  <span className="list-row-text">
                    <span className="project-card-meta"><span>{project.company ? `${project.company} / ${project.category}` : project.category}</span><ProjectStatus value={project.status} /></span>
                    <span className="list-row-title">{project.name}</span>
                    <span className="list-row-subtitle">Ziel: {project.date}</span>
                  </span>
                  <span className="list-row-trailing"><MiniProgress value={project.progress} color={categories.projects.fill} /><span className="list-percent numeric">{project.progress} %</span></span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <GlassCard><p className="t-subheadline t-secondary">Keine Projekte für diesen Filter.</p></GlassCard>}
      </> : <EmptyState section="projects" />}
    </>
  );
}

export function FilesScreen({ model, populated, files, openFile }: ScreenProps) {
  return (
    <>
      <LargeTitleHeader title="Dateien" icon={<CategoryTitle category="files" />} actions={<HeaderActions />} />
      {populated ? <>
        <CategoryMetrics model={model} category="files" />
        <SectionHeader title="Alle Dateien" />
        <ul className="glass inset-list" aria-label="Dateien">
          {files.map((item) => (
            <li key={item.name} className="list-item has-icon">
              <button type="button" className="file-row" onClick={() => openFile(item)}>
                <span className="file-icon" aria-hidden="true" style={{ color: categories.files.fill }}><FileText size={24} strokeWidth={1.9} /><small>{item.type}</small></span>
                <span className="list-row-text"><span className="list-row-title">{item.name}</span><span className="list-row-subtitle">{item.project} · {item.size}</span></span>
                <span className="list-row-trailing file-date">{item.date}</span>
              </button>
            </li>
          ))}
        </ul>
      </> : <EmptyState section="files" />}
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
      </div>
      <SectionHeader title="Einstellungen" />
      <InsetGroupedList label="Einstellungen" className="list-icons">
        <ListRow compact href={appearanceHref(preview)} icon={<Palette size={24} color="var(--system-gray)" aria-hidden="true" />} title="Darstellung" subtitle="Hintergrund, Glas und Transparenz" />
        <ListRow compact onClick={() => openPanel("help")} icon={<MessageSquare size={24} color="var(--system-gray)" aria-hidden="true" />} title="Hilfe & Kontakt" />
        <ListRow compact onClick={signOut} icon={<LogOut size={24} color="var(--system-gray)" aria-hidden="true" />} title={preview ? "Vorschau verlassen" : signingOut ? "Wird abgemeldet …" : "Abmelden"} chevron={false} />
      </InsetGroupedList>
    </>
  );
}
