# OALAB Projects – Client Hub

> Zentrale Projektübersicht, Entscheidungsgrundlage und Sammlung offener Fragen.
> Dieses Dokument soll bei jeder fachlichen oder technischen Entscheidung aktualisiert werden.

**Stand:** 13. Oktober 2026
**Projektphase:** Technisches Grundgerüst / Product Discovery

## 1. Zielbild

Der OALAB Client Hub soll als zentrale Schnittstelle zwischen OALAB und seinen Kunden dienen. Das konkrete Produktziel, die Zielgruppen und der Funktionsumfang müssen noch gemeinsam festgelegt werden.

## 2. Aktueller Stand

Das Repository basiert derzeit nahezu unverändert auf dem offiziellen Next.js-/Supabase-Starter-Kit. Eine projektspezifische Client-Hub-Funktionalität ist noch nicht implementiert.

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
- Geschützte Beispielroute unter `/protected`
- Automatische Weiterleitung nicht angemeldeter Benutzer zum Login
- Light- und Dark-Mode
- Grundlegende UI-Komponenten wie Buttons, Karten, Eingabefelder, Checkboxen und Dropdowns

### Noch nicht implementiert

- OALAB-Branding und deutschsprachige Inhalte
- Client-Hub-Dashboard und Navigation
- Kunden, Unternehmen, Projekte, Aufgaben und Meilensteine
- Rollen- und Berechtigungssystem
- Mandantentrennung zwischen Kunden
- Dateien, Freigaben und Supabase Storage
- Kommentare, Nachrichten und Benachrichtigungen
- Angebote, Verträge, Rechnungen oder Zahlungen
- Kalender, Termine und externe Integrationen
- Projektspezifisches Datenbankschema, Migrationen und generierte TypeScript-Datenbanktypen
- Automatisierte Tests und CI/CD
- Dokumentierter Hosting- und Deployment-Prozess

## 3. Aktuelle Routen

| Route | Status | Zweck |
| --- | --- | --- |
| `/` | Öffentlich | Unveränderte Starter-Startseite |
| `/auth/login` | Öffentlich | Anmeldung |
| `/auth/sign-up` | Öffentlich | Selbstregistrierung |
| `/auth/sign-up-success` | Öffentlich | Hinweis zur E-Mail-Bestätigung |
| `/auth/forgot-password` | Öffentlich | Passwort-Reset anfordern |
| `/auth/update-password` | Auth-Flow | Neues Passwort setzen |
| `/auth/confirm` | Auth-Callback | E-Mail-Token bestätigen |
| `/auth/error` | Öffentlich | Authentifizierungsfehler anzeigen |
| `/protected` | Geschützt | Generische Beispielseite mit Benutzer-Claims |

Die Root-Route und alle `/auth`-Routen sind öffentlich. Andere Routen werden durch den Supabase-Proxy geschützt und bei fehlender Session zum Login umgeleitet.

## 4. Supabase-Status

Die lokale Umgebung verweist derzeit auf das Supabase-Projekt mit dem Ref:

```text
tjbslvwvisxjjcxfhbgm
```

Konfiguriert sind ausschließlich eine öffentliche Supabase-URL und ein moderner Publishable Key. Es befindet sich kein `service_role`- oder Secret-Key im Repository.

Das konfigurierte Projekt ist über die aktuell verbundene Supabase-Integration nicht zugänglich. Dort sind momentan nur diese Projekte sichtbar:

- `service-oalab`
- `pflegedashboard`

Daher konnten folgende Bereiche noch nicht geprüft werden:

- Datenbanktabellen und Beziehungen
- Row Level Security (RLS) und Grants
- Auth-Einstellungen und Redirect-URLs
- Storage-Buckets und Storage Policies
- Edge Functions
- Bestehende Benutzer und Daten

Vor der Datenmodellierung muss entschieden werden, welches Supabase-Projekt verwendet wird. Für neue Tabellen müssen sowohl explizite Data-API-Grants als auch passende RLS-Policies vorgesehen werden. Supabase stellt die automatische Data-API-Freigabe bestehender Projekte zum 30. Oktober 2026 um: [Supabase Changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## 5. Technische Qualität und bekannte Aufgaben

- `npx tsc --noEmit` läuft aktuell ohne Fehler.
- Das Quellcode-Linting meldet nur den CommonJS-Import in `tailwind.config.ts`.
- `npm run lint` scannt irrtümlich auch den generierten `.next`-Ordner und erzeugt dadurch Tausende irrelevante Meldungen.
- `next` ist aktuell auf Version 16.4.0 installiert, `eslint-config-next` jedoch auf 15.3.1.
- Zentrale Abhängigkeiten werden teilweise mit `latest` statt mit einer festen Version deklariert.
- Es existieren noch keine Tests.

### Technischer Aufräumbedarf

- [ ] ESLint-Konfiguration um generierte Verzeichnisse ergänzen
- [ ] `eslint-config-next` an die installierte Next.js-Version angleichen
- [ ] Abhängigkeiten reproduzierbar pinnen
- [ ] Starter-Inhalte und Starter-Deploy-Link entfernen
- [ ] Projektspezifische Metadaten und Sprache konfigurieren
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

- [ ] Gibt es ein OALAB-Logo, Brand Guide, Farben und Schriften?
- [ ] Welche Referenzseiten oder visuellen Stile passen zum gewünschten Auftritt?
- [ ] Soll die Anwendung nur auf Deutsch oder mehrsprachig sein?
- [ ] Welche Tonalität soll die Benutzeroberfläche haben?
- [ ] Welche rechtlichen Seiten werden benötigt?

### Betrieb und Datenschutz

- [ ] Welche Domain soll verwendet werden?
- [ ] Wo soll die Anwendung gehostet werden?
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
