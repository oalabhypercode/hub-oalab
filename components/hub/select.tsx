"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { matchesSearch } from "@/lib/table-tools";
import { edgeIndex, highlightParts, SEARCH_FROM, stepIndex, typeaheadIndex } from "@/lib/select-keys";

/**
 * The hub's own lists instead of the browser's (user 12.11.2026, proposal A „Studio“): the field stays as it was, the list
 * opens as a white sheet like the tables, with a tick at the choice, a search field on long lists and the keyboard
 * of a native select. It floats above everything (Popover API, like the ⓘ cards), so no panel, table or dialog cuts it
 * off; phones show it as a sheet at the bottom (glass.css).
 */

export type SelectOption = {
  value: string;
  label: string;
  /** In front of the label, in the list and in the field while chosen: an icon, a colour dot or a logo. */
  lead?: React.ReactNode;
  /** Muted text in front of the label, a customer number for example. */
  prefix?: string;
  /** Muted text at the end of the row. */
  meta?: string;
  /** Heading of a group; it shows above the first option of the group. */
  group?: string;
  disabled?: boolean;
};

const noSubscription = () => () => {};
const popoverSupported = () => typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;
const isPhone = () => window.matchMedia("(max-width: 767px)").matches;
const GAP = 6;
const EDGE = 8;

/**
 * Under its field, above it when there is more room there, never past the screen edges. On phones a select keeps the
 * sheet at the bottom from the CSS; suggestions stay under their field, above the keyboard.
 */
function placeList(list: HTMLElement, anchor: HTMLElement, matchWidth: boolean) {
  for (const key of ["left", "top", "width", "minWidth", "maxWidth", "maxHeight"] as const) list.style[key] = "";
  if (isPhone() && !list.classList.contains("is-suggest")) return;
  const rect = anchor.getBoundingClientRect();
  // A form field's list is exactly as wide as the field; other lists grow with their longest option.
  if (matchWidth) Object.assign(list.style, { width: `${rect.width}px`, maxWidth: `${window.innerWidth - 2 * EDGE}px` });
  else list.style.minWidth = `${Math.max(rect.width, 200)}px`;
  const below = window.innerHeight - rect.bottom - GAP - EDGE;
  const above = rect.top - GAP - EDGE;
  const height = list.offsetHeight;
  const up = height > below && above > below;
  list.style.maxHeight = `${Math.max(140, Math.floor(up ? above : below))}px`;
  const width = list.offsetWidth;
  list.style.left = `${Math.round(Math.min(Math.max(EDGE, rect.left), window.innerWidth - width - EDGE))}px`;
  list.style.top = `${Math.round(up ? rect.top - GAP - list.offsetHeight : rect.bottom + GAP)}px`;
  list.dataset.side = up ? "above" : "below";
}

/** Keeps the floating list at its field while the page scrolls; closes it once the field is gone. */
function useFollow(open: boolean, list: React.RefObject<HTMLElement | null>, anchor: React.RefObject<HTMLElement | null>, matchWidth: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const follow = (event?: Event) => {
      const element = list.current;
      const field = anchor.current;
      if (!element || !field) return;
      // Scrolling inside the list itself must not move it.
      if (event && event.target instanceof Node && element.contains(event.target)) return;
      const rect = field.getBoundingClientRect();
      const sheet = isPhone() && !element.classList.contains("is-suggest");
      if (!sheet && (rect.bottom < 0 || rect.top > window.innerHeight || (rect.width === 0 && rect.height === 0))) close();
      else placeList(element, field, matchWidth);
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => { window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow); };
  }, [open, list, anchor, matchWidth, close]);
}

/** A click inside the list must not reach a surrounding <label>, which would click the field again and reopen the list. */
const keepInside = {
  onClick: (event: React.MouseEvent) => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); },
  onMouseDown: (event: React.MouseEvent) => { if (event.target instanceof Element && event.target.closest(".hub-option")) event.preventDefault(); },
};

