/** One upload of a customer, as the hub shows it (service-oalab table hub_uploads). */
export type HubUpload = {
  id: string;
  customerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** „uploading“: space reserved, the bytes are on their way; „waiting“: done, waits for an admin to take it over. */
  status: "uploading" | "waiting";
  /** Who uploaded it („Jana Sommer“), empty when the login is gone. */
  uploader: string;
  createdAt: number;
  completedAt: number | null;
  expiresAt: number | null;
};

export type HubUploadSpace = { used: number; limit: number; maxFile: number };

export type HubUploadsState = {
  /** False before the database knows the upload area (migration 202611280001): the hub shows nothing of it then. */
  ready: boolean;
  uploads: HubUpload[];
  /** Customers: their own customer (the one they upload for) and its space; null for admins and freelancers. */
  customerId: string | null;
  space: HubUploadSpace | null;
  /** Admins: the default per customer, the total over all customers and each customer's own limit (null: default). */
  settings: { defaultLimit: number; totalLimit: number } | null;
  limits: Record<string, number | null>;
  error?: string;
};

export const NO_UPLOADS: HubUploadsState = { ready: false, uploads: [], customerId: null, space: null, settings: null, limits: {} };
