# OALAB Projects – Client Hub

> Zentrale Projektübersicht, Entscheidungsgrundlage und Sammlung offener Fragen.
> Dieses Dokument soll bei jeder fachlichen oder technischen Entscheidung aktualisiert werden.

**Stand:** 15. Oktober 2026
**Projektphase:** Schritt 1 – Frontend und vier rollenbasierte Demo-Konten umgesetzt; persistentes Datenmodell folgt

### Markenentscheidung vom 15. Oktober 2026

- Plattformname: **oalab**, Produktbezeichnung: **oalab Client Hub**.
- Hauptlogo und Iconvariante sind als gelieferte Originaldateien eingebunden.
- Der Bordeaux-Rot-Orange-Verlauf des Icons bildet die gemeinsame Corporate-Farbwelt. Inter ist die einheitliche Schrift aller Oberflächen.
- Verbindliche Anwendungsregeln und Farbwerte stehen in [CI_GUIDELINES.md](./CI_GUIDELINES.md); zentrale CSS-Tokens in `app/brand.css`.

### Ergänzung vom 15. Oktober 2026: Login und Testkonten

- `/` zeigt direkt den Login; die separate Landingpage wurde auf Wunsch entfernt.
- Lokal können alle vier echten Demo-Konten per Klick angemeldet werden. Die Passwörter bleiben serverseitig in der ignorierten Zugangsdaten-Datei; dieser Passwort-Zweig ist im Produktionsmodus gesperrt.
- Online-Version auf `main`: [oalab-client-hub.vercel.app](https://oalab-client-hub.vercel.app/). Auf ausdrücklichen Wunsch sind die vier Fixture-Ansichten öffentlich für alle Besucher ohne Demo-Code auswählbar.
- Die öffentliche Demo ist von echten Supabase-Sitzungen getrennt: signiertes, zwölf Stunden gültiges HttpOnly-/Secure-Cookie, vier feste Identitäten, exakter HTTPS-Origin. Der Signaturschlüssel liegt ausschließlich als privates Vercel-Secret vor. Keine echten Passwörter oder administrativen Supabase-Keys werden dafür hochgeladen.
- Ein OALAB-Admin und drei OALAB-Customer sind als echte Supabase-Testkonten angelegt.
- Individuelle Testpasswörter werden ausschließlich lokal und außerhalb von Git gespeichert. Die Rollen werden serverseitig aus administrativ gesetzten Metadaten ausgewertet.
- Alle vier Anmeldungen, Rollen und Workspace-Zuordnungen sind geprüft. Der Admin sieht neun Projekte, jeder Customer drei Projekte und zwei Beispieldateien; URL-Manipulation gibt keine fremden Kundendaten frei.
- Die Daten sind versionierte Frontend-Fixtures; persistente Geschäftsdaten und Live-Nachrichten folgen später.
- Verbindliche Kontenliste, Einrichtung und Bereitstellungsstatus: [DEMO_ACCOUNTS.md](./DEMO_ACCOUNTS.md).

## 1. Zielbild

Der OALAB Client Hub soll als zentrale Schnittstelle zwischen OALAB und seinen Kunden dienen. Das konkrete Produktziel, die Zielgruppen und der Funktionsumfang müssen noch gemeinsam festgelegt werden.

## 2. Aktueller Stand

Das Repository basiert auf dem Next.js-/Supabase-Starter-Kit. Schritt 1 wurde auf dieser Basis umgesetzt: ein responsives Client-Hub-Frontend, gestaltete Authentifizierungsseiten und eine separate öffentliche Designvorschau. Die echten Kunden- und Projektdaten sind noch nicht angebunden.

### Beschlossene Richtung für Schritt 1

- Layoutreferenz: [Prolab für Framer](https://www.framer.com/marketplace/templates/prolab/) – große Typografie und klare Flächen. Das Branding folgt den oalab-CI-Richtlinien.
- Plattformname, Logos, Markenverlauf und Inter sind durch den Auftraggeber festgelegt.
- Das Frontend ist zunächst deutschsprachig und auf die Zusammenarbeit zwischen Kunden und OALAB ausgerichtet.
- `/preview` zeigt ausschließlich fiktive Beispieldaten und kennzeichnet diese ausdrücklich. Es wird keine echte Anmeldung simuliert.
- `/dashboard` prüft entweder echte Supabase-Claims oder eine ausdrücklich markierte öffentliche Fixture-Identität. Die vier Demo-Identitäten erhalten gezielt zugeordnete Fixtures; normale Konten sehen ohne Datenanbindung leere Zustände. Öffentliche Fixture-Identitäten dürfen niemals echte Geschäftsdaten oder Schreibaktionen autorisieren.
- Die bestehende Selbstregistrierung bleibt vorerst erhalten. Einladung und Rollenmodell sind weiterhin offen.

### Technische Basis

- Next.js 16.4 mit App Router und Turbopack
- React 19 und TypeScript
- Tailwind CSS 3 sowie shadcn/Radix-Komponenten
- Supabase Auth und `@supabase/ssr`
- Cookie-basierte Sessions für Client- und Server-Komponenten
- GitHub-Repository: `oalabhypercode/oalab-client-hub`
- Lokale Entwicklung über `http://localhost:3000`

### Bereits implementiert

- Registrierung mit E-Mail und Passwort
- Anmeldung und Abmeldung
- E-Mail-Bestätigung
- Passwort-Reset
- Geschützter Workspace unter `/dashboard`; die bisherige Route `/protected` leitet dorthin um
- Automatische Weiterleitung nicht angemeldeter Benutzer zum Login
- Responsives Grundlayout mit Navigation, Topbar, Mobilmenü und oalab-Branding
- Übersicht, Projektindex, Dateien, Nachrichten und Kontoeinstellungen als Frontend-Gerüst
- Deutsche Authentifizierungsseiten mit Ladezuständen, Passwortsichtbarkeit und Fehlermeldungen
- Workspace-Suche, Projektfilter, Detaildialoge und Benachrichtigungsdialog in der Designvorschau
- Sichere interne Weiterleitungen und PKCE-/E-Mail-Bestätigungs-Callbacks
- Vier echte Demo-Konten mit serververwalteter Admin-/Customer-Zuordnung und getrennten Fixture-Datensichten
- Wiederholbarer Seed und automatisierte Login- sowie Dashboard-Zugriffstests ohne Ausgabe von Passwörtern
- Helles Design als vorläufige Richtung; ein finaler Dark-Mode ist noch nicht gestaltet

### Noch nicht implementiert

- Datenanbindung für Kunden, Unternehmen, Projekte, Aufgaben und Meilensteine
- Persistentes Rollen- und Berechtigungssystem für reale Geschäftsdaten
- Datenbankseitige Mandantentrennung zwischen Kunden (die Demo-Fixtures sind bereits getrennt)
- Echte Datei-Uploads, Downloads, Freigaben und Supabase Storage
- Echte Kommentare, Nachrichten und Benachrichtigungen
- Angebote, Verträge, Rechnungen oder Zahlungen
- Kalender, Termine und externe Integrationen
- Projektspezifisches Datenbankschema, Migrationen und generierte TypeScript-Datenbanktypen
- Umfassende Integrationstests und CI/CD

## 3. Aktuelle Routen

| Route | Status | Zweck |
| --- | --- | --- |
| `/` | Öffentlich | Direkter Login mit vier explizit freigegebenen Online-Fixture-Ansichten; lokal echte Testkonten |
| `/auth/login` | Öffentlich | Derselbe Login mit regulärem Formular und passender Demo-Auswahl |
| `/auth/demo` | Same-Origin-POST | Online: feste Fixture-Identität; lokal: regulärer Testkonto-Login. Ohne passende Freigabe 404 |
| `/auth/demo/logout` | Same-Origin-POST | Öffentliche Demo-Identität abmelden, ohne Supabase-Session auszugeben |
| `/auth/sign-up` | Öffentlich | Selbstregistrierung |
| `/auth/sign-up-success` | Öffentlich | Hinweis zur E-Mail-Bestätigung |
| `/auth/forgot-password` | Öffentlich | Passwort-Reset anfordern |
| `/auth/update-password` | Auth-Flow | Neues Passwort setzen |
| `/auth/confirm` | Auth-Callback | E-Mail-Token bestätigen; Recovery zum Passwortformular |
| `/auth/callback` | Auth-Callback | PKCE-Code gegen Session tauschen |
| `/auth/error` | Öffentlich | Authentifizierungsfehler anzeigen |
| `/dashboard` | Geschützt | Persönliche Übersicht; zugeordnete Demo-Inhalte oder leerer Zustand |
| `/dashboard/projects` | Geschützt | Demo-Projekte je Rolle/Workspace; ansonsten Gerüst |
| `/dashboard/files` | Geschützt | Zugeordnete Beispieldateien ohne echte Downloads |
| `/dashboard/messages` | Geschützt | Zugeordnete Beispielunterhaltung ohne Versand |
| `/dashboard/settings` | Geschützt | Kontoinformationen |
| `/preview` | Öffentlich | Dashboard-Designvorschau mit fiktiven Daten |
| `/preview/projects` | Öffentlich | Beispielprojekte mit Filtern und Detaildialogen |
| `/preview/files` | Öffentlich | Beispiel-Dateiliste und Dateiinformationen |
| `/preview/messages` | Öffentlich | Fiktive, nicht sendende Beispielunterhaltung |
| `/preview/settings` | Öffentlich | Beispiel-Kontoeinstellungen |
| `/protected` | Geschützt | Weiterleitung auf `/dashboard` |

Die Root-Route, `/auth/*` und `/preview/*` sind öffentlich. Das Dashboard prüft die Identität im Proxy und zusätzlich serverseitig. Nur `/dashboard` und seine Unterseiten akzeptieren bei expliziter Freigabe die separat signierte öffentliche Fixture-Identität; andere geschützte Routen verlangen weiterhin gültige Supabase-Claims. Ohne echte Session oder gültige Demo-Identität wird zum Login umgeleitet. Vorschau und öffentliche Demo lesen keine echten Kundendaten. Vor der Anbindung echter Daten müssen neue APIs und Datenzugriffe unabhängig von der Fixture-Identität echte Authentifizierung sowie RLS prüfen.

Deployment und Abschalten der Demo sind in [README.md](./README.md#vercel-und-öffentliche-demo) dokumentiert. Bestehendes Vercel-Projekt: `oalabs-projects/oalab-client-hub`. Production enthält öffentliche Supabase-Konfiguration sowie `ENABLE_PUBLIC_DEMO_LOGIN`, `PUBLIC_DEMO_ORIGIN` und das private `OALAB_DEMO_SESSION_SECRET`. Lokale Secret-Dateien bleiben vom Upload und Git ausgeschlossen.

Für vollständige E-Mail-Flows müssen die eingesetzten Supabase-E-Mail-Templates und Redirect-URLs zum Callback passen: `<origin>/auth/callback?next=/dashboard` und `<origin>/auth/callback?next=/auth/update-password`. Bei Token-Hash-Templates wird `/auth/confirm` verwendet. Echte Passwort-Logins sind mit allen vier Demo-Konten erfolgreich geprüft. Die Projekteinstellungen und die E-Mail-Zustellung sind noch nicht geprüft; die reservierten `.test`-Adressen haben bewusst keine Postfächer.

## 4. Supabase-Status

Die lokale Umgebung verweist derzeit auf das Supabase-Projekt mit dem Ref:

```text
tjbslvwvisxjjcxfhbgm
```

Lokal sind die öffentliche Supabase-URL, ein moderner Publishable Key und ein serverseitiger Secret Key in der ignorierten `.env.local` konfiguriert. Der Secret Key wird nur für die administrative Kontenbereitstellung verwendet, niemals im Frontend oder in versionierten Dateien. Auch die individuellen Demo-Passwörter sind von Git ausgeschlossen.

Das konfigurierte Projekt ist über die aktuell verbundene Supabase-Integration nicht zugänglich. Dort sind momentan nur diese Projekte sichtbar:

- `service-oalab`
- `pflegedashboard`

Über die offizielle Admin API konnten die vier Testkonten mit dem lokalen Secret Key erfolgreich angelegt werden. Authentifizierung und Demo-Zuordnungen sind geprüft. Folgende Bereiche sind weiterhin ungeprüft:

- Datenbanktabellen und Beziehungen
- Row Level Security (RLS) und Grants
- Auth-Einstellungen und Redirect-URLs
- Storage-Buckets und Storage Policies
- Edge Functions
- Bestehende Geschäftsdaten (Benutzer wurden für die sichere Seed-Zuordnung gelesen; fremde Konten nicht verändert)

Für die aktuellen Demo-Konten wird `tjbslvwvisxjjcxfhbgm` verwendet. Vor der Datenmodellierung sind der dauerhafte Projektzugriff und die Produktionszuordnung zu klären. Für neue Tabellen müssen sowohl explizite Data-API-Grants als auch passende RLS-Policies vorgesehen werden. Supabase stellt die automatische Data-API-Freigabe bestehender Projekte zum 30. Oktober 2026 um: [Supabase Changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## 5. Technische Qualität und bekannte Aufgaben

- `npx tsc --noEmit` läuft aktuell ohne Fehler.
- `npm run lint` läuft ohne Fehler; generierte Dateien sind ausgeschlossen und der Tailwind-Import ist bereinigt.
- `npm run build` läuft erfolgreich durch.
- `npm test` besteht mit 20 Tests für Auth-Weiterleitungen, Seed-Konfiguration, Demo-Zugriffsregeln, lokales Ein-Klick-Login, gemeinsames Branding und die öffentliche Signatur-/Origin-Policy unter Node.js 24.
- `npm run demo:verify` besteht für alle vier echten Logins inklusive Rolle, Workspace und Abmeldung.
- `npm run demo:smoke` besteht für alle vier Dashboard-Datensichten, fremde Projekt-IDs und den Schutz vor unangemeldetem Zugriff.
- Alle vier lokalen Ein-Klick-Logins und der Kontowechsel sind im Browser geprüft. Produktion ohne öffentliche Freigabe verweigert Demo-POSTs mit 404. `npm run demo:public:smoke -- --local` besteht im explizit freigegebenen Produktionsmodus für alle vier Fixture-Identitäten, Kundentrennung, Abmeldung, Host-/Origin-Prüfung und die Grenze zu echten Auth-Routen. Passwörter fehlen in HTML, Browser-Assets und Deployment-Traces.
- `next` ist aktuell auf Version 16.4.0 installiert, `eslint-config-next` jedoch auf 15.3.1.
- Zentrale Abhängigkeiten werden teilweise mit `latest` statt mit einer festen Version deklariert.
- Browserprüfung: Desktop und Mobilgerät, Navigation, Filter, Suche, Dateidialoge und unangemeldeter Zugriff; echter Admin-Login, neun Projekte, Kundenfilter, Abmeldung und Wechsel zwischen Kundenkonten. An-/Abmeldung verwerfen alte Client-Router-Zustände.

### Technischer Aufräumbedarf

- [x] ESLint-Konfiguration um generierte Verzeichnisse ergänzen
- [ ] `eslint-config-next` an die installierte Next.js-Version angleichen
- [ ] Abhängigkeiten reproduzierbar pinnen
- [x] Starter-Startseite und Starter-Deploy-Link aus dem Produkt entfernen
- [x] Projektspezifische Metadaten und Sprache konfigurieren
- [ ] Teststrategie und CI-Pipeline festlegen

## 6. Offene Produktfragen

### Ziel und Zielgruppen

- [ ] Welches konkrete Problem soll der Client Hub lösen?
- [ ] Wer sind die primären Benutzer?
- [ ] Nutzen ausschließlich Kunden das Portal oder auch OALAB-Mitarbeiter und externe Partner?
- [ ] Welche Aufgaben sollen heute verwendete E-Mails, Tabellen oder andere Tools ersetzen?
- [ ] Was ist der minimale Funktionsumfang der ersten produktiven Version?

### Benutzer und Berechtigungen

- [ ] Welche Rollen werden benötigt, beispielsweise OALAB-Admin, Projektmanager, Mitarbeiter oder Kunde?
- [ ] Welche Daten und Aktionen darf jede Rolle sehen beziehungsweise ausführen?
- [ ] Kann ein Benutzer mehreren Kundenunternehmen angehören?
- [ ] Kann ein Kunde mehrere Projekte besitzen?
- [ ] Darf ein Projekt mehrere Kundenkontakte enthalten?
- [ ] Erfolgt die Registrierung öffentlich oder ausschließlich über Einladungen?
- [ ] Wer darf neue Benutzer einladen, sperren oder entfernen?

### Dashboard und Navigation

- [ ] Welche Informationen müssen nach dem Login sofort sichtbar sein?
- [ ] Benötigt jede Rolle ein anderes Dashboard?
- [ ] Welche Hauptbereiche sollen in der Navigation erscheinen?
- [ ] Werden globale Suche, Filter, Favoriten oder zuletzt besuchte Projekte benötigt?

### Kunden und Projekte

- [ ] Welche Daten werden zu einem Kundenunternehmen gespeichert?
- [ ] Welche Felder benötigt ein Projekt?
- [ ] Welche Projektstatus und Statusübergänge gibt es?
- [ ] Wie werden Fortschritt, Priorität, Budget und Zeitplan dargestellt?
- [ ] Werden Aufgaben, Meilensteine, Deliverables oder Freigaben benötigt?
- [ ] Wer darf Projekte und Projektdaten erstellen oder verändern?
- [ ] Soll es Vorlagen für wiederkehrende Projekttypen geben?

### Kommunikation und Aktivitäten

- [ ] Werden projektbezogene Kommentare oder vollständige Chats benötigt?
- [ ] Müssen Benutzer erwähnt werden können?
- [ ] Welche Aktivitäten sollen in einem Verlauf protokolliert werden?
- [ ] Welche Ereignisse lösen E-Mail- oder In-App-Benachrichtigungen aus?
- [ ] Müssen Benachrichtigungseinstellungen pro Benutzer konfigurierbar sein?

### Dateien und Freigaben

- [ ] Welche Dateitypen und maximalen Größen sind erlaubt?
- [ ] Werden Ordner, Kategorien, Tags oder Versionen benötigt?
- [ ] Dürfen Kunden Dateien hochladen und löschen?
- [ ] Benötigen Dateien Freigabe- oder Abnahmeprozesse?
- [ ] Müssen Downloads und Änderungen revisionssicher protokolliert werden?

### Angebote, Verträge und Abrechnung

- [ ] Sollen Angebote, Verträge oder Rechnungen im Hub angezeigt werden?
- [ ] Werden Zahlungsstatus oder Online-Zahlungen benötigt?
- [ ] Gibt es dafür bereits ein führendes System oder eine Buchhaltungsintegration?
- [ ] Müssen Dokumente elektronisch bestätigt oder unterschrieben werden?

### Termine und Integrationen

- [ ] Benötigt das Portal Termine, Meetings oder Deadlines?
- [ ] Sollen Google Calendar, Outlook oder andere Kalender angebunden werden?
- [ ] Welche weiteren Systeme müssen integriert werden, beispielsweise E-Mail, Slack, Teams, Notion, Drive oder ein CRM?
- [ ] Existieren bereits Daten, die importiert oder regelmäßig synchronisiert werden müssen?

### Design und Inhalte

- [x] Hauptlogo, Icon, Farbverlauf und Inter sind festgelegt; siehe `CI_GUIDELINES.md`.
- [ ] Welche Referenzseiten oder visuellen Stile passen zum gewünschten Auftritt?
- [ ] Soll die Anwendung nur auf Deutsch oder mehrsprachig sein?
- [ ] Welche Tonalität soll die Benutzeroberfläche haben?
- [ ] Welche rechtlichen Seiten werden benötigt?

### Betrieb und Datenschutz

- [x] Aktuelle Test-/Main-Adresse: `https://oalab-client-hub.vercel.app/`; eine eigene finale Domain ist noch offen.
- [x] Bestehendes Vercel-Projekt `oalabs-projects/oalab-client-hub`, Produktion aus `main`; Details in README.
- [ ] Welche Anforderungen gelten für DSGVO, Aufbewahrung und Löschung?
- [ ] Werden Audit-Logs, Backups oder Datenexporte benötigt?
- [ ] Wer erhält Zugriff auf Produktion, Supabase und Deployment?
- [ ] Welche Umgebungen werden benötigt: lokal, Staging und Produktion?

## 7. Antwortvorlage für die nächste Abstimmung

Die offenen Punkte können frei oder anhand dieser Kurzvorlage beantwortet werden:

```text
Ziel des Client Hubs:

Benutzerrollen:
- OALAB Admin:
- OALAB Mitarbeiter:
- Kunde:
- Weitere Rollen:

Ein Kunde soll sehen und erledigen können:

Ein OALAB-Mitarbeiter soll verwalten können:

Unverzichtbare Bereiche der ersten Version:
- Dashboard:
- Kunden:
- Projekte:
- Aufgaben/Meilensteine:
- Dateien:
- Kommunikation:
- Rechnungen/Angebote:
- Termine:
- Sonstiges:

Typischer Projektablauf und Status:

Pflichtfelder eines Projekts:

Registrierung:
- öffentlich / nur per Einladung

Design:
- Logo:
- Farben:
- Stil oder Referenzen:

Sprache und Region:

Benötigte Integrationen:

Gewünschte Domain und Hosting:

Unbedingt in Version 1:

Supabase-Auswahl:
- bestehendes Projekt `tjbslvwvisxjjcxfhbgm`
- `service-oalab`
- neues Projekt
```

## 8. Pflege dieses Dokuments

- Beantwortete Fragen werden in konkrete Entscheidungen umformuliert und aus der offenen Liste entfernt.
- Neue fachliche Entscheidungen erhalten bei Bedarf ein Datum und einen Verantwortlichen.
- Änderungen am Datenmodell, an Rollen oder am Projektumfang müssen hier dokumentiert werden.
- Zugangsdaten, Secret Keys, personenbezogene Daten und andere Geheimnisse gehören niemals in dieses Dokument oder in das Repository.
