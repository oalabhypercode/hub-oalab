/**
 * Who runs the hub, for the imprint (§ 5 DDG) and the privacy policy (Art. 13 DSGVO): one place for both pages.
 * The details match the imprint of oalab.de. Self-contained, so `node --test` reads it directly.
 */
export const OPERATOR = {
  name: "OALab by Sameh & Hashoorzada GbR",
  partners: ["Mohammad Ali Sameh", "Omed Hashoorzada"],
  street: "Neustrasse 3",
  city: "48167 Münster",
  country: "Deutschland",
  phone: "+49 176 82570173",
  phoneHref: "tel:+4917682570173",
  email: "info@oalab.de",
  vatId: "DE451293303",
} as const;

/** "Stand" of the privacy policy: the day its content was last checked against the code. Move it with every change. */
export const PRIVACY_POLICY_DATE = "4. November 2026";
