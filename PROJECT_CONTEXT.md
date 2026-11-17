# oalab Client Hub – Produktstand

Ist-Zustand je Bereich: was gilt, wo es im Code liegt, worauf achten, was offen ist. Technik und Einrichtung: [README.md](./README.md), Marke: [CI_GUIDELINES.md](./CI_GUIDELINES.md). Verlauf der Entscheidungen: Git und [Historie/PROJECT_CONTEXT-verlauf.md](./Historie/PROJECT_CONTEXT-verlauf.md).

## Pflege

- Neue Entscheidung → Zeile im passenden Bereich ersetzen, nie danebenschreiben; ohne Datum, ohne Person
- Datenmodell, Rollen, Umfang hier nachziehen; Funktionsänderung → Wissensbasis `lib/hub-assistant/knowledge.ts` mitziehen
- Keine Zugangsdaten, Schlüssel, personenbezogenen Daten

## Grundsätze

- Produkt: gemeinsamer Workspace von oalab und Kunden; Name **oalab** klein, Produkt **oalab Client Hub**
- Live mit echten Kunden; keine Demo-Zugänge; jeder Login ist echt
- Hub = Hauptzugang (Login, Kunden, Konten, Pakete, Dateien, Kalender, Projekte); Service (service.oalab.de) = nur Anfragen-Chat
- Neue Funktion liest neue Spalten fehlertolerant: ohne Migration bleibt der Hub wie vorher
- Migrationen: alle in `service-oalab/supabase/migrations/`; ohne `delete from` (SQL-Editor warnt); live einspielen nur nach Freigabe
- Neue Tabellen: explizite Grants + RLS
- Schreibende Server-Aktionen: erst Admin-Prüfung mit Sitzung des Aufrufers (`verifyHubAdmin`, `is_hub_admin()` liest Rolle und Status aus der Datenbank), dann Service-Rolle
- Jede Admin-Aktion → `hub_admin_events`, ohne Namen, Adressen, Links, Passwörter

## Plattform

- hub.oalab.de: Coolify-App `oalab-hub` auf Server 2, gebaut aus `main` (jeder Push live)
- `OALAB_PLATFORM=own` (`lib/platform/`): Daten über internes PostgREST, Login über die Better-Auth-Tabellen von Service, Dateien in Garage; Aufrufstellen bleiben supabase-js
- Sitzung: Cookie `__Secure-oalab.session_token`, 30 Tage nach letzter Nutzung; ein Konto für Hub und Service
- Links: Aktivierung (Konto nie angemeldet) 7 Tage, sonst 24 Stunden (`lib/platform/config.ts`); Aktivierungsmail nennt „Link gültig bis …“
- Rollen: Service liest `memberships`; Hub liest `app_metadata.app_role` + `hub_profiles.status`; Hub-Admin ist kein Release-Manager; Hub-Rollen aus `memberships` ableiten = offen
- Supabase `hxljfihyejwpugnsffcc` eingefroren (Rückweg, nicht löschen); altes Hub-Projekt `tjbslvwvisxjjcxfhbgm` pausiert; `supabase/migrations/` hier nur Herkunft
- Vercel-Projekt `oalabs-projects/oalab-client-hub` baut nicht (Ignored Build Step)
- Lokal: `npm run dev` mit Tunnel und lokalem Admin, siehe README

## Rollen und Zugang

- Rollen: Admin (`oalab_admin`), Kunde, Freelancer (`oalab_freelancer`, nur Hub, nie Service-Mitgliedschaft)
- Nur aktive Profile kommen in den Hub (`getWorkspaceIdentity`); sonst `/auth/pending` mit Stand (wartet, abgelehnt, deaktiviert)
- Assistent, WhatsApp, Kalender-Auslastung verlangen aktives Konto
- Status: Wartet auf Freigabe, Aktivierung offen, Aktiv, Deaktiviert, Abgelehnt
- Schutz: kein Selbst-Sperren/-Herabstufen; letzter aktiver Admin bleibt
- Deaktivieren wirkt sofort auf alle Daten (Leseregeln verlangen aktives Profil)

### Zweiter Faktor

