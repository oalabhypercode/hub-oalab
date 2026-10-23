"use server";

import { createClient } from "@/lib/supabase/server";
import { linkMessageUrl, maskPhone } from "./messages";

// Every action is a public POST endpoint: authenticate inside each one. RLS limits users to their own link,
// and link codes are only created by hub_create_whatsapp_link_code().

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type WhatsAppStatus = { available: boolean; linkedPhone: string | null };
export type WhatsAppLinkCode = { code: string; expiresAt: string; url: string; number: string };

const businessNumber = () => process.env.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/g, "") ?? "";
const available = () => Boolean(businessNumber() && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
const notSignedIn = { ok: false as const, error: "WhatsApp lässt sich nur mit echtem Login verbinden." };

function describe(error: { code?: string; message?: string }) {
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202" || /hub_whatsapp|schema cache/i.test(error.message ?? "")
    ? "WhatsApp ist in Supabase noch nicht eingerichtet. Die Migration steht noch aus."
    : "Das hat gerade nicht geklappt. Bitte versuche es erneut.";
}

async function signedIn() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return error || !data?.claims ? null : { supabase, userId: data.claims.sub };
}

export async function getWhatsAppStatus(): Promise<Result<WhatsAppStatus>> {
  const session = await signedIn();
  if (!session) return notSignedIn;
  const { data, error } = await session.supabase.from("hub_whatsapp_links").select("phone").eq("user_id", session.userId).maybeSingle();
  if (error) return { ok: false, error: describe(error) };
  return { ok: true, data: { available: available(), linkedPhone: data ? maskPhone(data.phone as string) : null } };
}

/** A fresh code for 15 minutes and the wa.me link that sends it from the user's phone. */
export async function createWhatsAppLinkCode(): Promise<Result<WhatsAppLinkCode>> {
  const session = await signedIn();
  if (!session) return notSignedIn;
  if (!available()) return { ok: false, error: "WhatsApp ist für den Client Hub noch nicht eingerichtet." };
  const { data, error } = await session.supabase.rpc("hub_create_whatsapp_link_code").single<{ code: string; expires_at: string }>();
  if (error || !data) return { ok: false, error: error ? describe(error) : "Es konnte kein Code erzeugt werden." };
  return { ok: true, data: { code: data.code, expiresAt: data.expires_at, url: linkMessageUrl(businessNumber(), data.code), number: `+${businessNumber()}` } };
}

export async function unlinkWhatsApp(): Promise<Result<null>> {
  const session = await signedIn();
  if (!session) return notSignedIn;
  const { error } = await session.supabase.from("hub_whatsapp_links").delete().eq("user_id", session.userId);
  if (error) return { ok: false, error: describe(error) };
  return { ok: true, data: null };
}
