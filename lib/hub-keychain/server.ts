import "server-only";
import { domainToUnicode } from "node:url";
import { maskEmail } from "@/lib/hub-auth/mail-code";
import { readCustomerPackages } from "@/lib/hub-contracts/packages";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { loadCustomerLogos } from "@/lib/hub-logos/server";
import { vaultKeyId } from "@/lib/hub-vault/key";
import { keychainAdmin, lockOf } from "./gate";
import { MAILBOX_CATEGORY } from "./rules";
import type { KeychainCategory, KeychainEntry, KeychainGate, KeychainOwner, KeychainState } from "./types";

// The „Schlüsselbund“ for a real admin, read with the service role after the admin check: categories, customers, every
// login and mailbox, and of passwords and notes only whether one exists. No ciphertext leaves this file.

type CategoryRow = { id: string; name: string; icon: string; position: number; fixed: boolean };
type CustomerRow = { id: string; company: string; customer_number: string; kind: string | null };
type LoginRow = { id: string; customer_id: string | null; kind: string; label: string; login_url: string; username: string; updated_at: string };
type MailboxRow = { id: string; customer_id: string; address: string; person: string; updated_at: string };
type SecretRow = { mailbox_id: string | null; login_id: string | null; purpose: string; updated_at: string };

/** The tables or columns are missing until migration 202611130001 is applied. */
export const isMissingKeychain = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42P01" || error.code === "42703" || error.code === "PGRST205" || error.code === "PGRST204" || /hub_keychain_|purpose|schema cache/i.test(error.message ?? "")));

const empty = (error?: string, ready = false): KeychainState => ({ ready, keyId: null, categories: [], owners: [], entries: [], lock: { status: "setup" }, email: "", ...(error ? { error } : {}) });

const readableAddress = (address: string) => {
  const at = address.lastIndexOf("@");
  if (at < 1) return address;
  try {
    return `${address.slice(0, at)}@${domainToUnicode(address.slice(at + 1)) || address.slice(at + 1)}`;
  } catch {
    return address;
  }
};

/** „oalab intern“: the owner of oalab's own accounts, always first. */
export const OWN_OWNER: KeychainOwner = { id: null, company: "oalab intern", customerNumber: "", logo: null, cancelled: false };

export async function loadKeychain(): Promise<KeychainState> {
  const admin = await keychainAdmin();
  if (!admin) return empty("Der Schlüsselbund ist nur für Admins verfügbar.");
  const { db } = admin;
  const [categories, customers, logins, mailboxes, secrets, logos, packages, lock] = await Promise.all([
    db.from("hub_keychain_categories").select("id, name, icon, position, fixed").order("position").order("name").returns<CategoryRow[]>(),
    db.from("hub_customers").select("id, company, customer_number, kind").order("company").returns<CustomerRow[]>(),
    db.from("hub_customer_logins").select("id, customer_id, kind, label, login_url, username, updated_at").returns<LoginRow[]>(),
    db.from("hub_customer_mailboxes").select("id, customer_id, address, person, updated_at").eq("kind", "mailbox").returns<MailboxRow[]>(),
    db.from("hub_vault_secrets").select("mailbox_id, login_id, purpose, updated_at").returns<SecretRow[]>(),
    loadCustomerLogos(db).catch(() => new Map<string, CustomerLogo>()),
    readCustomerPackages(db).catch(() => ({ ready: false, byCustomer: new Map() })),
    lockOf(admin).catch(() => ({ status: "locked", attemptsLeft: 0, recoveryLeft: 0 }) as const),
  ]);
  const error = categories.error ?? secrets.error ?? logins.error;
  if (error && isMissingKeychain(error)) return empty("Der Schlüsselbund ist in der Datenbank noch nicht eingerichtet. Die Migration steht noch aus.");
  if (error || customers.error || mailboxes.error) return empty("Der Schlüsselbund konnte gerade nicht geladen werden. Bitte versuche es erneut.", true);

  const passwords = new Map<string, string>();
  const notes = new Set<string>();
  for (const row of secrets.data ?? []) {
    const owner = row.mailbox_id ?? row.login_id;
    if (!owner) continue;
    if (row.purpose === "note") notes.add(owner);
    else passwords.set(owner, row.updated_at);
  }
  const entries: KeychainEntry[] = [
    ...(mailboxes.data ?? []).map((row): KeychainEntry => ({
      id: row.id, kind: "mailbox", categoryId: MAILBOX_CATEGORY, ownerId: row.customer_id, title: readableAddress(row.address), person: row.person,
      loginUrl: "", username: readableAddress(row.address), hasPassword: passwords.has(row.id), hasNote: notes.has(row.id), changedAt: passwords.get(row.id) ?? row.updated_at,
    })),
    ...(logins.data ?? []).map((row): KeychainEntry => ({
      id: row.id, kind: "login", categoryId: row.kind, ownerId: row.customer_id, title: row.label, person: "",
      loginUrl: row.login_url, username: row.username, hasPassword: passwords.has(row.id), hasNote: notes.has(row.id), changedAt: passwords.get(row.id) ?? row.updated_at,
    })),
  ];
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.categoryId, (counts.get(entry.categoryId) ?? 0) + 1);
  const owners: KeychainOwner[] = [
    OWN_OWNER,
    // Freelancers hold no accesses: only entries of the kind customer.
    ...(customers.data ?? []).filter((row) => (row.kind ?? "customer") === "customer").map((row): KeychainOwner => ({
      id: row.id, company: row.company, customerNumber: row.customer_number, logo: logos.get(row.id) ?? null,
      cancelled: (packages.byCustomer.get(row.id) ?? []).some((item: { packageId: string | null; until: string | null }) => Boolean(item.packageId && item.until)),
    })),
  ];
  return {
    ready: true,
    keyId: vaultKeyId(),
    categories: (categories.data ?? []).map((row): KeychainCategory => ({ ...row, count: counts.get(row.id) ?? 0 })),
    owners,
    entries,
    lock,
    email: maskEmail(admin.email),
  };
}

/** The lock alone, for the passwords under „Vertrag & Domain“; null for anyone but a real admin. */
export async function loadKeychainGate(): Promise<KeychainGate | null> {
  const admin = await keychainAdmin();
  if (!admin) return null;
  try {
    return { lock: await lockOf(admin), keyId: vaultKeyId() };
  } catch {
    return { lock: { status: "locked", attemptsLeft: 0, recoveryLeft: 0 }, keyId: vaultKeyId() };
  }
}
