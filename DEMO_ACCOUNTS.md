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

`/` und `/auth/login` zeigen direkt die Anmeldung. Auf einem lokalen Entwicklungsserver mit `npm run dev` stehen vier Schaltflächen bereit: OALAB Admin, Nordlicht Studio, Form & Feld und Studio Horizont. Ein Klick meldet das jeweilige echte Testkonto an und öffnet `/dashboard`. Zum Wechseln abmelden und das nächste Konto auswählen. Das reguläre E-Mail-/Passwortformular bleibt verfügbar.

Voraussetzung ist die vom Seed erzeugte `.demo-accounts.local.json` für das konfigurierte Projekt. Die Datei bleibt serverseitig; das Formular überträgt ausschließlich die feste Konto-ID, niemals das Passwort. Die Anmeldung verwendet die normale Supabase-Passwortprüfung und kontrolliert zusätzlich Benutzer-ID, E-Mail sowie die vertrauenswürdige Demo-Rolle und den zugehörigen Workspace.

Die Abkürzung ist ausschließlich bei `NODE_ENV=development` und einem Loopback-Host (`localhost`, `127.0.0.1` oder `::1`) verfügbar. Extern weitergeleitete Hosts sowie fremde oder fehlende Formular-Origins werden abgewiesen. `ENABLE_DEMO_LOGIN=false` deaktiviert die Funktion lokal. Im Produktionsbuild ist der POST-Endpunkt `/auth/demo` immer mit 404 gesperrt, auch mit `ENABLE_DEMO_LOGIN=true`. Die lokale Zugangsdaten-Datei ist zusätzlich vom Next.js-Deployment-Tracing ausgeschlossen.

Alle vier Schaltflächen, die anschließenden Datensichten und der Kontowechsel sind im Browser geprüft. Diese Abkürzung ist keine Anmeldung für echte Kunden und darf nicht als öffentliche Demo-Freigabe eingesetzt werden.

Zusätzlich geprüft: Der lokal gestartete Produktionsbuild zeigt weder auf `/` noch auf `/auth/login` die Demo-Auswahl, und der Demo-POST liefert 404. Fremde und fehlende Origins werden lokal mit 403 abgewiesen; unbekannte Konto-IDs erzeugen keine Demo-Session. Keine Testpasswörter befinden sich im ausgelieferten HTML oder in den Browser-Assets; die lokale Zugangsdaten-Datei ist in keinem Server-Deployment-Trace enthalten.

## Rollen und Daten

- Die Rollen werden ausschließlich in serververwalteten `app_metadata` gesetzt: `app_role`, `demo_account` und `demo_workspace`.
- Der Admin verwendet den expliziten Scope `demo_workspace: "all"`, Customer jeweils ihren Workspace-Schlüssel. Supabase entfernt mit `null` belegte Metadaten; ein fehlender Scope gewährt daher keine Demo-Rechte.
- Der Server wertet diese Daten erst nach erfolgreicher Prüfung der Supabase-Claims aus. Ein frei editierbares Anzeigenamen-Feld gewährt keine Berechtigungen.
- Der Demo-Admin erhält die Beispieldaten aller drei Demo-Kunden und einen Kundenfilter im Projektindex.
- Jeder Demo-Customer erhält nur die Daten des ihm zugeordneten Workspaces.
- Je Kunde sind drei Projekte, zwei Beispieldateien, zwei nächste Schritte und eine Beispielunterhaltung vorbereitet.
- Die Dummy-Inhalte werden versioniert in `lib/demo-data.ts` und `config/demo-accounts.json` gepflegt. Sie enthalten keine echten Kundendaten.
- Diese Stufe dient Frontend- und Rollen-Tests mit echter Anmeldung. Aufgaben-Häkchen sind lokale UI-Zustände; Beispieldateien werden nicht heruntergeladen und Beispielnachrichten nicht gesendet. Persistente Projekte, Uploads und Live-Kommunikation benötigen anschließend das Datenbankmodell.

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
