"use client";

import { Fragment } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { hubHref, sectionLabel, type HubSection } from "@/lib/hub-data";
import { chatNavigation, hubNavigation, mainNavigation, newTabLinkProps } from "./navigation";
import { useHubShell } from "./shell-context";

/** Floating glass tab bar below 1024 px with the sidebar's entries and a separate search button for "Entdecken". */
export function GlassTabBar({ preview, section }: { preview: boolean; section: HubSection }) {
  const { account } = useHubShell();
  return (
    <>
      <div className="scroll-edge" aria-hidden="true" />
      <nav className="tab-bar-wrap" aria-label="Hauptnavigation">
        <div className="glass glass-float tab-bar">
          {hubNavigation.map(({ section: target, icon: Icon }, index) => (
            <Fragment key={target}>
              <Link href={hubHref(preview, target)} className="tab" aria-current={section === target ? "page" : undefined}>
                <Icon size={24} strokeWidth={2} aria-hidden="true" /><span>{sectionLabel(target, account.admin)}</span>
              </Link>
              {/* Same place as in the sidebar: right after the main entries. */}
              {index === mainNavigation.length - 1 && (
                <a href={chatNavigation.href} {...newTabLinkProps} className="tab">
                  <chatNavigation.icon size={24} strokeWidth={2} aria-hidden="true" /><span>{chatNavigation.label}</span><span className="visually-hidden"> (öffnet in neuem Tab)</span>
                </a>
              )}
            </Fragment>
          ))}
        </div>
        <Link href={hubHref(preview, "discover")} className="glass glass-float tab-search" aria-label="Entdecken und suchen" aria-current={section === "discover" ? "page" : undefined}>
          <Search size={24} strokeWidth={2} aria-hidden="true" />
        </Link>
      </nav>
    </>
  );
}
