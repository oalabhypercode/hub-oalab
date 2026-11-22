/**
 * The emojis of the notes (plan 1.6, decision 12): stored as plain Unicode characters in the document, shown as
 * Microsoft's Fluent Emoji 3D (MIT), which the hub serves itself from public/emoji/fluent, so a page looks the same on
 * Mac, Windows and Android and no browser loads anything from a foreign server. Each emoji carries German names for the
 * search in the picker and after „:“ in the text. Self-contained so tests load it directly.
 */

export type EmojiCategory = { id: string; name: string; icon: string; emojis: [string, string][] };

/** Grouped like the picker's tabs; the names are what the search matches (first word = the name after „:“). */
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: "smileys", name: "Smileys", icon: "😀", emojis: [
    ["😀", "grinsen freude"], ["😃", "lachen"], ["😄", "freuen"], ["😁", "strahlen"], ["😊", "lächeln"], ["🙂", "freundlich"], ["😉", "zwinkern"],
    ["😍", "verliebt"], ["🤩", "begeistert"], ["😎", "cool"], ["🤔", "nachdenken überlegen"], ["😅", "erleichtert"], ["😂", "tränen lachen"],
    ["🥳", "feiern party"], ["😮", "staunen"], ["😴", "müde schlafen"], ["🙃", "kopfüber ironie"], ["😇", "engel brav"], ["🤗", "umarmen"],
    ["🤯", "überwältigt explodiert"], ["😬", "grimasse peinlich"], ["😢", "traurig weinen"], ["😠", "wütend ärger"], ["🫡", "salutieren jawohl"],
  ] },
  { id: "menschen", name: "Menschen", icon: "👍", emojis: [
    ["👍", "daumen hoch gut ok"], ["👎", "daumen runter schlecht"], ["👏", "applaus klatschen"], ["🙌", "hurra jubeln"], ["🙏", "danke bitte"],
    ["🤝", "handschlag einigung"], ["💪", "stark kraft"], ["👋", "winken hallo"], ["✌️", "frieden sieg"], ["👀", "augen schauen"],
    ["🧠", "gehirn idee denken"], ["🧑‍💻", "entwickler laptop programmieren"], ["🧑‍🎨", "künstler design"], ["🫶", "herzhände danke"],
    ["👉", "zeigen hinweis"], ["☝️", "zeigefinger wichtig"], ["✍️", "schreiben unterschrift"], ["🗣️", "sprechen ansage"], ["👥", "team gruppe leute"],
  ] },
  { id: "natur", name: "Natur", icon: "🌿", emojis: [
    ["🌱", "setzling start wachsen"], ["🌿", "kraut grün"], ["🌸", "blüte frühling"], ["🌻", "sonnenblume"], ["🌍", "erde welt global"],
    ["☀️", "sonne"], ["🌙", "mond nacht"], ["⭐", "stern"], ["🌟", "glanzstern highlight"], ["⚡", "blitz schnell energie"], ["🔥", "feuer heiß dringend"],
    ["🌈", "regenbogen"], ["❄️", "schnee winter"], ["🌊", "welle wasser meer"], ["🍀", "kleeblatt glück"], ["🐛", "käfer bug fehler"],
  ] },
  { id: "essen", name: "Essen", icon: "☕", emojis: [
    ["☕", "kaffee pause"], ["🍵", "tee"], ["🍎", "apfel"], ["🍕", "pizza"], ["🍰", "kuchen"], ["🥨", "brezel"], ["🍫", "schokolade"], ["🥂", "anstoßen sekt"],
    ["🍪", "keks cookie"], ["🍩", "donut"],
  ] },
  { id: "aktivitaet", name: "Aktivität", icon: "🎯", emojis: [
    ["🎯", "ziel treffer"], ["🎨", "kunst design farbe"], ["🎬", "film video"], ["🎵", "musik"], ["📸", "foto kamera"], ["🏆", "pokal sieg"],
    ["🎉", "party feiern tada"], ["🎁", "geschenk"], ["🧩", "puzzle teil"], ["⚽", "fußball"], ["🎓", "lernen abschluss schulung"], ["🏁", "zielflagge fertig"],
  ] },
  { id: "reisen", name: "Reisen", icon: "🚀", emojis: [
    ["🚀", "rakete start launch"], ["✈️", "flugzeug reise"], ["🚗", "auto"], ["🏠", "haus zuhause"], ["🏢", "büro firma"], ["🏗️", "baustelle bau"],
    ["🗺️", "karte plan"], ["🧭", "kompass richtung"], ["⛰️", "berg"], ["🏖️", "strand urlaub"], ["📍", "standort ort pin"], ["🚧", "absperrung arbeit"],
  ] },
  { id: "objekte", name: "Objekte", icon: "💡", emojis: [
    ["💡", "idee glühbirne"], ["📋", "klemmbrett briefing"], ["📝", "notiz memo"], ["📄", "dokument seite"], ["📊", "diagramm zahlen"],
    ["📈", "wachstum steigend"], ["📉", "sinkend rückgang"], ["📅", "kalender termin"], ["🗓️", "planer"], ["⏱️", "stoppuhr zeit"], ["⏰", "wecker"],
    ["⏳", "sanduhr warten"], ["📌", "pin wichtig"], ["📎", "büroklammer anhang"], ["🔒", "schloss intern privat"], ["🔑", "schlüssel zugang"],
    ["🧰", "werkzeugkasten"], ["🛠️", "werkzeuge technik"], ["💻", "laptop computer"], ["📱", "handy smartphone"], ["📦", "paket lieferung"],
    ["📣", "megafon ankündigung"], ["💬", "sprechblase kommentar"], ["📚", "bücher wissen"], ["🗂️", "ordner ablage"], ["📁", "mappe dateien"],
    ["🖼️", "bild grafik"], ["✉️", "brief mail"], ["📞", "telefon anruf"], ["🔍", "lupe suche"], ["🔔", "glocke erinnerung"], ["🧾", "rechnung beleg"],
    ["💶", "geld euro budget"], ["🧪", "test versuch"], ["🎙️", "mikrofon podcast"], ["🖥️", "bildschirm monitor"], ["🗒️", "notizblock"],
  ] },
  { id: "symbole", name: "Symbole", icon: "✅", emojis: [
    ["✅", "erledigt fertig haken"], ["☑️", "abgehakt"], ["❌", "nein falsch"], ["⚠️", "achtung warnung"], ["❗", "wichtig ausrufezeichen"],
    ["❓", "frage"], ["💯", "hundert perfekt"], ["🔴", "rot"], ["🟠", "orange"], ["🟡", "gelb"], ["🟢", "grün"], ["🔵", "blau"], ["🟣", "lila violett"],
    ["❤️", "herz liebe"], ["💜", "lila herz"], ["✨", "funkeln neu"], ["🆕", "neu"], ["🔗", "link verbindung"], ["♻️", "recycling wiederverwenden"],
    ["➡️", "pfeil weiter"], ["🔄", "aktualisieren wiederholen"], ["🚫", "verboten nicht"], ["💤", "pause ruhe"],
  ] },
];

