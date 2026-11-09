import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { HubAccountData } from "@/lib/hub-users/types";
import { cleanLogoColor, isLogoBackground, LOGO_BUCKET, LOGO_URL_SECONDS, type CustomerLogo } from "./rules";

type LogoRow = { id: string; logo_path: string | null; logo_background: string | null; logo_color: string | null };

/**
 * Logos of the given customers (of every customer the session may read when no ids are given), with links signed
 * in one call. Read on their own and never in CUSTOMER_COLUMNS: a logo is decoration, so a missing migration, a
 * failed read or a failed signature leaves the initials instead of failing the page.
 */
export async function loadCustomerLogos(supabase: SupabaseClient, ids?: string[]): Promise<Map<string, CustomerLogo>> {
  const logos = new Map<string, CustomerLogo>();
  if (ids && !ids.length) return logos;
  const base = supabase.from("hub_customers").select("id, logo_path, logo_background, logo_color").not("logo_path", "is", null);
  const { data, error } = await (ids ? base.in("id", ids) : base).returns<LogoRow[]>();
  const rows = error ? [] : (data ?? []).filter((row): row is LogoRow & { logo_path: string } => Boolean(row.logo_path));
  if (!rows.length) return logos;
  const signed = await supabase.storage.from(LOGO_BUCKET).createSignedUrls(rows.map((row) => row.logo_path), LOGO_URL_SECONDS);
  if (signed.error || !signed.data) return logos;
  const urls = new Map(signed.data.flatMap((item) => item.signedUrl && item.path ? [[item.path, item.signedUrl]] : []));
  for (const row of rows) {
    const url = urls.get(row.logo_path);
    const background = isLogoBackground(row.logo_background) ? row.logo_background : "light";
    if (url) logos.set(row.id, { url, background, color: background === "brand" ? cleanLogoColor(row.logo_color) : null });
  }
  return logos;
}

/**
 * The logo a customer login sees in its own hub (corner, welcome card, phone header), read and signed with its own
 * session: the storage policy hands out only the logo of its own customer. Admins keep their initials.
 */
export async function loadAccountLogo(identity: { account: HubAccountData | null }) {
  const customerId = identity.account?.customers[0]?.id;
  if (!customerId || identity.account?.role === "oalab_admin") return null;
  return (await loadCustomerLogos(await createClient(), [customerId])).get(customerId) ?? null;
}
