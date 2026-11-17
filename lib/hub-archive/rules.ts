/**
 * Archived customers and freelancers (17.11.2026): an admin archives one in the user management, and it disappears
 * from every other screen of the hub, with its files, folders, appointments, chats, contracts, accesses, projects,
 * tasks and service requests. Nothing is deleted; „Wiederherstellen“ brings it back. A customer also counts as
 * archived when its Service organization is archived, so the organization of a deleted customer (Service keeps it,
 * archived, with its requests) stays out of sight too.
 *
 * Pure rules for the loaders; lib/hub-archive/server.ts reads the state.
 */
export type ArchiveState = {
  /** Hub customers and freelancers out of sight: archived themselves or through their Service organization. */
  readonly customerIds: ReadonlySet<string>;
  /** Service organizations out of sight: archived in Service or belonging to an archived hub customer. */
  readonly organizationIds: ReadonlySet<string>;
};

export const noArchive: ArchiveState = { customerIds: new Set(), organizationIds: new Set() };

export const isArchivedCustomer = (archive: ArchiveState, customerId: string | null | undefined) => Boolean(customerId && archive.customerIds.has(customerId));
export const isArchivedOrganization = (archive: ArchiveState, organizationId: string | null | undefined) => Boolean(organizationId && archive.organizationIds.has(organizationId));

/** Rows of customers that are not archived (by `id`). */
export const withoutArchivedCustomers = <T extends { id: string }>(archive: ArchiveState, rows: readonly T[]) => rows.filter((row) => !archive.customerIds.has(row.id));

/**
 * Whether a file stays in sight: unassigned files stay, a file only archived customers hold goes. A file that is also
 * assigned to others stays and simply loses the archived ones from its list.
 */
export const fileInSight = (archive: ArchiveState, customerIds: readonly string[]) => !customerIds.length || customerIds.some((id) => !archive.customerIds.has(id));
