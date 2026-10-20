import type { FileCategory } from "./catalog";

export type HubFileCustomer = { id: string; customerNumber: string; company: string };

/** A file as the files table shows it, whether it comes from Supabase or from fixtures. */
export type HubStoredFile = {
  id: string;
  title: string;
  fileName: string;
  category: FileCategory;
  description: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  createdAt: string;
  customers: HubFileCustomer[];
  /** Static example file (fixtures only); real files are downloaded through a signed URL. */
  sampleHref?: string;
};

/**
 * "supabase": real files under RLS; uploads and downloads go through server actions.
 * "fixtures": preview and public demo identities, which may never touch real data.
 */
export type HubFilesState = {
  source: "supabase" | "fixtures";
  files: HubStoredFile[];
  customers: HubFileCustomer[];
  /** Upload and assign; decided on the server from the verified role, never from fixtures. */
  canManage: boolean;
  error?: string;
};