- Je Konto genau eine Methode: Aus, Code per E-Mail, Authenticator-App (`app_metadata.second_factor`); Wahl im Profil, nur aus Sitzung mit bestätigtem bisherigem Faktor
- Freelancer: fest Code, kein „Aus“
- Admins setzen im User Management auf E-Mail oder Aus zurück (entfernt App)
- Mail-Code: 10 Minuten, 5 Versuche, „Neuen Code senden“ begrenzt; Betreff mit Uhrzeit der Anforderung, Code nie im Betreff; Code-Seite nennt Mail des gültigen Codes
- Bestätigte Sitzung → `aal2`; Hub-Seiten, -Aktionen, Assistent, Team-Bereiche von Service verlangen `aal2`; Service schickt Team-Konten auf `/auth/mfa?next=…`
- Passwort zurücksetzen: Aus → Link; E-Mail → Link zählt als Code; App → Link + App-Code
- `npm run auth:second-factor` zeigt Konten mit zweitem Faktor

## User Management (`/dashboard/users`, nur Admins)

- Reiter Konten, Kunden, Freelancer; ⓘ am Umschalter erklärt sie; Konten = Personen mit Login, Kunden/Freelancer = Firmen
- Registrierung: Pflicht Vorname, Nachname, Unternehmen, Telefon, E-Mail, Passwort; optional Position, Website, Kundennummer, Nachricht; Datenschutzhinweis (Art. 6 Abs. 1 lit. b DSGVO, keine Checkbox); Regeln `lib/hub-users/rules.ts`
- Offene Registrierungen: erste Gruppe „Wartet auf Freigabe“, „Prüfen“ in der Zeile; Freigeben (Rolle, bestehender oder neuer Kunde) → Mail mit Login-Link; Ablehnen mit Begründung (Mail + `/auth/pending`), bleibt gespeichert
- Konto anlegen: Login, Rolle, Kunde → Aktivierungslink zum Kopieren, Häkchen verschickt ihn per Mail
- Bearbeiten: Rolle, Kunde, Passwort-Link, deaktivieren/reaktivieren, löschen nach Eingabe der E-Mail; Löschen nur über `hub_delete_login` (`removeLogin`); `in_use`/`staff` → nur deaktivieren möglich
- Kunden: Unternehmen (≤ 160 Zeichen), Kundennummer, Pakete, Kontakt, Anschrift, Logo; Kontostatus (kein Konto, angelegt, eingeladen, aktiv), „Letzter Login“
- Kundennummer: `OA-` + zufällige freie Zahl 10000–99999 (auch gegen Service geprüft); Service-Format `OA-` + 4–20 Großbuchstaben/Ziffern; Freelancer `FL-` + Zufallszahl
- Neuer Kunde entsteht zuerst als Service-Organisation (`hub.customer_created` in `audit_events`), Hub-Kunde per Service-Trigger; Logins über `service_access_from_hub`; Fehlschlag → `removeServiceCustomer` (Mitgliedschaften zuerst)
- Kontaktdaten Hub ↔ `business_customer_profiles`: Trigger beide Richtungen, feldweise, nur direkte Änderungen; Anschrift „Straße, PLZ Ort, Land“; Ansprechpartner und Notizen bleiben in Service

### Import aus Sevdesk

- „Kunden → Importieren“ (`lib/hub-customer-import/rules.ts`, `users-import.tsx`, `importCustomers`): CSV (UTF-8 oder Windows-1252, `;` `,` Tab, ≤ 5 MB, ≤ 2000 Zeilen), Excel mit Hinweis abgelehnt; Spalten nach Überschrift, zuordenbar
- Übernommen: Unternehmen, Kundennummer, E-Mail, Telefon (sonst Mobil), Website, Anschrift, Land; nie USt-ID, Steuernummer, Bank, Notizen
- Nummer = `OA-` + Sevdesk-Nummer (unter vier Zeichen mit führenden Nullen); ohne Nummer Zufallsnummer
- Bestehende Kunden (Nummer, dann `normalizeCompany`): nur leere Felder füllen, nie überschreiben; Konflikte (fremde Nummer, doppelt) = Fehler
- Ansprechpartner füllen Lücken der Firma; Person ohne Firma → Kunde unter ihrem Namen; andere Kategorien übersprungen, anhakbar
- Speichern erst mit „… Kunden übernehmen“, in Paketen zu 20; kein Rückgängig → Vorschau, mit ein, zwei Zeilen beginnen

### Konten und Einladungen

