import Link from "next/link";
import { Chevron } from "./glass";

/** One glass card holding rows separated by inset hairlines. Rows are not glass themselves. */
export function InsetGroupedList({ children, label, className = "" }: { children: React.ReactNode; label?: string; className?: string }) {
  return <ul className={`glass inset-list ${className}`} aria-label={label}>{children}</ul>;
}

type RowContent = { icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; trailing?: React.ReactNode; chevron?: boolean };

function Content({ icon, title, subtitle, trailing, chevron = true }: RowContent) {
  return <>
    {icon && <span className="list-row-icon">{icon}</span>}
    <span className="list-row-text"><span className="list-row-title">{title}</span>{subtitle && <span className="list-row-subtitle">{subtitle}</span>}</span>
    {trailing && <span className="list-row-trailing">{trailing}</span>}
    {chevron && <Chevron />}
  </>;
}

export function ListRow({ href, onClick, compact = false, className, ...content }: RowContent & { href?: string; onClick?: () => void; compact?: boolean; className?: string }) {
  const rowClass = className ?? `list-row${compact ? " list-row-compact" : ""}${content.icon ? " has-icon" : ""}`;
  return (
    <li className={`list-item${compact ? " is-compact" : ""}${content.icon ? " has-icon" : ""}`}>
      {href ? <Link href={href} className={rowClass}><Content {...content} /></Link>
        : onClick ? <button type="button" className={rowClass} onClick={onClick}><Content {...content} /></button>
        : <div className={rowClass}><Content {...content} chevron={content.chevron ?? false} /></div>}
    </li>
  );
}

export function MiniProgress({ value, color }: { value: number; color: string }) {
  return <span className="list-progress" aria-hidden="true" style={{ background: `color-mix(in srgb, ${color} 25%, transparent)` }}><span style={{ width: `${value}%`, background: color }} /></span>;
}
