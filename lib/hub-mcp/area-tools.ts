/**
 * Stage 3 of the connector (23.11.2026): reading the rest of the hub for admins, as far as its pages show it: contact
 * data and logins of a customer, the Asset Management, Vertrag & Domain, the conversations (service requests and the
 * private chat), the admin log and the AI log, and Insights. lib/hub-mcp/areas.ts loads with the server key after the
 * connection's check, as the admins' other reading tools do. Never: passwords, codes or the second factor (the
 * Schlüsselbund stays closed: the connector has no session), and no download links (files open in the hub). Stage 4
 * (below) writes in these areas. Definitions only, so tests load them directly.
 */
import type { HubScope } from "./config";
import type { ToolDefinition } from "./protocol";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const uuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const id = (description: string) => ({ type: "string", pattern: uuidPattern, description });

const tools: (ToolDefinition & { scope: HubScope })[] = [
  {
    name: "get_customer_contacts",
    title: "Kontaktdaten ansehen",
    description: "Die Kontaktdaten eines Kunden oder Freelancers wie im User Management: E-Mail, Telefon, Website, Adresse und seine Zugänge (Name, E-Mail, Telefon, Position, Stand, letzte Anmeldung). Passwörter, Codes und den zweiten Faktor gibt der Connector nie heraus; Zugänge ändern geht nur im Hub.",
    inputSchema: { type: "object", properties: { customer_id: id("Der Kunde oder Freelancer (ID aus search).") }, required: ["customer_id"], additionalProperties: false },
    annotations: { title: "Kontaktdaten ansehen", ...READ },
    scope: "hub:read",
  },
  {
    name: "list_files",
    title: "Dateien ansehen",
    description: "Dateien im Asset Management: mit customer_id die Dateien eines Kunden mit Ordner und „Sichtbar für“ sowie seine Ordner, sonst die neuesten Dateien aller Kunden (höchstens 100); query filtert nach Titel oder Dateiname. Herunterladen geht über den Link in den Hub.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Nur die Dateien dieses Kunden (ID aus search)."),
        query: { type: "string", minLength: 2, maxLength: 100, description: "Suchbegriff im Titel oder Dateinamen." },
      },
      additionalProperties: false,
    },
    annotations: { title: "Dateien ansehen", ...READ },
    scope: "hub:read",
  },
  {
    name: "get_contract",
    title: "Vertrag & Domain ansehen",
    description: "Vertrag & Domain eines Kunden wie im Hub: Pakete mit Laufzeit, der Verlauf (Rechnungen, Verträge, Änderungen mit Betrag und ob der Kunde sie sieht), Domains mit Registrar, DNS, Hosting, Verlängerung und Prüfungen, Mailserver, Postfächer, das Service-Kontingent dieses Monats und was welcher Freelancer davon sieht. Passwörter und Zugangsdaten bleiben im Schlüsselbund.",
    inputSchema: { type: "object", properties: { customer_id: id("Der Kunde (ID aus search).") }, required: ["customer_id"], additionalProperties: false },
    annotations: { title: "Vertrag & Domain ansehen", ...READ },
    scope: "hub:read",
  },
  {
    name: "list_conversations",
    title: "Gespräche auflisten",
    description: "Gespräche wie unter Nachrichten: service = Anfragen der Kunden auf der Serviceplattform und Meldungen aus dem Team mit Stand und letzter Nachricht, private = der private Chat je Kunde mit letzter Nachricht und ob etwas Neues für dich da ist. Neueste zuerst, nach Wunsch nur für einen Kunden.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["all", "service", "private"], default: "all", description: "Welche Gespräche." },
        customer_id: id("Nur die Gespräche dieses Kunden (ID aus search)."),
      },
      additionalProperties: false,
    },
    annotations: { title: "Gespräche auflisten", ...READ },
    scope: "hub:read",
  },
  {
    name: "read_conversation",
    title: "Gespräch lesen",
    description: "Ein Gespräch mit seinen Nachrichten, älteste zuerst: kind service mit request_id aus list_conversations oder kind private mit customer_id. Claude liest nur mit: Für das Team bleibt alles so ungelesen, wie es war. Im privaten Chat antwortet send_chat_message, auf der Serviceplattform antwortet man dort.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["service", "private"], description: "service = Anfrage auf der Serviceplattform, private = privater Chat." },
        request_id: id("Die Anfrage (request_id aus list_conversations), bei kind service."),
        customer_id: id("Der Kunde (ID aus search oder list_conversations), bei kind private."),
      },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: { title: "Gespräch lesen", ...READ },
    scope: "hub:read",
  },
  {
    name: "get_admin_log",
    title: "Protokoll lesen",
    description: "Das Admin-Protokoll wie im User Management: wer wann was geändert hat, auch über Claude (Aktionen claude.*), nach Wunsch für einen Kunden, ab einem Aktionsanfang (etwa claude. oder note.) und für die letzten Tage (ohne Angabe 14, höchstens 90; höchstens 100 Einträge). source ai zeigt stattdessen das KI-Protokoll des Assistenten mit seinen Vorschlägen und was daraus wurde.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["hub", "ai"], default: "hub", description: "hub = Admin-Protokoll, ai = KI-Protokoll." },
        customer_id: id("Nur Einträge zu diesem Kunden (nur bei source hub)."),
        action: { type: "string", pattern: "^[a-z][a-z_.]{0,39}$", description: "Nur Aktionen, die so anfangen, z. B. claude. (nur bei source hub)." },
        days: { type: "integer", minimum: 1, maximum: 90, default: 14, description: "Wie viele Tage zurück." },
      },
      additionalProperties: false,
    },
    annotations: { title: "Protokoll lesen", ...READ },
    scope: "hub:read",
  },
  {
    name: "get_insights",
    title: "Insights ansehen",
    description: "Insights für das Team wie im Hub: die Termine von heute, die offenen Anfragen der nächsten 31 Tage und das Service-Kontingent jedes Kunden mit Paket in diesem Monat (verbraucht, Grenze, Stand), dazu ob die Sperre bei vollem Kontingent an ist.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Insights ansehen", ...READ },
    scope: "hub:read",
  },
];

