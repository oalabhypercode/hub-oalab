import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { BackgroundLayer } from "@/components/hub/background-layer";
import { Wordmark } from "@/components/hub/wordmark";
import { LegalLinks } from "@/components/legal-links";

export default function NotFound() {
  return (
    <main className="auth-page">
      <BackgroundLayer />
      <header className="auth-topbar"><Wordmark href="/" /></header>
      <div className="auth-layout auth-layout-single">
        <section className="glass glass-float auth-card">
          <div className="auth-form"><span className="auth-success-icon" aria-hidden="true"><Compass size={26} /></span><span className="eyebrow">404 · Kurz verlaufen.</span><h1>Neue Wege.<br />Aber nicht dieser.</h1><p>Diese Seite gibt es nicht. Zurück geht es hier.</p><Link className="button-primary full-width" href="/"><ArrowLeft size={18} aria-hidden="true" />Zur Startseite</Link></div>
        </section>
      </div>
      <footer className="auth-footer auth-footer-single"><span>oalab Client Hub</span><LegalLinks className="legal-links auth-legal-links" /></footer>
    </main>
  );
}
