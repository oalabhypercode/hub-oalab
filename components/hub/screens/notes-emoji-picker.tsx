"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, Search, Shuffle, X } from "lucide-react";
import { useStoredValue } from "@/lib/use-stored-value";
import { DEFAULT_RECENT, EMOJI_CATEGORIES, EMOJIS, emojiEntry, emojiSrc, parseRecent, RECENT_EMOJI_KEY, searchEmojis, withRecent } from "@/lib/hub-notes/emoji";

/** The emojis picked last on this device (browser storage, like the list view); never fails without storage. */
export function useRecentEmojis() {
  const [raw, setRaw] = useStoredValue(RECENT_EMOJI_KEY, "");
  const stored = parseRecent(raw);
  const recent = stored.length ? stored : DEFAULT_RECENT;
  const remember = (char: string) => setRaw(JSON.stringify(withRecent(recent, char)));
  return { recent, remember };
}

function Glyph({ char }: { char: string }) {
  const src = emojiSrc(char);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" width={28} height={28} draggable={false} /> : <span>{char}</span>;
}

type PickerProps = {
  anchor: DOMRect;
  heading: string;
  onPick: (char: string) => void;
  onRemove?: () => void;
  onClose: () => void;
};

/**
 * The emoji picker in the hub's glass (V2-Emoji): search with German names, categories, „Zuletzt benutzt“,
 * „Zufällig“ and „Entfernen“. It floats next to what opened it and follows light and dark like every popup.
 */
export function EmojiPicker({ anchor, heading, onPick, onRemove, onClose }: PickerProps) {
  const { recent, remember } = useRecentEmojis();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("recent");
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => { search.current?.focus({ preventScroll: true }); }, []);

  useLayoutEffect(() => {
    const width = 344;
    const height = box.current?.offsetHeight ?? 420;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : below;
    setPlace({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    const onPointer = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey, true);
    // A tick later, so the click that opened the picker does not close it at once.
    const timer = window.setTimeout(() => document.addEventListener("pointerdown", onPointer), 0);
    return () => { window.removeEventListener("keydown", onKey, true); window.clearTimeout(timer); document.removeEventListener("pointerdown", onPointer); };
  }, [onClose]);

  const term = query.trim();
  const list = useMemo(() => {
    if (term) return searchEmojis(term);
    if (category === "recent") return recent.map((char) => emojiEntry(char)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    return EMOJIS.filter((entry) => entry.category === category);
  }, [term, category, recent]);
  const caption = term ? (list.length === 1 ? "1 Treffer" : `${list.length} Treffer`) : category === "recent" ? "Zuletzt benutzt" : EMOJI_CATEGORIES.find((item) => item.id === category)?.name ?? "";
  const pick = (char: string) => { remember(char); onPick(char); onClose(); };

  return createPortal(
    <div ref={box} className="nz-ep nz-glass" role="dialog" aria-label={heading} style={place ? { left: place.left, top: place.top } : { left: anchor.left, top: anchor.bottom + 6 }} onMouseDown={(event) => { if ((event.target as HTMLElement).tagName !== "INPUT") event.preventDefault(); }}>
      <div className="nz-ep-head">
        <strong>{heading}</strong>
        <button type="button" className="nz-ep-btn" onClick={() => pick(EMOJIS[Math.floor(Math.random() * EMOJIS.length)].char)}><Shuffle size={14} aria-hidden="true" /><span>Zufällig</span></button>
        {onRemove && <button type="button" className="nz-ep-btn is-danger" onClick={() => { onRemove(); onClose(); }}>Entfernen</button>}
        <button type="button" className="nz-ep-x" aria-label="Schließen" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <label className="nz-ep-search">
        <Search size={14} aria-hidden="true" />
        <input ref={search} type="search" placeholder="Suchen, z. B. Rakete oder Idee" aria-label="Emoji suchen" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && list[0]) { event.preventDefault(); pick(list[0].char); } }} />
      </label>
      <div className="nz-ep-tabs" role="tablist" aria-label="Kategorien">
        {[{ id: "recent", name: "Zuletzt benutzt", icon: "" }, ...EMOJI_CATEGORIES].map((item) => {
          const on = !term && category === item.id;
          return (
            <button key={item.id} type="button" role="tab" className={`nz-ep-tab${on ? " is-on" : ""}`} aria-selected={on} aria-label={item.name} data-tip={item.name} onClick={() => { setCategory(item.id); setQuery(""); }}>
              {item.id === "recent" ? <Clock size={17} aria-hidden="true" /> : <Glyph char={item.icon} />}
            </button>
          );
        })}
      </div>
      <div className="nz-ep-caption">{caption}</div>
      <div className="nz-ep-grid">
        {list.map((entry) => (
          <button key={entry.char} type="button" className="nz-ep-cell" aria-label={entry.name} data-tip={entry.name} onClick={() => pick(entry.char)}><Glyph char={entry.char} /></button>
        ))}
      </div>
      {!list.length && <p className="nz-ep-empty">Kein Emoji gefunden.</p>}
      <div className="nz-ep-foot"><span>Fluent Emoji, auf jedem Gerät gleich</span><span>{EMOJIS.length} Emojis</span></div>
    </div>,
    document.body,
  );
}
