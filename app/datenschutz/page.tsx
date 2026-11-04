import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PrivacyPolicy } from "@/components/legal/privacy-policy";
import { PRIVACY_POLICY_DATE } from "@/lib/legal-details";

export const metadata: Metadata = {
  title: "Datenschutz",
  description: "Datenschutzerklärung des oalab Client Hub: welche Daten der Hub verarbeitet, wozu, und welche Rechte du hast.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Datenschutzerklärung"
      lead="Hier erfährst du, welche personenbezogenen Daten der oalab Client Hub unter hub.oalab.de verarbeitet, wozu, und welche Rechte du hast. Für unsere Website oalab.de gilt deren eigene Datenschutzerklärung."
      stand={PRIVACY_POLICY_DATE}
    >
      <PrivacyPolicy />
    </LegalPage>
  );
}
