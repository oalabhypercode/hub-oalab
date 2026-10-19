"use client";

import Link from "next/link";
import { FolderOpen, LayoutGrid, MessageSquare, Search } from "lucide-react";
import { hubHref, type HubSection } from "@/lib/hub-data";

const tabs = [
  { section: "overview", label: "Übersicht", icon: LayoutGrid },
  { section: "projects", label: "Projekte", icon: FolderOpen },
  { section: "messages", label: "Nachrichten", icon: MessageSquare },
] as const;

/** Floating glass tab bar for phones, with a separate search button that opens "Entdecken". */
export function GlassTabBar({ preview, section, onNavigate }: { preview: boolean; section: HubSection; onNavigate: () => void }) {
  return (
    <>
      <div className="scroll-edge" aria-hidden="true" />
      <nav className="tab-bar-wrap" aria-label="Hauptnavigation">
        <div className="glass glass-float tab-bar">
          {tabs.map(({ section: target, label, icon: Icon }) => (
            <Link key={target} href={hubHref(preview, target)} onClick={onNavigate} className="tab" aria-current={section === target ? "page" : undefined}>
              <Icon size={24} strokeWidth={2} aria-hidden="true" /><span>{label}</span>
            </Link>
          ))}
        </div>
        <Link href={hubHref(preview, "discover")} onClick={onNavigate} className="glass glass-float tab-search" aria-label="Entdecken und suchen" aria-current={section === "discover" ? "page" : undefined}>
          <Search size={24} strokeWidth={2} aria-hidden="true" />
        </Link>
      </nav>
    </>
  );
}
