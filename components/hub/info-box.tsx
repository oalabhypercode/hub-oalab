"use client";

import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { ShellContext } from "./shell-context";

/**
 * What an ⓘ says: at most three short steps, each led by a bold word or two, an optional warning, and the question
 * „Mehr dazu im Assistenten“ asks. The details live in the assistant's knowledge (lib/hub-assistant/knowledge.ts).
 */
export type InfoCard = { steps: React.ReactNode[]; warn?: React.ReactNode; ask: string };

/** The card is this wide on larger screens (glass.css); phones show it as a sheet at the bottom. */
const CARD_WIDTH = 316;
const GAP = 8;

const noSubscription = () => () => {};
/** The Popover API puts the card above everything (page, scrolling panes, open dialogs); older browsers show it inline. */
const popoverSupported = () => typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

/** Next to its ⓘ, below it or above it when there is no room, never past the screen edges. */
function place(card: HTMLElement, button: HTMLElement) {
  if (window.matchMedia("(max-width: 767px)").matches) return;
  const rect = button.getBoundingClientRect();
  const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * GAP);
  const left = Math.min(Math.max(GAP, rect.right + 10 - width), window.innerWidth - width - GAP);
  const height = card.offsetHeight;
  const above = height > 0 && rect.bottom + GAP + height > window.innerHeight - GAP && rect.top - GAP - height > GAP;
  card.style.left = `${left}px`;
  card.style.top = `${above ? rect.top - GAP - height : rect.bottom + GAP}px`;
  card.style.setProperty("--info-arrow", `${rect.left + rect.width / 2 - left}px`);
  card.dataset.side = above ? "above" : "below";
}

/**
 * The ⓘ next to a feature and its card „Kurz erklärt“. Rule of the user since 5.11.2026: every feature beyond plain
 * viewing gets one; since 6.11.2026 the card says it in at most three short lines and hands everything else to the
 * assistant. The card floats above the page, so opening it shifts nothing. The caller places both parts: the button
 * next to the heading or label, the box in the block below (inside a dialog, so the card belongs to it).
 *
 *   const info = useInfo("Vertragsvorlagen", { steps: [<><b>Blanko</b> zum Ausfüllen von Hand.</>], ask: "Wie funktionieren die Vertragsvorlagen?" });
 *   <h3>Vertragsvorlagen{info.button}</h3>
 *   {info.box}
 */
export function useInfo(title: string, card: InfoCard) {
  const [open, setOpen] = useState(false);
  const floating = useSyncExternalStore(noSubscription, popoverSupported, () => false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const shell = useContext(ShellContext);

  // The browser opens and closes the card (the ⓘ is its invoker, Escape and a click elsewhere close it); the page
  // only places it and mirrors the state. While the page scrolls the card follows its ⓘ and closes once the ⓘ is
  // gone; on phones it stays where it is, at the bottom.
  useEffect(() => {
    const element = cardRef.current;
    const button = buttonRef.current;
    if (!floating || !element || !button) return;
    const follow = () => {
      if (!element.matches(":popover-open") || window.matchMedia("(max-width: 767px)").matches) return;
      const rect = button.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight || (rect.width === 0 && rect.height === 0)) element.hidePopover();
      else place(element, button);
    };
    const before = (event: Event) => { if ((event as ToggleEvent).newState === "open") place(element, button); };
    const toggle = (event: Event) => {
      const now = (event as ToggleEvent).newState === "open";
      setOpen(now);
      if (now) {
        place(element, button);
        window.addEventListener("scroll", follow, true);
        window.addEventListener("resize", follow);
      } else {
        window.removeEventListener("scroll", follow, true);
        window.removeEventListener("resize", follow);
      }
    };
    element.addEventListener("beforetoggle", before);
    element.addEventListener("toggle", toggle);
    return () => {
      element.removeEventListener("beforetoggle", before);
      element.removeEventListener("toggle", toggle);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [floating]);

  const hide = () => {
    if (floating) cardRef.current?.hidePopover();
    else setOpen(false);
  };

  const button = (
    <button
      ref={buttonRef}
      type="button"
      className="info-button"
      aria-expanded={open}
      aria-controls={id}
      aria-label={`Kurz erklärt: ${title}`}
      title={`Kurz erklärt: ${title}`}
      popoverTarget={floating ? id : undefined}
      onClick={floating ? undefined : () => setOpen((now) => !now)}
    >
      <Info size={15} strokeWidth={2.4} aria-hidden="true" />
    </button>
  );

  const content = (
    <>
      <div className="info-card-head">
        <strong>{title}</strong>
        <span className="info-card-kicker">Kurz erklärt</span>
        <button type="button" className="info-card-close" aria-label="Schließen" onClick={hide}><X size={14} aria-hidden="true" /></button>
      </div>
      <ol className="info-card-steps">{card.steps.map((step, index) => <li key={index}><span>{step}</span></li>)}</ol>
      {card.warn && <div className="info-card-warn"><TriangleAlert size={15} aria-hidden="true" /><span>{card.warn}</span></div>}
      {shell && (
        <div className="info-card-foot">
          <button type="button" className="info-card-ask" onClick={() => { hide(); shell.askAssistant(card.ask); }}>
            <Sparkles size={15} aria-hidden="true" />Mehr dazu im Assistenten
          </button>
        </div>
      )}
    </>
  );

  const box = floating
    ? <div ref={cardRef} id={id} popover="auto" className="info-card" role="dialog" aria-label={title}>{content}</div>
    : open ? <div id={id} className="info-card is-inline" role="dialog" aria-label={title}>{content}</div> : null;
  return { button, box, open };
}
