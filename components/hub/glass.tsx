import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { categories, type CategoryId } from "@/lib/categories";

type Polymorphic = { className?: string; children?: React.ReactNode };

export function GlassCard({ as: Tag = "section", feature = false, className = "", children, ...rest }: Polymorphic & { as?: "section" | "div" | "article" | "ul"; feature?: boolean } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={`glass ${feature ? "glass-card-feature" : "glass-card"} ${className}`} {...rest}>{children}</Tag>;
}

export function CategoryIcon({ category, size = 17 }: { category: CategoryId; size?: number }) {
  const { icon: Icon, fill } = categories[category];
  return <Icon className="category-icon" size={size} color={fill} strokeWidth={2.2} aria-hidden="true" />;
}

/** Round (icon) or capsule (text) glass button. Icon-only buttons need a label. */
export function GlassButton({ icon: Icon, label, children, badge = false, className = "", ...rest }: { icon?: LucideIcon; label?: string; badge?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`glass glass-float glass-button${children ? " glass-button-text" : ""} ${className}`} aria-label={children ? undefined : label} title={children ? undefined : label} {...rest}>
      {Icon && <Icon size={20} strokeWidth={2} aria-hidden="true" />}{children}{badge && <span className="glass-button-badge" aria-hidden="true" />}
    </button>
  );
}

export function GlassLinkButton({ href, icon: Icon, label, children, className = "" }: { href: string; icon?: LucideIcon; label?: string; children?: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`glass glass-float glass-button${children ? " glass-button-text" : ""} ${className}`} aria-label={children ? undefined : label} title={children ? undefined : label}>
      {Icon && <Icon size={20} strokeWidth={2} aria-hidden="true" />}{children}
    </Link>
  );
}

/** Section title directly on the background, with an optional link on the right. */
export function SectionHeader({ title, action, id }: { title: string; action?: React.ReactNode; id?: string }) {
  return <div className="section-header"><h2 className="t-title2" id={id}>{title}</h2>{action}</div>;
}

export function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="section-header-action" href={href}>{children}</Link>;
}

export function Chevron({ size = 18 }: { size?: number }) {
  return <ChevronRight className="card-chevron" size={size} strokeWidth={2.5} aria-hidden="true" />;
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="metric-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <div key={index} className="glass glass-card skeleton-card"><span className="skeleton-bar" /><span className="skeleton-bar" /><span className="skeleton-bar" /></div>)}
    </div>
  );
}
