"use client";

import { formatPatchDate, patchKindLabels, patchPackagesFor } from "@/lib/patch-notes";
import { HeaderActions } from "../app-shell";
import { GlassCard } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { useHubShell } from "../shell-context";

/** Every change to the hub, one package per go-live. Real admins see all entries, everyone else the ones for customers. */
export function PatchNotesScreen() {
  const { manageUsers } = useHubShell();
  const packages = patchPackagesFor(manageUsers);
  return (
    <>
      <LargeTitleHeader title="Patch Notes" actions={<HeaderActions />} />
      <p className="section-first t-subheadline patch-intro">
        {manageUsers
          ? "Alle Änderungen am Hub, ein Paket pro Livegang. Einträge mit „Intern“ sehen nur Admins."
          : "Was sich am Client Hub geändert hat, ein Paket pro Livegang."}
      </p>
      {packages.map((item) => (
        <GlassCard key={item.number} as="article" className="patch-package stack-gap" aria-labelledby={`patch-${item.number}`}>
          <p className="patch-meta t-footnote t-secondary"><span>Paket {item.number}</span><time dateTime={item.date}>{formatPatchDate(item.date)}</time></p>
          <h2 className="t-title3" id={`patch-${item.number}`}>{item.title}</h2>
          {manageUsers && <p className="t-subheadline t-secondary patch-summary">{item.summary}</p>}
          <ul className="patch-changes">
            {item.changes.map((change) => (
              <li key={change.title}>
                <span className={`project-status patch-kind patch-kind-${change.kind}`}>{patchKindLabels[change.kind]}</span>
                <div>
                  <p className="t-headline">{change.title}{manageUsers && !change.customers && <span className="patch-internal">Intern</span>}</p>
                  <p className="t-subheadline t-secondary">{change.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </GlassCard>
      ))}
    </>
  );
}
