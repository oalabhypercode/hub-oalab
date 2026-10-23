"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { hubHref, sectionLabel, type HubSection } from "@/lib/hub-data";
import { hubNavigation } from "./navigation";
import { useHubShell } from "./shell-context";

/** Floating glass tab bar below 1024 px with the sidebar's entries and a separate search button for "Entdecken". */
export function GlassTabBar({ preview, section }: { preview: boolean; section: HubSection }) {
  const { account } = useHubShell();
  return (
    <>
      <div className="scroll-edge" aria-hidden="true" />
      <nav className="tab-bar-wrap" aria-label="Hauptnavigation">
        <div className="glass glass-float tab-bar">
          {hubNavigation.map(({ section: target, icon: Icon }) => (
            <Link key={target} href={hubHref(preview, target)} className="tab" aria-current={section === target ? "page" : undefined}>
              <Icon size={24} strokeWidth={2} aria-hidden="true" /><span>{sectionLabel(target, account.admin)}</span>
            </Link>
          ))}
        </div>
        <Link href={hubHref(preview, "discover")} className="glass glass-float tab-search" aria-label="Entdecken und suchen" aria-current={section === "discover" ? "page" : undefined}>
          <Search size={24} strokeWidth={2} aria-hidden="true" />
        </Link>
      </nav>
    </>
  );
}
