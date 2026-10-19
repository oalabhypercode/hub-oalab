"use client";

import { createContext, useContext } from "react";
import type { ServicePackageId } from "@/lib/service-packages";

export type ShellPanel = "search" | "notifications" | "help";

/** Who is signed in and whom they represent; company and number are null until assigned. */
export type HubAccount = { name: string; company: string | null; customerNumber: string | null; servicePackages: ServicePackageId[]; admin: boolean; customers: number };

export type ShellContextValue = {
  preview: boolean;
  initials: string;
  account: HubAccount;
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
