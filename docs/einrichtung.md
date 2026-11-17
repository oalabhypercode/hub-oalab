# Einrichtung und Technik je Bereich

Variablen stehen in Coolify bei der App `oalab-hub` (Laufzeit) und lokal in `.env.local`; nie einchecken. Übersicht aller Variablen: [README](../README.md#umgebungsvariablen). Produktregeln: [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).

## Anmeldung

- Login, Registrierung, „Passwort vergessen“, Abmelden: Server-Aktionen (`lib/hub-auth/actions.ts`), nie im Browser
- Registrierung: Hub legt wartendes Konto selbst an und schickt den Bestätigungslink per SMTP (`registration.confirmation`)
- Login, Registrierung, Passwort-Links je Adresse und Netz begrenzt (`hub_take_auth_rate`)
- Sperre im Hub (`hub_profiles.status` `disabled`/`rejected`) sperrt auch Service
- Workspace prüft Sitzung im Proxy und erneut auf dem Server; kein Zugang ohne Login
- Zweiter Faktor:
  - App: QR-Code + Schlüssel im Profil, bestätigt mit erstem Code
  - Mail-Code: nach dem Passwort über `hub@oalab.de`; Datenbank kennt nur Hash, gebunden an die Sitzung (`oalab_mail_codes`, `oalab_mail_code_sessions`); danach Tokens mit `aal2`, höchstens 30 Tage
  - Passwort-Link zählt bei Mail-Methode als Code (`lib/hub-auth/recovery.ts`)
  - Service schickt Team-Konten ohne `aal2` auf `/auth/mfa?next=<Service-Adresse>` (`serviceDestination`)
  - Migration `service-oalab/supabase/migrations/202610260001_mail_second_factor.sql`

## User Management

- Jede Aktion (`lib/hub-users/actions.ts`) prüft zuerst mit der Sitzung des Aufrufers `is_hub_admin()` (Rolle und Status aus der Datenbank, nicht aus dem Token); erst dann Server-Schlüssel (`lib/supabase/admin.ts`, nur serverseitig)
- Browser lesen Profile und Protokoll nur
- Protokoll `hub_admin_events` ohne Namen, Adressen, Links

## Dateiablage

- Hochladen nur Admins, bis 20 Dateien auf einmal
- ZIP baut der Browser (`lib/hub-files/zip.ts`, `fflate`, bis 500 MB)
- Ordner je Kunde, eine Ebene; Kunden dürfen per Spaltenrecht nur den Ordner ihrer Zuordnungen ändern

## E-Mails

SMTP über das netcup-Postfach `hub@oalab.de` (`lib/hub-mail/`, `nodemailer`). Absender `oalab Client Hub <hub@oalab.de>`, Antworten an `info@oalab.de`.

| E-Mail | an | ausgelöst durch |
| --- | --- | --- |
| Neue Registrierung mit allen Angaben, Button ins User Management; Antworten an die Person | Team (`HUB_TEAM_EMAIL`) | Person hat Adresse bestätigt und sieht zum ersten Mal `/auth/pending` |
| Eingangsbestätigung | Person | wie oben |
| Zugang freigeschaltet, mit Login-Link | Person | „Freigeben“ |
| Registrierung nicht freigegeben, mit Begründung | Person | „Ablehnen“ |
| Aktivierungs- oder Passwort-Link | Person | Häkchen beim Anlegen, „Link per E-Mail senden“, „Einladungen senden“ |
| Sicherheitscode | Person | Login mit Mail-Code |
| „Neu im Client Hub“: gebündelte Benachrichtigungen | Kunden-Logins, Admins (Chat) | siehe Benachrichtigungen |

- Team-Mail und Eingangsbestätigung je Login genau einmal: Reservierung in `hub_notifications` (eindeutiger Index); Fehlschlag → Wiederholung beim nächsten Aufruf der Warteseite
- `hub_notifications` speichert nur Art, Login, Ergebnis, Message-ID; Logs nennen nur die Art; Kopfzeile `X-Hub-Mail` für Postfach-Filter
- Ohne `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`: Testmodus, als „nicht verschickt“ vermerkt, Hinweis im User Management
- Mailbilder: `node scripts/mail-images.mjs` → `lib/hub-mail/images.ts`
- Einrichtung:
  1. Postfach `hub@oalab.de` bei netcup; SMTP-Server laut netcup-Mail-Einstellungen (`mxe989.netcup.net`, Port 465 SSL/TLS)
  2. `SMTP_*` als Secret in Coolify; `MAIL_FROM` = Postfach oder Alias davon
  3. DNS: SPF von oalab.de schließt netcup ein (`include:_spf.webhosting.systems`); DKIM und DMARC (`_dmarc`, Start `v=DMARC1; p=none;`) fehlen noch
- netcup verarbeitet Namen, Adressen, Registrierungsangaben im Auftrag; AV-Vertrag liegt vor; Datenschutzerklärung nennt netcup

## Impressum und Datenschutz

- Eigene öffentliche Seiten `/impressum`, `/datenschutz` (`app/impressum`, `app/datenschutz`, Texte `components/legal/`, Anbieter `lib/legal-details.ts`)
- Erreichbar in höchstens zwei Klicks (§ 5 DDG, Art. 13 DSGVO): Fußzeilen von Login, Registrierung, 404, Rechtsseiten; Zahnrad-Menü; „Mehr“ → „Rechtliches“; Profil; jede Hub-Mail
- Mails verlinken absolut über `NEXT_PUBLIC_SITE_URL` (sonst `https://hub.oalab.de`)
- Dienst neu oder geändert → Text im selben PR, `PRIVACY_POLICY_DATE` mitziehen; `tests/legal-pages.test.mjs` prüft Links, Anbieter, Cookies, veraltete Angaben (§ 5 TMG)
- Entwurf ohne Rechtsberatung; anwaltliche Prüfung offen

## Benachrichtigungen

Glocke + gebündelte Mail (`lib/hub-notify/`):

| Meldung | ausgelöst durch |
| --- | --- |
| „Du bist am Zug: …“ | freigegebene, offene Aufgabe mit Label „Kunde“ liegt beim Kunden |
| „Projekt aktualisiert: …“ | Status oder Zieltermin eines freigegebenen Projekts ändert sich |
| „Neue Datei: …“ | Admin ordnet dem Kunden eine Datei zu (nach „Sichtbar für“) |
| Termin angelegt, bestätigt, verschoben, abgesagt, Anfrage abgelehnt | Kalender |
| „Neue Nachricht von oalab“ | oalab antwortet im privaten Chat (an die Logins der Firma) |
| „Neue Nachricht von …“ (Admins) | Kunde schreibt im privaten Chat; Mail nach 5 Minuten, nur solange niemand aus dem Team gelesen hat |

- Dateien und Termine schreibt der Hub beim Speichern in `hub_inbox`; Studio-Änderungen alle fünf Minuten aus `studio_activity`, `hub_notice_marks` hält den letzten Stand (jede Änderung genau einmal)
- Takt: Datenbank-Cron ruft `/api/notifications/sweep` mit `HUB_NOTIFY_TOKEN`; ohne Token keine Studio-Meldungen
- Kunden-Mail ≈ 15 Minuten nach erster neuer Meldung, alle neuen (auch gelesene), höchstens zehn; einzelne Meldung = eigene Mail mit Button zur Stelle
- Abschalten im Profil („Benachrichtigungen“, Metadaten `hub_mail_notifications`); Glocke bleibt
- Links zur Stelle: Projekt, Kalendertag mit Termin (`?appointment=<id>`), Datei (`?file=<id>`)
- Kalender-Buttons bei neuen, bestätigten, verschobenen Terminen: Apple, Google, Outlook, .ics; signierte Links `/api/calendar/<Termin>/…` (HMAC mit `HUB_NOTIFY_TOKEN`, ohne Login); Route liest Termin neu → abgesagte nie mit alter Zeit (`lib/hub-calendar/links.ts`)
- Google ohne Login verliert den Termin (leitet auf Produktseite); über die Adresse nicht lösbar

### Telegram für Admins

Jede Kundennachricht im privaten Chat → Telegram-Gruppe: Firma und Name fett, Text (über 3.500 Zeichen gekürzt), Knopf „Im Hub öffnen“ (`lib/hub-telegram/`). Offizielle Bot API, kostenlos, ohne Server und Webhook. Gruppe löscht Nachrichten nach 24 Stunden.

1. @BotFather `/newbot`, Namen und Benutzernamen (endet auf „bot“) wählen → Token
2. Gruppe mit allen Admins, Bot hinzufügen, in der Gruppe `/start@<benutzername_des_bots>` senden
3. `https://api.telegram.org/bot<TOKEN>/getUpdates` öffnen → bei `"chat"` die Gruppennummer (beginnt mit `-100`)
4. In Coolify eintragen und neu deployen:

| Variable | Typ | Zweck |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Secret | Token des Bots von BotFather |
| `TELEGRAM_CHAT_ID` | Config | Nummer der Gruppe der Admins |

5. Profil → „Benachrichtigungen“ → „Testmeldung senden“

- Ohne beide Werte sendet der Hub nichts, auch keinen Fehler
- Bot-Chats nicht Ende-zu-Ende-verschlüsselt; Sperrbildschirm-Vorschau in Telegram abschaltbar
- Token bekannt geworden → `/revoke` bei BotFather

## Assistent (Claude)

- Claude Opus 5.5 über `@anthropic-ai/sdk`; Route `app/api/assistant/route.ts` nur für angemeldete, aktive Logins; Rolle aus der Sitzung
- Wissensbasis `lib/hub-assistant/knowledge.ts` bei jeder Funktionsänderung mitziehen (`tests/hub-assistant.test.mjs`)
- Ohne `ANTHROPIC_API_KEY`: „Der Assistent ist noch nicht eingerichtet“
- `/hub-hilfe` in Claude Code (angemeldetes `claude`):

```sh
claude "/hub-hilfe Wie nehme ich eine Terminanfrage an?"
claude -p "/hub-hilfe Wo finden Kunden ihre Dateien?"
```

## WhatsApp

Offizielle WhatsApp Cloud API von Meta (Graph API v26.0), ohne Zwischenanbieter; nicht eingerichtet.

- Verbinden: Profil → „WhatsApp verbinden“ → Code (15 Minuten) → „VERBINDEN 123456“ an die oalab-Nummer
- Webhook `app/api/whatsapp/route.ts`: prüft Signatur, bestätigt sofort, antwortet im Hintergrund
- 30 Fragen je Nummer und Tag; „TEAM“ nennt `WHATSAPP_SUPPORT_CONTACT` (Standard info@oalab.de); Verlauf nach 48 Stunden gelöscht
- Kosten: 1.000 Antworten je Nummer und Monat frei, danach Meta-Gebühr (Zahlungsmethode im Meta-Konto nötig, sonst keine Zustellung) + Claude
- Einrichtung:
  1. developers.facebook.com: App Typ „Business“, Produkt WhatsApp; eigene Nummer, nicht in der normalen WhatsApp-App registriert
  2. Business Manager: Systembenutzer mit `whatsapp_business_messaging`, dauerhafter Token
  3. WhatsApp → Konfiguration: Rückruf-URL `https://hub.oalab.de/api/whatsapp`, Verifizierungstoken = `WHATSAPP_VERIFY_TOKEN`; Feld **messages** abonnieren
  4. Variablen in Coolify, neu deployen:

| Variable | Typ | Zweck |
| --- | --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Secret | dauerhafter Token des Systembenutzers |
| `WHATSAPP_PHONE_NUMBER_ID` | Config | Telefonnummer-ID aus WhatsApp → API-Setup |
| `WHATSAPP_APP_SECRET` | Secret | App-Geheimcode, prüft die Signatur |
| `WHATSAPP_VERIFY_TOKEN` | Secret | selbst gewählt, gleich wie im Webhook-Formular |
| `WHATSAPP_BUSINESS_NUMBER` | Config | Nummer international ohne „+“, für den Link im Profil |
| `WHATSAPP_SUPPORT_CONTACT` | Config | optional, Kontakt für „TEAM“ |

- Meta erreicht `localhost` nicht → echte Nachrichten nur über öffentliche Adresse; `tests/hub-whatsapp.test.mjs` prüft ohne Meta
- Vor Livegang: Datenschutzabschnitt zu Meta (Nummer, Verlauf 48 Stunden)

## Nur Supabase-Rückweg

Gilt nur, wenn der Hub ohne `OALAB_PLATFORM=own` auf Supabase `hxljfihyejwpugnsffcc` läuft:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- Gemeinsames Cookie `sb-oalab-auth-token` (`lib/supabase/cookies.ts`), auf oalab.de mit `Domain=oalab.de`
- Supabase-Mailvorlagen `supabase/templates/` (Token-Hash über `/auth/confirm`), im Dashboard unter Authentication → Emails einfügen; Custom SMTP über `hub@oalab.de`; „Confirm email“ an; „Email OTP expiration“ 24 Stunden
- Redirect-URLs: `<origin>/auth/callback?next=/dashboard`, `<origin>/auth/callback?next=/auth/update-password`
- Access-Token-Hook `public.oalab_access_token_hook` für Mail-Code-`aal2`; fehlt er, bricht der Code-Login mit Meldung ab
- `HUB_NOTIFY_TOKEN` = `oalab_hub_notify_token` aus Supabase Vault
