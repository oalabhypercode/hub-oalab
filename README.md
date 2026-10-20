# OALAB Projects – Client Hub

Ein gemeinsamer Workspace für oalab und seine Kunden. Die Plattform heißt **oalab Client Hub** und verwendet die gelieferten oalab-Logos, den Bordeaux-Rot-Orange-Verlauf und die einheitliche Schrift **Inter**.

Projektstand, Entscheidungen und offene Produktfragen werden in [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) gepflegt.

Logo-Einsatz, Markenfarben und Typografie sind in [CI_GUIDELINES.md](./CI_GUIDELINES.md) festgelegt. Die zentralen Markentokens stehen in `app/brand.css`.

Die [Online-Version](https://oalab-client-hub.vercel.app/) zeigt direkt den Login; eine separate Landingpage gibt es nicht. Die vier Demo-Ansichten sind auf ausdrücklichen Wunsch öffentlich per Klick zugänglich: OALAB Admin, Nordlicht Studio, Form & Feld und Studio Horizont. Sie verwenden nur Fixtures und keine echten Supabase-Sitzungen. Lokal bestehen zusätzlich vier echte Supabase-Testkonten. Einrichtung und Status stehen in [DEMO_ACCOUNTS.md](./DEMO_ACCOUNTS.md).

## Aktueller Umfang

Schritt 1 umfasst das responsive Frontend mit Navigation und Dashboard sowie die neu gestalteten Login-, Registrierungs- und Passwortseiten. Die Gestaltung orientiert sich an [Prolab](https://www.framer.com/marketplace/templates/prolab/).

- **Designvorschau:** [/preview](http://localhost:3000/preview) – ausdrücklich gekennzeichnete fiktive Projekte, Dateien und Nachrichten.
- **Anmelden:** [/auth/login](http://localhost:3000/auth/login) – bestehende Supabase-Authentifizierung im neuen Design.
- **Workspace:** [/dashboard](http://localhost:3000/dashboard) – nach regulärer Anmeldung oder mit einer separat signierten öffentlichen Demo-Identität. Demo-Identitäten erhalten ausschließlich rollenabhängige Fixtures; normale Konten sehen ohne Datenanbindung leere Zustände.

Der Hub ist im Liquid-Glass-Stil gestaltet (Struktur nach Apple Health): Übersicht mit Insights, Favoriten, Highlights und Listen, Detailseiten je Kennzahl mit Zeitraum-Umschalter, Entdecken sowie die Kategorien Projekte, Dateien und Nachrichten. Hintergrund und Glas lassen sich unter Profil › Darstellung einstellen. Ab 1024 px navigiert eine Glas-Sidebar; auf Tablet und Smartphone stehen dieselben Einträge in einer schwebenden Tab-Bar am unteren Rand, daneben ein Such-Button für „Entdecken“. In der Vorschau und den Demo-Workspaces lassen sich Projekte filtern, Details öffnen und Seiten beziehungsweise Beispielprojekte durchsuchen. Der Demo-Admin sieht alle drei Kunden; Customer nur ihren eigenen Workspace. Persistente Rollenverwaltung, Uploads, Downloads, Live-Nachrichten und echte Projektverwaltung folgen in weiteren Schritten.

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

Bestehendes Projekt: `oalabs-projects/oalab-client-hub`, Produktions-URL: [oalab-client-hub.vercel.app](https://oalab-client-hub.vercel.app/), Git-Branch: `main`.

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

Die 30 Unit-Tests prüfen Auth-Weiterleitungen, Seed-Konten, Demo-Rollen, Branding, die öffentliche Demo-Policy einschließlich Manipulation und Ablauf der signierten Sitzungen, Textkontrast und Darstellungslogik des Hubs sowie Upload-Regeln, RLS-Migration und Musterdateien der Dateiablage. `demo:public:smoke` benötigt keine Zugangsdaten und prüft alle vier öffentlichen Fixture-Ansichten, Kundentrennung, Abmeldung und die Grenze zu echten Auth-Routen. Mit den lokalen Zugangsdaten prüft `npm run demo:verify` die echte Supabase-Authentifizierung erneut; `npm run demo:smoke` prüft bei laufendem Entwicklungsserver die echten Test-Logins und Dashboard-Datensichten. Einrichtung und Ergebnisse stehen in [DEMO_ACCOUNTS.md](./DEMO_ACCOUNTS.md). Bestätigungs- und Passwort-E-Mails sind noch separat zu prüfen.

## Supabase-Authentifizierung

Der reguläre Workspace prüft die Supabase-Session im Proxy und erneut auf dem Server. Öffentliche Demo-Identitäten sind separat signiert, ausdrücklich markiert und auf Fixture-Seiten begrenzt; sie dürfen niemals echte Datenoperationen autorisieren. Ein erfolgreicher regulärer Passwort-Login beendet eine zuvor ausgewählte öffentliche Demo-Identität. Vorschau und öffentliche Demo enthalten keine echten Kundendaten.

Für PKCE-E-Mail-Flows müssen in Supabase die passenden Redirect-URLs erlaubt sein:

- `<origin>/auth/callback?next=/dashboard`
- `<origin>/auth/callback?next=/auth/update-password`

Bei Token-Hash-E-Mail-Templates wird `/auth/confirm` genutzt. Recovery-Links führen standardmäßig zum Formular für ein neues Passwort. Den aktuellen Projektzugang und offene Auth-Entscheidungen beschreibt [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).

## Technische Basis

Next.js 16.4, React 19, TypeScript, Tailwind CSS und Supabase SSR. Die zentralen CI-Tokens stehen in `app/brand.css`, die Hub-Oberfläche in `app/glass.css`, Login- und Basisstile in `app/hub.css`. Hintergrund-Presets und Glas-Grenzwerte liegen in `lib/appearance.ts`, Kategorien in `lib/categories.ts`, Kennzahlen, Insights und Highlights in `lib/hub-metrics.ts` und fiktive Inhalte in `lib/hub-data.ts`.

Keine Secret Keys, Passwörter oder personenbezogenen Kundendaten ins Repository einchecken.
