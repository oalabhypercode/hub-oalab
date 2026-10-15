import Link from "next/link";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { BrandLogo, Wordmark } from "@/components/hub/wordmark";

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="Willkommen bei oalab">
        <div className="auth-visual-top"><Wordmark href="/" light /><span className="tiny-label">DEIN CLIENT HUB.</span></div>
        <div className="auth-editorial"><span className="eyebrow">GUTE IDEEN BRAUCHEN EIN WIR.</span><h1>Zusammen.<br />Weiter.</h1><p>Ein Ort für deine Projekte.<br />Und alles, was wir gemeinsam bewegen.</p></div>
        <div className="auth-sculpture" aria-hidden="true"><BrandLogo /></div>
        <div className="auth-visual-bottom"><span>Von der ersten Idee.<br />Bis zum guten Gefühl.</span><span className="auth-big-arrow" aria-hidden="true">↗</span></div>
      </section>
      <section className="auth-form-side"><header className="auth-form-header"><Link className="text-action" href="/preview">Ein erster Einblick <ArrowUpRight size={16} /></Link></header><div className="auth-form-container">{children}</div><footer className="auth-form-footer"><span>oalab Client Hub</span><span><LockKeyhole size={12} />Dein geschützter Workspace</span></footer></section>
    </main>
  );
}
