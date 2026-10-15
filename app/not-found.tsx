import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return <main className="not-found-page"><span className="eyebrow">404 / KURZ VERLAUFEN.</span><h1>Neue Wege.<br />Aber nicht dieser.</h1><p>Diese Seite gibt es nicht. Zurück geht es hier.</p><Link className="button-primary" href="/"><ArrowLeft size={17} />Zur Startseite</Link></main>;
}
