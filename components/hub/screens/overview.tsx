"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, CircleMinus, CirclePlus } from "lucide-react";
import { categories, categoryLabel } from "@/lib/categories";
import { formatDeadline, hubHref, type HubSection } from "@/lib/hub-data";
import { customerSteps } from "@/lib/hub-projects/map";
import { metricOrder, type MetricId } from "@/lib/hub-metrics";
import { HeaderActions } from "../app-shell";
import { HighlightCard, InsightsCard, MetricCard, MetricCardStatic, ServiceCard, WelcomeCard } from "../cards";
import { CategoryIcon, GlassCard, SectionHeader, SectionLink } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { InsetGroupedList, ListRow, MiniProgress } from "../list";
import { useHubShell } from "../shell-context";
import type { ScreenProps } from "./types";

export function OverviewScreen({ model, preview, populated, favorites, toggleStep, admin, projects, liveProjects }: ScreenProps) {
  const { account, initials } = useHubShell();
  const [editing, setEditing] = useState(false);
  const available = metricOrder.filter((id) => !favorites.isFavorite(id));

  return (
    <>
      <LargeTitleHeader title="Übersicht" date={model.dateLine} actions={<HeaderActions />} />
      <div className="section-first welcome-row"><WelcomeCard account={account} initials={initials} /><ServiceCard account={account} /></div>
      {populated ? <>
        {model.insight && <div className="stack-gap"><InsightsCard insight={model.insight} href={hubHref(preview, "insights")} /></div>}

        <SectionHeader title="Favoriten" id="favorites-title" action={<button type="button" className="section-header-action" onClick={() => setEditing((value) => !value)} aria-pressed={editing}>{editing ? "Fertig" : "Bearbeiten"}</button>} />
        {favorites.favorites.length ? (
          <div className="metric-grid" aria-labelledby="favorites-title">
            {favorites.favorites.map((id, index) => editing ? (
              <MetricCardStatic key={id} metric={model.metrics[id]}>
                <div className="favorite-controls">
                  <button type="button" className="favorite-remove" onClick={() => favorites.remove(id)} aria-label={`${model.metrics[id].name} aus Favoriten entfernen`}><CircleMinus size={22} aria-hidden="true" /></button>
                  <button type="button" className="favorite-move" onClick={() => favorites.move(id, -1)} disabled={index === 0} aria-label={`${model.metrics[id].name} nach vorne`}><ArrowUp size={18} aria-hidden="true" /></button>
                  <button type="button" className="favorite-move" onClick={() => favorites.move(id, 1)} disabled={index === favorites.favorites.length - 1} aria-label={`${model.metrics[id].name} nach hinten`}><ArrowDown size={18} aria-hidden="true" /></button>
                </div>
              </MetricCardStatic>
            ) : <MetricCard key={id} metric={model.metrics[id]} />)}
          </div>
        ) : (
          <GlassCard className="empty-card"><p className="t-headline">Noch keine Favoriten.</p><p className="t-subheadline t-secondary">Füge Kennzahlen hinzu, die du immer im Blick haben möchtest.</p>{!editing && <button type="button" className="text-link" onClick={() => setEditing(true)}>Favoriten hinzufügen</button>}</GlassCard>
        )}
        {editing && available.length > 0 && (
          <InsetGroupedList label="Weitere Kennzahlen" className="favorites-add">
            {available.map((id: MetricId) => <ListRow key={id} compact onClick={() => favorites.toggle(id)} icon={<CirclePlus size={22} color="var(--switch-on)" aria-hidden="true" />} title={model.metrics[id].name} subtitle={categoryLabel(model.metrics[id].category, admin)} chevron={false} />)}
          </InsetGroupedList>
        )}

        {model.highlights.length > 0 && <>
          <SectionHeader title="Highlights" action={<SectionLink href={hubHref(preview, "insights")}>Alle anzeigen</SectionLink>} />
          <div className="highlight-grid">{model.highlights.slice(0, 2).map((highlight) => <HighlightCard key={highlight.id} highlight={highlight} href={model.metrics[highlight.metric].href} label={categoryLabel(highlight.category, admin)} />)}</div>
        </>}

        {model.steps.length > 0 && <>
          <SectionHeader title="Du bist am Zug" />
          <ul className="glass inset-list" aria-label="Deine nächsten Schritte">
            {model.steps.map((step) => (
              <li key={step.id} className={`list-item step-item${step.done ? " is-done" : ""}`}>
                <button type="button" className="step-check" onClick={() => toggleStep(step.id)} aria-pressed={step.done} aria-label={`${step.title} ${step.done ? "wieder öffnen" : "in der Vorschau abhaken"}`}>{step.done && <Check size={15} strokeWidth={3} aria-hidden="true" />}</button>
                <Link href={step.href} className="step-link"><span className="list-row-title">{step.title}</span><span className="list-row-subtitle">{step.category} · {step.date}</span></Link>
              </li>
            ))}
          </ul>
        </>}

        {model.projectRows.length > 0 && <>
          <SectionHeader title="Aktuelle Projekte" action={<SectionLink href={hubHref(preview, "projects")}>Alle anzeigen</SectionLink>} />
          <InsetGroupedList label="Aktuelle Projekte">
            {model.projectRows.map((row) => <ListRow key={row.id} href={row.href} title={row.title} subtitle={row.subtitle} trailing={<><MiniProgress value={row.progress} color={categories.projects.fill} /><span className="list-percent numeric">{row.progress} %</span></>} />)}
          </InsetGroupedList>
        </>}

        {model.activity.length > 0 && <>
          <SectionHeader title="Zuletzt passiert" />
          <InsetGroupedList label="Zuletzt passiert">
            {model.activity.map((item) => <ListRow key={item.id} href={item.href} compact icon={<CategoryIcon category={item.category} size={22} />} title={item.title} subtitle={item.detail} />)}
          </InsetGroupedList>
        </>}
      </> : liveProjects?.error ? <LoadNotice text={liveProjects.error} />
      : projects.length ? <LiveOverview preview={preview} admin={admin} model={model} projects={projects} />
      : <EmptyState section="overview" />}
    </>
  );
}