export function Select({ value, onChange, options, label, placeholder, disabled = false, variant = "field", chevron = variant === "field", showLead = variant === "field", search = "auto", searchPlaceholder, className, id }: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** The field's name: read out with the value, and the heading of the sheet on phones. */
  label: string;
  /** Shown while no option has the value ("Verschieben nach …"). */
  placeholder?: string;
  disabled?: boolean;
  /** "field": a form field like the inputs next to it. "bare": only the text; the wrapper around it draws the box. */
  variant?: "field" | "bare";
  /** The double arrow at the end; wrappers that draw their own arrow leave it out. */
  chevron?: boolean;
  /** Shows the chosen option's lead (colour dot, logo) in the field; wrappers draw their own icon, so "bare" leaves it out. */
  showLead?: boolean;
  /** Search field on top; "auto" from more than ten options on. */
  search?: boolean | "auto";
  searchPlaceholder?: string;
  className?: string;
  id?: string;
}) {
  const floating = useSyncExternalStore(noSubscription, popoverSupported, () => false);
  const baseId = useId();
  const popId = `${baseId}-pop`;
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  const searchable = search === "auto" ? options.length > SEARCH_FROM : search;
  const selected = options.find((option) => option.value === value);
  const shown = query ? options.filter((option) => matchesSearch(query, [option.label, option.prefix, option.meta])) : options;
  const disabledFlags = shown.map((option) => Boolean(option.disabled));
  const matchWidth = variant === "field";

  const hide = () => {
    if (floating) { if (popRef.current?.matches(":popover-open")) popRef.current.hidePopover(); }
    else setOpen(false);
  };
  const show = () => {
    if (disabled) return;
    if (floating) { if (!popRef.current?.matches(":popover-open")) popRef.current?.showPopover(); }
    else { setOpen(true); setQuery(""); setActive(options.findIndex((option) => option.value === value)); }
  };
  const choose = (option: SelectOption | undefined) => {
    if (!option || option.disabled) return;
    hide();
    triggerRef.current?.focus({ preventScroll: true });
    if (option.value !== value) onChange(option.value);
  };

  // The browser opens and closes the list (the field is its invoker; Escape and a click elsewhere close it); the
  // component mirrors the state, starts at the current choice and places the list.
  useEffect(() => {
    const element = popRef.current;
    if (!floating || !element) return;
    const before = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      setQuery("");
      setActive(options.findIndex((option) => option.value === value));
    };
    const toggle = (event: Event) => {
      const now = (event as ToggleEvent).newState === "open";
      setOpen(now);
      // Until it is placed again the list stays invisible (glass.css), so it never flashes in the middle of the screen.
      if (!now) delete element.dataset.side;
      // Safari does not focus a clicked button; the arrow keys need the field.
      else if (!element.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true });
    };
    element.addEventListener("beforetoggle", before);
    element.addEventListener("toggle", toggle);
    return () => { element.removeEventListener("beforetoggle", before); element.removeEventListener("toggle", toggle); };
  }, [floating, options, value]);

  useLayoutEffect(() => {
    if (!open || !popRef.current || !triggerRef.current) return;
    placeList(popRef.current, triggerRef.current, matchWidth);
  }, [open, shown.length, matchWidth]);

  useEffect(() => {
    if (open && searchable && !isPhone()) searchRef.current?.focus({ preventScroll: true });
  }, [open, searchable]);

  // The marked option stays in view while the arrow keys move through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    const box = scrollRef.current;
    const row = document.getElementById(optionId(active));
    if (!box || !row || !box.contains(row)) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop - 4;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight + 4;
  });

  useFollow(open, popRef, triggerRef, matchWidth, hide);

  const onKey = (event: React.KeyboardEvent) => {
    if (disabled) return;
    const fromSearch = event.target instanceof HTMLInputElement;
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
      else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Typing on the closed field opens the list at the first fitting option.
        show();
        typed.current = { text: event.key, at: Date.now() };
        if (searchable) setQuery(event.key);
        else setActive(typeaheadIndex(options.map((option) => option.label), options.map((option) => Boolean(option.disabled)), event.key, -1));
        event.preventDefault();
      }
      return;
    }
    // Keys the open list uses stay with it: no form around it submits, no dialog saves on Enter.
    const take = () => { event.preventDefault(); event.stopPropagation(); };
    switch (event.key) {
      case "ArrowDown": take(); setActive((now) => stepIndex(disabledFlags, now, 1)); return;
      case "ArrowUp": take(); setActive((now) => stepIndex(disabledFlags, now, -1)); return;
      case "Home": case "PageUp": if (fromSearch && event.key === "Home") return; take(); setActive(edgeIndex(disabledFlags, "first")); return;
      case "End": case "PageDown": if (fromSearch && event.key === "End") return; take(); setActive(edgeIndex(disabledFlags, "last")); return;
      case "Enter": take(); choose(shown[active]); return;
      case " ": if (fromSearch) return; take(); choose(shown[active]); return;
      case "Escape":
        // Closes only the list: no dialog or panel around it closes with it.
        event.preventDefault();
        event.stopPropagation();
        hide();
        triggerRef.current?.focus({ preventScroll: true });
        return;
      case "Tab": hide(); return;
    }
    if (!fromSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typed.current = { text: now - typed.current.at > 600 ? event.key : typed.current.text + event.key, at: now };
      const index = typeaheadIndex(shown.map((option) => option.label), disabledFlags, typed.current.text, active);
      if (index >= 0) setActive(index);
    }
  };

  const triggerLabel = `${label}: ${selected ? `${selected.prefix ? `${selected.prefix} ` : ""}${selected.label}` : placeholder ?? "keine Auswahl"}`;
  const activeId = open && active >= 0 && shown[active] ? optionId(active) : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`hub-select-trigger is-${variant}${className ? ` ${className}` : ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={triggerLabel}
        aria-activedescendant={searchable ? undefined : activeId}
        disabled={disabled}
        popoverTarget={floating ? popId : undefined}
        onClick={floating ? undefined : () => (open ? hide() : show())}
        onKeyDown={onKey}
      >
        {showLead && selected?.lead && <span className="hub-select-lead">{selected.lead}</span>}
        <span className="hub-select-value">
          {selected ? <>{selected.prefix && <span className="hub-select-prefix">{selected.prefix}</span>}{selected.label}</> : <span className="hub-select-placeholder">{placeholder}</span>}
        </span>
        {chevron && <ChevronsUpDown className="hub-select-chevron" size={variant === "field" ? 16 : 14} aria-hidden="true" />}
      </button>
      <div
        ref={popRef}
        id={popId}
        popover={floating ? "auto" : undefined}
        className={`hub-list${floating ? "" : " is-inline"}${searchable ? " has-search" : ""}`}
        hidden={!floating && !open}
        {...keepInside}
      >
        <div className="hub-list-head"><strong>{label}</strong><button type="button" className="hub-list-close" aria-label="Schließen" onClick={hide}><X size={16} aria-hidden="true" /></button></div>
        {searchable && (
          <div className="hub-list-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(event.target.value ? 0 : -1); }}
              onKeyDown={onKey}
              placeholder={searchPlaceholder ?? "Suchen …"}
              role="combobox"
              aria-label={`${label} durchsuchen`}
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        <div ref={scrollRef} id={listId} className="hub-list-options" role="listbox" aria-label={label}>
          {shown.map((option, index) => (
            <Fragment key={`${option.value}-${index}`}>
              {!query && option.group && option.group !== shown[index - 1]?.group && <div className="hub-list-group" role="presentation">{option.group}</div>}
              <div
                id={optionId(index)}
                className={`hub-option${index === active ? " is-active" : ""}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                onClick={() => choose(option)}
                onMouseMove={() => { if (index !== active && !option.disabled) setActive(index); }}
              >
                {option.lead && <span className="hub-option-lead">{option.lead}</span>}
                <span className="hub-option-text">{option.prefix && <span className="hub-option-prefix">{option.prefix}</span>}{option.label}</span>
                {option.meta && <span className="hub-option-meta">{option.meta}</span>}
                <Check className="hub-option-check" size={15} aria-hidden="true" />
              </div>
            </Fragment>
          ))}
          {shown.length === 0 && <p className="hub-list-empty">Kein Treffer</p>}
        </div>
        {searchable && <div className="hub-list-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> wählen</span><span><kbd>↵</kbd> übernehmen</span><span><kbd>esc</kbd> schließen</span></div>}
      </div>
    </>
  );
}

