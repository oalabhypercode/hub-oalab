// Fictional example files ("Servicevertrag", "Logo-Datei") for the demo customers.
// Deterministic output, so seeding twice uploads identical bytes.

export const sampleCustomers = [
  { slug: "nordlicht", customerNumber: "KD-24017", company: "Nordlicht Studio", servicePackage: "Oalab-Website extra", initial: "N", color: "#FF9500", email: "nordlicht@demo.oalab.test" },
  { slug: "formfeld", customerNumber: "KD-24023", company: "Form & Feld", servicePackage: "Oalab-Website lite", initial: "F", color: "#34C759", email: "formfeld@demo.oalab.test" },
  { slug: "horizont", customerNumber: "KD-24031", company: "Studio Horizont", servicePackage: "Oalab-Website Max", initial: "H", color: "#30B0C7", email: "horizont@demo.oalab.test" },
];

/** Minimal single-page PDF (Helvetica, WinAnsi) with correct cross-reference offsets. */
export function samplePdf(title, lines) {
  const escape = (text) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = ["BT", "/F1 20 Tf", "72 770 Td", `(${escape(title)}) Tj`, "/F1 11 Tf", "0 -36 Td", ...lines.flatMap((line) => [`(${escape(line)}) Tj`, "0 -18 Td"]), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf, "latin1");
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function serviceContract(customer) {
  return samplePdf("Servicevertrag - Beispiel (fiktiv)", [
    `Kunde: ${customer.company}`,
    `Kundennummer: ${customer.customerNumber}`,
    `Servicepaket: ${customer.servicePackage}`,
    "Laufzeit: 12 Monate ab 1. Oktober 2026, danach monatlich kündbar",
    "Leistungen: Hosting, Wartung, Sicherheitsupdates und Support",
    "",
    "Dieses Dokument ist ein fiktives Beispiel für die Demo des oalab Client Hub.",
    "Es begründet keine Rechte oder Pflichten.",
  ]);
}

export function logoFile(customer) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160" viewBox="0 0 480 160">
  <rect width="480" height="160" rx="24" fill="#1C1C1E"/>
  <circle cx="80" cy="80" r="44" fill="${customer.color}"/>
  <text x="80" y="96" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700" text-anchor="middle" fill="#1C1C1E">${customer.initial}</text>
  <text x="148" y="90" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#FFFFFF">${escapeXml(customer.company)}</text>
  <text x="148" y="122" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#A1A1A6">Beispiel-Logo (fiktiv)</text>
</svg>
`, "utf8");
}

/** Both example files of a customer with their hub metadata. */
export function sampleFiles(customer) {
  return [
    {
      key: "servicevertrag",
      fileName: `Servicevertrag ${customer.company}.pdf`,
      title: "Servicevertrag",
      category: "contract",
      description: `Fiktiver Beispielvertrag zum Servicepaket ${customer.servicePackage}: Laufzeit, Leistungen und Konditionen.`,
      mimeType: "application/pdf",
      bytes: serviceContract(customer),
    },
    {
      key: "logo",
      fileName: `Logo ${customer.company}.svg`,
      title: "Logo-Datei",
      category: "brand",
      description: "Fiktives Beispiel-Logo als Vektordatei (SVG) für Website, Social Media und Druck.",
      mimeType: "image/svg+xml",
      bytes: logoFile(customer),
    },
  ];
}
