# OALAB Projects – Client Hub

Ein gemeinsamer Workspace für oalab und seine Kunden. Die Plattform heißt **oalab Client Hub** und verwendet die gelieferten oalab-Logos, den Bordeaux-Rot-Orange-Verlauf und die einheitliche Schrift **Inter**.

Projektstand, Entscheidungen und offene Produktfragen werden in [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) gepflegt.

Logo-Einsatz, Markenfarben und Typografie sind in [CI_GUIDELINES.md](./CI_GUIDELINES.md) festgelegt. Die zentralen Markentokens stehen in `app/brand.css`.

Die [Startseite](http://localhost:3000) zeigt direkt den Login; eine separate Landingpage gibt es nicht. Im lokalen Entwicklungsmodus stehen vier anklickbare Demo-Konten für die Anmeldung ohne manuelle Zugangsdaten bereit. Einrichtung und Status stehen in [DEMO_ACCOUNTS.md](./DEMO_ACCOUNTS.md).

## Aktueller Umfang

Schritt 1 umfasst das responsive Frontend mit Navigation und Dashboard sowie die neu gestalteten Login-, Registrierungs- und Passwortseiten. Die Gestaltung orientiert sich an [Prolab](https://www.framer.com/marketplace/templates/prolab/).

- **Designvorschau:** [/preview](http://localhost:3000/preview) – ausdrücklich gekennzeichnete fiktive Projekte, Dateien und Nachrichten.
- **Anmelden:** [/auth/login](http://localhost:3000/auth/login) – bestehende Supabase-Authentifizierung im neuen Design.
- **Echter Workspace:** [/dashboard](http://localhost:3000/dashboard) – nur nach Anmeldung. Vier eingerichtete Testkonten erhalten rollenabhängige Dummy-Inhalte; normale Konten sehen ohne Datenanbindung leere Zustände.

Die Navigation führt zu Übersicht, Projekten, Dateien, Nachrichten und Einstellungen. In der Vorschau und den Demo-Workspaces lassen sich Projekte filtern, Details öffnen und Seiten beziehungsweise Beispielprojekte durchsuchen. Der Demo-Admin sieht alle drei Kunden; Customer nur ihren eigenen Workspace. Persistente Rollenverwaltung, Uploads, Downloads, Live-Nachrichten und echte Projektverwaltung folgen in weiteren Schritten.

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

Anschließend [localhost:3000](http://localhost:3000) öffnen. Die Startseite zeigt denselben Login wie `/auth/login`. Sind die vier Testkonten eingerichtet und ihre lokalen Zugangsdaten vorhanden, öffnet ein Klick auf ein Demo-Konto den zugehörigen Workspace. Die Demo-Auswahl ist ausschließlich auf lokalen Entwicklungsservern aktiv; `ENABLE_DEMO_LOGIN=false` deaktiviert sie zusätzlich. Im Produktionsbuild sind Auswahl und Demo-Endpunkt immer gesperrt. Die Designvorschau ist auch ohne Supabase-Konfiguration erreichbar.

## Prüfungen

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Die Tests prüfen sichere Auth-Weiterleitungen, die vier Seed-Konten und die Auswertung administrativ gesetzter Demo-Rollen. Die Anmeldung mit allen vier echten Testkonten ist geprüft. Mit den lokalen Zugangsdaten prüft `npm run demo:verify` die Authentifizierung erneut; `npm run demo:smoke` prüft bei laufendem Entwicklungsserver die tatsächlichen Dashboard-Datensichten und den Zugriffsschutz. Einrichtung und Ergebnisse stehen in [DEMO_ACCOUNTS.md](./DEMO_ACCOUNTS.md). Bestätigungs- und Passwort-E-Mails sind noch separat zu prüfen.

## Supabase-Authentifizierung

Das Dashboard prüft die Session im Proxy und erneut auf dem Server. Die öffentliche Vorschau verwendet keine echten Kundendaten.

Für PKCE-E-Mail-Flows müssen in Supabase die passenden Redirect-URLs erlaubt sein:

- `<origin>/auth/callback?next=/dashboard`
- `<origin>/auth/callback?next=/auth/update-password`

Bei Token-Hash-E-Mail-Templates wird `/auth/confirm` genutzt. Recovery-Links führen standardmäßig zum Formular für ein neues Passwort. Den aktuellen Projektzugang und offene Auth-Entscheidungen beschreibt [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).

## Technische Basis

Next.js 16.4, React 19, TypeScript, Tailwind CSS und Supabase SSR. Die zentralen CI-Tokens stehen in `app/brand.css`, die Oberflächenstile in `app/hub.css` und fiktive Vorschauinhalte in `lib/hub-data.ts`.

Keine Secret Keys, Passwörter oder personenbezogenen Kundendaten ins Repository einchecken.