/** Real logins with Studio projects: what waits for the customer and how the running projects stand. */
function LiveOverview({ preview, admin, model, projects }: Pick<ScreenProps, "preview" | "admin" | "model" | "projects">) {
  const steps = customerSteps(projects);
  const projectHref = (id: string) => `${hubHref(preview, "projects")}?project=${id}`;
  return <>
    <SectionHeader title={admin ? "Wartet auf Kunden" : "Du bist am Zug"} />
    {steps.length ? (
      <InsetGroupedList label={admin ? "Aufgaben, die bei Kunden liegen" : "Deine nächsten Schritte"}>
        {steps.slice(0, 6).map(({ task, project }) => <ListRow key={task.id} href={projectHref(project.id)} title={task.title} subtitle={[admin ? project.company : "", project.name, task.dueOn ? `bis ${formatDeadline(task.dueOn)}` : ""].filter(Boolean).join(" · ")} />)}
      </InsetGroupedList>
    ) : <GlassCard className="empty-card"><p className="t-subheadline t-secondary">{admin ? "Gerade liegt keine freigegebene Aufgabe bei einem Kunden." : "Gerade wartet nichts auf dich."}</p></GlassCard>}
    {model.projectRows.length > 0 && <>
      <SectionHeader title="Aktuelle Projekte" action={<SectionLink href={hubHref(preview, "projects")}>Alle anzeigen</SectionLink>} />
      <InsetGroupedList label="Aktuelle Projekte">
        {model.projectRows.map((row) => <ListRow key={row.id} href={row.href} title={row.title} subtitle={row.subtitle} trailing={<><MiniProgress value={row.progress} color={categories.projects.fill} /><span className="list-percent numeric">{row.progress} %</span></>} />)}
      </InsetGroupedList>
    </>}
  </>;
}

/** A load error of real data, in place of the content it replaces. */
export function LoadNotice({ text }: { text: string }) {
  return <GlassCard className="empty-card section-first" role="status"><p className="t-headline">Gerade nicht verfügbar</p><p className="t-subheadline t-secondary">{text}</p></GlassCard>;
}

export function InsightsScreen({ model, preview, populated, admin }: ScreenProps) {
  return (
    <>
      <LargeTitleHeader title="Insights" date={model.dateLine} actions={<HeaderActions />} />
      {populated && model.insight ? <>
        <div className="section-first"><InsightsCard insight={model.insight} /></div>
        <SectionHeader title="Highlights" />
        <div className="highlight-grid">{model.highlights.map((highlight) => <HighlightCard key={highlight.id} highlight={highlight} href={model.metrics[highlight.metric].href} label={categoryLabel(highlight.category, admin)} />)}</div>
      </> : <EmptyState section="insights" preview={preview} />}
    </>
  );
}

const emptyCopy: Partial<Record<HubSection, [string, string]>> = {
  overview: ["Dein nächstes Kapitel beginnt hier.", "Sobald dein Projektteam deinen Workspace eingerichtet hat, findest du hier Projekte, nächste Schritte und Neuigkeiten."],
  insights: ["Insights entstehen mit deinen Projekten.", "Sobald Projekte, Dateien und Nachrichten in deinem Workspace liegen, fassen wir hier zusammen, was passiert ist."],
  projects: ["Raum für große Ideen.", "Hier erscheinen deine Projekte, sobald sie deinem Workspace zugeordnet sind."],
  files: ["Alles am richtigen Ort.", "Briefings, Entwürfe und finale Ergebnisse finden hier bald ihren Platz."],
  messages: ["Lass uns im Gespräch bleiben.", "Hier laufen künftig die Rückfragen und Updates zu deinen Projekten zusammen."],
};

export function EmptyState({ section, preview = false }: { section: HubSection; preview?: boolean }) {
  const [title, text] = emptyCopy[section] || emptyCopy.overview!;
  return (
    <GlassCard className="empty-state section-first">
      <h2 className="t-title3">{title}</h2>
      <p className="t-body t-secondary">{text}</p>
      {!preview && <Link className="text-link" href="/preview">Designvorschau entdecken</Link>}
    </GlassCard>
  );
}
