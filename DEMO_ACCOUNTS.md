# Demo-Konten und Testdaten

Stand: 15. Oktober 2026.

## Status

Die vier unten aufgeführten Konten sind **angelegt und geprüft**. Die Bereitstellung erfolgte am 15. Oktober 2026 über die Supabase Admin API mit dem lokal hinterlegten Secret Key. Anmeldung, Rollen, getrennte Kundensichten und der Schutz vor unangemeldetem Zugriff wurden erfolgreich getestet.

Diese Datei enthält keine Passwörter. Die individuellen Zugangsdaten stehen ausschließlich in der lokal erzeugten, nicht versionierten Datei `.demo-accounts.local.json`.

## Eingerichtete Konten

| E-Mail | Anzeigename | Rolle | Workspace |
| --- | --- | --- | --- |
| `admin@demo.oalab.test` | Alex Weber | OALAB Admin | Alle drei Demo-Kunden |
| `nordlicht@demo.oalab.test` | Jana Sommer | OALAB Customer | Nordlicht Studio |
| `formfeld@demo.oalab.test` | Ben Fischer | OALAB Customer | Form & Feld |
| `horizont@demo.oalab.test` | Mira Hansen | OALAB Customer | Studio Horizont |

Die Adressen gehören zur reservierten Test-Domain `.test`. Der administrative Seed bestätigt sie direkt; es werden keine Einladungs- oder Bestätigungs-E-Mails versendet.

## Demo per Klick starten

### Öffentlich auf Vercel

