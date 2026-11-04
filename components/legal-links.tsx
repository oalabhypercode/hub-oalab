import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/legal-links";

/** "Impressum · Datenschutz" for footers and the profile: the hub's own public pages (lib/legal-links.ts). */
export function LegalLinks({ className = "legal-links" }: { className?: string }) {
  return (
    <nav className={className} aria-label="Rechtliches">
      <Link href={LEGAL_PATHS.imprint}>Impressum</Link>
      <Link href={LEGAL_PATHS.privacy}>Datenschutz</Link>
    </nav>
  );
}
