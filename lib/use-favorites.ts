"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { defaultFavorites, isMetricId, type MetricId } from "./hub-metrics";

// Favourites are per user and per browser (there are no stored user settings in the backend yet).
const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

function read(key: string) {
  if (!memory.has(key)) {
    try { memory.set(key, localStorage.getItem(key)); } catch { memory.set(key, null); }
  }
  return memory.get(key) ?? "";
}

function write(key: string, value: string) {
  memory.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* keep the in-memory value */ }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith("oalab-hub-favorites:")) return;
    memory.set(event.key, event.newValue);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function parse(raw: string): MetricId[] {
  if (!raw) return defaultFavorites;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is MetricId => typeof item === "string" && isMetricId(item)) : defaultFavorites;
  } catch {
    return defaultFavorites;
  }
}

export function useFavorites(userKey: string) {
  const key = `oalab-hub-favorites:${userKey}`;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "");
  const favorites = useMemo(() => parse(raw), [raw]);
  const save = useCallback((next: MetricId[]) => write(key, JSON.stringify(next)), [key]);

  return {
    favorites,
    isFavorite: (id: MetricId) => favorites.includes(id),
    toggle: (id: MetricId) => save(favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id]),
    remove: (id: MetricId) => save(favorites.filter((item) => item !== id)),
    move: (id: MetricId, offset: -1 | 1) => {
      const index = favorites.indexOf(id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= favorites.length) return;
      const next = [...favorites];
      [next[index], next[target]] = [next[target], next[index]];
      save(next);
    },
  };
}
