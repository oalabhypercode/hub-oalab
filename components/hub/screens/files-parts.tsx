"use client";

import { useState } from "react";
import { File, FileArchive, FileImage, FileText, Search } from "lucide-react";
import { categories } from "@/lib/categories";
import { fileCategories, fileFormat, type FileCategory } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubStoredFile } from "@/lib/hub-files/types";

export function FileIcon({ file, size = 22 }: { file: Pick<HubStoredFile, "mimeType" | "fileName">; size?: number }) {
  const format = fileFormat(file.fileName);
  const Icon = file.mimeType.startsWith("image/") ? FileImage : ["ZIP", "RAR", "7Z"].includes(format) ? FileArchive : ["PDF", "DOC", "DOCX", "TXT", "XLSX", "PPTX"].includes(format) ? FileText : File;
  return <Icon size={size} color={categories.files.fill} strokeWidth={1.9} aria-hidden="true" />;
}

export function CategoryPill({ category }: { category: FileCategory }) {
  return <span className={`file-category file-category-${category}`}>{fileCategories[category]}</span>;
}

/** Checkbox list of customers, searchable by customer number or company. */
export function CustomerPicker({ customers, selected, onChange, idPrefix, emptyHint = "Ohne Zuordnung landet die Datei in der Ablage" }: { customers: HubFileCustomer[]; selected: string[]; onChange: (ids: string[]) => void; idPrefix: string; emptyHint?: string }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shown = customers.filter((customer) => `${customer.customerNumber} ${customer.company}`.toLowerCase().includes(term));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return (
    <fieldset className="customer-picker">
      <legend>Kunden zuordnen <span>{selected.length ? `${selected.length} ausgewählt` : emptyHint}</span></legend>
      {customers.length > 6 && <label className="search-input customer-picker-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kundennummer oder Firma" aria-label="Kunden durchsuchen" /></label>}
      <ul>
        {shown.map((customer) => (
          <li key={customer.id}>
            <label htmlFor={`${idPrefix}-${customer.id}`}>
              <input id={`${idPrefix}-${customer.id}`} type="checkbox" checked={selected.includes(customer.id)} onChange={() => toggle(customer.id)} />
              <span className="customer-number numeric">{customer.customerNumber}</span>
              <span className="customer-company">{customer.company}</span>
            </label>
          </li>
        ))}
        {!shown.length && <li className="customer-picker-empty">{customers.length ? `Kein Kunde passt zu „${query}“.` : "Es sind noch keine Kunden angelegt."}</li>}
      </ul>
    </fieldset>
  );
}
