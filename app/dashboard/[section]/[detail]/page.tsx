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
import { loadNotes } from "@/lib/hub-notes/server";

export function generateStaticParams() { return hubDetailParams; }

type DetailProps = { params: Promise<{ section: string; detail: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

async function WorkspaceDetail({ params, searchParams }: DetailProps) {
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
  // Notizen under Projekte (22.11.2026): for admins, customers and freelancers; ?customer= and ?page= pick what opens.
  const notes = section === "projects" && detail === "notes";
  const query = notes ? await searchParams : {};
  // The task board is the oalab team's and, since 16.11.2026, the freelancers' (only their projects, the database
  // decides); customers keep the project window.
  if (tasks && !admin && !freelancer) notFound();
  const [filesState, liveProjects, taskBoard, calendarState, notesArea] = await Promise.all([
    loadHubFiles(),
    loadLiveProjects(),
    tasks || (calendar && (admin || freelancer)) ? loadTaskBoard() : undefined,
    calendar ? loadHubCalendar(todayIso()) : undefined,
    notes ? loadNotes(one(query.customer), one(query.page)) : undefined,
  ]);
  return <HubView section={detailSection(section, detail)} detail={detail} email={identity.email} role={identity.account?.role ?? null} userKey={identity.userId} asOf={todayIso()} filesState={filesState} liveProjects={liveProjects} taskBoard={taskBoard} calendarState={calendarState} notes={notesArea} />;
}

export default function Page(props: DetailProps) {
  return <Suspense fallback={<HubContentLoading />}><WorkspaceDetail {...props} /></Suspense>;
}
