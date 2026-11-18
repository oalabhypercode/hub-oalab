"use client";

import { hubHref, type HubSection } from "@/lib/hub-data";
import { formatFileDay } from "@/lib/hub-files/catalog";
import { previewNotices } from "@/lib/hub-insights/fixtures";
import { previewWidgets, withPreviewTasks } from "@/lib/hub-overview/fixtures";
import type { OverviewFacts, OverviewWidgetsData } from "@/lib/hub-overview/types";
import { isServicePackageId } from "@/lib/service-packages";
import { adminNotices } from "../admin-notices";
import { HeaderActions } from "../app-shell";
import { FreelancerCard, WelcomeCard } from "../cards";
import { GlassCard, SectionHeader, SectionLink, TitleIcon } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { InsetGroupedList, ListRow } from "../list";
import { sectionIcons } from "../navigation";
import { NotificationCenter } from "../notification-center";
import { useHubShell } from "../shell-context";
import { WelcomeStage } from "../welcome-stage";
import { WidgetStacks } from "../widget-stacks";
import { FileIcon } from "./files-parts";
import type { ScreenProps } from "./types";

/** The admins' welcome card in the design preview (fictional). */
const previewFacts: OverviewFacts = { customers: 4, withService: 3 };

/**
 * The overview (design „V5“, user 18.11.2026): one long welcome card, below it the bell's notices like a phone's
 * notification centre and beside them two widget stacks. Where projects stand in detail lives on Insights. Freelancers
 * keep their welcome with the card of their customers and the newest files.
 */
export function OverviewScreen({ model, preview, admin, fileState, projects, asOf, userKey, facts, widgets }: ScreenProps & { userKey: string; facts?: OverviewFacts | null; widgets?: OverviewWidgetsData | null }) {
  const { account, initials, logo, inbox, pendingRegistrations } = useHubShell();
  const notices = preview ? previewNotices(asOf, admin) : inbox?.items ?? [];
  const widgetData = preview ? previewWidgets(asOf, admin) : widgets ?? null;
  const widgetProjects = preview ? withPreviewTasks(projects, asOf) : projects;
  // Admins: what waits for them joins the notices (registrations, requests, overdue tasks, full quotas, projects).
  const derived = admin && widgetData ? adminNotices({ data: widgetData, projects: widgetProjects, registrations: pendingRegistrations, preview }) : [];

  return (
    <>
      <LargeTitleHeader title="Übersicht" date={model.dateLine} icon={<TitleIcon icon={sectionIcons.overview!} />} actions={<HeaderActions />} />
      {account.freelancer
        ? <div className="section-first welcome-row has-host"><WelcomeStage account={account} logo={logo} preview={preview} /><FreelancerCard customers={fileState.customers.filter((customer) => customer.kind !== "freelancer").length} href={hubHref(preview, "files")} /></div>
        : <div className="section-first welcome-row is-merged">{admin
          ? <WelcomeCard account={account} initials={initials} logo={logo} facts={facts ?? (preview ? previewFacts : null)} />
          : <WelcomeStage account={account} logo={logo} preview={preview} />}</div>}
      {account.freelancer
        ? <FreelancerOverview preview={preview} fileState={fileState} asOf={asOf} />
        : <div className={`nt-zone${widgetData ? " has-charts" : ""}`}>
          <NotificationCenter items={notices} derived={derived} preview={preview} admin={admin} insightsHref={hubHref(preview, "insights")} userKey={userKey} />
          {widgetData && <WidgetStacks userKey={userKey} admin={admin} preview={preview} data={widgetData} projects={widgetProjects} stamps={[...notices.map((item) => item.createdAt), ...fileState.files.map((file) => file.createdAt)]} servicePackage={admin ? null : account.packages.find(isServicePackageId) ?? null} />}
        </div>}
    </>
  );
}

/**
 * Freelancers have no projects: their overview shows the newest files at their customers and from oalab, each with
 * where it lies, and leads into their asset management.
 */
function FreelancerOverview({ preview, fileState, asOf }: Pick<ScreenProps, "preview" | "fileState" | "asOf">) {
  const ownId = fileState.freelancer?.ownId ?? null;
  const recent = fileState.files.slice(0, 6);
  const where = (customerIds: string[]) => customerIds.includes(ownId ?? "") ? "Meine Dateien" : fileState.customers.find((customer) => customerIds.includes(customer.id))?.company ?? "";
  return <>
    <SectionHeader title="Neue Dateien" action={<SectionLink href={hubHref(preview, "files")}>Alle anzeigen</SectionLink>} />
    {fileState.error ? <LoadNotice text={fileState.error} /> : recent.length ? (
      <InsetGroupedList label="Neue Dateien">
        {recent.map((file) => <ListRow key={file.id} href={`${hubHref(preview, "files")}?file=${encodeURIComponent(file.id)}`} compact icon={<FileIcon file={file} size={20} />} title={file.title} subtitle={[where(file.customers.map((customer) => customer.id)), formatFileDay(file.createdAt, asOf)].filter(Boolean).join(" · ")} />)}
      </InsetGroupedList>
    ) : <GlassCard className="empty-card"><p className="t-headline">Noch keine Dateien.</p><p className="t-subheadline t-secondary">Sobald oalab dir Kunden zuordnet oder Dateien für dich bereitstellt, erscheinen sie hier und im Asset Management.</p></GlassCard>}
  </>;
}

/** A load error of real data, in place of the content it replaces. */
export function LoadNotice({ text }: { text: string }) {
  return <GlassCard className="empty-card section-first" role="status"><p className="t-headline">Gerade nicht verfügbar</p><p className="t-subheadline t-secondary">{text}</p></GlassCard>;
}

const emptyCopy: Partial<Record<HubSection, [string, string]>> = {
  overview: ["Dein nächstes Kapitel beginnt hier.", "Sobald dein Projektteam deinen Workspace eingerichtet hat, findest du hier Projekte, nächste Schritte und Neuigkeiten."],
  insights: ["Insights entstehen mit deinen Projekten.", "Sobald Projekte, Dateien und Nachrichten in deinem Workspace liegen, fassen wir hier zusammen, was passiert ist."],
  projects: ["Raum für große Ideen.", "Hier erscheinen deine Projekte, sobald sie deinem Workspace zugeordnet sind."],
  files: ["Alles am richtigen Ort.", "Briefings, Entwürfe und finale Ergebnisse finden hier bald ihren Platz."],
  messages: ["Lass uns im Gespräch bleiben.", "Hier laufen künftig die Rückfragen und Updates zu deinen Projekten zusammen."],
};

/** A section without content yet. Since 18.11.2026 without the link to the design preview, which is a 404 live. */
export function EmptyState({ section }: { section: HubSection; preview?: boolean }) {
  const [title, text] = emptyCopy[section] || emptyCopy.overview!;
  return (
    <GlassCard className="empty-state section-first">
      <h2 className="t-title3">{title}</h2>
      <p className="t-body t-secondary">{text}</p>
    </GlassCard>
  );
}
