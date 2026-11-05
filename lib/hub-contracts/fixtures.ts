import type { CustomerPackage, PackageId } from "@/lib/service-packages";
import type { DomainCheck, DomainStatus, LoginKind, MailboxKind } from "@/lib/hub-domains/rules";
import type { CustomerDomain, DomainMailState, Mailbox, MailServer, ProviderLogin } from "@/lib/hub-domains/types";
import type { ContractCustomer, ContractsState, TimelineEntry } from "./types";

// Fictional packages and timelines of the three demo customers (/preview and the demo logins). Ids are the customer
// numbers, as with the example files, so an entry can link the customer's example contract.

type FixtureEntry = Pick<TimelineEntry, "occurredOn" | "kind" | "title" | "amountCents" | "customerVisible"> & { note?: string; source?: "manual" | "package"; linksContract?: true };
type FixtureDomain = { domain: string; status: DomainStatus; registrar: string; dns: string; website: string; owner: "oalab" | "customer"; renewsOn: string | null; checks: DomainCheck[]; note?: string };
type FixtureMail = {
  domains: FixtureDomain[];
  /** Only with OALAB Domain & Mail. */
  server?: { provider: string; host: string };
  /** Address, kind, person, target, password stored. */
  mailboxes: [string, MailboxKind, string, string, boolean][];
  /** Kind, label, login address, user name, password stored. */
  logins: [LoginKind, string, string, string, boolean][];
};
type Fixture = { company: string; packages: [PackageId | null, string | null, string | null][]; timeline: FixtureEntry[]; mail: FixtureMail };

