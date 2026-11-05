"use client";

import { useState } from "react";
import { DOCX_MIME } from "@/lib/contract-templates/catalog";
import type { ContractActionResult, ContractDownload } from "@/lib/contract-templates/actions";

/** Hands a generated Word file to the browser's download. */
export function saveDownload({ fileName, base64 }: ContractDownload) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_MIME }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** "05.11.2026, 13:05 Uhr" in Berlin time. */
export const formatStamp = (iso: string) => `${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))} Uhr`;

/** Runs one contract action at a time and keeps its message; field errors go to `onFields`. */
export function useContractRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function run<T>(key: string, action: () => Promise<ContractActionResult<T>>, onDone: (data: T) => void, onFields?: (errors: Record<string, string>) => void) {
    setBusy(key);
    setError("");
    try {
      const result = await action();
      if (result.ok) onDone(result.data);
      else {
        setError(result.error);
        if (result.fieldErrors) onFields?.(result.fieldErrors);
      }
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : "Das hat gerade nicht geklappt. Bitte versuche es erneut.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, setError, run };
}
