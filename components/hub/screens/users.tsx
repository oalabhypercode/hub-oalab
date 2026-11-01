"use client";

import { useState } from "react";
import { Activity, ArrowUpDown, Building2, Check, Copy, ListFilter, MailX, Pencil, Rows3, ShieldCheck, UserPlus } from "lucide-react";
import { displayStatusLabels, roleLabels, type DisplayStatus } from "@/lib/hub-users/rules";
import type { ManagedCustomer, ManagedUser, UserManagementState } from "@/lib/hub-users/types";
import { formatFileDate, formatFileDateTime } from "@/lib/hub-files/catalog";
import { servicePackages } from "@/lib/service-packages";
import { matchesSearch, sortRows, type SortState, type SortValue } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { SegmentedControl } from "../controls";
import { GlassCard, TitleIcon } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { sectionIcons } from "../navigation";
import { MenuChoices, SheetEmpty, SheetFooter, SheetToolbar, StatusGlyph, TableGroup, ToolbarMenu, useCollapsedGroups, type GlyphKind } from "../sheet";
import { alphabetical, FilterSelect, SortControl, SortHeader, type SortOption } from "../table-tools";
import { CustomerDialog, fullName, ReviewDialog, UserDialog } from "./users-dialogs";

const ALL = "all";
type Dialog = { kind: "review"; userId: string } | { kind: "user"; userId?: string } | { kind: "customer"; customerId?: string };

const statusOrder: DisplayStatus[] = ["pending", "invited", "active", "disabled", "rejected"];

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

const statusGlyph: Record<DisplayStatus, GlyphKind> = { pending: "pending", invited: "invited", active: "active", disabled: "disabled", rejected: "rejected" };
const initialsOf = (user: ManagedUser) => ((user.firstName[0] ?? "") + (user.lastName[0] ?? "")).toUpperCase() || "?";
const companyMark = (name: string) => name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
type Tab = "users" | "customers";
type UserGrouping = "status" | "none";

