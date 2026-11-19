"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Dragging files in the Asset Management (user 19.11.2026), with mouse, pen and finger (a finger holds a row for a
 * moment first, so swiping still scrolls), like the task board (tasks-drag.ts). A row with `data-drag-file` starts a
 * drag; it carries the ticked files when the row is ticked, else just its own. Targets are the customers in the list
 * (`data-drop-customer`) and the folders of the open customer (`data-drop-folder`). Only the floating stack under the
 * pointer lives outside React; the page learns which files move and which target is under them (`drag`). The customer
 * list and the files scroll along at their edges, Escape cancels.
 */

export type FileDropTarget = { kind: "customer"; id: string } | { kind: "folder"; key: string };
export type FileDragState = { ids: string[]; over: FileDropTarget | null };

type Live = {
  id: string;
  row: HTMLElement;
  pointer: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  lastX: number;
  tilt: number;
  started: boolean;
  timer: number;
  frame: number;
  ids: string[];
  ghost: HTMLElement | null;
  tag: HTMLElement | null;
  over: FileDropTarget | null;
};

const HOLD_MS = 240;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 9;
const same = (a: FileDropTarget | null, b: FileDropTarget | null) => a === b || (a !== null && b !== null && a.kind === b.kind && (a.kind === "customer" ? a.id === (b as typeof a).id : a.key === (b as typeof a).key));

