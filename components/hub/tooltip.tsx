"use client";

import { useEffect } from "react";

/**
 * The hub's hover hints instead of the browser's title tooltips (user 12.11.2026, proposal A „Studio“): a small dark
 * label with an arrow, in the hub's font. An element asks for one with data-tip (the text), data-tip-sub (a second,
 * lighter line) and data-tip-kbd (a shortcut), or with data-tip-compact for a button whose text may hide. One layer serves the whole hub: the hint shows after 0.4 s, at once when
 * the pointer moves on to a neighbour, also on keyboard focus, and hides on click, scrolling and Escape. A hint that
 * changes while the pointer rests on its element ("Kopieren" → "Kopiert") shows the new text. Phones get none.
 */

const DELAY = 400;
const WARM = 300;
const GAP = 9;
const EDGE = 8;
const TIP_ID = "hub-tip";

export function TooltipLayer() {
  useEffect(() => {
    const floating = "showPopover" in HTMLElement.prototype;
    const tip = document.createElement("div");
    tip.className = "hub-tip";
    tip.id = TIP_ID;
    tip.setAttribute("role", "tooltip");
    // The top layer keeps the hint above lists, panels and open dialogs; older browsers get a plain fixed box.
    if (floating) tip.setAttribute("popover", "manual");
    else tip.hidden = true;
    document.body.append(tip);

    let anchor: HTMLElement | null = null;
    let hovered: HTMLElement | null = null;
    let timer = 0;
    let hiddenAt = 0;
    let pressedAt = 0;
    let described: { element: HTMLElement; before: string | null } | null = null;

    // data-tip-compact names a button only while its text (data-tip-label) is hidden, when a narrow pane shows the
    // symbol alone; next to its visible text a hint would only repeat it.
    const labelHidden = (element: HTMLElement) => {
      const label = element.querySelector<HTMLElement>("[data-tip-label]");
      return !label || label.getClientRects().length === 0 || label.getBoundingClientRect().width <= 1;
    };
    const textOf = (element: HTMLElement) => element.dataset.tipCompact !== undefined
      ? (labelHidden(element) ? element.dataset.tipCompact.trim() : "")
      : element.dataset.tip?.trim() ?? "";
    const isOpen = () => (floating ? tip.matches(":popover-open") : !tip.hidden);
    const tipTarget = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>("[data-tip], [data-tip-compact]") : null);

    const render = (element: HTMLElement) => {
      const title = document.createElement("span");
      title.className = "hub-tip-title";
      title.textContent = textOf(element);
      if (element.dataset.tipKbd) {
        const kbd = document.createElement("kbd");
        kbd.textContent = element.dataset.tipKbd;
        title.append(kbd);
      }
      const parts: Node[] = [title];
      if (element.dataset.tipSub) {
        const sub = document.createElement("small");
        sub.textContent = element.dataset.tipSub;
        parts.push(sub);
      }
      tip.replaceChildren(...parts);
    };

    // Above the element, centred, below it when the screen edge is too close; the arrow keeps pointing at it.
    const place = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      tip.style.left = "0px";
      tip.style.top = "0px";
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const below = rect.top - GAP - height < EDGE;
      const left = Math.min(Math.max(EDGE, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - EDGE);
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(below ? rect.bottom + GAP : rect.top - GAP - height)}px`;
      tip.style.setProperty("--tip-arrow", `${Math.round(rect.left + rect.width / 2 - left)}px`);
      tip.dataset.side = below ? "below" : "above";
    };

    // Screen readers hear the hint as the element's description, unless it only repeats the element's name.
    const describe = (element: HTMLElement) => {
      const name = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
      if (name === textOf(element) && !element.dataset.tipSub) return;
      const before = element.getAttribute("aria-describedby");
      element.setAttribute("aria-describedby", before ? `${before} ${TIP_ID}` : TIP_ID);
      described = { element, before };
    };
    const undescribe = () => {
      if (!described) return;
      if (described.before === null) described.element.removeAttribute("aria-describedby");
      else described.element.setAttribute("aria-describedby", described.before);
      described = null;
    };

    const hide = () => {
      window.clearTimeout(timer);
      undescribe();
      if (isOpen()) {
        if (floating) tip.hidePopover();
        else tip.hidden = true;
        hiddenAt = Date.now();
      }
      anchor = null;
    };

    const show = (element: HTMLElement) => {
      if (!element.isConnected || !textOf(element)) return;
      // A field whose list is open needs no hint on top of it.
      if (element.getAttribute("aria-expanded") === "true" || element.querySelector('[aria-expanded="true"]')) return;
      undescribe();
      anchor = element;
      // Inside an open dialog the hint belongs to the dialog, so the dialog does not make it inert.
      const host = element.closest("dialog[open]") ?? document.body;
      if (floating && tip.matches(":popover-open")) tip.hidePopover();
      if (tip.parentElement !== host) host.append(tip);
      render(element);
      if (floating) tip.showPopover();
      else tip.hidden = false;
      place(element);
      describe(element);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const element = tipTarget(event.target);
      hovered = element;
      if (element === anchor) return;
      window.clearTimeout(timer);
      const warm = isOpen() || Date.now() - hiddenAt < WARM;
      if (anchor) hide();
      if (element) timer = window.setTimeout(() => show(element), warm ? 0 : DELAY);
    };
    const onOut = (event: PointerEvent) => {
      // The pointer left the window.
      if (event.relatedTarget === null) { hovered = null; hide(); }
    };
    const onDown = () => {
      pressedAt = Date.now();
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const element = tipTarget(event.target);
      if (!element || !(event.target instanceof Element)) return;
      let visible = false;
      try { visible = event.target.matches(":focus-visible"); } catch { /* old browsers: no hint on focus */ }
      if (!visible) return;
      window.clearTimeout(timer);
      show(element);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (anchor && event.target instanceof Node && anchor.contains(event.target)) hide();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };

    // A hint that changes under the pointer shows its new text: after a click ("Kopiert") or while it is visible.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const element = mutation.target;
        if (!(element instanceof HTMLElement)) continue;
        if (element === anchor) {
          if (!textOf(element)) { hide(); continue; }
          render(element);
          place(element);
        } else if (element === hovered && Date.now() - pressedAt < 2000) {
          window.clearTimeout(timer);
          show(element);
        }
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-tip", "data-tip-sub"] });

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      observer.disconnect();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
      tip.remove();
    };
  }, []);
  return null;
}
