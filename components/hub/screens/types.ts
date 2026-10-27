import type { Project } from "@/lib/hub-data";
import type { HubFilesState, HubStoredFile } from "@/lib/hub-files/types";
import type { HubCalendarState } from "@/lib/hub-calendar/types";
import type { HubModel } from "@/lib/hub-metrics";
import type { LiveProjectsState } from "@/lib/hub-projects/map";
import type { useFavorites } from "@/lib/use-favorites";

export type ScreenProps = {
  model: HubModel;
  preview: boolean;
  populated: boolean;
  /** Reference day: the fixtures' DEMO_AS_OF or today for real accounts. */
  asOf: string;
  admin: boolean;
  projects: Project[];
  /** Real logins: their Studio projects or why they did not load; null for fixtures. */
  liveProjects: LiveProjectsState | null;
  files: HubStoredFile[];
  /** Files table data: Supabase (real logins) or fixtures (preview, public demo). */
  fileState: HubFilesState;
  /** Calendar data: Supabase (real logins) or fixtures (preview, public demo). */
  calendar: HubCalendarState;
  favorites: ReturnType<typeof useFavorites>;
  firstName: string;
  company?: string;
  toggleStep: (id: string) => void;
};
