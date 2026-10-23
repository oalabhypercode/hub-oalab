import { zipSync } from "fflate";
import { MAX_ZIP_BYTES, zipEntryNames } from "./catalog";

/**
 * Downloads several files as one ZIP that the browser builds itself, so no server limit applies.
 * Entries are stored without compression: most files (PDF, images, Office) are compressed already.
 */
export async function downloadAsZip(entries: { url: string; fileName: string }[], zipName: string) {
  const names = zipEntryNames(entries.map((entry) => entry.fileName));
  const contents: Record<string, Uint8Array> = {};
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error(`„${entry.fileName}“ konnte nicht geladen werden.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    total += bytes.byteLength;
    if (total > MAX_ZIP_BYTES) throw new Error("Die Auswahl ist größer als 500 MB. Bitte in mehreren Teilen herunterladen.");
    contents[names[index]] = bytes;
  }
  const url = URL.createObjectURL(new Blob([zipSync(contents, { level: 0 })], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = zipName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