/** The reading tools of stage 3, admins only. */
export const areaTools = tools;
export const AREA_TOOL_NAMES = tools.map((tool) => tool.name);

/*
 * Stage 4 (23.11.2026): writing in the rest of the hub, as the user allowed it: answering in the private chat, a
 * customer's contact data, the Asset Management (assigning, „Sichtbar für“, renaming, folders), Vertrag & Domain (the
 * timeline, domains and mailboxes without passwords) and what a freelancer sees of a customer. Every tool is marked
 * destructive, so Claude asks before each change; lib/hub-mcp/area-writes.ts saves through the hub's own code. Never:
 * logins, invitations, the second factor, the Schlüsselbund and passwords, packages, the quota lock, deleting.
 */
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const text = (maxLength: number, description: string) => ({ type: "string", maxLength, description });

const writeTools: (ToolDefinition & { scope: HubScope })[] = [
  {
    name: "send_chat_message",
    title: "Im privaten Chat antworten",
    description: "Schreibt im privaten Chat eines Kunden als oalab, wie eine Antwort unter Nachrichten: Der Kunde sieht sie sofort, bekommt eine Meldung in der Glocke und, liest er sie nicht rechtzeitig, eine E-Mail. Danach gilt der Chat für das Team als gelesen, wie nach einer Antwort im Hub. Lies vorher mit read_conversation (kind private) und zeig dem Nutzer den Text, bevor du ihn schickst. Anfragen auf der Serviceplattform beantwortet man dort.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Der Kunde (ID aus search oder list_conversations)."),
        text: { type: "string", minLength: 1, maxLength: 5000, description: "Die Nachricht, höchstens 5000 Zeichen; Zeilenumbrüche bleiben." },
      },
      required: ["customer_id", "text"],
      additionalProperties: false,
    },
    annotations: { title: "Im privaten Chat antworten", ...WRITE },
    scope: "hub:write",
  },
  {
    name: "update_customer_contact",
    title: "Kontaktdaten ändern",
    description: "Ändert die Kontaktdaten eines Kunden wie das Fenster im User Management: Kontakt-E-Mail, Telefon, Website und Anschrift. Nur die genannten Felder ändern sich, ein leerer Text leert eins. Firmenname und Kundennummer bleiben, wie sie sind; die Kontaktdaten gelten auch auf der Serviceplattform. Zugänge, Einladungen und Passwörter ändert ein Admin nur im Hub.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Der Kunde (ID aus search)."),
        contact_email: text(254, "Kontakt-E-Mail der Firma."),
        phone: text(40, "Telefon, z. B. +49 341 1234567."),
        website: text(200, "Website, z. B. kunde.de (https:// ergänzt der Hub)."),
        street: text(120, "Straße und Hausnummer."),
        postal_code: text(12, "Postleitzahl."),
        city: text(80, "Ort."),
        country: text(60, "Land (leer = Deutschland)."),
      },
      required: ["customer_id"],
      additionalProperties: false,
    },
    annotations: { title: "Kontaktdaten ändern", ...WRITE },
    scope: "hub:write",
  },
  {
    name: "assign_files",
    title: "Dateien zuordnen",
    description: "Ordnet Dateien aus dem Asset Management einem Kunden zu, wie „Zuordnen“ im Hub: Sie bleiben bei ihren anderen Kunden. Mit folder_id liegen sie danach in diesem Ordner des Kunden (auch die, die schon dort waren), sonst neue in „Ohne Ordner“. Mit from_customer_id übernehmen sie „Sichtbar für“ vom bisherigen Kunden, mit move zusätzlich verschoben (dort nicht mehr zugeordnet, die Datei selbst bleibt). Wer die Dateien neu sieht, bekommt eine Meldung in der Glocke. IDs aus list_files.",
    inputSchema: {
      type: "object",
      properties: {
        file_ids: { type: "array", items: id("Eine Datei (file_id aus list_files)."), minItems: 1, maxItems: 50, uniqueItems: true, description: "Die Dateien, höchstens 50." },
        customer_id: id("Der Kunde, dem die Dateien zugeordnet werden (ID aus search)."),
        folder_id: id("Ein Ordner dieses Kunden (folder_id aus list_files mit customer_id)."),
        from_customer_id: id("Der Kunde, bei dem die Dateien bisher liegen."),
        move: { type: "boolean", description: "Nur mit from_customer_id: verschieben, also beim bisherigen Kunden herausnehmen." },
      },
      required: ["file_ids", "customer_id"],
      additionalProperties: false,
    },
    annotations: { title: "Dateien zuordnen", ...WRITE },
    scope: "hub:write",
  },
  {
    name: "set_file_visibility",
    title: "„Sichtbar für“ ändern",
    description: "Legt fest, wer eine Datei bei einem Kunden sieht, wie „Sichtbar für“ im Asset Management: both = der Kunde und seine Freelancer, customer = nur der Kunde, freelancer = nur die Freelancer (etwa Arbeitsdateien). Wer die Datei dadurch neu sieht, bekommt eine Meldung in der Glocke. IDs aus list_files mit customer_id.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: id("Die Datei (file_id aus list_files)."),
        customer_id: id("Der Kunde, bei dem die Datei liegt."),
        visibility: { type: "string", enum: ["both", "customer", "freelancer"], description: "both = Kunde und Freelancer, customer = nur Kunde, freelancer = nur Freelancer." },
      },
      required: ["file_id", "customer_id", "visibility"],
      additionalProperties: false,
    },
    annotations: { title: "„Sichtbar für“ ändern", ...WRITE },
    scope: "hub:write",
  },
  {
    name: "rename_files",
    title: "Dateien umbenennen",
    description: "Benennt Dateien um wie „Umbenennen“ im Asset Management: Titel und Downloadname werden zum neuen Namen, die Dateiendung bleibt (aus „Logo hell“ wird Logo hell.svg). Die gespeicherte Datei bleibt, wo sie ist, und niemand bekommt eine Meldung. Bis zu 50 Dateien auf einmal, IDs aus list_files.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          description: "Je Datei der neue Name.",
          items: {
            type: "object",
            properties: {
              file_id: id("Die Datei (file_id aus list_files)."),
              name: { type: "string", minLength: 1, maxLength: 200, description: "Der neue Name ohne Endung." },
            },
            required: ["file_id", "name"],
            additionalProperties: false,
          },
        },
      },
      required: ["files"],
      additionalProperties: false,
    },
    annotations: { title: "Dateien umbenennen", ...WRITE },
    scope: "hub:write",
  },
  {
    name: "create_folder",
    title: "Ordner anlegen",
    description: "Legt im Asset Management einen Ordner bei einem Kunden an (eine Ebene, höchstens 80 Zeichen, ohne Schrägstrich). Dateien kommen mit assign_files und folder_id hinein; Ordner umbenennen oder löschen geht im Hub.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Der Kunde (ID aus search)."),
        name: { type: "string", minLength: 1, maxLength: 80, description: "Name des Ordners, z. B. Logos." },
      },
      required: ["customer_id", "name"],
      additionalProperties: false,
    },
    annotations: { title: "Ordner anlegen", ...WRITE },
    scope: "hub:write",
  },
  {
    name: "save_timeline_entry",
    title: "Verlauf eintragen",
    description: "Trägt im Verlauf unter Vertrag & Domain einen Eintrag ein oder ändert einen (mit entry_id aus get_contract), wie das Fenster im Hub: Tag, Art, Titel, Betrag, Notiz fürs Team, ob der Kunde ihn in seinem Verlauf sieht, und eine Datei des Kunden. Beim Ändern bleibt, was nicht genannt ist; neu braucht es day, kind und title. Eine Meldung bekommt der Kunde nicht.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Der Kunde (ID aus search)."),
        entry_id: id("Nur zum Ändern: der Eintrag (entry_id aus get_contract)."),
        day: { type: "string", pattern: DAY_PATTERN, description: "Tag, JJJJ-MM-TT." },
        kind: { type: "string", enum: ["invoice_paid", "invoice_sent", "package", "domain", "mail", "other"], description: "invoice_paid = Rechnung bezahlt, invoice_sent = Rechnung gestellt, package = Paket, domain = Domain, mail = Mail, other = Sonstiges." },
        title: { type: "string", minLength: 1, maxLength: 160, description: "Titel, z. B. Rechnung Oktober bezahlt." },
        amount: { type: ["string", "number", "null"], description: "Betrag in Euro, z. B. 89,00 oder 1.234,56; null oder leer = kein Betrag." },
        note: text(2000, "Notiz fürs Team; leer entfernt sie."),
        customer_visible: { type: "boolean", description: "Ob der Kunde den Eintrag in seinem Verlauf sieht." },
        file_id: { type: ["string", "null"], pattern: uuidPattern, description: "Eine Datei dieses Kunden (file_id aus list_files); null nimmt sie heraus." },
      },
      required: ["customer_id"],
      additionalProperties: false,
    },
    annotations: { title: "Verlauf eintragen", ...WRITE },
    scope: "hub:write",
  },
  {
    name: "save_domain",
    title: "Domain eintragen",
    description: "Trägt unter Vertrag & Domain eine Domain ein oder ändert eine (mit domain_id aus get_contract), wie das Fenster „Domain“ im Hub: Name, Status, Inhaber, Registrar, DNS, Website-Hosting, Verlängerung, die sechs Prüfungen und eine Notiz fürs Team. Beim Ändern bleibt, was nicht genannt ist; neu braucht es domain (ohne Angabe Status aktiv und Inhaber der Kunde, wie im Fenster). Zugangsdaten und Passwörter bleiben im Schlüsselbund.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Der Kunde (ID aus search)."),
        domain_id: id("Nur zum Ändern: die Domain (domain_id aus get_contract)."),
        domain: { type: "string", minLength: 3, maxLength: 253, description: "Die Domain, z. B. kunde.de (Umlaute erlaubt)." },
        status: { type: "string", enum: ["active", "setup", "transfer", "cancelled", "ended"], description: "active = Aktiv, setup = In Einrichtung, transfer = Umzug läuft, cancelled = Gekündigt, ended = Beendet." },
        owner: { type: "string", enum: ["customer", "oalab"], description: "Wem die Domain gehört: customer = Kunde, oalab = oalab." },
        registrar: text(100, "Registrar."),
        dns_provider: text(100, "Wo das DNS liegt."),
        website_host: text(100, "Wo die Website liegt."),
        renews_on: { type: ["string", "null"], pattern: DAY_PATTERN, description: "Verlängerung, JJJJ-MM-TT; null = keine." },
        checks: {
          type: "object",
          description: "Die Prüfungen, nur die genannten ändern sich.",
          properties: {
            website: { type: "boolean", description: "A- oder CNAME-Eintrag zeigt auf die Website." },
            ssl: { type: "boolean", description: "Gültiges Zertifikat für die Website." },
            mx: { type: "boolean", description: "MX-Eintrag zeigt auf den Mail-Server." },
            spf: { type: "boolean", description: "SPF-Eintrag erlaubt den Mail-Server." },
            dkim: { type: "boolean", description: "DKIM-Schlüssel steht im DNS." },
            dmarc: { type: "boolean", description: "DMARC-Eintrag ist gesetzt." },
          },
          additionalProperties: false,
        },
        note: text(2000, "Notiz fürs Team; leer entfernt sie."),
      },
      required: ["customer_id"],
      additionalProperties: false,
    },
    annotations: { title: "Domain eintragen", ...WRITE },
    scope: "hub:write",
  },
  {
    name: "save_mailbox",
    title: "E-Mail-Adresse eintragen",
    description: "Trägt unter Vertrag & Domain eine E-Mail-Adresse ein oder ändert eine (mit mailbox_id aus get_contract): ein Postfach, eine Weiterleitung an eine oder mehrere Adressen oder einen Alias eines Postfachs, mit der Person, die sie nutzt. Beim Ändern bleibt, was nicht genannt ist; neu braucht es address (ohne Angabe ein Postfach). Passwörter von Postfächern bleiben im Schlüsselbund.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Der Kunde (ID aus search)."),
        mailbox_id: id("Nur zum Ändern: die Adresse (mailbox_id aus get_contract)."),
        address: { type: "string", minLength: 3, maxLength: 254, description: "Die Adresse, z. B. info@kunde.de." },
        kind: { type: "string", enum: ["mailbox", "forward", "alias"], description: "mailbox = Postfach, forward = Weiterleitung, alias = Alias." },
        person: text(120, "Wer die Adresse nutzt."),
        target: text(2600, "Bei forward die Zieladressen mit Komma getrennt (höchstens 10), bei alias das Postfach."),
      },
      required: ["customer_id"],
      additionalProperties: false,
    },
    annotations: { title: "E-Mail-Adresse eintragen", ...WRITE },
    scope: "hub:write",
  },
  {
    name: "set_freelancer_access",
    title: "Freigaben für Freelancer",
    description: "Legt fest, was ein Freelancer von einem Kunden sieht, den er betreut, wie der Tab „Freelancer“ unter Vertrag & Domain: domains = Domains & Hosting, mail = E-Mail (ohne Passwörter), packages = Pakete (ohne Preise), contact = Kontaktdaten; dazu Hinweise nur für diesen Freelancer (leer entfernt sie). Nur genannte Bereiche ändern sich; eine neue Freigabe meldet die Glocke des Freelancers. Wer welchen Kunden betreut, legt ein Admin im Hub fest.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: id("Der Kunde (ID aus search)."),
        freelancer_id: id("Der Freelancer (freelancer_id aus get_contract)."),
        areas: {
          type: "object",
          description: "Bereiche an (true) oder aus (false).",
          properties: {
            domains: { type: "boolean", description: "Domains & Hosting." },
            mail: { type: "boolean", description: "E-Mail, ohne Passwörter." },
            packages: { type: "boolean", description: "Pakete, ohne Preise." },
            contact: { type: "boolean", description: "Kontaktdaten der Firma." },
          },
          additionalProperties: false,
        },
        note: text(2000, "Hinweise für diesen Freelancer bei diesem Kunden; leer entfernt sie."),
      },
      required: ["customer_id", "freelancer_id"],
      additionalProperties: false,
    },
    annotations: { title: "Freigaben für Freelancer", ...WRITE },
    scope: "hub:write",
  },
];

/** The writing tools of stage 4, admins only. */
export const areaWriteTools = writeTools;
export const AREA_WRITE_TOOL_NAMES = writeTools.map((tool) => tool.name);
