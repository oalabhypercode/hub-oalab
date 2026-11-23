"use client";

import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, Archive, ArrowUpDown, BellRing, Building2, Check, Copy, Handshake, KeyRound, ListFilter, MailX, Megaphone, Rows3, Send, Settings, ShieldCheck, Upload, UserPlus, Users } from "lucide-react";
import { displayStatusLabels, roleLabels, type DisplayStatus, type HubRole } from "@/lib/hub-users/rules";
import { entryOfLogin, groupLoginsByCompany, type CompanyGroup } from "@/lib/hub-users/company-groups";
import { customerLoginState, isFirstInvitation, isInvitable, loginStateLabels, type LoginState } from "@/lib/hub-invitations/rules";
import type { ManagedCustomer, ManagedUser, UserManagementState } from "@/lib/hub-users/types";
import { formatFileDate, formatFileDateTime } from "@/lib/hub-files/catalog";
import { packageCatalog, packageIds } from "@/lib/service-packages";
import { matchesSearch, sortRows, type SortState, type SortValue } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { SegmentedControl } from "../controls";
import { GlassCard, TitleIcon } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { LogoMark } from "../logo-mark";
import { customerOption } from "../select-options";
import { sectionIcons } from "../navigation";
import { MenuChoices, SheetActionMenu, SheetEmpty, SheetFooter, SheetToolbar, StatusGlyph, TableGroup, ToolbarMenu, useCollapsedGroups, type GlyphKind, type SheetAction } from "../sheet";
import { alphabetical, FilterSelect, SortControl, SortHeader, type SortOption } from "../table-tools";
import { CustomerPanel, FreelancerPanel, fullName, ReviewPanel, statusGlyph, UserPanel } from "./users-dialogs";
import { CustomerImportDialog } from "./users-import";
import { AnnouncementsDialog, CustomerLoginsDialog, InvitationsDialog, LaunchRemindersDialog } from "./users-logins";
import { useInfo } from "../info-box";

const ALL = "all";
/**
 * What is open: a panel at the right edge (a registration, a login, a customer, a freelancer; new without an id, a new
 * login from a customer with its entry and role chosen) or one of the bulk windows.
 */
type Dialog = { kind: "review"; userId: string } | { kind: "user"; userId?: string; customerId?: string; role?: HubRole; entryCreated?: boolean } | { kind: "customer"; customerId?: string } | { kind: "freelancer"; customerId?: string } | { kind: "import" } | { kind: "logins" } | { kind: "invite" } | { kind: "announce" } | { kind: "remind" };
const dialogFor = (user: ManagedUser): Dialog => user.status === "pending" ? { kind: "review", userId: user.id } : { kind: "user", userId: user.id };
/** A new login for a customer or a freelancer: that entry chosen, with its role. */
const loginFor = (entry: Pick<ManagedCustomer, "id" | "kind">, entryCreated = false): Dialog => ({ kind: "user", customerId: entry.id, role: entry.kind === "freelancer" ? "oalab_freelancer" : "oalab_customer", ...(entryCreated ? { entryCreated } : {}) });
/** A new admin (user 21.11.2026): the role chosen, no customer to pick; admins belong to the oalab team. */
const adminLogin: Dialog = { kind: "user", role: "oalab_admin" };
// The open row: the login, or the customer or freelancer being edited or getting a new login.
const openIdOf = (dialog: Dialog | null) => dialog?.kind === "review" ? dialog.userId : dialog?.kind === "user" ? dialog.userId ?? dialog.customerId : dialog?.kind === "customer" || dialog?.kind === "freelancer" ? dialog.customerId : undefined;

const loginStateOrder: LoginState[] = ["none", "created", "invited", "active"];
const loginStateGlyph: Record<LoginState, GlyphKind> = { none: "disabled", created: "pending", invited: "invited", active: "active" };
/** The row of a customer or freelancer (user 9.11.2026): red without a login, yellow while nobody signed in yet, plain once active. */
const loginVeil: Record<LoginState, string> = { none: " is-no-login", created: " is-awaiting-login", invited: " is-awaiting-login", active: "" };

const statusOrder: DisplayStatus[] = ["pending", "invited", "active", "disabled", "rejected"];

/** Customer number with a copy button (support calls, invoices). */
function NumberChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the number stays readable */ }
  }
  return <span className="number-chip"><span className="numeric">{value}</span><button type="button" onClick={copy} aria-label={`Kundennummer ${value} kopieren`} data-tip="Kopieren">{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}</button></span>;
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

type CustomerSortKey = "number" | "company" | "logins" | "login" | "city";
const customerSorts: Record<CustomerSortKey, SortOption<CustomerSortKey>> = {
  number: { id: "number", label: "Kunden-Nr.", dirLabels: { asc: "aufsteigend", desc: "absteigend" } },
  company: { id: "company", label: "Unternehmen", dirLabels: alphabetical },
  logins: { id: "logins", label: "Zugänge", firstDir: "desc", dirLabels: { asc: "wenigste zuerst", desc: "meiste zuerst" } },
  login: { id: "login", label: "Letzter Login", firstDir: "desc", dirLabels: { asc: "älteste zuerst", desc: "neueste zuerst" } },
  city: { id: "city", label: "Ort", dirLabels: alphabetical },
};

const initialsOf = (user: ManagedUser) => ((user.firstName[0] ?? "") + (user.lastName[0] ?? "")).toUpperCase() || "?";
const companyMark = (name: string) => name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
type Tab = "users" | "customers" | "freelancers";
/** „Zugänge“ by company first (user 21.11.2026): each customer and freelancer with its logins, the admins under oalab. */
type UserGrouping = "company" | "status" | "none";
const groupings: { id: UserGrouping; label: string; short: string }[] = [
  { id: "company", label: "Unternehmen", short: "Unternehmen" },
  { id: "status", label: "Status", short: "Status" },
  { id: "none", label: "Keine Gruppen", short: "Keine" },
];
const pendingEmpty = "Keine offenen Registrierungen. Neue Registrierungen von der Login-Seite erscheinen hier zur Freigabe.";
/**
 * A company's row among the logins by company: its name, then its number, its kind (Kunde, Freelancer, Admin), its
 * logins with their state and its newest sign-in in the table's columns, its actions on the right.
 */