const fixtures: Record<string, Fixture> = {
  "KD-24017": {
    company: "Nordlicht Studio",
    packages: [["domain-mail", "2026-03-01", null], ["service-max", "2026-10-01", null]],
    timeline: [
      { occurredOn: "2026-10-06", kind: "invoice_paid", title: "Rechnung Oktober bezahlt", amountCents: 8900, customerVisible: true, note: "Per Überweisung eingegangen." },
      { occurredOn: "2026-10-01", kind: "invoice_sent", title: "Rechnung Oktober gestellt", amountCents: 8900, customerVisible: true },
      { occurredOn: "2026-10-01", kind: "package", title: "Wechsel von OALAB Service Lite zu OALAB Service Max", amountCents: null, customerVisible: true, source: "package", linksContract: true },
      { occurredOn: "2026-03-04", kind: "mail", title: "Postfächer info@ und jana@ eingerichtet", amountCents: null, customerVisible: true, note: "Weiterleitung von hallo@ auf info@." },
      { occurredOn: "2026-03-01", kind: "domain", title: "Domain nordlicht.example umgezogen", amountCents: null, customerVisible: false, note: "Umzug vom alten Anbieter, DNS-Einträge übernommen." },
      { occurredOn: "2026-03-01", kind: "package", title: "OALAB Domain & Mail gebucht", amountCents: null, customerVisible: false, source: "package" },
    ],
    mail: {
      domains: [
        { domain: "nordlicht.example", status: "active", registrar: "Beispiel-Registrar", dns: "Beispiel-DNS", website: "Beispiel-Hosting", owner: "customer", renewsOn: "2026-12-01", checks: ["website", "ssl", "mx", "spf", "dkim", "dmarc"], note: "Umzug vom alten Anbieter im März, DNS-Einträge übernommen." },
        { domain: "nordlicht-studio.example", status: "active", registrar: "Beispiel-Registrar", dns: "Beispiel-DNS", website: "Weiterleitung auf nordlicht.example", owner: "oalab", renewsOn: "2027-03-01", checks: ["website", "ssl", "mx", "spf"] },
      ],
      server: { provider: "Beispiel-Mailhoster", host: "mail.beispiel-hosting.example" },
      mailboxes: [
        ["info@nordlicht.example", "mailbox", "Jana Sommer", "", true],
        ["jana@nordlicht.example", "mailbox", "Jana Sommer", "", true],
        ["hallo@nordlicht.example", "forward", "", "info@nordlicht.example", false],
        ["kontakt@nordlicht.example", "alias", "", "info@nordlicht.example", false],
      ],
      logins: [
        ["registrar", "Beispiel-Registrar Kundenbereich", "https://login.beispiel-registrar.example/", "kd-24017", true],
        ["hosting", "Beispiel-Hosting Webpanel", "https://panel.beispiel-hosting.example/", "nordlicht", true],
      ],
    },
  },
  "KD-24023": {
    company: "Form & Feld",
    packages: [["domain", "2026-05-01", null], ["service-lite", "2026-05-01", null]],
    timeline: [
      { occurredOn: "2026-10-09", kind: "invoice_paid", title: "Rechnung Oktober bezahlt", amountCents: 3900, customerVisible: true },
      { occurredOn: "2026-10-01", kind: "invoice_sent", title: "Rechnung Oktober gestellt", amountCents: 3900, customerVisible: true },
      { occurredOn: "2026-05-01", kind: "package", title: "OALAB Service Lite gebucht", amountCents: null, customerVisible: false, source: "package", linksContract: true },
    ],
    mail: {
      domains: [{ domain: "formundfeld.example", status: "active", registrar: "Beispiel-Registrar", dns: "Beispiel-DNS", website: "Beispiel-Hosting", owner: "customer", renewsOn: "2027-05-01", checks: ["website", "ssl"] }],
      mailboxes: [],
      logins: [["dns", "Beispiel-DNS Konsole", "https://dns.beispiel.example/", "formundfeld", false]],
    },
  },
  "KD-24031": {
    company: "Studio Horizont",
    packages: [["domain-mail", "2026-01-15", null], ["service-lite", "2026-01-15", "2026-11-30"]],
    timeline: [
      { occurredOn: "2026-10-12", kind: "package", title: "OALAB Service Lite gekündigt zum 30.11.2026", amountCents: null, customerVisible: true, note: "Kündigung per Mail, Gespräch über Service Max vereinbart.", source: "package" },
      { occurredOn: "2026-10-01", kind: "invoice_sent", title: "Rechnung Oktober gestellt", amountCents: 6900, customerVisible: true, note: "Zahlung noch offen." },
      { occurredOn: "2026-01-15", kind: "package", title: "OALAB Domain & Mail gebucht", amountCents: null, customerVisible: false, source: "package", linksContract: true },
    ],
    mail: {
      domains: [
        { domain: "studio-horizont.example", status: "active", registrar: "Beispiel-Registrar", dns: "Beispiel-DNS", website: "Beispiel-Hosting", owner: "customer", renewsOn: "2026-11-20", checks: ["website", "ssl", "mx", "spf", "dkim"], note: "DMARC fehlt noch, mit dem Kunden abstimmen." },
        { domain: "horizont-shop.example", status: "transfer", registrar: "Alter Anbieter", dns: "Beispiel-DNS", website: "", owner: "customer", renewsOn: null, checks: [], note: "Umzug beantragt, der Auth-Code liegt beim Kunden." },
      ],
      server: { provider: "Beispiel-Mailhoster", host: "mail.beispiel-hosting.example" },
      mailboxes: [["kontakt@studio-horizont.example", "mailbox", "Mira Horizont", "", false]],
      logins: [],
    },
  },
};

const groups = ["domain", "service"] as const;

/**
 * The example data the area shows without real data: every demo customer for admins, the own one for customers
 * (released entries only, without notes). `contractFiles` maps a customer number to its example contract's file id.
 */
