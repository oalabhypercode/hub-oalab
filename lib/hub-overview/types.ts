import type { HubAppointment } from "@/lib/hub-calendar/types";
import type { InsightsData } from "@/lib/hub-insights/types";

/** The admins' welcome card: how many customers there are and how many of them hold a Service package. */
export type OverviewFacts = { customers: number; withService: number };

/** The widgets' own data: this week's appointments and the Service quota; tasks, notices and files come with the page. */
export type OverviewWidgetsData = { today: string; now: number; weekStart: string; appointments: HubAppointment[]; appointmentsError: string | null; quota: InsightsData["quota"] };
