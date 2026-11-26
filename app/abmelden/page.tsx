import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { MiniLoader } from "@/components/brand-loader";
import { LegalCard, LegalPage } from "@/components/legal/legal-page";
import { readInfoMailsLink } from "@/lib/hub-mail/opt-out-server";
import { OPERATOR } from "@/lib/legal-details";
import { switchInfoMails } from "./actions";

export const metadata: Metadata = { title: "Infomails", robots: { index: false, follow: false } };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

// Behind „Infomails abbestellen“ at the foot of every info mail (lib/hub-mail/opt-out.ts), without a session: the
// signed link stands for one login. Opening the page changes nothing, as mail scanners open links; the button does,
// and the same page then offers the way back.
async function Choice({ searchParams }: PageProps) {
  await connection();
  const query = await searchParams;
  const userId = one(query.u);
  const signature = one(query.sig);
  const link = await readInfoMailsLink(userId, signature);
  if (link.state === "invalid") {
    return (
      <section className="optout">
        <p>Dieser Link ist nicht vollständig oder nicht mehr gültig. Schreib uns einfach an <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>, dann tragen wir dich aus.</p>
      </section>
    );
  }
  return (
    <section className="optout">
      {query.fehler === "1" && <p className="form-error" role="alert">Das hat gerade nicht geklappt. Bitte versuch es noch einmal.</p>}
      <LegalCard>{link.wanted ? <>Unsere Infomails gehen an <strong>{link.email}</strong>.</> : <>An <strong>{link.email}</strong> gehen keine Infomails mehr.</>}</LegalCard>
      <p>{link.wanted ? "Mit einem Klick bestellst du sie ab. Hier kannst du sie jederzeit wieder bestellen." : "Du hast unsere Infomails abbestellt. Möchtest du sie doch wieder bekommen?"}</p>
      <form action={switchInfoMails} className="optout-form">
        <input type="hidden" name="u" value={userId} />
        <input type="hidden" name="sig" value={signature} />
        <input type="hidden" name="wanted" value={link.wanted ? "0" : "1"} />
        <button type="submit" className={link.wanted ? "button-primary" : "button-secondary"}>{link.wanted ? "Infomails abbestellen" : "Wieder bestellen"}</button>
      </form>
      <p>Benachrichtigungen zu Terminen, Dateien und Nachrichten sowie E-Mails zu deinem Zugang bekommst du weiter. Die Benachrichtigungen schaltest du im Client Hub im Profil unter „Benachrichtigungen“ ab.</p>
    </section>
  );
}

export default function Page({ searchParams }: PageProps) {
  return (
    <LegalPage eyebrow="E-Mail" title="Infomails von oalab" lead="Hier legst du fest, ob du unsere Infomails zum Client Hub und zur Serviceplattform bekommst, etwa zum Start, mit Anleitungen und Neuigkeiten.">
      <Suspense fallback={<div className="optout" role="status" aria-label="Wird geladen"><MiniLoader size={24} /></div>}><Choice searchParams={searchParams} /></Suspense>
    </LegalPage>
  );
}
