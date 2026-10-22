"use client";

import { useState } from "react";
import { Activity, Building2, Check, Copy, Globe, Hash, Inbox, Mail, MailX, MessageSquareText, Pencil, Phone, ShieldCheck, UserCog, UserPlus } from "lucide-react";
import { displayStatusLabels, roleLabels, suggestCustomer, type DisplayStatus } from "@/lib/hub-users/rules";
import type { ManagedCustomer, ManagedUser, UserManagementState } from "@/lib/hub-users/types";
import { formatFileDate, formatFileDateTime } from "@/lib/hub-files/catalog";
import { servicePackages } from "@/lib/service-packages";
import { matchesSearch, sortRows, type SortState, type SortValue } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { GlassCard, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { alphabetical, FilterSelect, SortControl, SortHeader, TableSearch, type SortOption } from "../table-tools";
import { CustomerDialog, fullName, ReviewDialog, UserDialog } from "./users-dialogs";

const ALL = "all";
type Dialog = { kind: "review"; userId: string } | { kind: "user"; userId?: string } | { kind: "customer"; customerId?: string };

const statusOrder: DisplayStatus[] = ["pending", "invited", "active", "disabled", "rejected"];

function StatusPill({ status }: { status: DisplayStatus }) {
  return <span className={`project-status status-${status}`}><i aria-hidden="true" />{displayStatusLabels[status]}</span>;
}

/** Customer number with a copy button (support calls, invoices). */
function NumberChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the number stays readable */ }
  }
  return <span className="number-chip"><span className="numeric">{value}</span><button type="button" onClick={copy} aria-label={`Kundennummer ${value} kopieren`} title="Kopieren">{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}</button></span>;
}

type UserSortKey = "name" | "company" | "number" | "status" | "login" | "created";
const userSorts: Record<UserSortKey, SortOption<UserSortKey>> = {
  name: { id: "name", label: "Name", dirLabels: alphabetical },
  company: { id: "company", label: "Unternehmen", dirLabels: alphabetical },
  number: { id: "number", label: "Kunden-Nr.", dirLabels: { asc: "aufsteigend", desc: "absteigend" } },
  status: { id: "status", label: "Status" },
  login: { id: "login", label: "Letzter Login", firstDir: "desc", dirLabels: { asc: "älteste zuerst", desc: "neueste zuerst" } },
  created: { id: "created", label: "Angelegt", firstDir: "desc", dirLabels: { asc: "älteste zuerst", desc: "neueste zuerst" } },
};

type CustomerSortKey = "number" | "company" | "logins" | "city";
const customerSorts: Record<CustomerSortKey, SortOption<CustomerSortKey>> = {
  number: { id: "number", label: "Kunden-Nr.", dirLabels: { asc: "aufsteigend", desc: "absteigend" } },
  company: { id: "company", label: "Unternehmen", dirLabels: alphabetical },
  logins: { id: "logins", label: "Logins", firstDir: "desc", dirLabels: { asc: "wenigste zuerst", desc: "meiste zuerst" } },
  city: { id: "city", label: "Ort", dirLabels: alphabetical },
};

