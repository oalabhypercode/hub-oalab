# oalab Client Hub – Produktstand

> Nur Ist-Zustand: was es gibt, wo es liegt, worauf achten. Verlauf in Git und `lib/patch-notes.ts`. Neue Entscheidung → Zeile ersetzen.

- **Was:** Arbeitsfläche für oalab-Team, Kunden und Freelancer; Projekte, Aufgaben, Dateien, Chat, Kalender, Verträge, Domains
- **Live:** `hub.oalab.de`, Livebetrieb mit echten Kunden; keine Demo-Zugänge
- **Nachbar:** Serviceplattform `service.oalab.de` (Repo `service-oalab`) = Service-Anfragen und OALab Studio; gemeinsame Datenbank, gemeinsamer Login
- **Marke:** `oalab` immer klein, Produkt „oalab Client Hub“, Inter; Regeln `CI_GUIDELINES.md`, Tokens `app/brand.css`

## Betrieb

- **Hosting:** Coolify-App `oalab-hub` auf Server 2; jeder Stand auf `main` in 2–4 min live → nie direkt auf `main` (Regeln `CLAUDE.md`)
- **Daten:** eigene Plattform – PostgreSQL, Garage (Dateien), eigene Anmeldung (`lib/platform/`); Supabase-Client-API bleibt als Schnittstelle (`lib/supabase/`)
- **Schema:** Migrationen nur in `service-oalab/supabase/migrations/`; `supabase/migrations/` hier = Herkunft, nicht mehr einspielen
- **Lokal:** `npm run dev`, `HUB_LOCAL_ADMIN_EMAIL` = ohne Anmeldung Admin, Tunnel zum Server per `HUB_LOCAL_TUNNEL_SCRIPT` (README „Lokal starten“)
- **Vercel:** altes Projekt `oalabs-projects/oalab-client-hub` baut nichts mehr
- **Geheimnisse:** nur Coolify-Umgebung und `.env.local`; nie ins Repo

## Rollen und Rechte

- **Admin** (`oalab_admin`): alles; letzter aktiver Admin bleibt, kein Selbst-Sperren
- **Kunde:** sieht nur eigene Firma (`hub_customer_members`); mehrere Logins je Firma
- **Freelancer** (`oalab_freelancer`): nur Hub, nie Serviceplattform; zweiter Faktor Pflicht; sieht zugeordnete Kunden (`hub_freelancer_customers`)
  - Kundendaten nur über `hub_freelancer_customer_list()` (Name, Nummer, Logo) und `hub_freelancer_customer_cards()` (Kontakt, Pakete nur mit Freigabe)
  - Freigaben je Kunde unter Vertrag & Domain › Freelancer (Domains & Hosting, E-Mail, Pakete, Kontaktdaten, Hinweise), ab Werk aus
- **Zugang** nur mit aktivem Profil (`hub_profiles.status`, `hub_is_active()`, `is_hub_admin()` aus der Datenbank, nicht aus dem Token) → Sperren wirkt sofort
- **Zweiter Faktor:** Aus, Code per E-Mail oder Authenticator-App (`app_metadata.second_factor`); bestätigt = `aal2`
  - Pflicht für Freelancer, KI-Werkzeuge, Zugangsdaten, Schlüsselbund
  - Code-Mail trägt Uhrzeit im Betreff (gegen gestapelte alte Codes)
- **Serverseitig schreiben:** jede Aktion prüft zuerst Admin/`aal2` mit der Sitzung, erst dann Server-Schlüssel; Protokoll `hub_admin_events`

## Bereiche

- **Übersicht:** Begrüßungskarte (Firma, Pakete, Weg zur Serviceplattform), Meldungen wie am Handy, Widgets (`widget-stacks.tsx`); Ali-Avatar bei Kunden (`welcome-stage.tsx`, `host-avatar.tsx`, WebGL-Alpha-Video, ohne Ton)
- **Insights:** Kacheln je Rolle (`lib/hub-insights/`)
- **Projekte:** Studio-Projekte aus `customer_projects`, `studio_project_details`, `studio_tasks` (keine eigenen Hub-Tabellen)
  - Kunde sieht Projekt nur mit `studio_project_details` + `client_visible = true`
  - Fortschritt = Anteil erledigter Aufgaben; „Dein Feedback“ = offene, freigegebene Aufgabe mit Label „Kunde“
  - Aufgaben-Board (5 Spalten, Liste, Fenster je Aufgabe) liest/schreibt Studio-Aufgaben mit Versionsprüfung (`lib/hub-tasks/`); „Nur Team“ blendet Freelancer aus
- **Kalender** (unter Projekte): Termine mit Teams-Link, Anfragen in freien Zeiten, Verfügbarkeit (Wochenplan, Ausnahmen, Vorlauf, Puffer) prüft auch die Datenbank; Projektziele und Aufgaben mit Datum; Regeln `lib/hub-calendar/rules.ts`, Schreiben `lib/hub-calendar/write.ts`
  - Mail-Links „In deinen Kalender“ signiert per HMAC (`lib/hub-calendar/links.ts`, `app/api/calendar/[id]/[target]/`)