- „Konten anlegen“ (Reiter Kunden, `users-logins.tsx`, `lib/hub-invitations/rules.ts`, `createCustomerLogins`): eine Zeile je Kunde ohne Konto; Adresse aus Kontakt-E-Mail, Namen aus erneut geladener Sevdesk-Datei (`readContacts`); Pakete zu 10; keine Mail
- Gesperrt: ohne Namen, ungültige Adresse, Adresse mit Konto, doppelte Adresse
- „Einladungen senden“ (Reiter Konten, `sendInvitations`): Aktivierungslink an nie angemeldete Konten, Pakete zu 10; Erinnerungen bewusst anhaken; ohne Mailversand startet nichts; „Zuletzt eingeladen“ aus `hub_notifications`

### Archivieren und Löschen

- Beides im User Management für Kunden und Freelancer (`lib/hub-archive`); Service-Anfragen werden nie gelöscht
- Archiviert = `hub_customers.archived_at` gesetzt oder Organisation in Service archiviert
- Archivieren: Eintrag verschwindet überall außer im User Management (Assets, Projekte, Aufgaben-Board, Kalender, Nachrichten, Vertrag & Domain, Schlüsselbund, Assistent, Claude-Connector); aktive Zugänge gesperrt und gemerkt (nie Admins/oalab-Team); Service-Organisation archiviert
- Wiederherstellen: alles zurück, genau die gemerkten Zugänge
- Löschen: Vorschau (was fällt weg, was bleibt) + Eingabe der Nummer; alles am Eintrag inkl. eigener Dateien und Logo; Zugänge gelöscht, von Service gebrauchte gesperrt und gelöst; Service-Organisation bleibt archiviert, Nummer bleibt vergeben
- Datenbank: `hub_archive_customer`, `hub_restore_customer`, `hub_delete_customer` (je eine Transaktion, nur Service-Rolle); Abgleich legt zu archivierten Organisationen keinen Hub-Kunden an

## Freelancer

- Betreut Kunden neben oalab; bekommt Kunden zugeordnet (legt keine an), eigene Dateien wie ein Kunde, sieht Dateien seiner Kunden
- Datei je Kunde „Sichtbar für“: Kunde und Freelancer, Nur Kunde, Nur Freelancer; Verträge, Angebote, Rechnungen von selbst „Nur Kunde“
- Freelancer nur lesend im Asset Management („Meine Dateien“, „Alle Dateien“, „Meine Kunden“; Ordner nur in eigenen Dateien)
- Kunde sieht nicht, wer ihn betreut; mehrere Freelancer je Kunde möglich
- Chat mit oalab und Termine wie ein Kunde; keine Projekte, kein Service; Aufgaben-Board mit Beteiligung und Sichtbarkeit
- Datenbank: `hub_customers.kind` (fest), `hub_freelancer_customers`, `hub_file_assignments.audience`; `hub_freelancer_sees()` verlangt aktives Profil + `aal2`
- Grenze: Freelancer sehen Kontaktdaten ihrer Kunden (Rechte pro Zeile); je Freelancer Vertraulichkeits- und AV-Vereinbarung nötig

## Asset Management (`/dashboard/files`)

- Admins: „Asset Management“ (`asset-management.tsx`), Kundenliste links, Kunde rechts; Kunden: „Dateien“ (Tabelle, `FileDetailDialog`)
- Ansichten: Kunde mit Ordnern, „Alle Dateien“, „Ablage“ (ohne Zuordnung) mit „Zuordnen“; Listenansicht Minimal/Detail (`listView` in `lib/appearance.ts`)
- Hochladen: Seitenleiste `AssetPanel` per Knopf oder Ziehen auf Ordner (`data-drop-folder`); bis 20 Dateien je 50 MB; Titel und Kategorie je Datei (`guessFileCategory`); keine ausführbaren Dateien; Kunden laden nicht hoch
- Kategorien (`lib/hub-files/catalog.ts`): Vertrag, Angebot, Rechnung, Logo & Marke, Design, Website & Inhalte, Dokumentation, Sonstiges
- Details als Seitenleiste (`asset-details.tsx`): Bildvorschau bis 8 MB, Herunterladen, Link kopieren (`?file=<id>`), „Als Logo verwenden“, Zuordnung und Ordner je Kunde
- Häkchen und Details schließen sich gegenseitig aus
- Bearbeiten: Titel, Kategorie, Beschreibung ohne Meldung an Kunden; Löschen endgültig mit Rückfrage (kein Papierkorb), nennt betroffene Kunden
- Ordner: je Kunde, eine Ebene; Kunden und Admins legen an; Löschen → Dateien nach „Ohne Ordner“
- ZIP: Browser baut ZIP selbst (`lib/hub-files/zip.ts`, `fflate`, ≤ 500 MB), doppelte Namen nummeriert
- Download: exakt die hochgeladene Fassung mit Originalnamen, SHA-256-Prüfsumme; Links 60 Sekunden
- Offen: neue Fassung hochladen, Tags, Unterordner, Kunden-Upload

