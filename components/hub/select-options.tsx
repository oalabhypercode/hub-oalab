import type { CSSProperties } from "react";
import { fileCategories, fileCategoryIds, type FileCategory } from "@/lib/hub-files/catalog";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { companyInitials, LogoMark } from "./logo-mark";
import type { SelectOption } from "./select";

/** Options the hub's lists share (components/hub/select.tsx), so a category or a customer looks the same in every list. */

/** The colour dot of a file category, the same as in the tables (.file-dot-*). */
export const categoryDot = (id: FileCategory) => <span className={`file-dot file-dot-${id}`} aria-hidden="true"><i /></span>;

export const categoryOptions = (): SelectOption[] => fileCategoryIds.map((id) => ({ value: id, label: fileCategories[id], lead: categoryDot(id) }));

/** A customer with logo (or initials) in front and the customer number as muted prefix. */
export const customerOption = (customer: { id: string; company: string; customerNumber: string; logo?: CustomerLogo | null }, group?: string): SelectOption => ({
  value: customer.id,
  label: customer.company,
  prefix: customer.customerNumber,
  lead: <LogoMark logo={customer.logo} initials={companyInitials(customer.company)} className="company-mark" />,
  group,
});

/** A round dot in the colour of a tone (ok, todo, info, off, bad), for states. */
export const toneDot = (tone: string) => <i className="select-dot is-round" style={{ "--dot": `var(--tone-${tone}-bar)` } as CSSProperties} aria-hidden="true" />;
