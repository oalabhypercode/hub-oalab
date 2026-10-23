"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { hubHref } from "@/lib/hub-data";
import { useHubShell } from "./shell-context";

/**
 * Large title directly on the background. After ~40 px of scrolling a compact,
 * sticky glass bar with the title fades in and the large title scrolls away.
 */
export function LargeTitleHeader({ title, date, actions, leading, icon }: { title: string; date?: string; actions?: React.ReactNode; leading?: React.ReactNode; icon?: React.ReactNode }) {
  const { preview, initials } = useHubShell();
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => { frame = 0; setCompact(window.scrollY > 40); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, []);

  return (
    <>
      <div className={`glass compact-nav${compact ? " is-visible" : ""}`} aria-hidden="true"><span>{title}</span></div>
      <header className="large-title-header">
        {leading && <div className="large-title-leading">{leading}</div>}
        {date && <p className="large-title-date">{date}</p>}
        <div className="large-title-row">
          <div className="large-title-text">
            {/* A soft hyphen keeps long words like "Management" from breaking at a random letter on phones. */}
            <h1 className="t-large-title">{icon}{title.replace(/Management/g, "Manage­ment")}</h1>
          </div>
          <div className="large-title-actions">
            {actions}
            <Link href={hubHref(preview, "settings")} className="glass glass-float mobile-avatar" aria-label="Profil & Darstellung">{initials}</Link>
          </div>
        </div>
      </header>
    </>
  );
}