type CompanyHead = { label: string; glyph: React.ReactNode; number?: React.ReactNode; kind?: React.ReactNode; logins: React.ReactNode; lastSignInAt?: string | null; actions?: React.ReactNode };
const loginCount = (count: number) => count === 1 ? "1 Zugang" : `${count} Zugänge`;

/** Names of linked entries for a cell: the first two, then "+n". */
const namesOf = (ids: string[], entries: ManagedCustomer[]) => {
  const names = ids.flatMap((id) => entries.find((entry) => entry.id === id)?.company ?? []).sort((a, b) => a.localeCompare(b, "de"));
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
};

/**
 * Admin page: one sheet with the logins (open registrations as the first group), the customers and the freelancers,
 * each with search, filters and sorting.
 */
export function UserManagementScreen({ state }: { state: UserManagementState }) {
  const { users, events } = state;
  // Every entry (customers and freelancers) for the logins; the tabs list each kind on its own. Archived entries
  // (17.11.2026) stay out of the lists and choices and wait in the folded group „Archiviert“ at the end of their tab.
  const entries = state.customers;
  const liveEntries = entries.filter((entry) => !entry.archivedAt);
  const allCustomers = entries.filter((entry) => entry.kind === "customer");
  const allFreelancers = entries.filter((entry) => entry.kind === "freelancer");
  const customers = allCustomers.filter((entry) => !entry.archivedAt);
  const freelancers = allFreelancers.filter((entry) => !entry.archivedAt);
  // The project dialog links its customer (/users?customer=<id>): the page opens on the customers with theirs open.
  const linkedId = useSearchParams().get("customer");
  const linked = allCustomers.find((customer) => customer.id === linkedId) ?? null;
  const [dialog, setDialog] = useState<Dialog | null>(() => linked ? { kind: "customer", customerId: linked.id } : null);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>(linked ? "customers" : "users");
  const groups = useCollapsedGroups();
  const [archiveOpen, setArchiveOpen] = useState(() => Boolean(linked?.archivedAt));
  // The panel reports unsaved changes; another row, another tab or closing asks before they are lost.
  const dirty = useRef(false);
  const reportDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  // A login of an archived customer in Service is no member any more; the archive remembers whose it was.
  const customerOf = (user: ManagedUser) => entryOfLogin(user, entries);
  const pending = users.filter((user) => user.status === "pending");
  const leave = () => !dirty.current || window.confirm("Deine Änderungen sind noch nicht gespeichert. Verwerfen?");
  const open = (next: Dialog) => {
    if (!leave()) return false;
    dirty.current = false;
    setNotice("");
    setDialog(next);
    return true;
  };
  const close = (discard = false) => {
    if (!discard && !leave()) return;
    dirty.current = false;
    setDialog(null);
  };
  const openUser = (user: ManagedUser) => open(dialogFor(user));
  const openId = openIdOf(dialog);
  const panelOpen = dialog !== null && dialog.kind !== "import" && dialog.kind !== "logins" && dialog.kind !== "invite" && dialog.kind !== "announce" && dialog.kind !== "remind";
  const showTab = (next: Tab) => {
    if (panelOpen && !leave()) return;
    if (panelOpen) { dirty.current = false; setDialog(null); }
    setTab(next);
  };
  // From the logins of a customer or a freelancer to one of them: the table under the panel shows the logins.
  const openFromEntry = (user: ManagedUser) => { if (open(dialogFor(user))) setTab("users"); };
  // A customer or freelancer without a login: one click opens „Zugang anlegen“ for it.
  const newLoginFor = (entryId: string) => { const entry = entries.find((item) => item.id === entryId); if (entry) open(loginFor(entry)); };
  // Right after creating a customer or a freelancer, its first login follows; its form is saved, nothing to ask.
  const afterCreate = (kind: "customer" | "freelancer") => (id: string) => { dirty.current = false; setDialog(loginFor({ id, kind }, true)); };

  // Logins
  const [userQuery, setUserQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [customerFilter, setCustomerFilter] = useState(ALL);
  const [userSort, setUserSort] = useState<SortState<UserSortKey>>({ key: "name", dir: "asc" });
  const [grouping, setGrouping] = useState<UserGrouping>("company");
  // By company, the company and its number stand in the group heading: no columns for them, no sorting by them.
  const byCompany = grouping === "company";
  const changeGrouping = (next: UserGrouping) => {
    setGrouping(next);
    if (next === "company" && (userSort.key === "company" || userSort.key === "number")) setUserSort({ key: "name", dir: "asc" });
  };
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
      && matchesSearch(userQuery, [fullName(user), user.email, user.phone, user.position, user.companyName, customer?.company, customer?.customerNumber, user.role === "oalab_admin" ? "oalab" : null, displayStatusLabels[user.displayStatus], user.role ? roleLabels[user.role] : null]);
  }), userSortValue[userSort.key], userSort.dir, { tieBreak: (user) => fullName(user) });
  const userFilters = [statusFilter, roleFilter, customerFilter].filter((value) => value !== ALL).length;
  const usersNarrowed = userQuery.trim() !== "" || userFilters > 0;
  const resetUsers = () => { setUserQuery(""); setStatusFilter(ALL); setRoleFilter(ALL); setCustomerFilter(ALL); };

  // Customers
  const [customerQuery, setCustomerQuery] = useState("");
  const [packageFilter, setPackageFilter] = useState(ALL);
  const [loginFilter, setLoginFilter] = useState(ALL);
  const [customerSort, setCustomerSort] = useState<SortState<CustomerSortKey>>({ key: "number", dir: "asc" });
  // How far each customer is with its logins: none, created, invited or active, and its newest sign-in.
  const loginsOf = (customer: ManagedCustomer) => customerLoginState(users.filter((user) => customer.memberIds.includes(user.id)));
  const customerSortValue: Record<CustomerSortKey, (customer: ManagedCustomer) => SortValue> = {
    number: (customer) => customer.customerNumber,
    company: (customer) => customer.company,
    logins: (customer) => customer.memberIds.length,
    login: (customer) => loginsOf(customer).lastSignInAt ?? "",
    city: (customer) => customer.city,
  };
  const customerMatches = (customer: ManagedCustomer) =>
    (packageFilter === ALL || (customer.packages as string[]).includes(packageFilter))
    && (loginFilter === ALL || loginsOf(customer).state === loginFilter)
    && matchesSearch(customerQuery, [customer.company, customer.customerNumber, customer.city, customer.contactEmail, customer.website, loginStateLabels[loginsOf(customer).state], ...customer.packages.map((id) => packageCatalog[id].name)]);
  const shownCustomers = sortRows(customers.filter(customerMatches), customerSortValue[customerSort.key], customerSort.dir, { tieBreak: (customer) => customer.company });
  // Archived customers: searchable, but without the filters for packages and logins (they have neither in use).
  const shownArchivedCustomers = sortRows(allCustomers.filter((customer) => customer.archivedAt && matchesSearch(customerQuery, [customer.company, customer.customerNumber, customer.city, customer.contactEmail, customer.website])), customerSortValue[customerSort.key], customerSort.dir, { tieBreak: (customer) => customer.company });
  const customerFilters = [packageFilter, loginFilter].filter((value) => value !== ALL).length;
  const customersNarrowed = customerQuery.trim() !== "" || customerFilters > 0;
  const withoutLogin = customers.filter((customer) => !customer.memberIds.length).length;
  const invitable = users.filter(isInvitable);
  const tabsInfo = useInfo("Zugänge, Kunden und Freelancer", {
    steps: [
      <><b>Zugänge</b> sind Logins, je Unternehmen; Admins unter oalab.</>,
      <><b>Erst Kunde oder Freelancer</b> anlegen, dann den Zugang dazu.</>,
      <><b>Rot:</b> noch kein Zugang. <b>Gelb:</b> noch nie angemeldet.</>,
    ],
    ask: "Was ist der Unterschied zwischen Zugängen, Kunden und Freelancern?",
  });

  // Freelancers: by name, searchable by name, number, place and their customers.
  const [freelancerQuery, setFreelancerQuery] = useState("");
  const freelancerMatches = (freelancer: ManagedCustomer) => matchesSearch(freelancerQuery, [freelancer.company, freelancer.customerNumber, freelancer.city, freelancer.contactEmail, namesOf(freelancer.linkedIds, customers)]);
  const byName = (a: ManagedCustomer, b: ManagedCustomer) => a.company.localeCompare(b.company, "de");
  const shownFreelancers = freelancers.filter(freelancerMatches).sort(byName);
  const shownArchivedFreelancers = allFreelancers.filter((freelancer) => freelancer.archivedAt && freelancerMatches(freelancer)).sort(byName);
  const shownArchived = tab === "freelancers" ? shownArchivedFreelancers : shownArchivedCustomers;

  const reviewUser = dialog?.kind === "review" ? users.find((user) => user.id === dialog.userId) : undefined;
  const editUser = dialog?.kind === "user" && dialog.userId ? users.find((user) => user.id === dialog.userId) : undefined;
  // A new login for an entry waits until the entry is in the data (right after creating it, with the refreshed page).
  const loginEntry = dialog?.kind === "user" && !dialog.userId && dialog.customerId ? entries.find((entry) => entry.id === dialog.customerId) : undefined;
  const userPanelReady = dialog?.kind === "user" && (dialog.userId ? Boolean(editUser) : !dialog.customerId || Boolean(loginEntry));
  const editCustomer = dialog?.kind === "customer" && dialog.customerId ? allCustomers.find((customer) => customer.id === dialog.customerId) : undefined;
  const editFreelancer = dialog?.kind === "freelancer" && dialog.customerId ? allFreelancers.find((freelancer) => freelancer.id === dialog.customerId) : undefined;
  // A login chooses among the entries in use; one that already belongs to an archived entry keeps it in the choice.
  const choiceEntries = entries.filter((entry) => !entry.archivedAt || Boolean(editUser?.customerIds.includes(entry.id)));
  const switcher = <span className="users-switch"><TabSwitch tab={tab} onTab={showTab} users={users.length} customers={customers.length} freelancers={state.freelancers ? freelancers.length : null} />{tabsInfo.button}{tabsInfo.box}</span>;
  const manage = <ManageButtons tab={tab} withoutLogin={withoutLogin} invitable={invitable.filter(isFirstInvitation).length} onCustomer={() => open({ kind: "customer" })} onImport={() => open({ kind: "import" })} onLogins={() => open({ kind: "logins" })} onInvite={() => open({ kind: "invite" })} onAnnounce={() => open({ kind: "announce" })} onRemind={() => open({ kind: "remind" })} onFreelancer={() => open({ kind: "freelancer" })} onUser={() => open({ kind: "user" })} onAdmin={() => open(adminLogin)} />;
  const title = <TitleIcon icon={sectionIcons.users!} />;

  if (state.error) {
    return <><LargeTitleHeader title="User Management" icon={title} actions={<HeaderActions />} /><GlassCard className="section-first"><p className="t-headline">User Management nicht verfügbar</p><p className="t-subheadline t-secondary">{state.error}</p></GlassCard></>;
  }

  const userRow = (user: ManagedUser) => {
    const customer = customerOf(user);
    const waiting = user.status === "pending";
    return (
      <tr key={user.id} className={`data-row${user.status === "disabled" || user.status === "rejected" ? " is-muted" : ""}${openId === user.id ? " is-open" : ""}`}>
        <td className="cell-person">
          <button type="button" className="row-open" onClick={() => openUser(user)}>
            <span className="avatar avatar-s" aria-hidden="true">{initialsOf(user)}</span><strong data-tip={fullName(user)}>{fullName(user)}</strong>
            {user.self && <span className="self-badge">Du</span>}
          </button>
          {/* By company, a registration's own company has no column: it stands quietly after the name. */}
          {byCompany && !customer && user.role !== "oalab_admin" && user.companyName && <span className="company-hint" data-tip="Angabe aus der Registrierung">{user.companyName}</span>}
        </td>
        {/* By company, the number belongs to the company's row above; the login leaves its column empty. */}
        {byCompany && <td className="cell-entry-number" />}
        <td className="cell-role">{user.role ? roleLabels[user.role] : <span className="cell-none">–</span>}</td>
        <td className="cell-mail">
          <span className="mail-cell"><span data-tip={user.email}>{user.email}</span>{waiting && !user.emailConfirmed && <span className="confirm-badge is-open" data-tip="Die E-Mail-Adresse ist noch nicht bestätigt">unbestätigt</span>}</span>
        </td>
        {!byCompany && <td className="cell-number col-number">{customer ? <NumberChip value={customer.customerNumber} /> : <span className="cell-none">–</span>}</td>}
        {!byCompany && <td className="cell-company">
          {customer ? <span className="company-cell"><LogoMark logo={customer.logo} initials={companyMark(customer.company)} className="company-mark" /><span className="company-name" data-tip={customer.company}>{customer.company}</span></span>
            : user.role === "oalab_admin" ? <span className="company-cell"><span className="company-mark" aria-hidden="true">OA</span>oalab</span>
            : user.companyName ? <span className="company-cell is-hint" data-tip="Angabe aus der Registrierung"><span className="company-name">{user.companyName}</span><span className="role-tag">Angabe</span></span>
            : <span className="cell-none">–</span>}
        </td>}
        <td className="cell-status"><span className="status-cell" data-tip={waiting ? `Registriert am ${formatFileDateTime(user.createdAt)}` : undefined}><StatusGlyph kind={statusGlyph[user.displayStatus]} />{waiting ? `Seit ${formatFileDate(user.createdAt)}` : displayStatusLabels[user.displayStatus]}</span></td>
        <td className="cell-login col-login">{user.lastSignInAt ? <time dateTime={user.lastSignInAt} data-tip={formatFileDateTime(user.lastSignInAt)}>{formatFileDate(user.lastSignInAt)}</time> : <span className="cell-none">noch nie</span>}</td>
        <td className="cell-action">
          {waiting ? <button type="button" className="row-check" onClick={() => openUser(user)}><ShieldCheck size={15} aria-hidden="true" />Prüfen</button>
            // Never signed in: the row leads to the activation link, which the panel offers on top.
            : user.displayStatus === "invited" ? <button type="button" className="row-invite" onClick={() => openUser(user)} aria-label={`${fullName(user)} einladen`} data-tip="Zugang öffnen und den Aktivierungslink senden"><Send size={14} aria-hidden="true" />Einladen</button>
            : <button type="button" className="row-action" onClick={() => openUser(user)} aria-label={`${fullName(user)} bearbeiten`} data-tip="Bearbeiten"><Settings size={16} aria-hidden="true" /></button>}
        </td>
      </tr>
    );
  };

  const userGroups = statusOrder.map((status) => ({ status, rows: shownUsers.filter((user) => user.displayStatus === status) }))
    // The registrations always have their group at the top, also empty: that is where new ones appear.
    .filter((group) => group.rows.length || (group.status === "pending" && !pending.length && !usersNarrowed));
  // By company the same: the registrations on top, then oalab, the companies A–Z, the rest; only groups with logins.
  const companyGroups = groupLoginsByCompany(shownUsers, entries)
    .filter((group) => group.rows.length || (group.kind === "pending" && !pending.length && !usersNarrowed));

  // ↑/↓ in the panel go through the rows as the table shows them: its tab, search, filters, sorting and open groups.
  const entryDialog = (kind: "customer" | "freelancer", customerId: string): Dialog => ({ kind, customerId });
  const rows: { id: string; dialog: Dialog }[] = tab === "users"
    ? (grouping === "status" ? userGroups.filter((group) => !groups.isCollapsed(group.status)).flatMap((group) => group.rows)
      : byCompany ? companyGroups.filter((group) => !groups.isCollapsed(group.key)).flatMap((group) => group.rows)
      : shownUsers).map((user) => ({ id: user.id, dialog: dialogFor(user) }))
    : [...(tab === "customers" ? shownCustomers : shownFreelancers), ...(archiveOpen ? shownArchived : [])].map((entry) => ({ id: entry.id, dialog: entryDialog(tab === "customers" ? "customer" : "freelancer", entry.id) }));
  const at = openId === undefined ? -1 : rows.findIndex((row) => row.id === openId);

  // A customer's row; archived ones stand muted at the end, with the logins their archive blocked.
  const customerRow = (customer: ManagedCustomer) => {
    const logins = loginsOf(customer);
    const archived = Boolean(customer.archivedAt);
    return (
      <tr key={customer.id} className={`data-row${archived ? " is-muted" : loginVeil[logins.state]}${openId === customer.id ? " is-open" : ""}`}>
        <td className="cell-person">
          <button type="button" className="row-open" onClick={() => open({ kind: "customer", customerId: customer.id })}><LogoMark logo={customer.logo} initials={companyMark(customer.company)} className="company-mark" /><strong>{customer.company}</strong></button>
          {!archived && customer.linkedIds.length > 0 && <span className="role-tag" data-tip={`Betreut von ${namesOf(customer.linkedIds, freelancers)}`}>Freelancer</span>}
        </td>
        <td className="cell-number"><NumberChip value={customer.customerNumber} /></td>
        <td className="cell-packages">{customer.packages.length ? customer.packages.map((id) => packageCatalog[id].short).join(" · ") : <span className="cell-none">–</span>}</td>
        <td className="cell-logins cell-login-state">{archived ? <ArchivedLogins entry={customer} />
          : customer.memberIds.length ? <span className="status-cell"><StatusGlyph kind={loginStateGlyph[logins.state]} />{`${customer.memberIds.length} · ${loginStateLabels[logins.state]}`}</span> : <AddLogin name={customer.company} onClick={() => newLoginFor(customer.id)} />}</td>
        <td className="cell-login col-login">{logins.lastSignInAt ? <time dateTime={logins.lastSignInAt} data-tip={formatFileDateTime(logins.lastSignInAt)}>{formatFileDate(logins.lastSignInAt)}</time> : <span className="cell-none">{customer.memberIds.length ? "noch nie" : "–"}</span>}</td>
        <td className="cell-city">{[customer.postalCode, customer.city].filter(Boolean).join(" ") || <span className="cell-none">–</span>}</td>
        <td className="cell-action"><button type="button" className="row-action" onClick={() => open({ kind: "customer", customerId: customer.id })} aria-label={`${customer.company} bearbeiten`} data-tip="Bearbeiten"><Settings size={16} aria-hidden="true" /></button></td>
      </tr>
    );
  };
  const freelancerRow = (freelancer: ManagedCustomer) => {
    const archived = Boolean(freelancer.archivedAt);
    return (
      <tr key={freelancer.id} className={`data-row${archived ? " is-muted" : loginVeil[loginsOf(freelancer).state]}${openId === freelancer.id ? " is-open" : ""}`}>
        <td className="cell-person">
          <button type="button" className="row-open" onClick={() => open({ kind: "freelancer", customerId: freelancer.id })}><LogoMark logo={freelancer.logo} initials={companyMark(freelancer.company)} className="company-mark" /><strong>{freelancer.company}</strong></button>
        </td>
        <td className="cell-number"><NumberChip value={freelancer.customerNumber} /></td>
        <td className="cell-packages">{!archived && freelancer.linkedIds.length ? namesOf(freelancer.linkedIds, customers) : <span className="cell-none">{archived ? "–" : "noch keine"}</span>}</td>
        <td className="cell-logins numeric">{archived ? <ArchivedLogins entry={freelancer} /> : freelancer.memberIds.length || <AddLogin name={freelancer.company} onClick={() => newLoginFor(freelancer.id)} />}</td>
        <td className="cell-city">{[freelancer.postalCode, freelancer.city].filter(Boolean).join(" ") || <span className="cell-none">–</span>}</td>
        <td className="cell-action"><button type="button" className="row-action" onClick={() => open({ kind: "freelancer", customerId: freelancer.id })} aria-label={`${freelancer.company} bearbeiten`} data-tip="Bearbeiten"><Settings size={16} aria-hidden="true" /></button></td>
      </tr>
    );
  };
  /** The folded group of archived entries at the end of the customers' or the freelancers' table. */
  const archiveGroup = (colSpan: number, row: (entry: ManagedCustomer) => React.ReactNode) => shownArchived.length > 0 && (
    <TableGroup colSpan={colSpan} label="Archiviert" count={shownArchived.length} glyph={<Archive size={14} aria-hidden="true" />} collapsed={!archiveOpen} onToggle={() => setArchiveOpen((value) => !value)}>
      {shownArchived.map(row)}
    </TableGroup>
  );
  /**
   * A company among the logins by company (user 21.11.2026), since 22.11.2026 as a row in the table's columns like the
   * customers' rows: logo and name, its number, its kind, its logins with their state (as under „Kunden“) and its newest
   * sign-in; „Zugang“ for one more login of this company and the gear to its data, oalab offers „Admin“. Registrations,
   * logins without a company and rejected ones have no number or kind.
   */
  const companyGroup = (group: CompanyGroup<ManagedUser, ManagedCustomer>) => {
    const entry = group.kind === "entry" ? group.entry : null;
    const state = customerLoginState(group.rows);
    const loginsCell = <span className="status-cell"><StatusGlyph kind={loginStateGlyph[state.state]} />{`${group.rows.length} · ${loginStateLabels[state.state]}`}</span>;
    const head: CompanyHead = entry ? {
      label: entry.company,
      glyph: <LogoMark logo={entry.logo} initials={companyMark(entry.company)} className="company-mark" />,
      number: <NumberChip value={entry.customerNumber} />,
      kind: <span className="role-tag">{entry.kind === "freelancer" ? "Freelancer" : "Kunde"}</span>,
      // An archived company's logins are blocked: its row says so where the others show their state.
      logins: entry.archivedAt ? <span className="status-cell" data-tip="Mit dem Archivieren gesperrt; „Wiederherstellen“ in den Stammdaten gibt die Zugänge frei"><StatusGlyph kind="disabled" />{entry.archivedLoginIds.length ? `Archiviert · ${entry.archivedLoginIds.length} gesperrt` : "Archiviert"}</span> : loginsCell,
      lastSignInAt: state.lastSignInAt,
      actions: <>
        {!entry.archivedAt && <button type="button" className="table-group-add" onClick={() => newLoginFor(entry.id)} aria-label={`Zugang für ${entry.company} anlegen`} data-tip="Weiteren Zugang für dieses Unternehmen anlegen"><UserPlus size={14} aria-hidden="true" />Zugang</button>}
        <button type="button" className="table-group-action" onClick={() => open(entryDialog(entry.kind, entry.id))} aria-label={`${entry.company} öffnen`} data-tip="Stammdaten öffnen"><Settings size={15} aria-hidden="true" /></button>
      </>,
    } : group.kind === "oalab" ? {
      label: "oalab",
      glyph: <span className="company-mark" aria-hidden="true">OA</span>,
      number: <span className="cell-none">–</span>,
      kind: <span className="role-tag">Admin</span>,
      logins: loginsCell,
      lastSignInAt: state.lastSignInAt,
      actions: <button type="button" className="table-group-add" onClick={() => open(adminLogin)} aria-label="Admin anlegen" data-tip="Weiteren Admin für das oalab-Team anlegen"><UserPlus size={14} aria-hidden="true" />Admin</button>,
    } : group.kind === "pending" ? { label: "Wartet auf Freigabe", glyph: <StatusGlyph kind={statusGlyph.pending} />, logins: <span className="status-cell"><StatusGlyph kind={statusGlyph.pending} />{`${group.rows.length} offen`}</span> }
      : group.kind === "rejected" ? { label: displayStatusLabels.rejected, glyph: <StatusGlyph kind={statusGlyph.rejected} />, logins: <span className="status-cell">{loginCount(group.rows.length)}</span> }
      : { label: "Ohne Unternehmen", glyph: <Building2 size={16} aria-hidden="true" />, logins: <span className="status-cell">{loginCount(group.rows.length)}</span> };
    return (
      <TableGroup key={group.key} colSpan={7} label={head.label} count={group.rows.length} glyph={head.glyph}
        collapsed={groups.isCollapsed(group.key)} onToggle={() => groups.toggle(group.key)} empty={group.kind === "pending" ? pendingEmpty : undefined}
        cells={<>
          <td className="cell-entry-number">{head.number}</td>
          <td className="cell-role">{head.kind}</td>
          <td className="cell-mail" />
          <td className="cell-status">{head.logins}</td>
          <td className="cell-login col-login">{head.lastSignInAt ? <time dateTime={head.lastSignInAt} data-tip={formatFileDateTime(head.lastSignInAt)}>{formatFileDate(head.lastSignInAt)}</time> : head.lastSignInAt === null ? <span className="cell-none">noch nie</span> : null}</td>
          <td className="cell-action">{head.actions && <span className="table-group-actions">{head.actions}</span>}</td>
        </>}>
        {group.rows.map(userRow)}
      </TableGroup>
    );
  };
  const panelProps = {
    onClose: close, onNotice: setNotice, onDirty: reportDirty,
    onPrev: at > 0 ? () => { open(rows[at - 1].dialog); } : undefined,
    onNext: at >= 0 && at < rows.length - 1 ? () => { open(rows[at + 1].dialog); } : undefined,
  };

  return (
    <>
      <LargeTitleHeader title="User Management" icon={title} actions={<HeaderActions />} />
      {notice && <p className="calendar-notice section-first" role="status"><Check size={18} aria-hidden="true" />{notice}</p>}
      {!state.mailConfigured && <GlassCard className="file-demo-note section-first"><MailX size={18} color="var(--accent-text)" aria-hidden="true" /><p className="t-subheadline">Der Mailversand ist noch nicht eingerichtet (SMTP-Zugang fehlt). Benachrichtigungen werden nur protokolliert; Links und Nachrichten gibst du bis dahin selbst weiter.</p></GlassCard>}

      <div className="sheet section-first sheet-fill">
        {tab === "users" ? (
          <SheetToolbar query={userQuery} onQuery={setUserQuery} placeholder="Name, E-Mail, Unternehmen, Kunden-Nr. …" label="Zugänge durchsuchen" compact
            leading={switcher} trailing={manage}>
            <ToolbarMenu icon={ListFilter} label="Filter" badge={userFilters}>
              <FilterSelect icon={Activity} name="Nach Status filtern" value={statusFilter} onChange={setStatusFilter} options={[{ value: ALL, label: "Alle Status" }, ...statusOrder.map((status) => ({ value: status, label: displayStatusLabels[status] }))]} />
              <FilterSelect icon={ShieldCheck} name="Nach Rolle filtern" value={roleFilter} onChange={setRoleFilter} options={[{ value: ALL, label: "Alle Rollen" }, { value: "oalab_customer", label: roleLabels.oalab_customer }, ...(state.freelancers ? [{ value: "oalab_freelancer", label: roleLabels.oalab_freelancer }] : []), { value: "oalab_admin", label: roleLabels.oalab_admin }, { value: "none", label: "Ohne Rolle" }]} />
              <FilterSelect icon={Building2} name="Nach Kunde filtern" value={customerFilter} onChange={setCustomerFilter} options={[{ value: ALL, label: "Alle Kunden" }, ...entries.map((customer) => customerOption(customer))]} />
            </ToolbarMenu>
            <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={userSorts[userSort.key].label}><SortControl options={Object.values(userSorts).filter((option) => !byCompany || (option.id !== "company" && option.id !== "number"))} sort={userSort} onChange={setUserSort} /></ToolbarMenu>
            <ToolbarMenu icon={Rows3} label="Gruppe" value={groupings.find((item) => item.id === grouping)!.short}>
              <MenuChoices label="Gruppieren nach" value={grouping} onChange={changeGrouping} options={groupings.map((item) => ({ id: item.id, label: item.label }))} />
            </ToolbarMenu>
          </SheetToolbar>
        ) : tab === "freelancers" ? (
          <SheetToolbar query={freelancerQuery} onQuery={setFreelancerQuery} placeholder="Name, FL-Nr., Ort, betreuter Kunde …" label="Freelancer durchsuchen" compact leading={switcher} trailing={manage} />
        ) : (
          <SheetToolbar query={customerQuery} onQuery={setCustomerQuery} placeholder="Unternehmen, Kunden-Nr., Ort, Paket …" label="Kunden durchsuchen" compact
            leading={switcher} trailing={manage}>
            <ToolbarMenu icon={ListFilter} label="Filter" badge={customerFilters}>
              <FilterSelect icon={Activity} name="Nach Paket filtern" value={packageFilter} onChange={setPackageFilter} options={[{ value: ALL, label: "Alle Pakete" }, ...packageIds.map((id) => ({ value: id, label: packageCatalog[id].name }))]} />
              <FilterSelect icon={KeyRound} name="Nach Zugangsstatus filtern" value={loginFilter} onChange={setLoginFilter} options={[{ value: ALL, label: "Alle Zugangsstatus" }, ...loginStateOrder.map((state) => ({ value: state, label: loginStateLabels[state] }))]} />
            </ToolbarMenu>
            <ToolbarMenu icon={ArrowUpDown} label="Sortierung" value={customerSorts[customerSort.key].label}><SortControl options={Object.values(customerSorts)} sort={customerSort} onChange={setCustomerSort} /></ToolbarMenu>
          </SheetToolbar>
        )}

        {tab === "users" ? (
          (byCompany ? companyGroups : userGroups).length ? (
            <div className="sheet-scroll">
              <table className={`data-table user-table${byCompany ? " is-by-company" : ""}`}>
                <caption className="visually-hidden">{byCompany ? "Zugänge nach Unternehmen: je Unternehmen Kundennummer, Art, Zugänge und letzter Login, darunter seine Zugänge mit Name, Rolle, E-Mail, Status und letztem Login" : "Zugänge mit Name, Rolle, E-Mail, Kundennummer, Unternehmen, Status und letztem Login"}</caption>
                <thead>
                  <tr>
                    <SortHeader option={userSorts.name} sort={userSort} onChange={setUserSort} />
                    {byCompany && <th scope="col" className="col-entry-number">Kunden-Nr.</th>}
                    <th scope="col">Rolle</th>
                    <th scope="col">E-Mail</th>
                    {!byCompany && <SortHeader option={userSorts.number} className="col-number" sort={userSort} onChange={setUserSort} />}
                    {!byCompany && <SortHeader option={userSorts.company} sort={userSort} onChange={setUserSort} />}
                    <SortHeader option={userSorts.status} sort={userSort} onChange={setUserSort} />
                    <SortHeader option={userSorts.login} className="col-login" sort={userSort} onChange={setUserSort} />
                    <th scope="col"><span className="visually-hidden">Prüfen oder bearbeiten</span></th>
                  </tr>
                </thead>
                {byCompany ? companyGroups.map(companyGroup) : grouping === "status" ? userGroups.map((group) => (
                  <TableGroup key={group.status} colSpan={8} label={group.status === "pending" ? "Wartet auf Freigabe" : displayStatusLabels[group.status]} count={group.rows.length}
                    glyph={<StatusGlyph kind={statusGlyph[group.status]} />} collapsed={groups.isCollapsed(group.status)} onToggle={() => groups.toggle(group.status)}
                    empty={pendingEmpty}>
                    {group.rows.map(userRow)}
                  </TableGroup>
                )) : <tbody>{shownUsers.map(userRow)}</tbody>}
              </table>
            </div>
          ) : <SheetEmpty text={users.length ? "Keine Zugänge für diese Suche oder Filter." : "Noch keine Zugänge."} onReset={usersNarrowed ? resetUsers : undefined} />
        ) : tab === "freelancers" ? (
          shownFreelancers.length || shownArchivedFreelancers.length ? (
            <div className="sheet-scroll">
              <table className="data-table customer-table">
                <caption className="visually-hidden">Freelancer mit Nummer, betreuten Kunden, Zugängen und Ort</caption>
                <thead>
                  <tr>
                    <th scope="col">Freelancer</th>
                    <th scope="col">Nummer</th>
                    <th scope="col">Betreute Kunden</th>
                    <th scope="col" className="col-count">Zugänge</th>
                    <th scope="col">Ort</th>
                    <th scope="col"><span className="visually-hidden">Bearbeiten</span></th>
                  </tr>
                </thead>
                <tbody>{shownFreelancers.map(freelancerRow)}</tbody>
                {archiveGroup(6, freelancerRow)}
              </table>
            </div>
          ) : <SheetEmpty text={allFreelancers.length ? "Kein Freelancer passt zu dieser Suche." : "Noch keine Freelancer. Lege den ersten mit „Freelancer anlegen“ an."} onReset={freelancerQuery.trim() ? () => setFreelancerQuery("") : undefined} />
        ) : shownCustomers.length || shownArchivedCustomers.length ? (
          <div className="sheet-scroll">
            <table className="data-table customer-table">
              <caption className="visually-hidden">Kunden mit Kundennummer, Unternehmen, Paketen, Zugängen mit Status, letztem Login und Ort</caption>
              <thead>
                <tr>
                  <SortHeader option={customerSorts.company} sort={customerSort} onChange={setCustomerSort} />
                  <SortHeader option={customerSorts.number} sort={customerSort} onChange={setCustomerSort} />
                  <th scope="col">Pakete</th>
                  <SortHeader option={customerSorts.logins} label="Zugänge" sort={customerSort} onChange={setCustomerSort} />
                  <SortHeader option={customerSorts.login} className="col-login" sort={customerSort} onChange={setCustomerSort} />
                  <SortHeader option={customerSorts.city} sort={customerSort} onChange={setCustomerSort} />
                  <th scope="col"><span className="visually-hidden">Bearbeiten</span></th>
                </tr>
              </thead>
              <tbody>{shownCustomers.map(customerRow)}</tbody>
              {archiveGroup(7, customerRow)}
            </table>
          </div>
        ) : <SheetEmpty text={allCustomers.length ? "Keine Kunden für diese Suche oder Filter." : "Noch keine Kunden. Lege den ersten mit „Kunde anlegen“ an."} onReset={customersNarrowed ? () => { setCustomerQuery(""); setPackageFilter(ALL); setLoginFilter(ALL); } : undefined} />}
        <SheetFooter hint={tab === "users" ? (pending.length ? `${pending.length === 1 ? "1 Registrierung wartet" : `${pending.length} Registrierungen warten`} auf Freigabe` : undefined)
          : <VeilKey states={(tab === "customers" ? customers : freelancers).map((entry) => loginsOf(entry).state)} />}>
          {users.filter((user) => user.status === "active").length} aktive Zugänge · {customers.length === 1 ? "1 Kunde" : `${customers.length} Kunden`}{freelancers.length ? ` · ${freelancers.length} Freelancer` : ""}{entries.length > liveEntries.length ? ` · ${entries.length - liveEntries.length} archiviert` : ""}
        </SheetFooter>
      </div>

      {reviewUser && <ReviewPanel key={reviewUser.id} user={reviewUser} customers={liveEntries} nextNumber={state.nextCustomerNumber} nextFreelancerNumber={state.nextFreelancerNumber} freelancers={state.freelancers} {...panelProps} />}
      {dialog?.kind === "user" && userPanelReady && <UserPanel key={dialog.userId ?? `new-${dialog.customerId ?? dialog.role ?? ""}`} user={editUser} presetCustomerId={dialog.customerId} presetRole={dialog.role} entryCreated={dialog.entryCreated} customers={choiceEntries} nextNumber={state.nextCustomerNumber} nextFreelancerNumber={state.nextFreelancerNumber} freelancers={state.freelancers} mailConfigured={state.mailConfigured} events={events.filter((event) => editUser && event.targetUserId === editUser.id)} onReview={(userId) => open({ kind: "review", userId })} {...panelProps} />}
      {dialog?.kind === "customer" && (!dialog.customerId || editCustomer) && <CustomerPanel key={dialog.customerId ?? "new"} customer={editCustomer} users={users} nextNumber={state.nextCustomerNumber} freelancers={freelancers} freelancersEnabled={state.freelancers} events={events.filter((event) => editCustomer && event.targetCustomerId === editCustomer.id)} onOpenUser={openFromEntry} onNewUser={newLoginFor} onCreated={afterCreate("customer")} {...panelProps} />}
      {dialog?.kind === "import" && <CustomerImportDialog customers={entries} onClose={() => setDialog(null)} onNotice={setNotice} />}
      {dialog?.kind === "logins" && <CustomerLoginsDialog customers={customers} users={users} onClose={() => setDialog(null)} onNotice={setNotice} />}
      {dialog?.kind === "invite" && <InvitationsDialog users={users} customers={entries} mailConfigured={state.mailConfigured} onClose={() => setDialog(null)} onNotice={setNotice} />}
      {dialog?.kind === "announce" && <AnnouncementsDialog users={users} customers={entries} mailConfigured={state.mailConfigured} onClose={() => setDialog(null)} onNotice={setNotice} />}
      {dialog?.kind === "remind" && <LaunchRemindersDialog users={users} customers={entries} mailConfigured={state.mailConfigured} onClose={() => setDialog(null)} onNotice={setNotice} />}
      {dialog?.kind === "freelancer" && (!dialog.customerId || editFreelancer) && <FreelancerPanel key={dialog.customerId ?? "new"} freelancer={editFreelancer} customers={customers} users={users} nextNumber={state.nextFreelancerNumber} events={events.filter((event) => editFreelancer && event.targetCustomerId === editFreelancer.id)} onOpenUser={openFromEntry} onNewUser={newLoginFor} onCreated={afterCreate("freelancer")} {...panelProps} />}
    </>
  );
}

