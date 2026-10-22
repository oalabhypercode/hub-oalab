"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileText, LogOut, MessageSquare, Palette, ShieldCheck, UserRound } from "lucide-react";
import { categories, categoryOrder, type CategoryId } from "@/lib/categories";
import { appearanceHref, currentMilestone, demoConversation, hubHref, previewAccount } from "@/lib/hub-data";
import { formatFileDate } from "@/lib/hub-files/catalog";
import { metricMeta, metricOrder } from "@/lib/hub-metrics";
import { HeaderActions } from "../app-shell";
import { MetricCard } from "../cards";
import { SearchField, SegmentedControl } from "../controls";
import { CategoryIcon, GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { InsetGroupedList, ListRow, MiniProgress } from "../list";
import { ProjectStatus } from "../project-status";
import { useHubShell } from "../shell-context";
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

export function ProjectsScreen({ preview, populated, projects, admin, asOf }: ScreenProps) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("Alle Projekte");
  const [companyFilter, setCompanyFilter] = useState("Alle Kunden");
  const matches = (item: (typeof filters)[number], status: string) => item === "Alle Projekte" || (item === "Aktiv" ? status !== "Abgeschlossen" : status === "Abgeschlossen");
  const shown = projects.filter((project) => matches(filter, project.status) && (companyFilter === "Alle Kunden" || project.company === companyFilter));
  return (
    <>
      <LargeTitleHeader title="Projekte" icon={<CategoryTitle category="projects" />} actions={<HeaderActions />} />
      {populated ? <>
        <SectionHeader title="Alle Projekte" />
        <div className="list-toolbar">
          <SegmentedControl label="Projekte filtern" value={filter} onChange={setFilter} options={filters.map((item) => {
            const count = projects.filter((project) => matches(item, project.status)).length;
            return { id: item, label: item === "Alle Projekte" ? "Alle" : item, count, name: `${item}: ${count}` };
          })} />
          {admin && <label className="glass customer-filter"><span>Kunde</span><select aria-label="Kunden filtern" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}><option>Alle Kunden</option>{Array.from(new Set(projects.map((project) => project.company))).map((company) => <option key={company}>{company}</option>)}</select></label>}
        </div>
        {shown.length ? (
          <div className="glass file-table-card">
            <table className="project-table">
              <caption className="visually-hidden">Projekte mit Bereich, aktuellem Meilenstein, Status und Fortschritt</caption>
              <thead>
                <tr>
                  <th scope="col">Bereich</th>
                  <th scope="col">Titel</th>
                  <th scope="col">Meilensteinbeschreibung</th>
                  <th scope="col">Aktueller Status</th>
                  <th scope="col">Fortschritt</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((project) => {
                  const milestone = currentMilestone(project, asOf);
                  return (
                    <tr key={project.id} className="project-row">
                      <td className="cell-area">{project.category}</td>
                      <td className="cell-project">
                        <Link href={`${hubHref(preview, "projects")}?project=${project.id}`} className="project-card">{project.name}</Link>
                        {admin && project.company && <small>{project.company}</small>}
                      </td>
                      <td className="cell-milestone">
                        {milestone ? <><strong>{milestone.title}</strong><span>{milestone.description}</span><small>{formatFileDate(milestone.at)}</small></> : <span>Noch kein Meilenstein</span>}
                      </td>
                      <td className="cell-status"><ProjectStatus value={project.status} /></td>
                      <td className="cell-progress">
                        <span className="progress-line"><MiniProgress value={project.progress} color={categories.projects.fill} /><span className="list-percent numeric">{project.progress} %</span></span>
                        <small>Ziel: {project.date}</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <GlassCard><p className="t-subheadline t-secondary">Keine Projekte für diesen Filter.</p></GlassCard>}
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
