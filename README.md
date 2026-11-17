# oalab Client Hub

Gemeinsamer Workspace von oalab und Kunden: Login, Kunden, Konten, Pakete, Vertrag & Domain, Dateien, Kalender, Projekte, Nachrichten, Assistent. Live: [hub.oalab.de](https://hub.oalab.de/) (Startseite = Login).

- Produktstand und offene Punkte: [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)
- Marke, Farben, Schrift, Glas: [CI_GUIDELINES.md](./CI_GUIDELINES.md)
- Einrichtung von Mail, Benachrichtigungen, Telegram, Assistent, WhatsApp, Anmeldung: [docs/einrichtung.md](./docs/einrichtung.md)
- Arbeitsregeln für KI (Git, Patch Notes): [AGENTS.md](./AGENTS.md)

## Lokal starten

- Node.js 24, npm; `npm ci`
- `.env.local` aus `.env.example` (nie einchecken)
- `npm run dev` → [localhost:3000](http://localhost:3000); Designvorschau [/preview](http://localhost:3000/preview) nur im Dev-Server (live 404)
- `HUB_LOCAL_ADMIN_EMAIL=<Admin-Adresse>`: ohne Anmeldung als dieser Admin; nur Dev-Server, nur 127.0.0.1/localhost; eigenes `-H` schaltet ab (`lib/local-admin.ts`, `scripts/dev.mjs`)
- `HUB_LOCAL_TUNNEL_SCRIPT`: `npm run dev` öffnet und hält den Tunnel zum OALab-Server (nur Omeds Mac, `service-oalab/scripts/hub-lokal.sh`); ohne Tunnel `ECONNREFUSED 127.0.0.1:15433`
- Ohne `SMTP_*` gehen lokal keine Mails raus (Testmodus)
- Hub und Service lokal mit gemeinsamem Login: `OALAB_AUTH_COOKIE_DOMAIN=oalab.localhost`, `hub.oalab.localhost` und `service.oalab.localhost` öffnen

## Betrieb

- Coolify-App `oalab-hub` auf Server 2, gebaut aus `main`; jeder Push auf `main` ist in 2–4 Minuten live
- Eigene Plattform (`OALAB_PLATFORM=own`, `lib/platform/`): PostgreSQL über internes PostgREST, Login über Better Auth (geteilt mit Service), Dateien in Garage
- Variablen in Coolify bei der App (Laufzeit, nicht Build)
- Datenbank-Schema und Migrationen: `service-oalab/supabase/migrations/`; `npm run db:push` hier wendet nichts an
- Betrieb des Servers: `service-oalab/docs/operations/eigener-server.md`
- Vercel-Projekt `oalabs-projects/oalab-client-hub` und Supabase `hxljfihyejwpugnsffcc` nur Rückweg: baut nicht, eingefroren, nicht löschen

## Umgebungsvariablen

Alle nur serverseitig, nie mit `NEXT_PUBLIC_`, außer wo genannt. Beispiele: `.env.example`.

| Variable | Typ | Zweck |
| --- | --- | --- |
| `OALAB_PLATFORM` | Config | `own` = eigene Plattform |
| `DATABASE_URL`, `OALAB_DATABASE_*` | Secret | PostgreSQL |
| `OALAB_REST_URL`, `OALAB_REST_JWT_SECRET` | Secret | internes PostgREST |
| `BETTER_AUTH_SECRET` | Secret | Sitzungen (wie Service) |
| `OALAB_OBJECT_STORAGE_*` | Secret | Garage |
| `NEXT_PUBLIC_SITE_URL` | Config | Adresse für Links in Mails |
| `OALAB_AUTH_COOKIE_DOMAIN`, `OALAB_SERVICE_URL` | Config | nur lokaler Test mit Service |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Secret | Mailversand über `hub@oalab.de` |
| `MAIL_FROM`, `MAIL_REPLY_TO`, `HUB_TEAM_EMAIL` | Config | Absender, Antworten, Team-Empfänger |
| `HUB_NOTIFY_TOKEN` | Secret | Benachrichtigungstakt, signierte Kalender-Links |
| `HUB_VAULT_KEY` | Secret | Verschlüsselung der Kunden-Zugänge (32 Byte, Base64); überall derselbe |
| `HUB_MCP_ENABLED` | Config | Claude-Connector an/aus |
| `ANTHROPIC_API_KEY` | Secret | Assistent |
| `TELEGRAM_BOT_TOKEN` | Secret | Token des Bots von BotFather |
| `TELEGRAM_CHAT_ID` | Config | Nummer der Gruppe der Admins |
| `WHATSAPP_*` | Secret/Config | WhatsApp-Anbindung, siehe Einrichtung |
| `HUB_LOCAL_ADMIN_EMAIL`, `HUB_LOCAL_TUNNEL_SCRIPT` | lokal | nur `.env.local` |
| `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SECRET_KEY` | Config/Secret | nur Supabase-Rückweg |

## Prüfungen

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
```

- `npm test`: Node-Tests in `tests/` (Liste in `package.json`)
- Windows mit `core.autocrlf=true`: Musterdatei-Test der Beispiel-PDFs schlägt fehl (bekannt, kein Befund)

## Wo was liegt

- Stile: `app/brand.css` (Marke), `app/glass.css` (Hub, Tokens hell/dunkel), `app/hub.css` (Auth, Basis), `app/motion.css` (Einblenden, „Bewegung reduzieren“)
- Darstellung, Presets, Grenzwerte: `lib/appearance.ts`; Kategorien: `lib/categories.ts`; Kennzahlen: `lib/hub-metrics.ts`; Beispieldaten: `lib/hub-data.ts`
- Bildschirme: `components/hub/screens/`; Navigation: `components/hub/navigation.ts`
- Bereiche: `lib/hub-*/` (je Bereich Regeln, Server, Aktionen; `write.ts` = gemeinsamer Schreibweg für Hub und Claude-Connector)
- Mails: `lib/hub-mail/`; Rechtstexte: `components/legal/`, `lib/legal-details.ts`
- Patch Notes: `lib/patch-notes.ts`; Assistent-Wissen: `lib/hub-assistant/knowledge.ts`
- Claude-Code-Befehl `/hub-hilfe`: `.claude/commands/hub-hilfe.md`
- Keine Secret Keys, Passwörter oder Kundendaten ins Repository (Repo ist öffentlich)