/** Admin page: one sheet with the logins (open registrations as the first group) and the customers, each with search, filters and sorting. */
export function UserManagementScreen({ state }: { state: UserManagementState }) {
  const { users, customers, events } = state;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("users");
  const groups = useCollapsedGroups();
  const customerOf = (user: ManagedUser) => customers.find((customer) => customer.id === user.customerIds[0]) ?? null;
  const pending = users.filter((user) => user.status === "pending");
  const open = (next: Dialog) => { setNotice(""); setDialog(next); };
  const openUser = (user: ManagedUser) => open(user.status === "pending" ? { kind: "review", userId: user.id } : { kind: "user", userId: user.id });

  // Logins
  const [userQuery, setUserQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [customerFilter, setCustomerFilter] = useState(ALL);
  const [userSort, setUserSort] = useState<SortState<UserSortKey>>({ key: "name", dir: "asc" });
  const [grouping, setGrouping] = useState<UserGrouping>("status");
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
  const usersNarrowed = userQuery.trim() !== "" || userFilters > 0;
  const resetUsers = () => { setUserQuery(""); setStatusFilter(ALL); setRoleFilter(ALL); setCustomerFilter(ALL); };

  // Customers
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
  const customersNarrowed = customerQuery.trim() !== "" || packageFilter !== ALL;

  const reviewUser = dialog?.kind === "review" ? users.find((user) => user.id === dialog.userId) : undefined;
  const editUser = dialog?.kind === "user" && dialog.userId ? users.find((user) => user.id === dialog.userId) : undefined;
  const editCustomer = dialog?.kind === "customer" && dialog.customerId ? customers.find((customer) => customer.id === dialog.customerId) : undefined;
  const title = <TitleIcon icon={sectionIcons.users!} />;

  if (state.error) {
    return <><LargeTitleHeader title="User Management" icon={title} actions={<HeaderActions />} /><GlassCard className="section-first"><p className="t-headline">User Management nicht verfügbar</p><p className="t-subheadline t-secondary">{state.error}</p></GlassCard></>;
  }

  const userRow = (user: ManagedUser) => {
    const customer = customerOf(user);
    const waiting = user.status === "pending";
    return (
      <tr key={user.id} className={`data-row${user.status === "disabled" || user.status === "rejected" ? " is-muted" : ""}`}>
        <td className="cell-person">
          <button type="button" className="row-open" onClick={() => openUser(user)}>
            <span className="avatar avatar-s" aria-hidden="true">{initialsOf(user)}</span><strong title={fullName(user)}>{fullName(user)}</strong>
            {user.self && <span className="self-badge">Du</span>}{user.demo && <span className="self-badge">Demo</span>}
          </button>
        </td>
        <td className="cell-mail">
          <span className="mail-cell"><span title={user.email}>{user.email}</span>{waiting && !user.emailConfirmed && <span className="confirm-badge is-open" title="Die E-Mail-Adresse ist noch nicht bestätigt">unbestätigt</span>}</span>
        </td>
        <td className="cell-number col-number">{customer ? <NumberChip value={customer.customerNumber} /> : <span className="cell-none">–</span>}</td>
        <td className="cell-company">
          {customer ? <span className="company-cell"><span className="company-mark" aria-hidden="true">{companyMark(customer.company)}</span><span className="company-name" title={customer.company}>{customer.company}</span></span>
            : user.role === "oalab_admin" ? <span className="company-cell"><span className="company-mark" aria-hidden="true">OA</span>oalab<span className="role-tag">Admin</span></span>
            : user.companyName ? <span className="company-cell is-hint" title="Angabe aus der Registrierung"><span className="company-name">{user.companyName}</span><span className="role-tag">Angabe</span></span>
            : <span className="cell-none">–</span>}
        </td>
        <td className="cell-status"><span className="status-cell" title={waiting ? `Registriert am ${formatFileDateTime(user.createdAt)}` : undefined}><StatusGlyph kind={statusGlyph[user.displayStatus]} />{waiting ? `Seit ${formatFileDate(user.createdAt)}` : displayStatusLabels[user.displayStatus]}</span></td>
        <td className="cell-login col-login">{user.lastSignInAt ? <time dateTime={user.lastSignInAt} title={formatFileDateTime(user.lastSignInAt)}>{formatFileDate(user.lastSignInAt)}</time> : <span className="cell-none">noch nie</span>}</td>
        <td className="cell-action">
          {waiting ? <button type="button" className="row-check" onClick={() => openUser(user)}><ShieldCheck size={15} aria-hidden="true" />Prüfen</button>
            : <button type="button" className="row-action" onClick={() => openUser(user)} aria-label={`${fullName(user)} bearbeiten`} title="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button>}
        </td>
      </tr>
    );
  };

  const userGroups = statusOrder.map((status) => ({ status, rows: shownUsers.filter((user) => user.displayStatus === status) }))
    // The registrations always have their group at the top, also empty: that is where new ones appear.
    .filter((group) => group.rows.length || (group.status === "pending" && !pending.length && !usersNarrowed));

  return (
    <>
      <LargeTitleHeader title="User Management" icon={title} actions={<HeaderActions />} />
      {notice && <p className="calendar-notice section-first" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      {!state.mailConfigured && <GlassCard className="file-demo-note section-first"><MailX size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Der Mailversand ist noch nicht eingerichtet (SMTP-Zugang fehlt). Benachrichtigungen werden nur protokolliert; Links und Nachrichten gibst du bis dahin selbst weiter.</p></GlassCard>}

      <div className="sheet section-first">
        {tab === "users" ? (
          <SheetToolbar query={userQuery} onQuery={setUserQuery} placeholder="Name, E-Mail, Unternehmen, Kunden-Nr. …" label="Konten durchsuchen" compact
            leading={<TabSwitch tab={tab} onTab={setTab} users={users.length} customers={customers.length} />}
            trailing={<ManageButtons onCustomer={() => open({ kind: "customer" })} onUser={() => open({ kind: "user" })} />}>
            <ToolbarMenu icon={ListFilter} label="Filter" badge={userFilters}>
              <FilterSelect icon={Activity} name="Nach Status filtern" value={statusFilter} onChange={setStatusFilter} options={[{ value: ALL, label: "Alle Status" }, ...statusOrder.map((status) => ({ value: status, label: displayStatusLabels[status] }))]} />
              <FilterSelect icon={ShieldCheck} name="Nach Rolle filtern" value={roleFilter} onChange={setRoleFilter} options={[{ value: ALL, label: "Alle Rollen" }, { value: "oalab_customer", label: roleLabels.oalab_customer }, { value: "oalab_admin", label: roleLabels.oalab_admin }, { value: "none", label: "Ohne Rolle" }]} />
              <FilterSelect icon={Building2} name="Nach Kunde filtern" value={customerFilter} onChange={setCustomerFilter} options={[{ value: ALL, label: "Alle Kunden" }, ...customers.map((customer) => ({ value: customer.id, label: `${customer.customerNumber} · ${customer.company}` }))]} />
            </ToolbarMenu>
            <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={userSorts[userSort.key].label}><SortControl options={Object.values(userSorts)} sort={userSort} onChange={setUserSort} /></ToolbarMenu>
            <ToolbarMenu icon={Rows3} label="Gruppe" value={grouping === "status" ? "Status" : "Keine"}>
              <MenuChoices label="Gruppieren nach" value={grouping} onChange={setGrouping} options={[{ id: "status", label: "Status" }, { id: "none", label: "Keine Gruppen" }]} />
            </ToolbarMenu>
          </SheetToolbar>
        ) : (
          <SheetToolbar query={customerQuery} onQuery={setCustomerQuery} placeholder="Unternehmen, Kunden-Nr., Ort, Servicepaket …" label="Kunden durchsuchen" compact
            leading={<TabSwitch tab={tab} onTab={setTab} users={users.length} customers={customers.length} />}
            trailing={<ManageButtons onCustomer={() => open({ kind: "customer" })} onUser={() => open({ kind: "user" })} />}>
            <ToolbarMenu icon={ListFilter} label="Filter" badge={packageFilter === ALL ? 0 : 1}>
              <FilterSelect icon={Activity} name="Nach Servicepaket filtern" value={packageFilter} onChange={setPackageFilter} options={[{ value: ALL, label: "Alle Servicepakete" }, ...Object.entries(servicePackages).map(([id, item]) => ({ value: id, label: item.name }))]} />
            </ToolbarMenu>
            <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={customerSorts[customerSort.key].label}><SortControl options={Object.values(customerSorts)} sort={customerSort} onChange={setCustomerSort} /></ToolbarMenu>
          </SheetToolbar>
        )}

        {tab === "users" ? (
          userGroups.length ? (
            <div className="sheet-scroll">
              <table className="data-table user-table">
                <caption className="visually-hidden">Konten mit Name, E-Mail, Kundennummer, Unternehmen, Status und letztem Login</caption>
                <thead>
                  <tr>
                    <SortHeader option={userSorts.name} sort={userSort} onChange={setUserSort} />
                    <th scope="col">E-Mail</th>
                    <SortHeader option={userSorts.number} className="col-number" sort={userSort} onChange={setUserSort} />
                    <SortHeader option={userSorts.company} sort={userSort} onChange={setUserSort} />
                    <SortHeader option={userSorts.status} sort={userSort} onChange={setUserSort} />
                    <SortHeader option={userSorts.login} className="col-login" sort={userSort} onChange={setUserSort} />
                    <th scope="col"><span className="visually-hidden">Prüfen oder bearbeiten</span></th>
                  </tr>
                </thead>
                {grouping === "status" ? userGroups.map((group) => (
                  <TableGroup key={group.status} colSpan={7} label={group.status === "pending" ? "Wartet auf Freigabe" : displayStatusLabels[group.status]} count={group.rows.length}
                    glyph={<StatusGlyph kind={statusGlyph[group.status]} />} collapsed={groups.isCollapsed(group.status)} onToggle={() => groups.toggle(group.status)}
                    empty="Keine offenen Registrierungen. Neue Registrierungen von der Login-Seite erscheinen hier zur Freigabe.">
                    {group.rows.map(userRow)}
                  </TableGroup>
                )) : <tbody>{shownUsers.map(userRow)}</tbody>}
              </table>
            </div>
          ) : <SheetEmpty text={users.length ? "Keine Konten für diese Suche oder Filter." : "Noch keine Konten."} onReset={usersNarrowed ? resetUsers : undefined} />
        ) : shownCustomers.length ? (
          <div className="sheet-scroll">
            <table className="data-table customer-table">
              <caption className="visually-hidden">Kunden mit Kundennummer, Unternehmen, Servicepaketen, Konten und Ort</caption>
              <thead>
                <tr>
                  <SortHeader option={customerSorts.company} sort={customerSort} onChange={setCustomerSort} />
                  <SortHeader option={customerSorts.number} sort={customerSort} onChange={setCustomerSort} />
                  <th scope="col">Servicepakete</th>
                  <SortHeader option={customerSorts.logins} label="Konten" className="col-count" sort={customerSort} onChange={setCustomerSort} />
                  <SortHeader option={customerSorts.city} sort={customerSort} onChange={setCustomerSort} />
                  <th scope="col"><span className="visually-hidden">Bearbeiten</span></th>
                </tr>
              </thead>
              <tbody>
                {shownCustomers.map((customer) => (
                  <tr key={customer.id} className="data-row">
                    <td className="cell-person">
                      <button type="button" className="row-open" onClick={() => open({ kind: "customer", customerId: customer.id })}><span className="company-mark" aria-hidden="true">{companyMark(customer.company)}</span><strong>{customer.company}</strong></button>
                    </td>
                    <td className="cell-number"><NumberChip value={customer.customerNumber} /></td>
                    <td className="cell-packages">{customer.servicePackages.length ? customer.servicePackages.map((id) => servicePackages[id].name).join(", ") : <span className="cell-none">–</span>}</td>
                    <td className="cell-logins numeric">{customer.memberIds.length}</td>
                    <td className="cell-city">{[customer.postalCode, customer.city].filter(Boolean).join(" ") || <span className="cell-none">–</span>}</td>
                    <td className="cell-action"><button type="button" className="row-action" onClick={() => open({ kind: "customer", customerId: customer.id })} aria-label={`${customer.company} bearbeiten`} title="Bearbeiten"><Pencil size={16} aria-hidden="true" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <SheetEmpty text={customers.length ? "Keine Kunden für diese Suche oder Filter." : "Noch keine Kunden. Lege den ersten mit „Kunde anlegen“ an."} onReset={customersNarrowed ? () => { setCustomerQuery(""); setPackageFilter(ALL); } : undefined} />}
        <SheetFooter hint={tab === "users" && pending.length ? `${pending.length === 1 ? "1 Registrierung wartet" : `${pending.length} Registrierungen warten`} auf Freigabe` : undefined}>
          {users.filter((user) => user.status === "active").length} aktive Konten · {customers.length === 1 ? "1 Kunde" : `${customers.length} Kunden`}
        </SheetFooter>
      </div>

      {reviewUser && <ReviewDialog key={reviewUser.id} user={reviewUser} customers={customers} nextNumber={state.nextCustomerNumber} onClose={() => setDialog(null)} onNotice={setNotice} />}
      {dialog?.kind === "user" && (!dialog.userId || editUser) && <UserDialog key={dialog.userId ?? "new"} user={editUser} customers={customers} nextNumber={state.nextCustomerNumber} mailConfigured={state.mailConfigured} events={events.filter((event) => editUser && event.targetUserId === editUser.id)} onClose={() => setDialog(null)} onNotice={setNotice} onReview={(userId) => setDialog({ kind: "review", userId })} />}
      {dialog?.kind === "customer" && (!dialog.customerId || editCustomer) && <CustomerDialog key={dialog.customerId ?? "new"} customer={editCustomer} users={users} nextNumber={state.nextCustomerNumber} events={events.filter((event) => editCustomer && event.targetCustomerId === editCustomer.id)} onClose={() => setDialog(null)} onNotice={setNotice} />}
    </>
  );
}

/** Logins and customers share one sheet; the switch sits where Studio has its views. */
function TabSwitch({ tab, onTab, users, customers }: { tab: Tab; onTab: (tab: Tab) => void; users: number; customers: number }) {
  return <SegmentedControl label="Konten oder Kunden" value={tab} onChange={onTab} options={[{ id: "users", label: "Konten", count: users, name: `Konten: ${users}` }, { id: "customers", label: "Kunden", count: customers, name: `Kunden: ${customers}` }]} />;
}

function ManageButtons({ onCustomer, onUser }: { onCustomer: () => void; onUser: () => void }) {
  return <>
    <button type="button" className="sheet-action" onClick={onCustomer}><Building2 size={15} aria-hidden="true" />Kunde anlegen</button>
    <button type="button" className="sheet-action is-primary" onClick={onUser}><UserPlus size={15} aria-hidden="true" />Konto anlegen</button>
  </>;
}
