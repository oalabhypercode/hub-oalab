/**
 * Who runs the hub, for the imprint (§ 5 DDG), the privacy policy (Art. 13 DSGVO) and the service contracts: one place
 * for all three. The address is the one the GbR uses in its contracts (confirmed 5.11.2026). Self-contained, so
 * `node --test` reads it directly.
 */
export const OPERATOR = {
  name: "OALab by Sameh & Hashoorzada GbR",
  partners: ["Mohammad Ali Sameh", "Omed Hashoorzada"],
  street: "Osterstrasse 28",
  city: "48163 Münster",
  country: "Deutschland",
  phone: "+49 176 82570173",
  phoneHref: "tel:+4917682570173",
  email: "info@oalab.de",
  vatId: "DE451293303",
} as const;

/** "Stand" of the privacy policy: the day its content was last checked against the code. Move it with every change. */
export const PRIVACY_POLICY_DATE = "8. November 2026";
