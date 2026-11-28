import { formatBytes, isBlockedFile } from "../hub-files/catalog";
import { UPLOAD_MAX_BYTES } from "./rules";

export type SpaceCheck = { ok: true } | { ok: false; error: string };

/** Before asking the database: name, programs, empty files, 5 GB and the space the customer has left. */
export function checkCustomerUpload(fileName: string, size: number, maxFile: number): SpaceCheck {
  if (!fileName.trim() || fileName.length > 255) return { ok: false, error: "Der Dateiname ist leer oder zu lang." };
  if (isBlockedFile(fileName)) return { ok: false, error: "Programme und Skripte können nicht hochgeladen werden." };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "Die Datei ist leer." };
  if (size > UPLOAD_MAX_BYTES) return { ok: false, error: `„${fileName}“ ist größer als 5 GB.` };
  if (size > maxFile) return { ok: false, error: `„${fileName}“ (${formatBytes(size)}) passt nicht mehr. Frei sind noch ${formatBytes(Math.max(0, maxFile))}.` };
  return { ok: true };
}