### Kundenlogos

- Privat wie Dateien (`hub-logos`, ≤ 2 MB, SVG/PNG/JPG/WebP); Links kurzlebig, gesammelt erzeugt; Kunde bekommt nur eigenes Logo
- Felder `logo_path`, `logo_background` (light, dark, brand), `logo_color`; getrennt und fehlertolerant gelesen, nie in `CUSTOMER_COLUMNS`
- `LogoMark` (`components/hub/logo-mark.tsx`): Kachel, bei Fehler Initialen; Plakette (`plate`) in der Firmenzeile
- Logo-Fenster `CustomerLogoDialog`: aus Asset Management („Logo hochladen/ändern“) und „Kunde bearbeiten“; Ziehen, Klicken, Strg+V, Bilder des Kunden (`listLogoCandidates`); Hintergrund vorgewählt (`groundForPixels`)
- Ersetzen löscht das vorige Bild

## Vertrag & Domain (`/dashboard/contracts`)

- Pakete in zwei Gruppen, je höchstens eins: Domain (OALAB Domain, OALAB Domain & Mail), Service (OALAB Service Lite, OALAB Service Max); `lib/service-packages.ts`, `hub_customer_packages` mit „seit“ und „gekündigt zum“
- Verlauf `hub_customer_timeline`: Rechnungen, Beträge, Dateien, interne Notiz, Freigabe für Kunden; Paketwechsel trägt die Datenbank ein
- Kunden sehen Pakete, Verträge, Rechnungen, freigegebene Zeitpunkte, nie Notizen; Freelancer kein Zugang
- Reiter Domain & Mail und Zugänge (`contracts-domains.tsx`, `contracts-access.tsx`, `lib/hub-domains/`): Domains (klein, Umlaute als `xn--…`, eindeutig), Status, DNS-Häkchen; ein Mail-Server je Kunde (nur mit Domain & Mail); Postfächer, Weiterleitungen, Aliase; Anbieter-Logins ohne Leseregel
- „Demnächst“: Domain-Verlängerungen der nächsten 60 Tage; Suche findet Kunden über Domains

### Zugänge (Passwörter)

- AES-256-GCM im Server (`lib/hub-vault/crypto.ts`), Schlüssel `HUB_VAULT_KEY` (32 Byte, Base64) nur in Coolify und `.env.local`, gelesen nur in `lib/hub-vault/key.ts`; Verlust = alle Passwörter unlesbar; Kennung (erste vier Byte SHA-256) unter „Zugänge“ muss überall gleich sein
- Datenbank `hub_vault_secrets`: nur Geheimtext, ohne Leseregel; Passwort nur an Postfach oder Login
- Jede Aktion: `aal2`, dann `verifyHubAdmin`; Anzeigen/Kopieren vorher protokolliert (`vault.revealed`, `vault.copied`), höchstens 30 Blicke je Admin in 10 Minuten; Anzeige 30 Sekunden
- Keine Passwortfelder im Formular (Browser speichert sonst Kundenpasswörter)
- Offen: frische Code-Bestätigung vor jedem Blick; Zwischenablage wird nicht geleert

### Service-Kontingente

- Gebaut, Schalter aus; einschalten erst auf ausdrückliches Wort: Preise freigegeben, alle echten Kunden mit Servicepaket, Sperrliste geprüft
- Grenze neuer Anfragen je Kalendermonat (deutsche Zeit): Lite 5, Max 20, ohne Paket 0; Antworten zählen nie; Admins nehmen einzelne Anfragen aus (Grund 3–300 Zeichen)
- Datenbank: `hub_service_quota_switch`, `hub_service_request_exemptions`, `app.hub_service_quota`, `app.assert_client_request_quota_v1`; Grenze für gleichzeitig offene Anfragen (20) bleibt
- Hub (`lib/hub-service-quota/`, `contracts-quota.tsx`): Karte „Service-Kontingente“ mit Schalter und Sperrliste, Balken je Kunde, „Nicht mitzählen“; Kunden sehen Stand nur bei eingeschaltetem Schalter; ab 80 % Vorwarnung
- Zählen nie: von oalab aus Mail/WhatsApp angelegte Anfragen; endgültig gelöschte Anfragen