/**
 * A text field with suggestions while typing, instead of the browser's datalist: free text stays possible, the list only
 * offers what was used before (providers, partners). The typed part shows in bold.
 */
export function SuggestInput({ value, onValueChange, suggestions, label, ...input }: {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: readonly string[];
  /** The field's name, for the list of suggestions. */
  label: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list" | "role">) {
  const floating = useSyncExternalStore(noSubscription, popoverSupported, () => false);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const typedText = value.trim();
  const matches = suggestions.filter((item) => item !== value && (!typedText || matchesSearch(typedText, [item]))).slice(0, 8);
  const visible = open && matches.length > 0;

  useLayoutEffect(() => {
    const element = popRef.current;
    if (!floating || !element || !inputRef.current) return;
    if (visible) {
      if (!element.matches(":popover-open")) element.showPopover();
      placeList(element, inputRef.current, true);
    } else if (element.matches(":popover-open")) element.hidePopover();
  }, [floating, visible, matches.length]);

  useFollow(visible, popRef, inputRef, true, () => setOpen(false));

  const pick = (item: string | undefined) => {
    if (item === undefined) return;
    onValueChange(item);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    input.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!visible) { setOpen(true); setActive(-1); return; }
      setActive((now) => stepIndex(matches.map(() => false), now, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && visible && active >= 0) {
      // Takes the suggestion only; a dialog that saves on Enter does not see this one.
      event.preventDefault();
      event.stopPropagation();
      pick(matches[active]);
    } else if (event.key === "Escape" && visible) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") setOpen(false);
  };

  return (
    <>
      <input
        {...input}
        ref={inputRef}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        onChange={(event) => { onValueChange(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={onKeyDown}
        onClick={(event) => { input.onClick?.(event); setOpen(true); }}
        onBlur={(event) => { input.onBlur?.(event); setOpen(false); }}
      />
      <div ref={popRef} popover={floating ? "manual" : undefined} className={`hub-list is-suggest${floating ? "" : " is-inline"}`} hidden={!floating && !visible} {...keepInside}>
        <div id={listId} className="hub-list-options" role="listbox" aria-label={`Vorschläge für ${label}`}>
          {matches.map((item, index) => (
            <div key={item} id={optionId(index)} className={`hub-option${index === active ? " is-active" : ""}`} role="option" aria-selected={index === active} onClick={() => pick(item)} onMouseMove={() => setActive(index)}>
              <span className="hub-option-text">{highlightParts(item, typedText).map((part, at) => part.hit ? <b key={at}>{part.text}</b> : <Fragment key={at}>{part.text}</Fragment>)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
