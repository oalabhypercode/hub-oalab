"use client";

import Link from "next/link";
import { hubHref, type HubSection } from "@/lib/hub-data";
import { tabNavigation } from "./navigation";
import { useHubShell } from "./shell-context";

const inTabs = new Set<HubSection>(tabNavigation.map((item) => item.section));

/**
 * Floating glass tab bar below 1024 px: Übersicht, Dateien, Nachrichten, Kalender and "Mehr". Nachrichten carries the
 * number of unread conversations. While a page from "Mehr" is open (Projekte, Insights, Profil …), "Mehr" stays marked
 * so the way back is clear.
 */
export function GlassTabBar({ preview, section, badges = {} }: { preview: boolean; section: HubSection; badges?: Partial<Record<HubSection, number>> }) {
  const { account } = useHubShell();
  return (
    <>
      <div className="scroll-edge" aria-hidden="true" />
      <nav className="tab-bar-wrap" aria-label="Hauptnavigation">
        <div className="glass glass-float tab-bar">
          {tabNavigation.map(({ section: target, label, icon: Icon }) => {
            const badge = badges[target] ?? 0;
            return (
              <Link key={target} href={hubHref(preview, target)} className="tab" aria-current={section === target ? "page" : target === "discover" && !inTabs.has(section) ? "true" : undefined}>
                {/* "Asset Management" does not fit under an icon; the short form keeps the label whole. */}
                <Icon size={22} strokeWidth={2} aria-hidden="true" /><span>{target === "files" && (account.admin || account.freelancer) ? "Assets" : label}</span>
                {badge > 0 && <span className="tab-badge"><span className="visually-hidden">Ungelesen: </span>{badge > 99 ? "99+" : badge}</span>}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
