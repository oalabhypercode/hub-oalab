import type { Project } from "@/lib/hub-data";
import type { HubFilesState, HubStoredFile } from "@/lib/hub-files/types";
import type { HubModel } from "@/lib/hub-metrics";
import type { useFavorites } from "@/lib/use-favorites";

export type ScreenProps = {
  model: HubModel;
  preview: boolean;
  populated: boolean;
  admin: boolean;
  projects: Project[];
  files: HubStoredFile[];
  /** Files table data: Supabase (real logins) or fixtures (preview, public demo). */
  fileState: HubFilesState;
  favorites: ReturnType<typeof useFavorites>;
  firstName: string;
  company?: string;
  toggleStep: (id: string) => void;
};
