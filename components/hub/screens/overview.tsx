"use client";

import { Sparkles, SquareKanban } from "lucide-react";
import { hubHref, type HubSection } from "@/lib/hub-data";
import { previewNotices } from "@/lib/hub-insights/fixtures";
import { previewBoard, previewWidgets, withPreviewTasks } from "@/lib/hub-overview/fixtures";
import type { OverviewFacts, OverviewWidgetsData } from "@/lib/hub-overview/types";
import type { TaskBoardState } from "@/lib/hub-tasks/types";
import { isServicePackageId } from "@/lib/service-packages";
import { adminNotices } from "../admin-notices";
import { HeaderActions } from "../app-shell";
import { WelcomeCard } from "../cards";
import { GlassCard, TitleIcon } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { sectionIcons } from "../navigation";
import { NotificationCenter, type QuietState } from "../notification-center";
import { useHubShell } from "../shell-context";
import { WelcomeStage } from "../welcome-stage";
import { WidgetStacks, type OverviewBoard } from "../widget-stacks";
import type { ScreenProps } from "./types";

/** The admins' welcome card in the design preview (fictional). */
const previewFacts: OverviewFacts = { customers: 4, withService: 3 };

/**
 * The overview (design „V5“, user 18.11.2026): one long welcome card, below it the bell's notices like a phone's
 * notification centre and beside them two widget stacks. Where projects stand in detail lives on Insights. Freelancers
 * (same day) get the same frame: the customers they look after and the way to their board in the welcome card, their
 * bell, and widgets from their board, customers and files.
 */
export function OverviewScreen({ model, preview, admin, fileState, projects, asOf, userKey, facts, widgets, board }: ScreenProps & { userKey: string; facts?: OverviewFacts | null; widgets?: OverviewWidgetsData | null; board?: TaskBoardState }) {
  const { account, initials, logo, inbox, pendingRegistrations } = useHubShell();
  const freelancer = account.freelancer;
  const notices = preview ? previewNotices(asOf, admin) : inbox?.items ?? [];
  const widgetData = preview ? previewWidgets(asOf, admin) : widgets ?? null;
  const widgetProjects = preview ? withPreviewTasks(projects, asOf) : projects;
  // Admins: what waits for them joins the notices (registrations, requests, overdue tasks, full quotas, projects).
  const derived = admin && widgetData ? adminNotices({ data: widgetData, projects: widgetProjects, registrations: pendingRegistrations, preview }) : [];
  const boardHref = `${hubHref(preview, "projects")}/tasks`;
  // Freelancers: the customers they look after (not their own entry) and their board (their projects, no „Nur Team“).
  const looksAfter = fileState.customers.filter((customer) => customer.kind !== "freelancer");
  const freelancerBoard: OverviewBoard | null = !freelancer ? null
    : preview ? previewBoard(widgetProjects, asOf, userKey)
      : board ? { projects: board.projects, tasks: board.tasks, viewerId: board.viewerId, error: board.error } : null;
  const quiet: QuietState = freelancer
    ? { text: "Neue Aufgaben in deinen Projekten, Dateien, Freigaben bei Kunden und Antworten auf Terminanfragen erscheinen hier.", href: boardHref, label: "Zu deinen Aufgaben", icon: SquareKanban }
    : admin
      ? { text: "Alles erledigt. Neue Registrierungen, Terminanfragen, Fristen, volle Kontingente und Nachrichten erscheinen hier.", href: hubHref(preview, "insights"), label: "Zahlen und Listen in Insights", icon: Sparkles }
      : { text: "Neue Dateien, Termine, Antworten und Aufgaben erscheinen hier, sobald es sie gibt.", href: hubHref(preview, "insights"), label: "Stand deiner Projekte in Insights", icon: Sparkles };

  return (
    <>
      <LargeTitleHeader title="Übersicht" date={model.dateLine} icon={<TitleIcon icon={sectionIcons.overview!} />} actions={<HeaderActions />} />
      <div className="section-first welcome-row is-merged">{admin
        ? <WelcomeCard account={account} initials={initials} logo={logo} facts={facts ?? (preview ? previewFacts : null)} />
        : <WelcomeStage account={account} logo={logo} preview={preview} freelancer={freelancer ? { customers: looksAfter.map((customer) => customer.company), boardHref } : undefined} />}</div>
      <div className={`nt-zone${widgetData ? " has-charts" : ""}`}>
        <NotificationCenter items={notices} derived={derived} preview={preview} quiet={quiet} userKey={userKey} />
        {widgetData && <WidgetStacks userKey={userKey} admin={admin} preview={preview} data={widgetData} projects={widgetProjects}
          stamps={[...notices.map((item) => item.createdAt), ...fileState.files.map((file) => file.createdAt)]}
          servicePackage={admin || freelancer ? null : account.packages.find(isServicePackageId) ?? null}
          freelancer={freelancer ? { board: freelancerBoard, customers: looksAfter, files: fileState.files, ownId: fileState.freelancer?.ownId ?? null } : undefined} />}
      </div>
    </>
  );
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