export function contractFixtures({ admin, customerNumber, contractFiles = {} }: { admin: boolean; customerNumber: string | null; contractFiles?: Record<string, string> }): ContractsState {
  const numbers = admin ? Object.keys(fixtures) : customerNumber && fixtures[customerNumber] ? [customerNumber] : [];
  const customers: ContractCustomer[] = numbers.map((number) => ({
    id: number,
    company: fixtures[number].company,
    customerNumber: number,
    logo: null,
    packages: fixtures[number].packages.map(([packageId, since, until], index): CustomerPackage => ({ group: groups[index], packageId, since, until })),
  }));
  const timeline = numbers.flatMap((number) => fixtures[number].timeline
    .filter((entry) => admin || entry.customerVisible)
    .map((entry, index): TimelineEntry => {
      const shown: TimelineEntry = {
        id: `${number}-t${index}`,
        customerId: number,
        occurredOn: entry.occurredOn,
        kind: entry.kind,
        title: entry.title,
        amountCents: entry.amountCents,
        fileId: entry.linksContract ? contractFiles[number] ?? null : null,
        customerVisible: entry.customerVisible,
        createdAt: `${entry.occurredOn}T09:${String(59 - index).padStart(2, "0")}:00Z`,
      };
      return admin ? { ...shown, note: entry.note ?? "", source: entry.source ?? "manual", authorName: "oalab-Team" } : shown;
    }));
  return { view: admin ? "admin" : "customer", source: "fixtures", customers, timeline, ready: true, canManage: false, domainMail: mailFixtures(numbers, customers, admin) };
}

const noChecks: Record<DomainCheck, boolean> = { website: false, ssl: false, mx: false, spf: false, dkim: false, dmarc: false };

/**
 * The example domains and mail of the demo customers: everything for admins (passwords only as „stored“; none exists),
 * for customers the running domain names, the addresses and, with Domain & Mail, the server settings.
 */
function mailFixtures(numbers: string[], customers: ContractCustomer[], admin: boolean): DomainMailState {
  const withMail = (number: string) => customers.some((customer) => customer.id === number && customer.packages.some((item) => item.packageId === "domain-mail"));
  const domains = numbers.flatMap((number) => fixtures[number].mail.domains
    .filter((item) => admin || item.status !== "ended")
    .map((item, index): CustomerDomain => {
      const shown: CustomerDomain = { id: `${number}-d${index}`, customerId: number, domain: item.domain, display: item.domain };
      return admin ? {
        ...shown,
        details: {
          registrar: item.registrar, dnsProvider: item.dns, websiteHost: item.website, owner: item.owner, renewsOn: item.renewsOn, status: item.status, note: item.note ?? "",
          checks: { ...noChecks, ...Object.fromEntries(item.checks.map((check) => [check, true])) },
        },
      } : shown;
    }));
  const mailServers = numbers.flatMap((number): MailServer[] => {
    const server = fixtures[number].mail.server;
    if (!server || (!admin && !withMail(number))) return [];
    const shown: MailServer = { customerId: number, imapHost: server.host, imapPort: 993, imapSecurity: "ssl", smtpHost: server.host, smtpPort: 465, smtpSecurity: "ssl", webmailUrl: "https://webmail.beispiel-hosting.example/" };
    return [admin ? { ...shown, provider: server.provider } : shown];
  });
  const mailboxes = numbers.flatMap((number) => fixtures[number].mail.mailboxes.map(([address, kind, person, target, stored], index): Mailbox => {
    const shown: Mailbox = { id: `${number}-m${index}`, customerId: number, address, display: address, person, kind, target, targetDisplay: target };
    return admin ? { ...shown, hasPassword: stored } : shown;
  }));
  const logins = admin ? numbers.flatMap((number) => fixtures[number].mail.logins.map(([kind, label, loginUrl, username, stored], index): ProviderLogin => ({
    id: `${number}-l${index}`, customerId: number, kind, label, loginUrl, username, hasPassword: stored,
  }))) : [];
  return { ready: true, domains, mailServers, mailboxes, logins, vault: admin ? { keyReady: false, keyId: null, confirmed: false } : null };
}
