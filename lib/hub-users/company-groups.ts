/**
 * „Zugänge“ by company (user 21.11.2026): every login under the customer or freelancer it belongs to, the admins under
 * oalab, which is no entry of its own (admin logins belong to none). Self-contained (type imports only), so the page and
 * `node --test` share it.
 */

type Login = { id: string; status: string; role: string | null; customerIds: readonly string[] };
type Entry = { id: string; company: string; archivedAt: string | null; archivedLoginIds: readonly string[] };

export type CompanyGroup<L, E> =
  | { kind: "pending" | "oalab" | "none" | "rejected"; key: string; rows: L[] }
  | { kind: "entry"; key: string; entry: E; rows: L[] };

/** The entry a login belongs to: its membership, else the archived entry whose archive took the membership away. */
export function entryOfLogin<E extends Entry>(login: Pick<Login, "id" | "customerIds">, entries: readonly E[]): E | null {
  return entries.find((entry) => entry.id === login.customerIds[0]) ?? entries.find((entry) => entry.archivedLoginIds.includes(login.id)) ?? null;
}

/**
 * The groups in their order: registrations waiting for approval (they belong to no company yet), oalab with the admins,
 * the customers and freelancers A–Z (archived ones after the others), logins without any company, rejected
 * registrations. The four fixed groups always come back, also empty; a company only with logins. Rows keep the order
 * they come in, which is the table's sorting.
 */
export function groupLoginsByCompany<L extends Login, E extends Entry>(logins: readonly L[], entries: readonly E[]): CompanyGroup<L, E>[] {
  const pending: L[] = [];
  const oalab: L[] = [];
  const none: L[] = [];
  const rejected: L[] = [];
  const companies = new Map<string, { entry: E; rows: L[] }>();
  for (const login of logins) {
    if (login.status === "pending") pending.push(login);
    else if (login.status === "rejected") rejected.push(login);
    else if (login.role === "oalab_admin") oalab.push(login);
    else {
      const entry = entryOfLogin(login, entries);
      if (!entry) none.push(login);
      else if (companies.has(entry.id)) companies.get(entry.id)!.rows.push(login);
      else companies.set(entry.id, { entry, rows: [login] });
    }
  }
  const ordered = [...companies.values()].sort((a, b) => Number(Boolean(a.entry.archivedAt)) - Number(Boolean(b.entry.archivedAt)) || a.entry.company.localeCompare(b.entry.company, "de"));
  return [
    { kind: "pending", key: "pending", rows: pending },
    { kind: "oalab", key: "oalab", rows: oalab },
    ...ordered.map(({ entry, rows }) => ({ kind: "entry" as const, key: `entry-${entry.id}`, entry, rows })),
    { kind: "none", key: "none", rows: none },
    { kind: "rejected", key: "rejected", rows: rejected },
  ];
}