/** What the red and yellow rows mean, with how many there are of each; nothing when every entry is active. */
function VeilKey({ states }: { states: LoginState[] }) {
  const none = states.filter((state) => state === "none").length;
  const open = states.filter((state) => state === "created" || state === "invited").length;
  if (!none && !open) return null;
  return <span className="veil-keys">
    {none > 0 && <span className="veil-key"><span className="veil-dot is-none" aria-hidden="true" />{none} ohne Zugang</span>}
    {open > 0 && <span className="veil-key"><span className="veil-dot is-open" aria-hidden="true" />{open} noch nie angemeldet</span>}
  </span>;
}

/** In the column „Zugänge“ of an archived entry: how many logins its archive blocked. */
function ArchivedLogins({ entry }: { entry: ManagedCustomer }) {
  const count = entry.archivedLoginIds.length;
  return count ? <span className="status-cell" data-tip="Mit dem Archivieren gesperrt; „Wiederherstellen“ gibt sie frei"><StatusGlyph kind="disabled" />{count} gesperrt</span> : <span className="cell-none">–</span>;
}

/** In the column „Zugänge“ of a customer or a freelancer without a login: one click opens „Zugang anlegen“ for it. */
function AddLogin({ name, onClick }: { name: string; onClick: () => void }) {
  return <button type="button" className="row-invite" onClick={onClick} aria-label={`Zugang für ${name} anlegen`} data-tip="Noch kein Zugang: jetzt einen anlegen"><UserPlus size={14} aria-hidden="true" />Zugang anlegen</button>;
}

