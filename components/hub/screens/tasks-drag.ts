"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { TaskStatus } from "@/lib/hub-tasks/types";

/**
 * Dragging cards and rows with mouse, pen and finger (a finger holds a card for a moment first, so swiping still
 * scrolls). The page keeps rendering through React: it learns which card moves and where the gap is (`drag`), draws the
 * gap and hides the card. Only the floating copy under the pointer lives outside React. Neighbours slide into place
 * (FLIP), the board and long columns scroll along at their edges, Escape cancels.
 */

export type DragOver = { status: TaskStatus; index: number };
export type DragState = { id: string; over: DragOver | null; row: boolean };

type Live = {
  id: string;
  element: HTMLElement;
  pointer: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  timer: number;
  frame: number;
  ghost: HTMLElement | null;
  offsetX: number;
  offsetY: number;
  tilt: number;
  lastX: number;
  over: DragOver | null;
  row: boolean;
};

const HOLD_MS = 240;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 9;

export function useTaskDrag({ root, enabled, onDrop }: { root: RefObject<HTMLElement | null>; enabled: boolean; onDrop: (id: string, over: DragOver) => void }) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const live = useRef<Live | null>(null);
  const flip = useRef<Map<string, number> | null>(null);
  const suppressClick = useRef(0);
  const dropRef = useRef(onDrop);
  useEffect(() => { dropRef.current = onDrop; }, [onDrop]);

  // Neighbours glide to their new place after the gap moved.
  useLayoutEffect(() => {
    const before = flip.current;
    flip.current = null;
    const container = root.current;
    if (!before || !container) return;
    for (const element of container.querySelectorAll<HTMLElement>("[data-card]")) {
      const top = before.get(element.dataset.card ?? "");
      if (top === undefined) continue;
      const delta = top - element.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) continue;
      element.style.transition = "none";
      element.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        element.style.transition = "transform 180ms cubic-bezier(0.2, 0.7, 0.2, 1)";
        element.style.transform = "";
      });
    }
  }, [drag?.over?.status, drag?.over?.index, root]);

  useEffect(() => {
    const container = root.current;
    if (!container || !enabled) return;

    const targetAt = (x: number, y: number, id: string): DragOver | null => {
      let column = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-col]") ?? null;
      if (column && !container.contains(column)) column = null;
      if (!column) {
        const columns = [...container.querySelectorAll<HTMLElement>("[data-col]")];
        const board = container.querySelector<HTMLElement>(".kb-board");
        if (board) {
          const area = board.getBoundingClientRect();
          if (y > area.top - 40 && y < area.bottom + 40) column = columns.find((element) => { const rect = element.getBoundingClientRect(); return x >= rect.left - 6 && x <= rect.right + 6; }) ?? null;
        } else {
          column = columns.find((element) => { const rect = element.getBoundingClientRect(); return y >= rect.top && y <= rect.bottom; }) ?? null;
        }
      }
      if (!column) return null;
      const status = column.dataset.col as TaskStatus;
      if (column.dataset.collapsed === "true") return { status, index: 0 };
      const list = column.querySelector<HTMLElement>("[data-list]");
      const cards = list ? [...list.querySelectorAll<HTMLElement>("[data-card]")].filter((element) => element.dataset.card !== id) : [];
      let index = cards.length;
      for (let position = 0; position < cards.length; position++) {
        const rect = cards[position].getBoundingClientRect();
        if (y < rect.top + rect.height / 2) { index = position; break; }
      }
      return { status, index };
    };

    const remember = () => {
      const tops = new Map<string, number>();
      for (const element of container.querySelectorAll<HTMLElement>("[data-card]")) tops.set(element.dataset.card ?? "", element.getBoundingClientRect().top);
      flip.current = tops;
    };

    const place = (state: Live) => {
      if (!state.ghost) return;
      const velocity = Math.max(-6, Math.min(6, state.x - state.lastX));
      state.tilt = state.tilt * 0.7 + velocity * 0.35;
      state.lastX = state.x;
      const turn = state.row ? 0 : 1.5 + state.tilt;
      state.ghost.style.transform = `translate(${state.x - state.offsetX}px, ${state.y - state.offsetY}px) rotate(${turn.toFixed(2)}deg) scale(${state.row ? 1.01 : 1.03})`;
      const over = targetAt(state.x, state.y, state.id);
      if (!over) return;
      if (state.over && state.over.status === over.status && state.over.index === over.index) return;
      state.over = over;
      remember();
      setDrag({ id: state.id, over, row: state.row });
    };

    const scrollAlong = () => {
      const state = live.current;
      if (!state?.started) return;
      let moved = false;
      const board = container.querySelector<HTMLElement>(".kb-board");
      const edge = window.innerWidth < 760 ? 36 : 70;
      if (board) {
        const rect = board.getBoundingClientRect();
        const step = state.x < rect.left + edge ? -Math.ceil((rect.left + edge - state.x) / 3) : state.x > rect.right - edge ? Math.ceil((state.x - (rect.right - edge)) / 3) : 0;
        if (step) { board.scrollLeft += step; moved = true; }
      }
      const scroller = board
        ? (state.over ? container.querySelector<HTMLElement>(`[data-col="${state.over.status}"] [data-list]`) : null)
        : container.querySelector<HTMLElement>(".kb-lv");
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const zone = board ? 50 : 60;
        const step = state.y < rect.top + zone ? -Math.ceil((rect.top + zone - state.y) / 4) : state.y > rect.bottom - zone ? Math.ceil((state.y - (rect.bottom - zone)) / 4) : 0;
        if (step) { scroller.scrollTop += step; moved = true; }
      }
      if (moved) place(state);
      state.frame = requestAnimationFrame(scrollAlong);
    };

    const start = (state: Live) => {
      const rect = state.element.getBoundingClientRect();
      state.started = true;
      state.offsetX = state.x - rect.left;
      state.offsetY = state.y - rect.top;
      state.lastX = state.x;
      const ghost = state.element.cloneNode(true) as HTMLElement;
      ghost.classList.add("kb-ghost");
      if (state.row) ghost.classList.add("is-row");
      ghost.classList.remove("is-open", "is-lifting");
      ghost.removeAttribute("tabindex");
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.width = `${rect.width}px`;
      (container.closest(".hub-app") ?? document.body).appendChild(ghost);
      state.ghost = ghost;
      document.documentElement.classList.add("kb-dragging");
      const board = container.querySelector<HTMLElement>(".kb-board");
      if (board) board.style.scrollSnapType = "none";
      state.over = targetAt(state.x, state.y, state.id);
      setDrag({ id: state.id, over: state.over, row: state.row });
      if (navigator.vibrate) try { navigator.vibrate(10); } catch { /* not allowed here */ }
      place(state);
      state.frame = requestAnimationFrame(scrollAlong);
    };

    const finish = (commit: boolean) => {
      const state = live.current;
      if (!state) return;
      live.current = null;
      window.clearTimeout(state.timer);
      state.element.classList.remove("is-lifting");
      if (!state.started) return;
      cancelAnimationFrame(state.frame);
      suppressClick.current = Date.now();
      document.documentElement.classList.remove("kb-dragging");
      const board = container.querySelector<HTMLElement>(".kb-board");
      if (board) board.style.scrollSnapType = "";
      const ghost = state.ghost;
      const over = commit ? state.over : null;
      const gap = container.querySelector<HTMLElement>(".kb-placeholder");
      const done = () => {
        ghost?.remove();
        setDrag(null);
        if (over) dropRef.current(state.id, over);
      };
      if (ghost && over && gap) {
        const rect = gap.getBoundingClientRect();
        ghost.style.transition = "transform 150ms cubic-bezier(0.2, 0.7, 0.2, 1)";
        ghost.style.transform = `translate(${rect.left}px, ${rect.top}px) rotate(0deg) scale(1)`;
        window.setTimeout(done, 140);
      } else done();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (live.current || event.button !== 0) return;
      const target = event.target as HTMLElement;
      const element = target.closest<HTMLElement>("[data-card]");
      if (!element || !container.contains(element) || target.closest("button, a, input, textarea, select, label, [data-no-drag]")) return;
      const state: Live = {
        id: element.dataset.card ?? "",
        element,
        pointer: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        started: false,
        timer: 0,
        frame: 0,
        ghost: null,
        offsetX: 0,
        offsetY: 0,
        tilt: 0,
        lastX: event.clientX,
        over: null,
        row: element.classList.contains("kb-row"),
      };
      live.current = state;
      if (event.pointerType !== "mouse") {
        element.classList.add("is-lifting");
        state.timer = window.setTimeout(() => { if (live.current === state && !state.started) { element.classList.remove("is-lifting"); start(state); } }, HOLD_MS);
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
        else if (state.pointer !== "mouse" && distance > TOUCH_SLOP) { window.clearTimeout(state.timer); state.element.classList.remove("is-lifting"); live.current = null; }
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

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("keydown", onKey, true);
    return () => {
      finish(false);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [root, enabled]);

  /** True right after a drag: the click that ends it must not open the card. */
  const justDragged = () => Date.now() - suppressClick.current < 250;
  return { drag, justDragged };
}