## Projekte und Aufgaben

- Quelle: Studio-Tabellen `customer_projects`, `studio_project_details`, `studio_tasks` (`lib/hub-projects/`, `lib/hub-tasks/`); keine eigenen Hub-Tabellen; bestehende Tabellen nicht ändern
- Kunde sieht ein Projekt nur mit `studio_project_details` und `client_visible = true`; Admins alles
- Fortschritt = Anteil erledigter Aufgaben (ohne Aufgaben: fertige Anfragen); „Abgeschlossen“ = Studio-Status `complete`; „Dein Feedback“ = offene, freigegebene Aufgabe mit Label „Kunde“
- Tabelle (`components/hub/sheet.tsx`): nach Status gruppiert; Spalten Kunde (Admins), Projekt, Bereich, Meilenstein, Status, Start, Nächster Termin, Fortschritt; schmale Flächen blenden Spalten aus, Handy = Karten
- Nächster Termin = Zieltermin mit Hinweis („in 8 Tagen“, „überfällig“), verlinkt auf Kalendertag; Projektziele im Kalender ganztägig, zählen nicht als belegt
- Aufgaben-Board mit Beteiligten und Sichtbarkeit; Schreiben über `lib/hub-tasks/write.ts`

## Kalender (`/dashboard/calendar`)

- Admins: Termine anlegen (optional für Kunden), Teams-Link von Hand (nur Teams-Domains), bearbeiten, absagen, löschen; Überschneidung angezeigt, nicht blockiert
- Verfügbarkeit: Wochenplan, Ausnahmen, Regeln; Anfragen nur in freien Zeiten (`lib/hub-calendar/rules.ts`)
- Kunden: Auslastung je Tag, fremde Termine nur „Belegt“; Anfragen 30–90 Minuten, höchstens fünf offen, zurückziehbar; „Teams-Meeting beitreten“
- Datenbank `hub_appointments` (RLS), `hub_calendar_busy()`, `hub_withdraw_appointment_request()`
- Schreiben über `lib/hub-calendar/write.ts` (auch Claude-Connector)
- Offen: Teams-Meetings automatisch (Microsoft Graph), Feiertage, Erinnerungen

## Nachrichten (`/dashboard/messages`)

- Kunden: privater Chat mit oalab, einer je Firma, alle Logins der Firma sehen ihn; dazu „Service-Anfragen“ (Links zur Serviceplattform) und Ali
- Admins: Reiter „Privat“ (ungelesen, Suche, „Kunden anschreiben“) und „Service“ (Service-Gespräche nur lesen, `?tab=service`)
- Ungelesen: andere Seite schrieb nach eigenem Lesen und nach letzter eigener Nachricht; Antwort eines Kollegen erledigt den Chat für alle
- Datenbank `hub_private_messages` (≤ 5000 Zeichen, `client_id` gegen Doppelsenden), `hub_private_reads`; Code `lib/hub-private-chat/`, `private-chat.tsx`, `conversations.tsx`
- Abfrage alle 15 Sekunden; keine Anhänge; Löschfrist offen

### Telegram

- Jede Kundennachricht im privaten Chat → Telegram-Gruppe der Admins: Firma, Name, Text (ab 3500 Zeichen gekürzt), „Im Hub öffnen“; geantwortet wird im Hub (`lib/hub-telegram/`)
- Gruppe löscht Nachrichten nach 24 Stunden (Einstellung in Telegram)
- Datenschutzerklärung und Chat-Hinweis sagen nur „meldet auch über Telegram“, ohne Inhaltsangabe
- Signal: nicht anbinden (Nutzungsbedingungen, inoffizielles Werkzeug)

## Benachrichtigungen

