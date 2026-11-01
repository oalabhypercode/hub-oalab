"use client";

import Link from "next/link";
import { hubHref, type HubSection } from "@/lib/hub-data";
import { tabNavigation } from "./navigation";
import { useHubShell } from "./shell-context";

const inTabs = new Set<HubSection>(tabNavigation.map((item) => item.section));

/**
 * Floating glass tab bar below 1024 px: Übersicht, Projekte, Dateien, Kalender and "Mehr". While a page from "Mehr" is
 * open (Insights, Nachrichten, Profil …), "Mehr" stays marked so the way back is clear.
 */
export function GlassTabBar({ preview, section }: { preview: boolean; section: HubSection }) {
  const { account } = useHubShell();
  return (
    <>
      <div className="scroll-edge" aria-hidden="true" />
      <nav className="tab-bar-wrap" aria-label="Hauptnavigation">
        <div className="glass glass-float tab-bar">
          {tabNavigation.map(({ section: target, label, icon: Icon }) => (
            <Link key={target} href={hubHref(preview, target)} className="tab" aria-current={section === target ? "page" : target === "discover" && !inTabs.has(section) ? "true" : undefined}>
              {/* "Asset Management" does not fit under an icon; the short form keeps the label whole. */}
              <Icon size={22} strokeWidth={2} aria-hidden="true" /><span>{target === "files" && account.admin ? "Assets" : label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
