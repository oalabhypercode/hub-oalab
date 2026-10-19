"use client";

import { createContext, useContext } from "react";

export type ShellPanel = "search" | "notifications" | "help";

export type ShellContextValue = {
  preview: boolean;
  initials: string;
  openPanel: (panel: ShellPanel) => void;
  unread: boolean;
  signOut: () => void;
  signingOut: boolean;
  logoutError: string;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useHubShell() {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useHubShell must be used inside AppShell");
  return value;
}
