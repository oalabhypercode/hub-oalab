/**
 * Stage 3 of the connector (23.11.2026): reading the rest of the hub for admins, as far as its pages show it: contact
 * data and logins of a customer, the Asset Management, Vertrag & Domain, the conversations (service requests and the
 * private chat), the admin log and the AI log, and Insights. Reading only; lib/hub-mcp/areas.ts loads with the server
 * key after the connection's check, as the admins' other reading tools do. Never: passwords, codes or the second
 * factor (the Schlüsselbund stays closed: the connector has no session), and no download links (files open in the hub).
 * Definitions only, so tests load them directly.
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
    description: "Gespräche wie unter Nachrichten: service = Anfragen der Kunden auf der Serviceplattform mit Stand und letzter Nachricht, private = der private Chat je Kunde mit letzter Nachricht und ob etwas Neues für dich da ist. Neueste zuerst, nach Wunsch nur für einen Kunden.",
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
    description: "Ein Gespräch mit seinen Nachrichten, älteste zuerst: kind service mit request_id aus list_conversations oder kind private mit customer_id. Claude liest nur mit: Für das Team bleibt alles so ungelesen, wie es war; antworten geht im Hub.",
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