/** Logins, customers and freelancers share one sheet; the switch sits where Studio has its views. Freelancers appear once the database knows them. */
function TabSwitch({ tab, onTab, users, customers, freelancers }: { tab: Tab; onTab: (tab: Tab) => void; users: number; customers: number; freelancers: number | null }) {
  const options: { id: Tab; label: string; count: number; name: string }[] = [
    { id: "users", label: "Zugänge", count: users, name: `Zugänge: ${users}` },
    { id: "customers", label: "Kunden", count: customers, name: `Kunden: ${customers}` },
  ];
  if (freelancers !== null) options.push({ id: "freelancers", label: "Freelancer", count: freelancers, name: `Freelancer: ${freelancers}` });
  return <SegmentedControl label="Zugänge, Kunden oder Freelancer" value={tab} onChange={onTab} options={options} />;
}

/**
 * Each tab's actions behind one red gear (user 9.11.2026), the one that creates its kind of entry first: customers with
 * „Kunde anlegen“, the logins for all customers without one and the import; freelancers with „Freelancer anlegen“ and a
 * login; logins with „Zugang anlegen“, „Admin anlegen“ (user 21.11.2026) and the invitations. The counts tell how
 * many are waiting.
 */
function ManageButtons({ tab, withoutLogin, invitable, onCustomer, onImport, onLogins, onInvite, onAnnounce, onRemind, onFreelancer, onUser, onAdmin }: {
  tab: Tab; withoutLogin: number; invitable: number;
  onCustomer: () => void; onImport: () => void; onLogins: () => void; onInvite: () => void; onAnnounce: () => void; onRemind: () => void; onFreelancer: () => void; onUser: () => void; onAdmin: () => void;
}) {
  const actions: SheetAction[] = tab === "customers" ? [
    { icon: Building2, label: "Kunde anlegen", hint: "Mit der nächsten freien Kundennummer", onSelect: onCustomer },
    { icon: Users, label: "Zugänge anlegen", hint: "Ein Zugang für jeden Kunden ohne Zugang", badge: withoutLogin, onSelect: onLogins },
    { icon: Upload, label: "Importieren", hint: "Kunden aus dem Sevdesk-Export (CSV)", onSelect: onImport },
  ] : tab === "freelancers" ? [
    { icon: Handshake, label: "Freelancer anlegen", hint: "Mit der nächsten freien FL-Nummer", onSelect: onFreelancer },
    { icon: UserPlus, label: "Zugang anlegen", hint: "Für einen Freelancer oder einen Kunden", onSelect: onUser },
  ] : [
    { icon: UserPlus, label: "Zugang anlegen", hint: "Mit Aktivierungslink per E-Mail", onSelect: onUser },
    { icon: ShieldCheck, label: "Admin anlegen", hint: "Für das oalab-Team, ohne Kunde", onSelect: onAdmin },
    { icon: Megaphone, label: "Ankündigung senden", hint: "Vorab-Mail mit Anleitung an Kunden ohne Anmeldung", onSelect: onAnnounce },
    { icon: BellRing, label: "Erinnerung senden", hint: "Mail zum Start an alle Kunden-Zugänge", onSelect: onRemind },
    { icon: Send, label: "Einladungen senden", hint: "An alle, die sich noch nie angemeldet haben", badge: invitable, onSelect: onInvite },
  ];
  return <SheetActionMenu label={tab === "customers" ? "Kunden verwalten" : tab === "freelancers" ? "Freelancer verwalten" : "Zugänge verwalten"} actions={actions} />;
}
