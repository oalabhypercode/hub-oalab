"use server";

import { redirect } from "next/navigation";
import { OPT_OUT_PATHS } from "@/lib/hub-mail/opt-out";
import { setInfoMails } from "@/lib/hub-mail/opt-out-server";

/**
 * The buttons of „Infomails abbestellen“: off, or on again. Only a valid signed link changes anything; afterwards the
 * page shows the login's choice as it is now (`fehler=1` when nothing could be saved).
 */
export async function switchInfoMails(formData: FormData) {
  const userId = String(formData.get("u") ?? "");
  const signature = String(formData.get("sig") ?? "");
  const saved = await setInfoMails(userId, signature, formData.get("wanted") === "1");
  const query = new URLSearchParams({ u: userId, sig: signature, ...(saved ? {} : { fehler: "1" }) });
  redirect(`${OPT_OUT_PATHS.page}?${query}`);
}
