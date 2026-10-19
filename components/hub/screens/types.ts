import type { HubFile, Project } from "@/lib/hub-data";
import type { HubModel } from "@/lib/hub-metrics";
import type { useFavorites } from "@/lib/use-favorites";

export type ScreenProps = {
  model: HubModel;
  preview: boolean;
  populated: boolean;
  admin: boolean;
  projects: Project[];
  files: HubFile[];
  favorites: ReturnType<typeof useFavorites>;
  firstName: string;
  company?: string;
  toggleStep: (id: string) => void;
  openFile: (file: HubFile) => void;
};
