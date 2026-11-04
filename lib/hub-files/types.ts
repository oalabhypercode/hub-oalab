import type { FileCategory } from "./catalog";
import type { CustomerLogo } from "../hub-logos/rules";

/**
 * Who sees a file at one customer (hub_file_assignments.audience, since 4.11.2026): the customer and their
 * freelancers, only the customer (contracts, offers and invoices by default) or only the freelancers (working files).
 */
export type FileAudience = "both" | "customer" | "freelancer";
export const fileAudiences: readonly FileAudience[] = ["both", "customer", "freelancer"];
export const isFileAudience = (value: unknown): value is FileAudience => fileAudiences.includes(value as FileAudience);

/**
 * The customers list carries each logo (admins and freelancers), its kind (a customer or a freelancer) and, for admins,
 * the freelancers who look after a customer; customers inside a file's assignments carry none of that.
 */
export type HubFileCustomer = { id: string; customerNumber: string; company: string; logo?: CustomerLogo; kind?: "customer" | "freelancer"; freelancerIds?: string[] };

/** One level of folders per customer; a file's folder is stored per customer assignment. */
export type HubFolder = { id: string; customerId: string; name: string };

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
  /** Folder of the file per customer id; customers without an entry hold it in "Ohne Ordner". */
  folderIds: Record<string, string>;
  /** Who sees the file per customer id (admins and freelancers; missing means "both"). */
  audiences?: Record<string, FileAudience>;
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
  folders: HubFolder[];
  /** Upload and assign; decided on the server from the verified role, never from fixtures. */
  canManage: boolean;
  /** A freelancer's view: their own entry (their files) next to the customers they look after, read only. */
  freelancer?: { ownId: string | null };
  /** Admins: the database knows freelancers ("Betreut von", "Sichtbar für"). */
  freelancers?: boolean;
  error?: string;
};
