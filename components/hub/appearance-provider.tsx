"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearanceToDocument,
  backgroundPresets,
  defaultAppearance,
  normalizeAppearance,
  resolveAppearance,
  type Appearance,
} from "@/lib/appearance";

// Browser storage can be unavailable (private mode, blocked site data); keep an in-memory copy.
let stored: string | null | undefined;
const listeners = new Set<() => void>();

function readStored() {
  if (stored === undefined) {
    try { stored = localStorage.getItem(APPEARANCE_STORAGE_KEY); } catch { stored = null; }
  }
  return stored ?? "";
}

function writeStored(value: string) {
  stored = value;
  try { localStorage.setItem(APPEARANCE_STORAGE_KEY, value); } catch { /* keep the in-memory value */ }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_STORAGE_KEY) return;
    stored = event.newValue;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// System preferences preselect the switches until the user sets them in Darstellung.
const reducedTransparencyQuery = "(prefers-reduced-transparency: reduce)";
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeQuery(query: string) {
  return (listener: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", listener);
    return () => list.removeEventListener("change", listener);
  };
}
const subscribeTransparency = subscribeQuery(reducedTransparencyQuery);
const subscribeMotion = subscribeQuery(reducedMotionQuery);

function parse(raw: string): unknown {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

type AppearanceContextValue = {
  appearance: Appearance;
  update: (patch: Partial<Appearance>) => void;
};

const AppearanceContext = createContext<AppearanceContextValue>({ appearance: defaultAppearance, update: () => {} });

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const raw = useSyncExternalStore(subscribe, readStored, () => "");
  const systemTransparency = useSyncExternalStore(subscribeTransparency, () => window.matchMedia(reducedTransparencyQuery).matches, () => false);
  const systemMotion = useSyncExternalStore(subscribeMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
  const appearance = useMemo(() => normalizeAppearance(parse(raw), systemTransparency, systemMotion), [raw, systemTransparency, systemMotion]);

  // The pre-paint script covers full page loads; this keeps <html> in sync after changes
  // and re-applies the values after React's development remount resets <html>.
  useLayoutEffect(() => {
    applyAppearanceToDocument(resolveAppearance(parse(raw), backgroundPresets, systemTransparency, systemMotion), document.documentElement);
  }, [raw, systemTransparency, systemMotion]);

  const update = useCallback((patch: Partial<Appearance>) => {
    writeStored(JSON.stringify({ ...appearance, ...patch }));
  }, [appearance]);

  const value = useMemo(() => ({ appearance, update }), [appearance, update]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  return useContext(AppearanceContext);
}
