"use client";

import { createContext, useContext } from "react";
import type { PackageId } from "@/lib/service-packages";
import type { CustomerLogo } from "@/lib/hub-logos/rules";

export type ShellPanel = "search" | "notifications" | "help";

/** Contact and address of the customer a real login belongs to, as the user management keeps it. */
export type HubCustomerDetails = { street: string; postalCode: string; city: string; country: string; website: string; phone: string; contactEmail: string };

/** Who is signed in and whom they represent; company and number are null until assigned. */
export type HubAccount = {
  name: string;
  /** The person's first name for greetings; empty when the login has none (a company account, say). */
  firstName: string;
  company: string | null;
  customerNumber: string | null;
  /** The packages of the customer the login belongs to, in group order. */
  packages: PackageId[];
  admin: boolean;
  /** A freelancer login: their own asset management with the customers they look after, no projects, no service platform. */
  freelancer: boolean;
  customers: number;
  /** Real logins only: the person's own details and their customer's contact data. */
  person: { phone: string; position: string } | null;
  customerDetails: HubCustomerDetails | null;
};

export type ShellContextValue = {
  preview: boolean;
  /** The loading shell before the login is known: account details are blank, not "no customer". */
  pending: boolean;
  initials: string;
  /** Customer logins: their company's logo in place of the initials (null without one and for admins). */
  logo: CustomerLogo | null;
  account: HubAccount;
  /** Admin login (not the preview): may open the user management. */
  manageUsers: boolean;
  openPanel: (panel: ShellPanel) => void;
  /** Opens the assistant about this project; it keeps the project as its reference, also when docked. */
  askAboutProject: (project: { id: string; name: string }) => void;
  /** Opens the assistant with this question in its input, ready to send („Mehr dazu im Assistenten“ of an ⓘ). */
  askAssistant: (question: string) => void;
  /** The assistant opens as a sidebar next to the page (a dialog on top of it would block that sidebar). */
  assistantDocked: boolean;
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
