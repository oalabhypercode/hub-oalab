import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BackgroundLayer } from "@/components/hub/background-layer";
import { Wordmark } from "@/components/hub/wordmark";
import { LegalLinks } from "@/components/legal-links";

/**
 * Imprint and privacy policy: the hub's background and top bar like the sign-in pages, the text on an opaque sheet
 * so long reading stays easy in light and dark. Public for everyone; "Zum Client Hub" leads signed-in logins to the
 * dashboard and everyone else to the sign-in (lib/auth-redirect.ts).
 */
export function LegalPage({ title, lead, stand, children }: { title: string; lead?: string; stand?: string; children: React.ReactNode }) {
  return (
    <main className="auth-page legal-page">
      <BackgroundLayer />
      <header className="auth-topbar"><Wordmark href="/" /></header>
      <article className="legal-sheet" aria-labelledby="legal-title">
        <Link className="legal-back" href="/"><ArrowLeft size={16} aria-hidden="true" />Zum Client Hub</Link>
        <p className="legal-eyebrow">Rechtliches</p>
        <h1 id="legal-title">{title}</h1>
        {lead && <p className="legal-lead">{lead}</p>}
        {stand && <p className="legal-stand">Stand: {stand}</p>}
        {children}
      </article>
      <footer className="auth-footer"><span>oalab Client Hub</span><LegalLinks className="legal-links auth-legal-links" /></footer>
    </main>
  );
}

/** One numbered part of a legal text; its id is the anchor of the table of contents. */
export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} aria-labelledby={`${id}-title`}><h2 id={`${id}-title`}>{title}</h2>{children}</section>;
}

/** An address or a provider, set apart from the running text. */
export function LegalCard({ children }: { children: React.ReactNode }) {
  return <div className="legal-card">{children}</div>;
}

/** The table of contents of a longer text. */
export function LegalContents({ sections }: { sections: readonly { id: string; title: string }[] }) {
  return (
    <nav className="legal-toc" aria-label="Inhalt">
      <strong>Inhalt</strong>
      <ol>{sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol>
    </nav>
  );
}