- Glocke + gebündelte Mail (`lib/hub-notify/`): Aufgabe liegt beim Kunden, Projektstatus/Zieltermin geändert, neue Datei (nach „Sichtbar für“, auch Freelancer), Termin angelegt/bestätigt/verschoben/abgesagt/abgelehnt, Chat-Nachrichten
- Kunden-Mail ≈ 15 Minuten nach erster Meldung, auch mit schon gelesenen; Admin-Chat-Mail nach 5 Minuten, nur solange niemand aus dem Team gelesen hat
- Abschalten im Profil („Benachrichtigungen“, `hub_mail_notifications`); Glocke bleibt
- Takt: Cron ruft `/api/notifications/sweep` mit `HUB_NOTIFY_TOKEN`; Studio-Änderungen aus `studio_activity`, `hub_notice_marks` hält letzten Stand
- Kalender-Links in Mails (Apple, Google, Outlook, .ics): signiert mit `HUB_NOTIFY_TOKEN`, Route liest Termin neu; Logos einfarbig Bordeaux (Apple/Microsoft-Logos markenrechtlich heikel)
- Offen: Tabelle „Vorher → Nachher“ in Mails (braucht Einzelwerte in `hub_inbox`)

## E-Mails

- Versand per SMTP über `hub@oalab.de` (netcup, `lib/hub-mail/`); kein weiterer Mailanbieter
- Ein gemeinsames Design (`lib/hub-mail/templates.ts`) für alle Mails; neue Mails folgen ihm; Bilder als Inline-Anhänge (`scripts/mail-images.mjs` → `lib/hub-mail/images.ts`)
- Einzelne Meldung: eigene Überschrift, Karte, Hinweis, Button zur Stelle; mehrere: Liste mit Link je Meldung
- Registrierungs-Mails genau einmal je Login (Reservierung in `hub_notifications`); Protokoll ohne Adressen und Inhalte
- Ohne SMTP: Testmodus, Mails gebaut, nicht verschickt, Hinweis im User Management

## Assistent („Assistent & Hilfe“)

- Claude Opus 5.5 über `@anthropic-ai/sdk` (`app/api/assistant/route.ts`); Wissensbasis `lib/hub-assistant/knowledge.ts`; Aufwand `low` im Hilfe-Chat, `medium` mit Werkzeugen
- Kunden und WhatsApp: nur Hilfe, keine Daten; Verlauf ≤ 20 Nachrichten, Frage ≤ 1000 Zeichen
- Hinweis: KI antwortet, keine persönlichen Daten eingeben
- Admins mit `aal2`: Lesewerkzeuge `search`, `get_customer`, `get_project`, `list_tasks` (`lib/hub-assistant/tools.ts`); Werkzeugergebnisse = Daten, keine Anweisungen
- **Claude liest selbst, schreibt nie selbst:** Schreibwerkzeuge erzeugen Vorschlag (`hub_assistant_actions`, Ablauf 30 Minuten); gespeichert erst nach Klick, genau der Vorschlag; Erfolg/Fehler aus Serverergebnis
  - `propose_tasks` (1–20 Aufgaben, ein Projekt, Dubletten abgewählt)
  - `propose_project_update`, `propose_task_updates` (nur geänderte Felder, Studio-Version muss stimmen; kein Umbenennen, kein Löschen)
  - `propose_customer` (Dublettenprüfung, Service-Organisation, Login optional)
- Meetingtranskripte: Admins bis 60.000 Zeichen je Nachricht, Verlauf bis 150.000; Belegzitat je Aufgabe, serverseitig geprüft; Termine/Zuständigkeiten nur wenn eindeutig; Transkripte nicht gespeichert; Prüfsatz `tests/fixtures/meeting-transcripts/`
- Chatverlauf im Browser (`lib/hub-assistant/chat-storage.ts`), weg bei Abmelden; Leiste rechts ab 1024 px
- KI-Protokoll: Bereich `ai-log` (nur Admins)
- `/hub-hilfe` (`.claude/commands/hub-hilfe.md`): dieselbe Wissensbasis in Claude Code, nur lesend
- Offen: Tageslimit je Admin, Löschfrist KI-Protokoll

## Claude-Connector (MCP)

