"use client";

import { FileArchive, FileImage, FileText, FileVideo, type LucideIcon } from "lucide-react";
import { uploadKind, type UploadKind } from "@/lib/hub-uploads/rules";

/* Small pieces both sides of the upload area share: the file's icon and when it came. */

const ICONS: Record<UploadKind, LucideIcon> = { video: FileVideo, archive: FileArchive, image: FileImage, doc: FileText };

export function UploadIcon({ fileName, mimeType }: { fileName: string; mimeType?: string }) {
  const kind = uploadKind(fileName, mimeType);
  const Icon = ICONS[kind];
  return <span className={`up-icon is-${kind}`} aria-hidden="true"><Icon size={17} /></span>;
}

const clock = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** „heute, 09:12“, „gestern, 17:40“, „vor 3 Tagen“. */
export function uploadedWhen(at: number, now: number) {
  const days = Math.round((Date.parse(`${berlinDay.format(now)}T00:00:00Z`) - Date.parse(`${berlinDay.format(at)}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return `heute, ${clock.format(at)}`;
  if (days === 1) return `gestern, ${clock.format(at)}`;
  return `vor ${days} Tagen`;
}

/** „noch etwa 2 Min.“ from the bytes sent so far and the time it took. */
export function timeToGo(sent: number, size: number, startedAt: number, now: number) {
  const seconds = (now - startedAt) / 1000;
  if (sent < 1 || seconds < 3) return "";
  const left = ((size - sent) / sent) * seconds;
  if (left < 60) return "noch unter 1 Min.";
  const minutes = Math.round(left / 60);
  return minutes < 60 ? `noch etwa ${minutes} Min.` : `noch etwa ${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
}
