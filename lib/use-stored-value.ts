"use client";

import { useCallback, useSyncExternalStore } from "react";

// A small value kept per browser (a view, a choice), like the favourites in lib/use-favorites.ts: read through
// useSyncExternalStore, so the server renders the fallback and the browser switches to its stored value without an
// effect, and other tabs follow through the storage event.

const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

function read(key: string) {
  if (!memory.has(key)) {
    try { memory.set(key, window.localStorage.getItem(key)); } catch { memory.set(key, null); }
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string) {
  memory.set(key, value);
  try { window.localStorage.setItem(key, value); } catch { /* keep the in-memory value */ }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (!event.key) return;
    memory.set(event.key, event.newValue);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useStoredValue(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key) ?? fallback, () => fallback);
  const save = useCallback((next: string) => write(key, next), [key]);
  return [value, save];
}