- Claude-Chats (claude.ai) arbeiten im Hub: `/api/mcp` (Streamable HTTP, ohne Sitzung, JSON), eigene Anmeldung OAuth 2.1 mit PKCE S256, Client-ID-Metadata-Dokument von claude.ai/claude.com, keine dynamische Registrierung
- Schalter `HUB_MCP_ENABLED` (aus = 404), nur auf eigener Plattform; Freigabe `/dashboard/settings/claude` nur Admins mit Code-bestätigter Sitzung
- Schlüssel: Zugriff 1 Stunde, Erneuerung 30 Tage mit Wechsel; ersetzter Erneuerungsschlüssel beendet Verbindung; Datenbank nur SHA-256 (`hub_claude_connections`); jede Nutzung prüft aktiven Admin
- Lesen: `search`, `get_customer` (ohne Kontaktdaten), `get_project`, `list_tasks`, `list_appointments`, `find_free_slots`, `check_appointment_time`
- Schreiben (`hub:write`; ältere Verbindungen nur Lesen bis Neuverbindung): Termine anlegen/ändern/absagen, Aufgaben anlegen/ändern/verschieben/kommentieren, Projekt anlegen; nichts löscht oder archiviert; alle als „destructive“ markiert
- Schreiben über denselben Code wie der Hub (`lib/hub-*/write.ts`) mit Admin-Claims (`aal2`, ohne Sitzung → Schlüsselbund bleibt zu); jede Änderung `claude.*` im Admin-Protokoll
- Profilkarte „Verbundene Apps“: Adresse, Verbindungen, Trennen
- Serviceplattform erst als eigener Plan mit eigener Freigabe
- Offen: Datenschutz (AV-Vertrag von Anthropic nur Team, Enterprise, API); Erklärung bleibt bis dahin unverändert

## WhatsApp

- Assistent per WhatsApp Cloud API (`app/api/whatsapp/route.ts`), nur verbundene Nummern (Code im Profil, „VERBINDEN 123456“, 15 Minuten)
- 30 Fragen je Nummer und Tag; unbekannte Nummern höchstens drei Antworten mit Anleitung; „TEAM“ nennt Kontakt; Verlauf nach 48 Stunden gelöscht
- Nicht eingerichtet (keine Meta-App, keine Variablen); vor Livegang Datenschutzabschnitt zu Meta

## Rechtliches

- `/impressum`, `/datenschutz` (`lib/legal-links.ts`, `lib/legal-details.ts`, `components/legal/`), öffentlich, höchstens zwei Klicks von überall, in jeder Mail
- Erklärung beschreibt, was der Code nutzt: netcup (Server, Datenbank, Anmeldung, Dateien, Mail), Cloudflare (USA, DPF), Anthropic, Telegram, Vercel/Supabase als frühere Plattform mit ruhender Kopie, Cookie `__Secure-oalab.session_token`, nächtliche Sicherung, Freelancer als Empfänger, Firmendaten aus Buchhaltung (Art. 14 DSGVO)
- Dienst neu/geändert → Text im selben PR, `PRIVACY_POLICY_DATE` mitziehen; `tests/legal-pages.test.mjs`
- Anrede „du“; keine eGbR, kein Datenschutzbeauftragter nötig
- Offen: anwaltliche Prüfung; Löschfristen (abgelehnte Registrierungen, KI-Protokoll, Chat); Standort Server 2 (bis dahin „in der EU“); Ziel der nächtlichen Sicherung; AV mit netcup (Server) und Cloudflare; Zugangsdaten der Hosting-Kunden in der Erklärung, bevor echte Zugangsdaten hineinkommen

## Oberfläche

