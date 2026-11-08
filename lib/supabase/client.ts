import { createBrowserClient } from "@supabase/ssr";

type UploadOptions = { contentType?: string; upsert?: boolean; cacheControl?: string };

/**
 * The browser's only storage call: an upload to a link the server signed. On the own platform that link is a signed
 * Garage URL (lib/platform/storage.ts) and takes the bytes with one PUT; a Supabase token goes through supabase-js.
 */
export function createClient() {
  return {
    storage: {
      from(bucket: string) {
        return {
          async uploadToSignedUrl(path: string, token: string, file: File | Blob, options?: UploadOptions) {
            if (!token.startsWith("https://")) {
              const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
              return supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, options);
            }
            try {
              const response = await fetch(token, { method: "PUT", body: file, headers: { "content-type": options?.contentType || file.type || "application/octet-stream" } });
              if (!response.ok) return { data: null, error: new Error(`Upload failed with HTTP ${response.status}`) };
              return { data: { path, fullPath: `${bucket}/${path}` }, error: null };
            } catch (error) {
              return { data: null, error: error instanceof Error ? error : new Error("Upload failed") };
            }
          },
        };
      },
    },
  };
}