Unter [oalab-client-hub.vercel.app](https://oalab-client-hub.vercel.app/) sind die vier Testansichten auf ausdrücklichen Wunsch **für alle Besucher ohne Demo-Code** freigegeben. Ein Klick auf OALAB Admin, Nordlicht Studio, Form & Feld oder Studio Horizont öffnet den passenden Fixture-Workspace. Zum Wechseln abmelden und ein anderes Testkonto auswählen. Regulärer Login bleibt separat möglich.

Diese öffentlichen Testidentitäten verwenden dieselben fiktiven Anzeigenamen und Inhalte, sind aber **keine Anmeldung bei den echten Supabase-Testkonten**. Es werden keine Passwörter und keine Supabase-Auth-Tokens ausgegeben. Der Server setzt ausschließlich ein signiertes `__Host-oalab-demo`-Cookie mit `HttpOnly`, `Secure`, `SameSite=Lax`, Pfad `/` und zwölf Stunden Laufzeit. Die Identität ist als `public-demo:<konto-id>` markiert. Nur die vier festen IDs sind erlaubt; unbekannte IDs, manipulierte oder abgelaufene Signaturen werden abgewiesen.

Aktivierung erfordert `ENABLE_PUBLIC_DEMO_LOGIN=true`, den exakten HTTPS-Origin in `PUBLIC_DEMO_ORIGIN` und einen privaten `OALAB_DEMO_SESSION_SECRET` mit mindestens 32 Zeichen. Die Werte sind nur in der Vercel-Produktionsumgebung hinterlegt; der Schlüssel ist vom Typ Secret. Host, weitergeleiteter Host und Formular-Origin werden geprüft. Es gibt keine automatische Freigabe weiterer Vercel-Preview-Domains. Ohne diese Konfiguration ist die öffentliche Auswahl deaktiviert.

Das Cookie autorisiert ausschließlich Fixture-Seiten unter `/dashboard`, keine Supabase-Aufrufe oder anderen geschützten Routen. Echte Backend-Aktionen müssen weiterhin unabhängig gültige Supabase-Claims und RLS prüfen. Vor Einführung persistenter Geschäftsdaten ist diese Grenze erneut zu prüfen. Keine persönlichen Daten in der öffentlichen Demo eingeben. Aufgaben-Häkchen bleiben lokale UI-Zustände, Datei- und Nachrichteninhalte sind Beispiele.

`npm run demo:public:smoke -- --local` prüft den öffentlichen Modus im Produktionsbuild. `npm run demo:public:smoke` prüft die feste Vercel-Adresse. Beide benötigen keine echten Zugangsdaten. Beide Prüfungen bestehen am 15. Oktober 2026 für alle vier Identitäten einschließlich Kundentrennung, fremder Projekt-IDs, Abmeldung und Ablehnung durch echte Auth-Routen.

Zusätzlich auf der Live-Adresse im Browser geprüft: alle vier Schaltflächen, Admin mit neun Projekten, jeder Kunde mit drei Projekten, Abmeldung und anschließender Kontowechsel. Bei 390 Pixeln Breite sind alle vier Schaltflächen vorhanden; kein horizontaler Überlauf. Der Upload-Trockenlauf schließt `.env.local` und `.demo-accounts.local.json` aus. Ein Scan der versionierten Quellen und Browser-Assets findet keine lokalen Testpasswörter oder administrativen Supabase-Schlüssel.

### Lokal mit echten Supabase-Testkonten

`/` und `/auth/login` zeigen direkt die Anmeldung. Auf einem lokalen Entwicklungsserver mit `npm run dev` stehen vier Schaltflächen bereit: OALAB Admin, Nordlicht Studio, Form & Feld und Studio Horizont. Ein Klick meldet das jeweilige echte Testkonto an und öffnet `/dashboard`. Zum Wechseln abmelden und das nächste Konto auswählen. Das reguläre E-Mail-/Passwortformular bleibt verfügbar.

Voraussetzung ist die vom Seed erzeugte `.demo-accounts.local.json` für das konfigurierte Projekt. Die Datei bleibt serverseitig; das Formular überträgt ausschließlich die feste Konto-ID, niemals das Passwort. Die Anmeldung verwendet die normale Supabase-Passwortprüfung und kontrolliert zusätzlich Benutzer-ID, E-Mail sowie die vertrauenswürdige Demo-Rolle und den zugehörigen Workspace.

Die echte Konto-Abkürzung ist ausschließlich bei `NODE_ENV=development` und einem Loopback-Host (`localhost`, `127.0.0.1` oder `::1`) verfügbar. Extern weitergeleitete Hosts sowie fremde oder fehlende Formular-Origins werden abgewiesen. `ENABLE_DEMO_LOGIN=false` deaktiviert die Funktion lokal. Im Produktionsbuild kann dieser lokale Passwort-Zweig nie aktiviert werden; nur der oben beschriebene, separate öffentliche Fixture-Modus ist optional möglich. Die lokale Zugangsdaten-Datei ist zusätzlich vom Next.js-Deployment-Tracing und Vercel-Upload ausgeschlossen.

Alle vier Schaltflächen, die anschließenden Datensichten und der Kontowechsel sind im Browser geprüft. Diese Abkürzung ist keine Anmeldung für echte Kunden und darf nicht als öffentliche Demo-Freigabe eingesetzt werden.

Zusätzlich geprüft: Ohne öffentliche Demo-Konfiguration zeigt ein Produktionsbuild keine Auswahl; der Demo-POST liefert 404. Im explizit aktivierten öffentlichen Modus werden stattdessen die getrennten Fixture-Identitäten ausgegeben. Fremde und fehlende Origins werden mit 403 abgewiesen; unbekannte Konto-IDs erzeugen keine Demo-Session. Keine Testpasswörter befinden sich im ausgelieferten HTML oder in den Browser-Assets; die lokale Zugangsdaten-Datei ist in keinem Server-Deployment-Trace enthalten.

## Rollen und Daten

- Bei echten Supabase-Testkonten werden die Rollen ausschließlich in serververwalteten `app_metadata` gesetzt: `app_role`, `demo_account` und `demo_workspace`. Die öffentliche Demo verwendet stattdessen feste, signierte Fixture-Identitäten aus der versionierten Kontenliste und gewährt keine echten Kontoberechtigungen.
- Der Admin verwendet den expliziten Scope `demo_workspace: "all"`, Customer jeweils ihren Workspace-Schlüssel. Supabase entfernt mit `null` belegte Metadaten; ein fehlender Scope gewährt daher keine Demo-Rechte.
- Der Server wertet diese Daten erst nach erfolgreicher Prüfung der Supabase-Claims aus. Ein frei editierbares Anzeigenamen-Feld gewährt keine Berechtigungen.
- Der Demo-Admin erhält die Beispieldaten aller drei Demo-Kunden und einen Kundenfilter im Projektindex.
- Jeder Demo-Customer erhält nur die Daten des ihm zugeordneten Workspaces.
- Je Kunde sind drei Projekte, zwei Beispieldateien, zwei nächste Schritte und eine Beispielunterhaltung vorbereitet.
- Die Dummy-Inhalte werden versioniert in `lib/demo-data.ts` und `config/demo-accounts.json` gepflegt. Sie enthalten keine echten Kundendaten.
- Diese Stufe dient Frontend- und Rollenansicht-Tests; echte Auth-Tests sind nur mit den tatsächlichen Supabase-Konten möglich. Aufgaben-Häkchen sind lokale UI-Zustände; Beispieldateien werden nicht heruntergeladen und Beispielnachrichten nicht gesendet. Persistente Projekte, Uploads und Live-Kommunikation benötigen anschließend das Datenbankmodell.

## Einrichtung

Zielprojekt: `tjbslvwvisxjjcxfhbgm`.

Für den Seed wird lokal in `.env.local` ein serverseitiger Supabase Secret Key benötigt:

```env
SUPABASE_SECRET_KEY=<serverseitiger Secret Key des Zielprojekts>
```

Alternativ unterstützt das Skript einen Legacy-Key unter `SUPABASE_SERVICE_ROLE_KEY`. Der Key darf niemals mit `NEXT_PUBLIC_` beginnen oder ins Repository gelangen. Der bereits vorhandene Publishable Key genügt für normale Logins, aber nicht zum administrativen Anlegen der Testkonten.

Die Konten werden über die [offizielle Supabase Admin API](https://supabase.com/docs/reference/javascript/auth-admin-createuser) angelegt. Die normale Supabase-Verbindung bleibt für die spätere Schema- und Datenbankarbeit relevant.

```sh
# Nur den Plan prüfen; keinerlei Konten oder Daten verändern
npm run demo:plan

# Konten anlegen beziehungsweise vorhandene eigene Demo-Konten pflegen
npm run demo:seed

# Anmeldung, Rollen, Workspace-Zuordnung und Abmeldung aller vier Konten prüfen
npm run demo:verify

# Bei laufendem lokalem Entwicklungsserver: tatsächliche Dashboard-Datensichten prüfen
npm run demo:smoke
```

Der Seed erzeugt individuelle zufällige Passwörter und speichert sie ausschließlich in `.demo-accounts.local.json`. Diese Datei ist in `.gitignore` ausgeschlossen und wird weder durch das Frontend ausgeliefert noch in Konsolenausgaben angezeigt. Auf Wiederholung bleiben bestehende Testpasswörter erhalten. Fremde bestehende Konten mit denselben Adressen werden nicht überschrieben.

## Prüfstand vom 15. Oktober 2026

- [x] Alle vier Konten existieren und `npm run demo:verify` besteht.
- [x] Der Admin sieht neun Projekte aller drei Demo-Kunden; der Kundenfilter zeigt jeweils drei.
- [x] Jeder Customer sieht drei Projekte und zwei Beispieldateien seines eigenen Kunden.
- [x] Eine andere Kunden-/Projekt-ID in der URL gibt keine zusätzlichen Daten frei.
- [x] Fehlende, ungültige oder mehrdeutige Demo-Metadaten gewähren keine Dummy-Kundendaten (Unit-Tests; kein zusätzliches reguläres Testkonto angelegt).
- [x] Die Login-/Logout-Prüfung besteht für alle vier Konten. Admin-Abmeldung, anschließender Kundenlogin und ein weiterer Kundenwechsel sind zusätzlich im Browser geprüft; der Abmeldeknopf bleibt bedienbar.
- [x] Ein erneuter Seed hat bestehende Testpasswörter erhalten; die anschließende Anmeldung besteht weiterhin.

`npm run demo:smoke` meldet jedes Konto separat an, prüft die serverseitig ausgelieferten Projekt- und Dateiseiten einschließlich fremder Projekt-IDs und meldet es wieder ab. Ohne Session wird der Workspace zum Login umgeleitet. Der Test erwartet standardmäßig `http://127.0.0.1:3000`; optional kann `DEMO_BASE_URL` auf einen anderen lokalen Origin gesetzt werden.

E-Mail-Zustellung und Passwort-Recovery sind damit nicht geprüft: Die `.test`-Adressen sind absichtlich keine zustellbaren Postfächer.

An- und Abmeldung wechseln bewusst mit einem neuen Dokument über die Auth-Grenze. Dadurch bleiben beim Kontowechsel keine alten Client-Router-Caches oder Ladezustände erhalten; der Workspace-Shell ist zusätzlich nach Benutzer-ID getrennt.
