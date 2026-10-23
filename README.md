# OALAB Projects – Client Hub

Ein gemeinsamer Workspace für oalab und seine Kunden. Die Plattform heißt **oalab Client Hub** und verwendet die gelieferten oalab-Logos, den Bordeaux-Rot-Orange-Verlauf und die einheitliche Schrift **Inter**.

Projektstand, Entscheidungen und offene Produktfragen werden in [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) gepflegt.

Logo-Einsatz, Markenfarben und Typografie sind in [CI_GUIDELINES.md](./CI_GUIDELINES.md) festgelegt. Die zentralen Markentokens stehen in `app/brand.css`.

Die [Online-Version](https://oalab-client-hub.vercel.app/) zeigt direkt den Login; eine separate Landingpage gibt es nicht. Die vier Demo-Ansichten sind auf ausdrücklichen Wunsch öffentlich per Klick zugänglich: OALAB Admin, Nordlicht Studio, Form & Feld und Studio Horizont. Sie verwenden nur Fixtures und keine echten Supabase-Sitzungen. Lokal bestehen zusätzlich vier echte Supabase-Testkonten. Einrichtung und Status stehen in [DEMO_ACCOUNTS.md](./DEMO_ACCOUNTS.md).

## Aktueller Umfang

Schritt 1 umfasst das responsive Frontend mit Navigation und Dashboard sowie die neu gestalteten Login-, Registrierungs- und Passwortseiten. Die Gestaltung orientiert sich an [Prolab](https://www.framer.com/marketplace/templates/prolab/).

- **Designvorschau:** [/preview](http://localhost:3000/preview) – ausdrücklich gekennzeichnete fiktive Projekte, Dateien und Nachrichten.
- **Anmelden:** [/auth/login](http://localhost:3000/auth/login) – bestehende Supabase-Authentifizierung im neuen Design.
- **Workspace:** [/dashboard](http://localhost:3000/dashboard) – nach regulärer Anmeldung oder mit einer separat signierten öffentlichen Demo-Identität. Demo-Identitäten erhalten ausschließlich rollenabhängige Fixtures. Echte Konten kommen erst nach der Freigabe im User Management in den Hub und sehen dann Unternehmen, Kundennummer und Servicepakete aus der Datenbank; bis dahin zeigt [/auth/pending](http://localhost:3000/auth/pending) den Stand.

Der Hub ist im Liquid-Glass-Stil gestaltet (Struktur nach Apple Health): Übersicht mit Insights, Favoriten, Highlights und Listen, Detailseiten je Kennzahl mit Zeitraum-Umschalter, Entdecken sowie die Kategorien Projekte, Dateien, Nachrichten und Kalender. Die Sprechblase „Assistent & Hilfe“ oben rechts öffnet einen KI-Assistenten (Claude), der Fragen zu den Funktionen beantwortet. Hintergrund und Glas lassen sich unter Profil › Darstellung einstellen. Ab 1024 px navigiert eine Glas-Sidebar; auf Tablet und Smartphone stehen dieselben Einträge in einer schwebenden Tab-Bar am unteren Rand, daneben ein Such-Button für „Entdecken“. In der Vorschau und den Demo-Workspaces lassen sich Projekte filtern, Details öffnen und Seiten beziehungsweise Beispielprojekte durchsuchen. Der Demo-Admin sieht alle drei Kunden; Customer nur ihren eigenen Workspace. Admins verwalten Registrierungen, Logins und Kunden im User Management. Live-Nachrichten und echte Projektverwaltung folgen in weiteren Schritten.

## Lokal starten

Voraussetzung: Node.js 24 und npm.

```sh
npm ci
```

Eine lokale `.env.local` mit den eigenen öffentlichen Supabase-Konfigurationswerten anlegen:

```env
NEXT_PUBLIC_SUPABASE_URL=<SUPABASE_PROJECT_URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<SUPABASE_PUBLISHABLE_KEY>
```

```sh
npm run dev
```

Anschließend [localhost:3000](http://localhost:3000) öffnen. Die Startseite zeigt denselben Login wie `/auth/login`. Sind die vier Testkonten eingerichtet und ihre lokalen Zugangsdaten vorhanden, öffnet ein Klick auf ein Demo-Konto den zugehörigen Workspace. Diese echte Konto-Abkürzung ist ausschließlich auf lokalen Entwicklungsservern aktiv; `ENABLE_DEMO_LOGIN=false` deaktiviert sie zusätzlich. Die davon getrennte öffentliche Fixture-Demo wird nur mit den folgenden expliziten Produktionseinstellungen aktiviert. Die Designvorschau ist auch ohne Supabase-Konfiguration erreichbar.

## Vercel und öffentliche Demo

Bestehendes Projekt: `oalabs-projects/oalab-client-hub`, Hauptdomain: [hub.oalab.de](https://hub.oalab.de/) (zeigt auf Vercel), weiterhin erreichbar unter [oalab-client-hub.vercel.app](https://oalab-client-hub.vercel.app/), Git-Branch: `main`. Supabase nutzt `https://hub.oalab.de` als Site URL; `NEXT_PUBLIC_SITE_URL` in Vercel sollte ebenfalls darauf zeigen.

In Vercel sind ausschließlich für **Production** konfiguriert:

| Variable | Typ | Zweck |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Config | Vorhandene URL für reguläre Authentifizierung |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Config | Vorhandener öffentlicher Supabase-Schlüssel |
| `ENABLE_PUBLIC_DEMO_LOGIN` | Config | `true` aktiviert die öffentliche Fixture-Demo |
| `PUBLIC_DEMO_ORIGIN` | Config | `https://oalab-client-hub.vercel.app` als einziger erlaubter HTTPS-Origin |
| `OALAB_DEMO_SESSION_SECRET` | Secret | Zufällig erzeugter, serverseitiger Signaturschlüssel, mindestens 32 Zeichen |

Der Secret-Wert wird direkt in Vercel verwaltet, nicht in Git. Für die Online-Demo werden weder der administrative Supabase-Key noch echte Testpasswörter benötigt. `.vercelignore` und das Next.js-Tracing schließen die lokalen Zugangsdaten vom Deployment aus. Preview-Domains sind nicht automatisch freigegeben.

Nach Änderungen auf `main` deployen; bei manuellem CLI-Deployment zunächst mit `vercel link --project oalab-client-hub --scope oalabs-projects` das bestehende Projekt auswählen, anschließend `vercel deploy --prod --scope oalabs-projects`. Keine lokalen Secret-Dateien hochladen und keine fremden Projektvariablen überschreiben. Änderungen an Umgebungsvariablen benötigen ein neues Deployment.

Sicherheitsgrenze: Das `__Host-oalab-demo`-Cookie gewährt für zwölf Stunden nur Zugriff auf die vier Fixture-Ansichten. Es ist kein Supabase-JWT. Echte Datenzugriffe und spätere Schreib-Endpunkte müssen unabhängig davon gültige Supabase-Claims sowie passende RLS-Policies prüfen. Vor der Anbindung echter Geschäftsdaten diese Trennung erneut prüfen. Abschalten: `ENABLE_PUBLIC_DEMO_LOGIN=false` setzen und neu deployen; Schlüsselwechsel invalidiert alle bisherigen Demo-Cookies.

## Dateiablage einrichten

Die Dateiablage liegt im Supabase-Projekt `tjbslvwvisxjjcxfhbgm`. Für die Migration selbst in `.env.local` eintragen (niemals einchecken):

```env
SUPABASE_ACCESS_TOKEN=<persönlicher Supabase Access Token>
SUPABASE_DB_PASSWORD=<Datenbank-Passwort des Projekts>
```

```sh
npm run db:check   # zeigt, welche Migrationen angewendet würden
npm run db:push    # wendet supabase/migrations an
npm run files:seed # Demo-Kunden, Mitgliedschaften und Beispieldateien (benötigt SUPABASE_SECRET_KEY)
```

Die Skripte lesen die Werte aus `.env.local` und geben sie nicht aus.

In der Dateiablage gilt:

- **Hochladen:** Admins laden bis zu 20 Dateien auf einmal hoch.
- **Herunterladen:** Mehrere markierte Dateien lädt man als ZIP herunter. Der Browser baut die ZIP-Datei selbst (`lib/hub-files/zip.ts`, Bibliothek `fflate`, bis 500 MB).
- **Ordner:** Ordner sind kundenbezogen und haben eine Ebene (`supabase/migrations/20261022170000_hub_folders.sql`). Kunden legen sie für ihr Unternehmen an, Admins für jeden Kunden. Kunden dürfen per Spaltenrecht nur den Ordner ihrer Zuordnungen ändern.

## User Management

Admins verwalten unter „Verwaltung → User Management“ (`/dashboard/users`) Registrierungen, Logins und Kunden. Grundlage ist die Migration `supabase/migrations/20261022190000_hub_user_management.sql`.

- **Registrierung mit Freigabe:** „Jetzt registrieren“ fragt Vorname, Nachname, Unternehmen, Telefon, E-Mail und Passwort ab, optional Position, Website, Kundennummer und Nachricht. Ein Datenbank-Trigger legt dazu ein Profil „wartet auf Freigabe“ an. Bis zur Freigabe führt jede Anmeldung auf `/auth/pending`; KI-Assistent, WhatsApp und Kalender-Auslastung bleiben gesperrt. Sobald die Person ihre E-Mail-Adresse bestätigt hat, bekommt das oalab-Team eine E-Mail mit allen Angaben und die Person eine Eingangsbestätigung (siehe [E-Mails](#e-mails)).
- **Freigeben:** Rolle wählen und den Login einem bestehenden Kunden zuordnen oder einen neuen Kunden mit der nächsten freien Kundennummer und Servicepaketen anlegen. Die Person bekommt danach eine E-Mail mit dem Login-Link. Ablehnen geht mit einer Begründung, die die Person per E-Mail bekommt und nach dem Login sieht; abgelehnte Registrierungen bleiben gespeichert.
- **Konten anlegen:** Der Admin legt Login, Rolle und Kunde an und erhält einen einmaligen Aktivierungslink (Supabase-Recovery-Link über `/auth/confirm`). Mit dem Häkchen „Aktivierungslink per E-Mail an die Person senden“ verschickt der Hub den Link selbst; angezeigt wird er zusätzlich zum Kopieren.
- **Bearbeiten, Sperren, Löschen:** Rolle und Kunde ändern, Passwort-Link erzeugen (zum Kopieren oder per E-Mail an die Person), deaktivieren (Supabase-Sperre plus inaktives Profil, wirkt sofort auf alle Daten) und reaktivieren, endgültig löschen nach erneuter Eingabe der E-Mail-Adresse.
- **Kunden:** Unternehmen, Kundennummer, Servicepakete, Kontakt und Anschrift. Kunden sehen diese Angaben nach dem Login in Sidebar, Übersicht und Profil.
- **Sicherheit:** Jede Aktion (`lib/hub-users/actions.ts`) prüft zuerst mit der Sitzung des Aufrufers, ob die Datenbank ihn als aktiven Admin führt (`is_hub_admin()` liest Rolle und Status aus der Datenbank, nicht aus dem Token). Erst dann arbeitet der Server mit dem Secret Key (`lib/supabase/admin.ts`, nur serverseitig). Browser dürfen Profile und Protokoll nur lesen. Schutzregeln: kein Selbst-Sperren oder -Herabstufen, der letzte aktive Admin bleibt erhalten, Demo-Konten sind schreibgeschützt. Jede Aktion steht im Protokoll `hub_admin_events`, ohne Namen, Adressen oder Links.

Für den Livebetrieb braucht Vercel (Production) zusätzlich `SUPABASE_SECRET_KEY` als Secret. In Supabase sollten „Confirm email“ aktiv und die Gültigkeit der E-Mail-Links („Email OTP expiration“) auf 24 Stunden gesetzt sein, damit weitergegebene Aktivierungslinks nicht nach einer Stunde verfallen. Bestätigungs- und Passwort-E-Mails an echte Adressen brauchen einen eigenen SMTP-Versand in Supabase (siehe [E-Mails](#e-mails)).

## E-Mails

Der Hub verschickt seine E-Mails selbst per SMTP über das Netcup-Postfach `hub@oalab.de` (`lib/hub-mail/`, Paket `nodemailer`). Absender ist `oalab Client Hub <hub@oalab.de>`, Antworten gehen an `info@oalab.de`.

| E-Mail | an | ausgelöst durch |
| --- | --- | --- |
| Neue Registrierung mit allen Angaben und Button ins User Management; Antworten gehen an die Person | oalab-Team (`HUB_TEAM_EMAIL`) | Die Person hat ihre E-Mail-Adresse bestätigt und sieht zum ersten Mal `/auth/pending` |
| Eingangsbestätigung | Person | wie oben |
| Zugang freigeschaltet, mit Login-Link | Person | „Freigeben“ |
| Registrierung nicht freigegeben, mit Begründung | Person | „Ablehnen“ |
| Aktivierungs- oder Passwort-Link | Person | Häkchen beim Anlegen oder „Link per E-Mail senden“ |

- Team-Mail und Eingangsbestätigung gehen pro Login genau einmal raus: Der Server reserviert vor dem Versand eine Zeile in `hub_notifications` (eindeutiger Index). Ein fehlgeschlagener Versand wird beim nächsten Aufruf der Warteseite wiederholt.
- `hub_notifications` (Migration `supabase/migrations/20261022210000_hub_notifications.sql`) speichert nur Art, Login, Ergebnis und Message-ID, keine Adressen, Betreffzeilen oder Inhalte. Admins sehen die Einträge im Verlauf des Benutzers. Server-Logs nennen nur die Art der Mail; jede Mail trägt sie auch im Kopf `X-Hub-Mail` (für Postfach-Filter).
- Ohne SMTP-Zugang (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`) läuft der Hub im Testmodus: Die Mails werden gebaut, aber nicht verschickt und als „nicht verschickt“ vermerkt. Das User Management zeigt dann einen Hinweis.
- Die Bestätigungs- und Passwort-Mails von Supabase selbst nutzen die deutschen Vorlagen in `supabase/templates/` (eingetragen in `supabase/config.toml`).

Einrichtung für den Livebetrieb (das Passwort nur bei Netcup, in Vercel, in Supabase und in `.env.local` eintragen, nie ins Repository):

1. Im Netcup-Kundenbereich das Postfach `hub@oalab.de` mit eigenem, starkem Passwort anlegen. Der SMTP-Server steht in den E-Mail-Einstellungen; für oalab.de ist es derzeit `mxe989.netcup.net`, Port `465` (SSL/TLS).
2. In Vercel (Production) `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` (`hub@oalab.de`) und `SMTP_PASSWORD` (als „Sensitive“) eintragen, für lokale Tests dieselben Werte in `.env.local`. Der Absender `MAIL_FROM` muss das Postfach selbst oder ein Alias davon sein. Optional sind `MAIL_REPLY_TO`, `HUB_TEAM_EMAIL` (mehrere Adressen mit Komma) und `NEXT_PUBLIC_SITE_URL` für die Links in den Mails, siehe `.env.example`.
3. In Supabase unter Authentication → Emails → SMTP Settings „Custom SMTP“ einschalten: Host und Port wie oben, Benutzer `hub@oalab.de` mit dessen Passwort, Absender `hub@oalab.de` mit dem Namen `oalab Client Hub`. Ohne eigenen SMTP schickt Supabase nur wenige Mails pro Stunde und nur an Mitglieder des Supabase-Teams.
4. In Supabase unter Authentication → Emails → Templates den Inhalt von `supabase/templates/confirmation.html` bei „Confirm signup“ und von `recovery.html` bei „Reset password“ einfügen, Betreff wie in `supabase/config.toml`. Die Links laufen per Token-Hash über `/auth/confirm` und funktionieren deshalb auch auf einem anderen Gerät. Unter Authentication → URL Configuration muss die „Site URL“ die Live-Adresse des Hubs sein, ohne Schrägstrich am Ende.
5. Danach „Confirm email“ einschalten und „Email OTP expiration“ auf 24 Stunden setzen (siehe [User Management](#user-management)).

6. DNS: Der SPF-Eintrag von oalab.de schließt Netcup bereits ein (`include:_spf.webhosting.systems`). Damit die Mails nicht im Spam landen, sind DKIM für oalab.de (falls der Netcup-Tarif es anbietet) und ein DMARC-Eintrag `_dmarc` empfehlenswert; bisher gibt es keinen, für den Anfang reicht `v=DMARC1; p=none;`.

Die Mails laufen über den Mailserver von Netcup in Deutschland. Netcup verarbeitet dabei Namen, E-Mail-Adressen und Registrierungsangaben im Auftrag; dafür braucht es den Auftragsverarbeitungsvertrag mit Netcup und einen Absatz in der Datenschutzerklärung.

## KI-Assistent (Claude)

Der Chat hinter „Assistent & Hilfe“ beantwortet Fragen zu den Funktionen des Hubs mit **Claude Opus 5.5** über das offizielle SDK `@anthropic-ai/sdk`. Grundlage ist die Wissensbasis in `lib/hub-assistant/knowledge.ts`; sie muss bei jeder Funktionsänderung mitgezogen werden (`tests/hub-assistant.test.mjs` prüft Bereiche, Dateikategorien und Terminstatus). Die Route `app/api/assistant/route.ts` antwortet nur angemeldeten Supabase-Nutzern, liest die Rolle (Admin oder Kunde) aus dem Token und schickt nur den Gesprächsverlauf an Anthropic, keine Kundendaten. Vorschau und öffentliche Demo senden keine Fragen.

Schlüssel in `.env.local` eintragen (niemals einchecken) und für den Livebetrieb als Secret in Vercel (Production) anlegen:

```env
ANTHROPIC_API_KEY=<API-Schlüssel aus der Claude Console>
```

Ohne Schlüssel zeigt der Chat „Der Assistent ist noch nicht eingerichtet“.

**Claude Code im Repo:** Der Projektbefehl `/hub-hilfe` (`.claude/commands/hub-hilfe.md`) beantwortet dieselben Fragen im Terminal anhand der Wissensbasis und des Codes, nur lesend. Voraussetzung ist ein angemeldetes Claude Code (`claude`, dann `/login`).

```sh
claude "/hub-hilfe Wie nehme ich eine Terminanfrage an?"
claude -p "/hub-hilfe Wo finden Kunden ihre Dateien?"
```

## WhatsApp-Anbindung

Kunden und Admins können dem KI-Assistenten auch per WhatsApp schreiben. Die Anbindung läuft über die offizielle **WhatsApp Cloud API** von Meta (Graph API v26.0), ohne Zwischenanbieter.

- **Verbinden:** Nur verbundene Nummern bekommen KI-Antworten. Im Profil unter „WhatsApp verbinden“ erzeugt man einen Code (gültig 15 Minuten) und sendet „VERBINDEN 123456“ an die oalab-Nummer.
- **Ablauf:** Der Webhook `app/api/whatsapp/route.ts` prüft die Signatur jeder Lieferung, bestätigt sofort und antwortet dann im Hintergrund mit derselben Wissensbasis wie der Chat.
- **Grenzen:** 30 Fragen pro Nummer und Tag; „TEAM“ nennt den Kontakt (`WHATSAPP_SUPPORT_CONTACT`, Standard info@oalab.de). Der Verlauf wird nach 48 Stunden gelöscht.

**Kosten:** Pro Nummer und Monat sind 1.000 Antworten bei Meta frei. Danach berechnet Meta jede Antwort; dafür muss im Meta-Konto eine Zahlungsmethode hinterlegt sein, sonst werden weitere Antworten nicht zugestellt. Dazu kommen die Kosten für Claude.

**Einrichtung bei Meta:**

1. Auf developers.facebook.com eine App vom Typ „Business“ anlegen und das Produkt **WhatsApp** hinzufügen. Für Tests stellt Meta eine Testnummer bereit; für den Betrieb eine eigene Nummer hinzufügen, die nicht in der normalen WhatsApp-App registriert ist.
2. Im Business Manager einen Systembenutzer mit der Berechtigung `whatsapp_business_messaging` anlegen und einen dauerhaften Token erzeugen.
3. Unter WhatsApp → Konfiguration den Webhook eintragen: Rückruf-URL `https://oalab-client-hub.vercel.app/api/whatsapp`, Verifizierungstoken = `WHATSAPP_VERIFY_TOKEN`. Danach das Feld **messages** abonnieren.
4. Die Werte in Vercel (Production) eintragen und neu deployen:

| Variable | Typ | Zweck |
| --- | --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Secret | Dauerhafter Token des Systembenutzers |
| `WHATSAPP_PHONE_NUMBER_ID` | Config | Telefonnummer-ID aus WhatsApp → API-Setup |
| `WHATSAPP_APP_SECRET` | Secret | App-Geheimcode (App-Einstellungen → Allgemein), prüft die Signatur |
| `WHATSAPP_VERIFY_TOKEN` | Secret | Selbst gewählte Zeichenkette, gleich wie im Webhook-Formular |
| `WHATSAPP_BUSINESS_NUMBER` | Config | Die WhatsApp-Nummer international ohne „+“, für den Link im Profil |
| `WHATSAPP_SUPPORT_CONTACT` | Config | Optional, Kontakt für „TEAM“ (Standard info@oalab.de) |
| `SUPABASE_SECRET_KEY` | Secret | Der Webhook läuft ohne Login und schreibt nur in die WhatsApp-Tabellen |
| `ANTHROPIC_API_KEY` | Secret | Antworten von Claude |

Lokal erreicht Meta `localhost` nicht. Zum Testen echter Nachrichten braucht es eine öffentliche URL, z. B. ein Vercel-Preview-Deployment oder einen Tunnel. `tests/hub-whatsapp.test.mjs` prüft Signatur, Nachrichtenauswertung, Codes und Verlauf ohne Meta.

## Prüfungen

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
# Öffentliche Demo im lokalen Produktionsbuild prüfen (Port 3001, abweichend mit SMOKE_PORT)
npm run demo:public:smoke -- --local
# Dieselben Prüfungen gegen die öffentliche Vercel-Adresse
npm run demo:public:smoke
```

Die 79 Unit-Tests prüfen Auth-Weiterleitungen, Seed-Konten, Demo-Rollen, Branding, die öffentliche Demo-Policy einschließlich Manipulation und Ablauf der signierten Sitzungen, Textkontrast und Darstellungslogik des Hubs, Upload-Regeln, Ordnernamen, ZIP-Dateinamen, RLS-Migrationen und Musterdateien der Dateiablage, die Kalenderregeln samt Migration und Projekt-Terminierungen, Suche und Sortierung der Tabellen, Eingaberegeln, Migration und Admin-Prüfungen des User Managements sowie Gesprächsregeln und Wissensbasis des KI-Assistenten, die WhatsApp-Anbindung (Signatur, Nachrichten, Codes, Verlauf, RLS) und die E-Mails (Vorlagen und Maskierung, SMTP-Zugang und -Nachricht, Versandprotokoll, Supabase-Vorlagen). `demo:public:smoke` benötigt keine Zugangsdaten und prüft alle vier öffentlichen Fixture-Ansichten, Kundentrennung, Abmeldung und die Grenze zu echten Auth-Routen. Mit den lokalen Zugangsdaten prüft `npm run demo:verify` die echte Supabase-Authentifizierung erneut; `npm run demo:smoke` prüft bei laufendem Entwicklungsserver die echten Test-Logins und Dashboard-Datensichten. Einrichtung und Ergebnisse stehen in [DEMO_ACCOUNTS.md](./DEMO_ACCOUNTS.md). Bestätigungs- und Passwort-E-Mails sind noch separat zu prüfen.

## Supabase-Authentifizierung

Der reguläre Workspace prüft die Supabase-Session im Proxy und erneut auf dem Server. Öffentliche Demo-Identitäten sind separat signiert, ausdrücklich markiert und auf Fixture-Seiten begrenzt; sie dürfen niemals echte Datenoperationen autorisieren. Ein erfolgreicher regulärer Passwort-Login beendet eine zuvor ausgewählte öffentliche Demo-Identität. Vorschau und öffentliche Demo enthalten keine echten Kundendaten.

Für PKCE-E-Mail-Flows müssen in Supabase die passenden Redirect-URLs erlaubt sein:

- `<origin>/auth/callback?next=/dashboard`
- `<origin>/auth/callback?next=/auth/update-password`

Die eigenen Vorlagen in `supabase/templates/` sind Token-Hash-Templates und nutzen `/auth/confirm`. Recovery-Links führen standardmäßig zum Formular für ein neues Passwort. Den aktuellen Projektzugang und offene Auth-Entscheidungen beschreibt [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).

## Technische Basis

Next.js 16.4, React 19, TypeScript, Tailwind CSS und Supabase SSR. Die zentralen CI-Tokens stehen in `app/brand.css`, die Hub-Oberfläche in `app/glass.css`, Login- und Basisstile in `app/hub.css`. Hintergrund-Presets und Glas-Grenzwerte liegen in `lib/appearance.ts`, Kategorien in `lib/categories.ts`, Kennzahlen, Insights und Highlights in `lib/hub-metrics.ts` und fiktive Inhalte in `lib/hub-data.ts`.

Keine Secret Keys, Passwörter oder personenbezogenen Kundendaten ins Repository einchecken.
