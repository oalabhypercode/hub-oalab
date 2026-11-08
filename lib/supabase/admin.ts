import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createOwnAdminClient } from "@/lib/platform/client";
import { usesOwnPlatform } from "@/lib/platform/config";

/**
 * Service-role client for server-side administration (Auth Admin API, writes behind an admin check).
 * Null when the secret key is not configured. Never import this from client code and never hand it a
 * value from the browser without validating it first.
 */
export function createAdminClient(): SupabaseClient | null {
  // Own platform: the service role on the internal PostgREST, user management on the shared login tables.
  if (usesOwnPlatform()) return createOwnAdminClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return null;
  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