export type EmojiEntry = { char: string; name: string; names: string; category: string };

export const EMOJIS: EmojiEntry[] = EMOJI_CATEGORIES.flatMap((category) => category.emojis.map(([char, names]) => ({ char, name: names.split(" ")[0], names, category: category.id })));

const byChar = new Map(EMOJIS.map((entry) => [stripVariation(entry.char), entry]));

/** The character without variation selectors (U+FE0F), as emojis arrive from different keyboards. */
export function stripVariation(char: string) {
  return char.replace(/️/g, "");
}

/** The entry of an emoji of the set, whichever variation selector it carries. */
export const emojiEntry = (char: string) => byChar.get(stripVariation(char));
export const isKnownEmoji = (char: string) => byChar.has(stripVariation(char));

/** The file name of an emoji in public/emoji/fluent: its code points in hex without variation selectors, e.g. 1f9d1-200d-1f4bb. */
export function emojiCode(char: string) {
  return [...stripVariation(char)].map((part) => part.codePointAt(0)!.toString(16)).join("-");
}

/** Where the hub serves the image of an emoji of the set; null for any other emoji (it shows as text). */
export function emojiSrc(char: string): string | null {
  return isKnownEmoji(char) ? `/emoji/fluent/${emojiCode(char)}.webp` : null;
}

const fold = (text: string) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

/** Emojis whose German names contain the query („rakete“, „rak“, „idee“); matches at the start of a name first. */
export function searchEmojis(query: string, limit = 64): EmojiEntry[] {
  const term = fold(query.trim());
  if (!term) return [];
  const starts: EmojiEntry[] = [];
  const contains: EmojiEntry[] = [];
  for (const entry of EMOJIS) {
    const names = fold(entry.names);
    if (names.split(" ").some((name) => name.startsWith(term))) starts.push(entry);
    else if (names.includes(term)) contains.push(entry);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The emojis picked last on this device, newest first (at most 16), stored in the browser like the list view. */
export const RECENT_EMOJI_KEY = "oalab-notes-recent-emojis";
export const DEFAULT_RECENT = ["🎨", "🚀", "📋", "✅", "💡", "🎯", "🤝", "🎉"];

export function withRecent(recent: readonly string[], char: string) {
  return [char, ...recent.filter((item) => item !== char)].slice(0, 16);
}

export function parseRecent(raw: string | null): string[] {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && isKnownEmoji(item)).slice(0, 16) : [];
  } catch {
    return [];
  }
}
