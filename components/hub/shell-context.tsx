"use client";

import { createContext, useContext } from "react";
import type { ServicePackageId } from "@/lib/service-packages";

export type ShellPanel = "search" | "notifications" | "help";

/** Contact and address of the customer a real login belongs to, as the user management keeps it. */
export type HubCustomerDetails = { street: string; postalCode: string; city: string; country: string; website: string; phone: string; contactEmail: string };

/** Who is signed in and whom they represent; company and number are null until assigned. */
export type HubAccount = {
  name: string;
  company: string | null;
  customerNumber: string | null;
  servicePackages: ServicePackageId[];
  admin: boolean;
  customers: number;
  /** Real logins only: the person's own details and their customer's contact data. */
  person: { phone: string; position: string } | null;
  customerDetails: HubCustomerDetails | null;
};

export type ShellContextValue = {
  preview: boolean;
  initials: string;
  account: HubAccount;
  /** Real admin login (not the preview or the public demo): may open the user management. */
  manageUsers: boolean;
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
