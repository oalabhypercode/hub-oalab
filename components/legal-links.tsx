import { legalLinks } from "@/lib/legal-links";

/** "Impressum · Datenschutz" for footers; renders nothing until the addresses are configured. */
export function LegalLinks({ className = "legal-links" }: { className?: string }) {
  const links = [
    legalLinks.imprint && { href: legalLinks.imprint, label: "Impressum" },
    legalLinks.privacy && { href: legalLinks.privacy, label: "Datenschutz" },
  ].filter((link): link is { href: string; label: string } => Boolean(link));
  if (!links.length) return null;
  return <nav className={className} aria-label="Rechtliches">{links.map((link) => <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</nav>;
}