export function useFileDrag({ root, enabled, idsFor, canDrop, describe, hint, onDrop }: {
  root: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** The files a drag of this row carries: the ticked ones when the row is ticked, else only its own. */
  idsFor: (id: string) => string[];
  /** Whether files may land here (the customer they come from does not take them). */
  canDrop: (target: FileDropTarget) => boolean;
  /** The line under the stack while it hovers a target ("Zu Studio Horizont"). */
  describe: (target: FileDropTarget) => string;
  /** The line under the stack while it hovers nothing ("Links auf einen Kunden ziehen"). */
  hint: string;
  onDrop: (ids: string[], target: FileDropTarget) => void;
}) {
  const [drag, setDrag] = useState<FileDragState | null>(null);
  const live = useRef<Live | null>(null);
  const quiet = useRef(0);
  const callbacks = useRef({ idsFor, canDrop, describe, hint, onDrop });
  useEffect(() => { callbacks.current = { idsFor, canDrop, describe, hint, onDrop }; }, [idsFor, canDrop, describe, hint, onDrop]);

  useEffect(() => {
    const container = root.current;
    if (!container || !enabled) return;

    const targetAt = (x: number, y: number): FileDropTarget | null => {
      const element = document.elementFromPoint(x, y);
      if (!element || !container.contains(element) || element.closest(".am-panel")) return null;
      const customer = element.closest<HTMLElement>("[data-drop-customer]")?.dataset.dropCustomer;
      const folder = element.closest<HTMLElement>("[data-drop-folder]")?.dataset.dropFolder;
      const target: FileDropTarget | null = customer ? { kind: "customer", id: customer } : folder ? { kind: "folder", key: folder } : null;
      return target && callbacks.current.canDrop(target) ? target : null;
    };

    const label = (state: Live) => {
      if (!state.tag) return;
      state.tag.classList.toggle("is-on", state.over !== null);
      state.tag.textContent = state.over ? callbacks.current.describe(state.over) : callbacks.current.hint;
    };

    const place = (state: Live) => {
      if (!state.ghost) return;
      const velocity = Math.max(-8, Math.min(8, state.x - state.lastX));
      state.tilt = state.tilt * 0.7 + velocity * 0.3;
      state.lastX = state.x;
      state.ghost.style.transform = `translate(${state.x - 18}px, ${state.y - 22}px) rotate(${(1.2 + state.tilt * 0.5).toFixed(2)}deg)`;
      const over = targetAt(state.x, state.y);
      if (same(over, state.over)) return;
      state.over = over;
      label(state);
      setDrag({ ids: state.ids, over });
    };

    // The customer list and the files scroll along while the stack rests near their top or bottom edge.
    const scrollAlong = () => {
      const state = live.current;
      if (!state?.started) return;
      let moved = false;
      for (const box of container.querySelectorAll<HTMLElement>(".chat-convs, .am-scroll")) {
        if (box.scrollHeight <= box.clientHeight + 1) continue;
        const rect = box.getBoundingClientRect();
        if (state.x < rect.left - 24 || state.x > rect.right + 24 || rect.height === 0) continue;
        const zone = 56;
        const step = state.y < rect.top + zone ? -Math.ceil((rect.top + zone - state.y) / 4) : state.y > rect.bottom - zone ? Math.ceil((state.y - (rect.bottom - zone)) / 4) : 0;
        if (!step) continue;
        const before = box.scrollTop;
        box.scrollTop += Math.max(-22, Math.min(22, step));
        if (box.scrollTop !== before) moved = true;
      }
      if (moved) place(state);
      state.frame = requestAnimationFrame(scrollAlong);
    };

    const start = (state: Live) => {
      state.started = true;
      state.ids = callbacks.current.idsFor(state.id);
      const ghost = document.createElement("div");
      ghost.className = "am-ghost";
      ghost.setAttribute("aria-hidden", "true");
      const stack = document.createElement("div");
      stack.className = `am-ghost-stack${state.ids.length > 1 ? " is-many" : ""}`;
      const card = document.createElement("div");
      card.className = "am-ghost-card";
      const lead = document.createElement("span");
      lead.className = `am-min-lead am-cat-${state.row.dataset.dragCat ?? "other"}`;
      const symbol = state.row.querySelector("svg");
      if (symbol) lead.appendChild(symbol.cloneNode(true));
      const title = document.createElement("span");
      title.className = "am-ghost-title";
      title.textContent = state.row.dataset.dragTitle ?? "";
      card.append(lead, title);
      stack.appendChild(card);
      if (state.ids.length > 1) {
        const count = document.createElement("span");
        count.className = "am-ghost-count";
        count.textContent = String(state.ids.length);
        stack.appendChild(count);
      }
      const tag = document.createElement("div");
      tag.className = "am-ghost-tag";
      ghost.append(stack, tag);
      (container.closest(".hub-app") ?? document.body).appendChild(ghost);
      state.ghost = ghost;
      state.tag = tag;
      document.documentElement.classList.add("am-dragging");
      label(state);
      setDrag({ ids: state.ids, over: null });
      if (state.pointer !== "mouse" && navigator.vibrate) try { navigator.vibrate(10); } catch { /* not allowed here */ }
      place(state);
      state.frame = requestAnimationFrame(scrollAlong);
    };

    const finish = (commit: boolean) => {
      const state = live.current;
      if (!state) return;
      live.current = null;
      window.clearTimeout(state.timer);
      state.row.classList.remove("is-lifting");
      if (!state.started) return;
      cancelAnimationFrame(state.frame);
      quiet.current = Date.now();
      document.documentElement.classList.remove("am-dragging");
      const over = commit ? state.over : null;
      const ghost = state.ghost;
      setDrag(null);
      if (over) {
        // The stack sinks into its target; the page shows the result (or asks first) right away.
        ghost?.classList.add("is-landing");
        window.setTimeout(() => ghost?.remove(), 220);
        callbacks.current.onDrop(state.ids, over);
        return;
      }
      const home = state.row.isConnected ? state.row.getBoundingClientRect() : null;
      if (ghost && home) {
        ghost.classList.add("is-returning");
        ghost.style.transform = `translate(${home.left + 8}px, ${home.top + 4}px)`;
        window.setTimeout(() => ghost.remove(), 200);
      } else ghost?.remove();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (live.current || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-drag-file]");
      if (!row || !container.contains(row) || target.closest("input, a, select, textarea, [data-no-drag]")) return;
      const state: Live = { id: row.dataset.dragFile ?? "", row, pointer: event.pointerType, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, lastX: event.clientX, tilt: 0, started: false, timer: 0, frame: 0, ids: [], ghost: null, tag: null, over: null };
      live.current = state;
      if (event.pointerType !== "mouse") {
        row.classList.add("is-lifting");
        state.timer = window.setTimeout(() => { if (live.current === state && !state.started) { row.classList.remove("is-lifting"); start(state); } }, HOLD_MS);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const state = live.current;
      if (!state) return;
      state.x = event.clientX;
      state.y = event.clientY;
      if (!state.started) {
        const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
        if (state.pointer === "mouse" && distance > MOUSE_SLOP) start(state);
        else if (state.pointer !== "mouse" && distance > TOUCH_SLOP) { window.clearTimeout(state.timer); state.row.classList.remove("is-lifting"); live.current = null; }
        return;
      }
      event.preventDefault();
      place(state);
    };
    const onPointerUp = (event: PointerEvent) => {
      const state = live.current;
      if (!state) return;
      if (state.started) { state.x = event.clientX; state.y = event.clientY; place(state); }
      finish(true);
    };
    const onCancel = () => finish(false);
    const onTouchMove = (event: TouchEvent) => { if (live.current?.started) event.preventDefault(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && live.current?.started) { event.preventDefault(); event.stopPropagation(); finish(false); } };
    const onContextMenu = (event: Event) => { if (live.current) event.preventDefault(); };
    // The click that ends a drag opens nothing (a file's details, a customer).
    const onClick = (event: MouseEvent) => { if (Date.now() - quiet.current < 250) { event.preventDefault(); event.stopPropagation(); } };
    const onDragStart = (event: DragEvent) => { if (live.current) event.preventDefault(); };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("contextmenu", onContextMenu);
    container.addEventListener("click", onClick, true);
    container.addEventListener("dragstart", onDragStart);
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("keydown", onKey, true);
    return () => {
      finish(false);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("contextmenu", onContextMenu);
      container.removeEventListener("click", onClick, true);
      container.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [root, enabled]);

  return { drag };
}
