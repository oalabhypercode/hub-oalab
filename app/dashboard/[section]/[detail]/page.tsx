import { Suspense } from "react";
import { notFound } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { HubContentLoading } from "@/components/hub/loading";
import { detailSection, hubDetailParams, isHubDetail, todayIso } from "@/lib/hub-routes";
import { getWorkspaceIdentity } from "@/lib/hub-session";
import { loadHubFiles } from "@/lib/hub-files/server";
import { loadHubCalendar } from "@/lib/hub-calendar/server";
import { loadLiveProjects } from "@/lib/hub-projects/server";
import { loadTaskBoard } from "@/lib/hub-tasks/server";

export function generateStaticParams() { return hubDetailParams; }

async function WorkspaceDetail({ params }: { params: Promise<{ section: string; detail: string }> }) {
  const { section, detail } = await params;
  if (!isHubDetail(section, detail)) notFound();
  const identity = await getWorkspaceIdentity();
  const admin = identity.account?.role === "oalab_admin";
  const freelancer = identity.account?.role === "oalab_freelancer";
  const tasks = section === "projects" && detail === "tasks";
  // The calendar under Projekte (16.11.2026): appointments for everyone; admins also see every task with a date, which
  // comes from the task board's reading (the same Studio rows), freelancers (18.11.2026) the tasks of their projects
  // from their board, customers their released tasks from their projects.
  const calendar = section === "projects" && detail === "calendar";
  // The task board is the oalab team's and, since 16.11.2026, the freelancers' (only their projects, the database
  // decides); customers keep the project window.
  if (tasks && !admin && !freelancer) notFound();
  const [filesState, liveProjects, taskBoard, calendarState] = await Promise.all([
    loadHubFiles(),
    loadLiveProjects(),
    tasks || (calendar && (admin || freelancer)) ? loadTaskBoard() : undefined,
    calendar ? loadHubCalendar(todayIso()) : undefined,
  ]);
  return <HubView section={detailSection(section, detail)} detail={detail} email={identity.email} role={identity.account?.role ?? null} userKey={identity.userId} asOf={todayIso()} filesState={filesState} liveProjects={liveProjects} taskBoard={taskBoard} calendarState={calendarState} />;
}

export default function Page(props: { params: Promise<{ section: string; detail: string }> }) {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceDetail {...props} /></Suspense>;
}
