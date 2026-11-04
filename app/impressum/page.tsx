import type { Metadata } from "next";
import { LegalCard, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { OPERATOR } from "@/lib/legal-details";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Impressum des oalab Client Hub: Anbieter, Kontakt und Pflichtangaben nach § 5 DDG.",
};

export default function ImprintPage() {
  return (
    <LegalPage title="Impressum" lead="Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG) für den oalab Client Hub unter hub.oalab.de.">
      <LegalSection id="anbieter" title="Anbieter">
        <LegalCard>
          <strong>{OPERATOR.name}</strong><br />
          {OPERATOR.street}<br />
          {OPERATOR.city}<br />
          {OPERATOR.country}
        </LegalCard>
        <p>Vertreten durch die Gesellschafter {OPERATOR.partners.join(" und ")}.</p>
      </LegalSection>
      <LegalSection id="kontakt" title="Kontakt">
        <p>
          Telefon: <a href={OPERATOR.phoneHref}>{OPERATOR.phone}</a><br />
          E-Mail: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        </p>
      </LegalSection>
      <LegalSection id="umsatzsteuer" title="Umsatzsteuer">
        <p>Umsatzsteuer-Identifikationsnummer nach § 27a Umsatzsteuergesetz: {OPERATOR.vatId}</p>
      </LegalSection>
      <LegalSection id="streitbeilegung" title="Verbraucherstreitbeilegung">
        <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
      </LegalSection>
    </LegalPage>
  );
}