/** Admin page: open registrations first, then every login and every customer, each with search, filters and sorting. */
export function UserManagementScreen({ state }: { state: UserManagementState }) {
  const { users, customers, events } = state;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState("");
  const customerOf = (user: ManagedUser) => customers.find((customer) => customer.id === user.customerIds[0]) ?? null;
  const pending = users.filter((user) => user.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const open = (next: Dialog) => { setNotice(""); setDialog(next); };

  // Logins table
  const [userQuery, setUserQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [customerFilter, setCustomerFilter] = useState(ALL);
  const [userSort, setUserSort] = useState<SortState<UserSortKey>>({ key: "name", dir: "asc" });
  const userSortValue: Record<UserSortKey, (user: ManagedUser) => SortValue> = {
    name: (user) => fullName(user),
    company: (user) => customerOf(user)?.company ?? user.companyName,
    number: (user) => customerOf(user)?.customerNumber ?? "",
    status: (user) => statusOrder.indexOf(user.displayStatus),
    login: (user) => user.lastSignInAt ?? "",
    created: (user) => user.createdAt,
  };
  const shownUsers = sortRows(users.filter((user) => {
    const customer = customerOf(user);
    return (statusFilter === ALL || user.displayStatus === statusFilter)
      && (roleFilter === ALL || (roleFilter === "none" ? !user.role : user.role === roleFilter))
      && (customerFilter === ALL || user.customerIds.includes(customerFilter))
      && matchesSearch(userQuery, [fullName(user), user.email, user.phone, user.position, user.companyName, customer?.company, customer?.customerNumber, displayStatusLabels[user.displayStatus], user.role ? roleLabels[user.role] : null]);
  }), userSortValue[userSort.key], userSort.dir, { tieBreak: (user) => fullName(user) });
  const userFilters = [statusFilter, roleFilter, customerFilter].filter((value) => value !== ALL).length;

  // Customers table
  const [customerQuery, setCustomerQuery] = useState("");
  const [packageFilter, setPackageFilter] = useState(ALL);
  const [customerSort, setCustomerSort] = useState<SortState<CustomerSortKey>>({ key: "number", dir: "asc" });
  const customerSortValue: Record<CustomerSortKey, (customer: ManagedCustomer) => SortValue> = {
    number: (customer) => customer.customerNumber,
    company: (customer) => customer.company,
    logins: (customer) => customer.memberIds.length,
    city: (customer) => customer.city,
  };
  const shownCustomers = sortRows(customers.filter((customer) =>
    (packageFilter === ALL || (customer.servicePackages as string[]).includes(packageFilter))
    && matchesSearch(customerQuery, [customer.company, customer.customerNumber, customer.city, customer.contactEmail, customer.website, ...customer.servicePackages.map((id) => servicePackages[id].name)]),
  ), customerSortValue[customerSort.key], customerSort.dir, { tieBreak: (customer) => customer.company });

  const reviewUser = dialog?.kind === "review" ? users.find((user) => user.id === dialog.userId) : undefined;
  const editUser = dialog?.kind === "user" && dialog.userId ? users.find((user) => user.id === dialog.userId) : undefined;
  const editCustomer = dialog?.kind === "customer" && dialog.customerId ? customers.find((customer) => customer.id === dialog.customerId) : undefined;
  const title = <span className="title-icon"><UserCog size={24} color="var(--accent-text)" aria-hidden="true" /></span>;

  if (state.error) {
    return <><LargeTitleHeader title="User Management" icon={title} actions={<HeaderActions />} /><GlassCard className="section-first"><p className="t-headline">User Management nicht verfügbar</p><p className="t-subheadline t-secondary">{state.error}</p></GlassCard></>;
  }

  return (
    <>
      <LargeTitleHeader title="User Management" icon={title} actions={<HeaderActions />} />
      <div className="calendar-toolbar users-toolbar">
        <p className="users-summary">{users.filter((user) => user.status === "active").length} aktive Logins · {customers.length} Kunden{pending.length ? ` · ${pending.length} offene Registrierung${pending.length === 1 ? "" : "en"}` : ""}</p>
        <button type="button" className="glass glass-float glass-button glass-button-text" onClick={() => open({ kind: "customer" })}><Building2 size={18} aria-hidden="true" />Kunde anlegen</button>
        <button type="button" className="calendar-primary users-primary" onClick={() => open({ kind: "user" })}><UserPlus size={18} aria-hidden="true" />Benutzer anlegen</button>
      </div>
      {notice && <p className="calendar-notice glass" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      {!state.mailConfigured && <GlassCard className="file-demo-note"><MailX size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Der Mailversand ist noch nicht eingerichtet (SMTP-Zugang fehlt). Benachrichtigungen werden nur protokolliert; Links und Nachrichten gibst du bis dahin selbst weiter.</p></GlassCard>}

      <SectionHeader title={pending.length ? `Offene Registrierungen (${pending.length})` : "Offene Registrierungen"} />
      {pending.length ? (
        <div className="registration-grid">
          {pending.map((user) => {
            const suggestion = suggestCustomer(user, customers);
            return (
              <article key={user.id} className="glass glass-card registration-card">
                <div className="registration-head">
                  <span className="avatar" aria-hidden="true">{(user.firstName[0] ?? "") + (user.lastName[0] ?? "") || "?"}</span>
                  <div><h3>{fullName(user)}</h3><p>{[user.position, user.companyName].filter(Boolean).join(" · ") || "Ohne Angabe zum Unternehmen"}</p></div>
                </div>
                <ul className="registration-facts">
                  <li><Mail size={15} aria-hidden="true" /><span>{user.email}</span><span className={user.emailConfirmed ? "confirm-badge" : "confirm-badge is-open"}>{user.emailConfirmed ? "bestätigt" : "offen"}</span></li>
                  {user.phone && <li><Phone size={15} aria-hidden="true" /><span>{user.phone}</span></li>}
                  {user.website && <li><Globe size={15} aria-hidden="true" /><a href={user.website} target="_blank" rel="noopener noreferrer">{user.website.replace(/^https?:\/\//, "")}</a></li>}
                  {user.customerNumberHint && <li><Hash size={15} aria-hidden="true" /><span>Kundennummer laut Angabe: {user.customerNumberHint}</span></li>}
                  {user.message && <li className="registration-message"><MessageSquareText size={15} aria-hidden="true" /><span>{user.message}</span></li>}
                </ul>
                {suggestion && <p className="suggestion"><Check size={15} aria-hidden="true" />Passt zu {suggestion.customerNumber} · {suggestion.company}</p>}
                <div className="registration-foot">
                  <small>Registriert {formatFileDateTime(user.createdAt)}</small>
                  <button type="button" className="calendar-primary" onClick={() => open({ kind: "review", userId: user.id })}><ShieldCheck size={17} aria-hidden="true" />Prüfen</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : <GlassCard className="file-demo-note"><Inbox size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Keine offenen Registrierungen. Neue Registrierungen von der Login-Seite erscheinen hier zur Freigabe.</p></GlassCard>}

      <SectionHeader title="Benutzer" />
      <TableSearch value={userQuery} onChange={setUserQuery} placeholder="Name, E-Mail, Unternehmen, Kunden-Nr. …" label="Benutzer durchsuchen" activeFilters={userFilters}>
        <FilterSelect icon={Activity} name="Nach Status filtern" value={statusFilter} onChange={setStatusFilter} options={[{ value: ALL, label: "Alle Status" }, ...statusOrder.map((status) => ({ value: status, label: displayStatusLabels[status] }))]} />
        <FilterSelect icon={ShieldCheck} name="Nach Rolle filtern" value={roleFilter} onChange={setRoleFilter} options={[{ value: ALL, label: "Alle Rollen" }, { value: "oalab_customer", label: roleLabels.oalab_customer }, { value: "oalab_admin", label: roleLabels.oalab_admin }, { value: "none", label: "Ohne Rolle" }]} />
        <FilterSelect icon={Building2} name="Nach Kunde filtern" value={customerFilter} onChange={setCustomerFilter} options={[{ value: ALL, label: "Alle Kunden" }, ...customers.map((customer) => ({ value: customer.id, label: `${customer.customerNumber} · ${customer.company}` }))]} />
        <SortControl options={Object.values(userSorts)} sort={userSort} onChange={setUserSort} />
      </TableSearch>
      {shownUsers.length ? (
        <div className="table-blobs">
          <table className="data-table user-table">
            <caption className="visually-hidden">Logins mit Kundennummer, Name, Unternehmen, Rolle, Status und letztem Login</caption>
            <thead>
              <tr>
                <SortHeader option={userSorts.number} sort={userSort} onChange={setUserSort} />
                <SortHeader option={userSorts.name} sort={userSort} onChange={setUserSort} />
                <SortHeader option={userSorts.company} sort={userSort} onChange={setUserSort} />
                <th scope="col">Rolle</th>
                <SortHeader option={userSorts.status} sort={userSort} onChange={setUserSort} />
                <SortHeader option={userSorts.login} sort={userSort} onChange={setUserSort} />
                <th scope="col"><span className="visually-hidden">Bearbeiten</span></th>
              </tr>
            </thead>
            <tbody>
              {shownUsers.map((user) => {
                const customer = customerOf(user);
                return (
                  <tr key={user.id} className={`data-row${user.status === "disabled" || user.status === "rejected" ? " is-muted" : ""}`}>
                    <td className="cell-number">{customer ? <NumberChip value={customer.customerNumber} /> : <span className="t-secondary">–</span>}</td>
                    <td className="cell-person">
                      <button type="button" className="row-open" onClick={() => open(user.status === "pending" ? { kind: "review", userId: user.id } : { kind: "user", userId: user.id })}>
                        <strong>{fullName(user)}{user.self && <span className="self-badge">Du</span>}{user.demo && <span className="self-badge">Demo</span>}</strong><small>{user.email}</small>
                      </button>
                    </td>
                    <td className="cell-company">{customer?.company ?? (user.role === "oalab_admin" ? "oalab" : user.companyName ? <span className="t-secondary">{user.companyName} (Angabe)</span> : "–")}</td>
                    <td className="cell-role">{user.role ? roleLabels[user.role] : <span className="t-secondary">–</span>}</td>
                    <td className="cell-status"><StatusPill status={user.displayStatus} /></td>
                    <td className="cell-login">{user.lastSignInAt ? formatFileDateTime(user.lastSignInAt) : <span className="t-secondary">noch nie</span>}</td>
                    <td className="cell-action"><button type="button" className="row-action" onClick={() => open(user.status === "pending" ? { kind: "review", userId: user.id } : { kind: "user", userId: user.id })} aria-label={`${fullName(user)} bearbeiten`} title="Bearbeiten"><Pencil size={17} aria-hidden="true" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <GlassCard><p className="t-subheadline t-secondary">{users.length ? "Keine Benutzer für diese Suche oder Filter." : "Noch keine Benutzer."}</p></GlassCard>}

      <SectionHeader title="Kunden" />
      <TableSearch value={customerQuery} onChange={setCustomerQuery} placeholder="Unternehmen, Kunden-Nr., Ort, Servicepaket …" label="Kunden durchsuchen" activeFilters={packageFilter === ALL ? 0 : 1}>
        <FilterSelect icon={Activity} name="Nach Servicepaket filtern" value={packageFilter} onChange={setPackageFilter} options={[{ value: ALL, label: "Alle Servicepakete" }, ...Object.entries(servicePackages).map(([id, item]) => ({ value: id, label: item.name }))]} />
        <SortControl options={Object.values(customerSorts)} sort={customerSort} onChange={setCustomerSort} />
      </TableSearch>
      {shownCustomers.length ? (
        <div className="table-blobs">
          <table className="data-table customer-table">
            <caption className="visually-hidden">Kunden mit Kundennummer, Unternehmen, Servicepaketen, Logins und Ort</caption>
            <thead>
              <tr>
                <SortHeader option={customerSorts.number} sort={customerSort} onChange={setCustomerSort} />
                <SortHeader option={customerSorts.company} sort={customerSort} onChange={setCustomerSort} />
                <th scope="col">Servicepakete</th>
                <SortHeader option={customerSorts.logins} sort={customerSort} onChange={setCustomerSort} />
                <SortHeader option={customerSorts.city} sort={customerSort} onChange={setCustomerSort} />
                <th scope="col"><span className="visually-hidden">Bearbeiten</span></th>
              </tr>
            </thead>
            <tbody>
              {shownCustomers.map((customer) => (
                <tr key={customer.id} className="data-row">
                  <td className="cell-number"><NumberChip value={customer.customerNumber} /></td>
                  <td className="cell-person">
                    <button type="button" className="row-open" onClick={() => open({ kind: "customer", customerId: customer.id })}><strong>{customer.company}</strong><small>{customer.contactEmail || customer.website.replace(/^https?:\/\//, "") || `Kunde seit ${formatFileDate(customer.createdAt)}`}</small></button>
                  </td>
                  <td className="cell-packages">{customer.servicePackages.length ? customer.servicePackages.map((id) => <span key={id} className="customer-chip">{servicePackages[id].name}</span>) : <span className="t-secondary">–</span>}</td>
                  <td className="cell-logins numeric">{customer.memberIds.length}</td>
                  <td className="cell-city">{[customer.postalCode, customer.city].filter(Boolean).join(" ") || <span className="t-secondary">–</span>}</td>
                  <td className="cell-action"><button type="button" className="row-action" onClick={() => open({ kind: "customer", customerId: customer.id })} aria-label={`${customer.company} bearbeiten`} title="Bearbeiten"><Pencil size={17} aria-hidden="true" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <GlassCard><p className="t-subheadline t-secondary">{customers.length ? "Keine Kunden für diese Suche oder Filter." : "Noch keine Kunden. Lege den ersten mit „Kunde anlegen“ an."}</p></GlassCard>}

      {reviewUser && <ReviewDialog key={reviewUser.id} user={reviewUser} customers={customers} nextNumber={state.nextCustomerNumber} onClose={() => setDialog(null)} onNotice={setNotice} />}
      {dialog?.kind === "user" && (!dialog.userId || editUser) && <UserDialog key={dialog.userId ?? "new"} user={editUser} customers={customers} nextNumber={state.nextCustomerNumber} mailConfigured={state.mailConfigured} events={events.filter((event) => editUser && event.targetUserId === editUser.id)} onClose={() => setDialog(null)} onNotice={setNotice} onReview={(userId) => setDialog({ kind: "review", userId })} />}
      {dialog?.kind === "customer" && (!dialog.customerId || editCustomer) && <CustomerDialog key={dialog.customerId ?? "new"} customer={editCustomer} users={users} nextNumber={state.nextCustomerNumber} events={events.filter((event) => editCustomer && event.targetCustomerId === editCustomer.id)} onClose={() => setDialog(null)} onNotice={setNotice} />}
    </>
  );
}