- Liquid Glass nach Struktur von Apple Health, ohne Apple-Markenelemente; Werte und Regeln: [CI_GUIDELINES.md](./CI_GUIDELINES.md)
- Tabellen wie OALab Studio auf deckender Fläche, Glas außen; Werkzeugleiste Suche, Filter, Sortierung, Gruppe (`components/hub/sheet.tsx`, `lib/table-tools.ts`); Suche ignoriert Groß-/Kleinschreibung und Umlaute
- Navigation: Sidebar ab 1024 px; darunter Tab-Leiste Übersicht, Dateien/Assets, Nachrichten, Kalender, Mehr (`tabNavigation` in `components/hub/navigation.ts`); Projekte unter „Mehr“
- Tablet: Logo allein mittig oben; Abmelden-Knopf oben rechts (`.topbar-signout`); Handy: Logo + Schriftzug links
- Ecke unten links (`glass-sidebar.tsx`): Zeichen, Name, Paket bzw. „oalab-Team“, ein Zahnrad mit Menü (Adresse, Profil, Darstellung, Abmelden)
- Begriffe: „Profil“, „Bereiche“, „Konto anlegen“, „Zieltermin“; ein Seitenkopf mit Symbol je Seite
- Dunkelmodus Automatisch/Hell/Dunkel (`colorScheme` in `lib/appearance.ts`), Tokens in `app/glass.css`
- Einblenden als Wasserfall, reines CSS auf Server-HTML (`app/motion.css`, `components/page-waterfall.tsx`); Glaskarten blenden selbst ein
- „Bewegung reduzieren“: eigener Schalter, Standard aus, unabhängig von `prefers-reduced-motion`; gespiegelt ins Cookie `oalab_reduce_motion` für Service
- Ladeanimation: drehendes oa-Logo nach 0,2 s (`components/brand-loader.tsx`), `MiniLoader` in Knöpfen; großes Logo nur auf Hintergrund, nie auf heller Karte
- Begrüßung nach Anmeldung „Willkommen zurück, Vorname.“ (`lib/greeting.ts`, `hub-greeting.tsx`)
- Ali (Kunden): Begrüßung in der Übersicht (`welcome-stage.tsx`, `host-avatar.tsx`, WebGL aus MP4 mit Alpha-Hälfte), Nachdenken in Nachrichten (`messages-host.tsx`); bei jedem Öffnen, ohne Ton; Admins ohne Avatar
- Firmenzeile unter Alis Blase: Logo-Plakette, Firma, Kundennummer
- Installierbare Web-App mit Offline-Seite; Installieren-Knopf links neben der Glocke
- Patch Notes (`/dashboard/patch-notes`, `lib/patch-notes.ts`): Pflege nach `AGENTS.md`

## Routen

| Route | Zugang | Zweck |
| --- | --- | --- |
| `/`, `/auth/login` | öffentlich | Login |
| `/auth/sign-up` | öffentlich | Registrierung, Zugang erst nach Freigabe |
| `/auth/pending` | mit Login | Stand der Registrierung |
| `/auth/mfa` | mit Login | Code-Eingabe zweiter Faktor |
| `/auth/forgot-password`, `/auth/update-password`, `/auth/confirm`, `/auth/callback`, `/auth/error`, `/auth/sign-up-success` | Auth-Flow | Passwort, Bestätigung, Fehler |
| `/dashboard` | geschützt | Übersicht |
| `/dashboard/<bereich>` | geschützt | projects, files, messages, calendar, contracts, patch-notes, insights, discover, metrics/<kennzahl>, settings, settings/appearance |
| `/dashboard/users`, `/dashboard/ai-log`, `/dashboard/keychain` | nur Admins | User Management, KI-Protokoll, Schlüsselbund (`lib/hub-keychain/`) |
| `/dashboard/settings/claude` | nur Admins | Freigabe Claude-Connector |
| `/impressum`, `/datenschutz` | öffentlich | Rechtstexte |
| `/api/assistant` | geschützt | Assistent (Stream) |
| `/api/whatsapp` | Meta-Signatur | WhatsApp-Webhook |
| `/api/notifications/sweep` | `HUB_NOTIFY_TOKEN` | Benachrichtigungstakt |
| `/api/calendar/<id>/<ziel>` | signierter Link | .ics, Google, Outlook |
| `/api/mcp`, `/api/mcp/oauth/*`, `/.well-known/oauth-*` | OAuth | Claude-Connector |
| `/preview/*` | nur `npm run dev`, live 404 | Designvorschau mit Beispieldaten (`lib/hub-data.ts`, `lib/hub-*/fixtures.ts`, `public/demo-files`) |
| `/protected` | geschützt | Weiterleitung auf `/dashboard` |

## Offen

- Hub-Rollen aus `memberships` ableiten
- Kunden ändern ihre Kontaktdaten selbst
- Kennzahl-Kacheln im Reiter „Projekte“: zurückholen oder anderer Platz
- Abhängigkeiten reproduzierbar pinnen (`@supabase/*` auf `latest`); Teststrategie und CI
- `.gitattributes` mit `public/demo-files/** -text` (Windows-CRLF bricht Musterdatei-Test)
- `npm audit`: drei mittlere Funde über Tailwind CSS 3, lösbar nur mit Tailwind 4; `--omit=dev` ohne Befund
- DKIM und DMARC für oalab.de