- **Dateien / Asset Management** (Admins): Kundenliste links, Ansichten Minimal, Detail, Liste; Upload- und Detail-Leiste; Ziehen auf Kunden/Ordner; Bearbeiten, endgültig Löschen (ohne Papierkorb)
  - Ordner: eine Ebene je Kunde; Kunden laden nicht hoch
  - „Sichtbar für“ je Datei und Kunde (Kunde und Freelancer, Nur Kunde, Nur Freelancer); Verträge, Angebote, Rechnungen ab Werk „Nur Kunde“
  - Downloads über 60-s-Links, ZIP baut der Browser; bis 50 MB je Datei, keine ausführbaren
  - Code `components/hub/screens/asset-*.tsx`, `lib/hub-files/`
- **Logos:** privat, kurzlebige Links (`lib/hub-logos/`); `CustomerLogoDialog` aus Asset Management und User Management; `LogoMark` mit Rückfall auf Initialen
- **Nachrichten:** privater Chat je Firma mit oalab (`lib/hub-private-chat/`, `hub_private_messages`); Admins dazu Reiter „Service“ = Gespräche der Serviceplattform nur lesen
  - Service-Anfragen stellen Kunden nur auf der Serviceplattform
  - Jede Kundennachricht mit Firma, Name, Text an die Telegram-Gruppe der Admins (`lib/hub-telegram/`); Datenschutzerklärung sagt nur „meldet auch über Telegram“
- **Benachrichtigungen:** Glocke + gebündelte Mail (`lib/hub-notify/`, `hub_inbox`); Sweep alle 5 min über `/api/notifications/sweep` (`HUB_NOTIFY_TOKEN`); ungelesene Meldung desselben Gegenstands wird aktualisiert statt verdoppelt; Abfrage alle 15 s (`use-live-sync.ts`)
- **Mails:** SMTP über Postfach `hub@oalab.de` (netcup), ein Design für alle (`lib/hub-mail/templates.ts`, Bilder als Inline-Anhänge aus `scripts/mail-images.mjs`); ohne `SMTP_*` gebaut, nicht verschickt
- **Vertrag & Domain** (`/dashboard/contracts`): je Kunde Pakete (`lib/service-packages.ts`: Domain bzw. Domain & Mail, Service Lite bzw. Max), Verlauf, Vertragsgenerator (drei Vorlagen, Word/PDF in Ordner „Verträge“), Domain & Mail (Domains, Testdomain mit Warnung, Mail-Server, Adressen), Zugangsdaten, Service-Kontingente, Freelancer-Freigaben
  - Zugangsdaten: AES-256-GCM im Server (`lib/hub-vault/`, Schlüssel `HUB_VAULT_KEY`, überall derselbe; Kennung unter „Zugangsdaten“); Anzeigen/Kopieren nur mit `aal2`, protokolliert, 30 s sichtbar
  - Kunden sehen eigene Pakete, Verträge, freigegebene Verlaufspunkte, Domains, Adressen; nie Passwörter oder interne Felder
- **Service-Kontingent:** Lite 5, Max 20 neue Anfragen je Monat, ohne Paket keine; Sperre `hub_service_quota_switch` ist **aus**; Code `lib/hub-service-quota/`
- **Schlüsselbund** (Verwaltung): alle Zugänge nach Kategorien, auch eigene von oalab (`lib/hub-keychain/`)
- **User Management** (`/dashboard/users`): Reiter Zugänge (nach Unternehmen gruppiert, `lib/hub-users/company-groups.ts`), Kunden, Freelancer
  - Registrierung mit Freigabe; Zugang anlegen, Zugänge sammeln (ohne Mail), Einladungen senden, Admin anlegen
  - Sevdesk-CSV-Import (`lib/hub-customer-import/`): füllt nur Lücken, überschreibt nie; Nummer `OA-` + Sevdesk-Nummer
  - Kundennummer neu: `OA-` + zufällige freie Zahl; neuer Kunde entsteht als Service-Organisation, Trigger legt Hub-Kunden an
  - Archivieren (sperrt Zugänge, Wiederherstellen holt alles zurück) und endgültig Löschen mit Vorschau (`lib/hub-archive/`); Service-Organisation bleibt archiviert
  - Login löschen nur über `hub_delete_login`; bei Verweisen in Service nur deaktivieren
- **Kundenstamm:** ein Stamm für Hub und Service; Kontaktdaten per Trigger in beide Richtungen (`business_customer_profiles`)
- **Passwort-Links:** öffnen nur `/auth/update-password`, eingelöst erst bei „Passwort speichern“ (gegen Virenscanner-Vorabaufrufe); erster Aktivierungslink 7 Tage, sonst 24 h (`lib/platform/config.ts`)
- **Assistent & Hilfe** (Claude, `app/api/assistant/route.ts`, `lib/hub-assistant/`): Hilfe-Chat für alle; Admins mit `aal2` zusätzlich Werkzeuge
  - Lesen läuft automatisch; Schreiben nur als Vorschlag (`hub_assistant_actions`, 30 min gültig), gespeichert erst nach Klick
  - Kunden anlegen, Aufgaben anlegen/ändern, Projekte ändern, Meetingtranskripte mit Belegzitat je Aufgabe
  - Verlauf nur im Browser; KI-Protokoll unter Verwaltung; Diktieren per Mikrofon
