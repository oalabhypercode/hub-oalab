/**
 * Dictation in the assistant chat (admins, since 16.11.2026): the browser's own speech recognition turns speech into
 * text for the chat field, and only that text reaches the hub and Claude. Pure helpers without imports, so tests load
 * this file directly; the browser side lives in components/hub/use-dictation.ts.
 */

/** Where this browser remembers the chosen microphone (the same key as in the approved preview). */
export const MIC_STORAGE_KEY = "oalab-hub-mic";
/** Dictation ends on its own after this long without new words … */
export const SILENCE_STOP_MS = 6000;
/** … and after five minutes in one go at the latest. */
export const MAX_DICTATION_MS = 5 * 60_000;
export const DICTATION_LANG = "de-DE";

/** Device ids Chromium lists in addition to the real microphones; they only point at one of them. */
const ALIAS_IDS = new Set(["default", "communications"]);

export type Mic = { deviceId: string; label: string };

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("de-DE") + text.slice(1);

/**
 * Appends dictated words to what is already in the field: spaces collapse to one, a space separates the parts, and
 * the words start with a capital letter in an empty field, after . ! ? : or on a new line.
 */
export function joinDictation(draft: string, spoken: string) {
  const text = spoken.replace(/\s+/g, " ").trim();
  if (!text) return draft;
  if (!draft.trim()) return capitalize(text);
  const before = draft.replace(/[ \t]+$/, "");
  const newLine = before.endsWith("\n");
  const sentence = newLine || /[.!?:]$/.test(before);
  return `${before}${newLine ? "" : " "}${sentence ? capitalize(text) : text}`;
}

/** What the chat says when the speech recognition stops with an error; "" for a stop the user asked for. */
export function dictationError(code: string) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Das Mikrofon ist für den Hub gesperrt. Erlaube es über das Symbol links in der Adresszeile und versuche es noch einmal.";
    case "audio-capture":
      return "Kein Mikrofon gefunden. Ist eins angeschlossen und eingeschaltet?";
    case "no-speech":
      return "Ich habe nichts gehört. Sprich etwas lauter oder näher am Mikrofon.";
    case "network":
      return "Die Spracherkennung braucht eine Internetverbindung. Bitte prüfe sie und versuche es noch einmal.";
    case "language-not-supported":
      return "Dein Browser erkennt hier kein Deutsch. Nimm Chrome, Edge oder Safari.";
    case "aborted":
      return "";
    default:
      return "Das Diktat ist abgebrochen. Bitte versuche es noch einmal.";
  }
}

/** "0:07", "1:24": how long the dictation runs. */
export function formatDictationTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The real microphones of a device list (enumerateDevices), without Chromium's "default" and "communications" aliases. */
export function micChoices(devices: readonly { kind?: string; deviceId: string; label: string }[]): Mic[] {
  return devices
    .filter((device) => (device.kind ?? "audioinput") === "audioinput" && device.deviceId && !ALIAS_IDS.has(device.deviceId))
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label.trim() || `Mikrofon ${index + 1}` }));
}

/**
 * The choice this browser remembered: a microphone it still has, or the standard one (`mic` null). `known` is false
 * when nothing usable is stored, for instance after the headset was unplugged; then the list comes back.
 */
export function chosenMic(devices: readonly Mic[], stored: string | null): { known: boolean; mic: Mic | null } {
  if (!stored) return { known: false, mic: null };
  try {
    const value = JSON.parse(stored) as { id?: unknown };
    if (value.id === null) return { known: true, mic: null };
    const mic = typeof value.id === "string" ? devices.find((device) => device.deviceId === value.id) : undefined;
    return mic ? { known: true, mic } : { known: false, mic: null };
  } catch {
    return { known: false, mic: null };
  }
}

/** What is stored for a choice; the standard microphone is remembered as such, so the list does not come back. */
export const storedMic = (mic: Mic | null) => JSON.stringify(mic ? { id: mic.deviceId, label: mic.label } : { id: null });

/** The error code for a failed getUserMedia (DOMException name), in the words of the speech recognition. */
export function micErrorCode(name: string) {
  if (name === "NotAllowedError" || name === "SecurityError") return "not-allowed";
  if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError") return "audio-capture";
  return "unknown";
}