- **Claude-Connector (MCP):** `/api/mcp`, OAuth 2.1 mit PKCE nur für Claude, Schalter `HUB_MCP_ENABLED` (`lib/hub-mcp/`)
  - Admins: lesen und schreiben (Termine, Aufgaben, Projekte), nichts löschen; jede Änderung `claude.*` im Admin-Protokoll
  - Freelancer: Schalter je Zugang (aus), höchstens 30 Tage, eigene Werkzeuge mit eigenen Rechten (`freelancer-tools.ts`, `freelancer-writes.ts`)
- **WhatsApp-Assistent:** Code gebaut (`/api/whatsapp`, `lib/hub-whatsapp/`), Meta-Zugang nicht eingerichtet → nicht in Betrieb
- **Rechtstexte:** `/impressum`, `/datenschutz` (`lib/legal-details.ts`, `components/legal/`); öffentlich, aus jeder Mail verlinkt
- **Patch Notes:** `/dashboard/patch-notes` aus `lib/patch-notes.ts`; Pflege nach `CLAUDE.md`
- **Web-App:** auf Home-Bildschirm installierbar, Offline-Seite ohne Datenspeicher

## Oberfläche

- **Stil:** Liquid Glass außen (Hintergrund, Seitenleiste, Karten), deckende Tabellen innen nach OALab Studio (`components/hub/sheet.tsx`); Standard-Hintergrund Preset „oalab“
- **Farben:** Tokens in `app/glass.css`; Dunkelmodus Automatisch/Hell/Dunkel; Text auf Glas ≥ 4,5:1 bei 70 % Deckkraft (`tests/appearance.test.mjs`)
- **Navigation:** ab 1024 px Seitenleiste, darunter Tab-Leiste mit „Mehr“ (`components/hub/navigation.ts`); Tablet: Logo mittig, Abmelden oben rechts
- **Bewegung:** Wasserfall-Einblendung reines CSS (`app/motion.css`); Schalter „Bewegung reduzieren“ ab Werk aus, unabhängig von `prefers-reduced-motion`, als Cookie `oalab_reduce_motion` auch in Service
- **Laden:** drehendes oa-Logo (`brand-loader.tsx`), `MiniLoader` in Knöpfen; Begrüßung nach Anmeldung
- **Darstellung** (Hintergrund, Glas, Listenansicht) nur im Browser gespeichert (`lib/appearance.ts`)
- `/preview` nur lokal im Dev-Server, live 404; Beispieldaten `lib/hub-data.ts`, `lib/hub-*/fixtures.ts`

## Fallen

- Neue Tabellen: RLS + explizite Grants; Hub liest neue Spalten fehlertolerant (ohne Migration bleibt alles wie vorher)
- Service gibt Browsern keine Leserechte auf `customer_projects`, `organizations`, `service_requests` → Admins lesen nach Admin-Prüfung mit Server-Schlüssel
- Studio-Schreiben immer mit Sitzung/Claims der Person → Studio-RLS, Trigger und Verlauf greifen
- Kunden mit Service-Organisation: `audit_events` unveränderlich → Organisation bleibt beim Löschen archiviert, Nummer bleibt vergeben
- Migrationen ohne `delete from` (SQL-Editor warnt sonst)
- Windows: Musterdatei-Test der Beispiel-PDFs schlägt bei CRLF fehl, kein Befund
- `@supabase/ssr` und `@supabase/supabase-js` stehen auf `latest`
- `npm audit`: 3 mittlere Funde über Tailwind 3, erst mit Tailwind 4 lösbar

## Offen

- **Datenschutz:** Standort Server 2 bei netcup, Ziel der nächtlichen Sicherung, AV-Vertrag netcup (Server) und Cloudflare bestätigen; Vereinbarung je Freelancer; Löschfristen (abgelehnte Registrierungen, KI-Protokoll, Chat); anwaltliche Prüfung; Claude-Connector: AV-Vertrag Anthropic nur für Team/Enterprise/API
- **Kontingent-Sperre einschalten** erst nach: Preise frei, alle echten Kunden mit Servicepaket, Sperrliste mit oalab durchgegangen
- **Admins:** zweiten Faktor für alle Admin-Logins einschalten
- **Aufräumen:** Testdaten (Testkunden, Test-Logins, Testtermine, Testanfrage, Testchat)
- **WhatsApp:** Meta-App, Nummer, Token; Datenschutzerklärung um Meta ergänzen
- **Backlog:** „Vorher → Nachher“ in Meldungs-Mails (braucht Spalte in `hub_inbox`); Kennzahl-Kacheln unter Projekte; Teams-Meetings automatisch (Microsoft Graph); Feiertage im Kalender; Kunden laden selbst hoch; neue Dateifassung hochladen; Tageslimit KI je Admin; Impressum auf oalab.de aktualisieren (anderes Repo)
