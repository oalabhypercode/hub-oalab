# OALAB Projects – Client Hub

> Zentrale Projektübersicht, Entscheidungsgrundlage und Sammlung offener Fragen.
> Dieses Dokument soll bei jeder fachlichen oder technischen Entscheidung aktualisiert werden.

**Stand:** 22. Oktober 2026
**Projektphase:** Schritt 1 – Frontend und vier rollenbasierte Demo-Konten umgesetzt; persistentes Datenmodell folgt

### Designentscheidung vom 19. Oktober 2026: Client Hub im Liquid-Glass-Stil

- Das Frontend des Hubs folgt der Struktur von Apple Health (Übersicht mit Insights, Favoriten, Highlights und Listen; Detailseiten mit Zeitraum-Umschalter T/W/M/6M/J; farbcodierte Kategorien) in der Designsprache Liquid Glass. Übernommen wird nur die Designsprache, keine Apple-Markenelemente.
- Unter allen Inhalten liegt ein kräftiger, wählbarer Hintergrund. Karten, Listen, Sidebar, Tab-Bar und Buttons sind mattes Glas (Standard 80 % Deckkraft, 24 px Unschärfe).
- **Inter bleibt** die Schrift. Große Kennzahlen nutzen `ui-rounded` (SF Pro Rounded auf Apple-Geräten, sonst Inter).
- **Standard-Hintergrund ist das Preset „oalab“** (Bordeaux, Rot und Orange, für weiße Schrift abgedunkelt). Ozean, Aubergine, Smaragd, Glut, Graphit und eine eigene Farbe sind wählbar. Links, aktive Navigation und Fokus bleiben Bordeaux.
- Kategorien: Projekte (Orange), Dateien (Indigo), Nachrichten (Blau), seit 22. Oktober 2026 Kalender (Rot). Rechnungen, Analytics und Hosting entfallen, bis es diese Module gibt.
- Die Beispieldaten (Vorschau und vier Demo-Identitäten) enthalten einen ausdrücklich fiktiven, datierten Verlauf: Projektstart, Zieltermine, Meilensteine, Dateidaten. Referenztag ist der 15. Oktober 2026 (`DEMO_AS_OF`). Echte Konten sehen weiterhin leere Zustände.
- Die Insights sind regelbasiert aus den vorhandenen Daten erzeugt und können später durch eine KI-Zusammenfassung ersetzt werden.
- Darstellung (Preset, eigene Farbe, Deckkraft 70–95 %, Unschärfe 8–40 px, „Transparenz reduzieren“) und Favoriten werden im Browser gespeichert, Favoriten pro Nutzer. Für Nutzereinstellungen gibt es noch keinen Speicher im Backend. Ein Inline-Script setzt die Darstellung vor dem ersten Paint.
- Die Übersicht begrüßt mit Namen und zeigt Unternehmen und Kundennummer (Admins: Organisation und Zahl der betreuten Kunden). Kundennummern existieren bisher nur als fiktive Demo-Werte (`KD-24017`, `KD-24023`, `KD-24031`); echte Konten zeigen „Noch nicht zugeordnet“.
- Rechts neben der Begrüßung stehen das aktive Servicepaket und der Button „Ab zur Serviceplattform“ (https://service.oalab.de, neuer Tab). Jeder Kunde hat mindestens ein Paket: Oalab-Website & Mail, Oalab-Website lite, Oalab-Website extra oder Oalab-Website Max (zentral in `lib/service-packages.ts`). Die Demo-Zuordnungen sind fiktiv.
- Login, Registrierung, Passwortseiten, Auth-Fehler und 404 stehen ebenfalls im Glas-Stil auf dem wählbaren Hintergrund; das Formular liegt auf einer Glaskarte. Das Original-Logo erscheint nur transparent als Wasserzeichen links (auf dem Smartphone klein oben rechts), nie umgefärbt.
- Auf der Login-Seite stehen die Demo-Konten in einem Dropdown „Testkonto wählen“; ein Klick auf ein Konto meldet direkt an. Die Links „Ein erster Einblick“ und „Dashboard-Vorschau entdecken“ entfallen, weil die Demo-Konten den Einblick bereits bieten. `/preview` bleibt per direkter Adresse erreichbar.
- Das Dashboard der Demo-Konten (Kunden und Admin) zeigt keinen Demo-Banner mehr. Rolle und Art der Demo stehen im Tooltip des Abmelde-Buttons, das Profil nennt die öffentliche Demo weiterhin ausdrücklich. Nur `/preview` behält den Hinweis „Designvorschau“.
- Kontrast: Alle Texte auf Glas erreichen mindestens 4,5:1 bei 70 % Deckkraft über jedem Hintergrund, auch über Schwarz. Dafür sind die Kategorie-Textfarben gegenüber der Vorlage abgedunkelt. `tests/appearance.test.mjs` prüft das.

### Markenentscheidung vom 15. Oktober 2026

- Plattformname: **oalab**, Produktbezeichnung: **oalab Client Hub**.
- Hauptlogo und Iconvariante sind als gelieferte Originaldateien eingebunden.
- Der Bordeaux-Rot-Orange-Verlauf des Icons bildet die gemeinsame Corporate-Farbwelt. Inter ist die einheitliche Schrift aller Oberflächen.
- Verbindliche Anwendungsregeln und Farbwerte stehen in [CI_GUIDELINES.md](./CI_GUIDELINES.md); zentrale CSS-Tokens in `app/brand.css`.

### Vorgabe vom 22. Oktober 2026: Kalender und Reiter „Projekte“

- Der Reiter „Projekte“ zeigt oben keine Kennzahl-Kacheln mehr. Die Kennzahlen bleiben über Favoriten und die Detailseiten erreichbar; die Kacheln stehen im Backlog (unten).
- Unter dem Suchfeld steht eine Tabelle mit den Spalten **Bereich** (z. B. Website & Digital, Brand Identity), **Titel** (bei Admins darunter der Kunde), **Meilensteinbeschreibung** (Titel und Text des aktuellen Meilensteins, seit dem 22. Oktober 2026 ohne Datum), **Aktueller Status**, **Startzeitpunkt** (Projektbeginn, `startedOn`), **Nächster Termin** (bis zum 22. Oktober 2026 „Terminierung“) und **Fortschritt** (Balken und Prozent). Die ganze Zeile öffnet den Projektdialog; auf dem Smartphone wird jede Zeile zur Karte, dort steht vor dem Startdatum „Start“.
- Sieben Spalten: Zellen sind enger, lange Überschriften brechen per weichem Trennstrich um. Ab 1280 px passt die Tabelle; darunter (1024–1279 px) scrollt sie seitlich in ihrem eigenen Bereich, die Seite bleibt fest.
- Die Filter zeigen ihre Anzahl als eigene Zähl-Badges („Alle 9“, „Aktiv 6“, „Abgeschlossen 3“).
- Abgeschlossene Projekte stehen am Ende und sind ausgegraut (graue Zeile, Titel und Texte in Sekundärfarbe). Der Fortschrittsbalken behält bewusst Farbe und Gewicht, damit 100 % sichtbar bleibt.
- **Nächster Termin** ist der Zieltermin des Projekts (`dueOn`) mit Hinweis „in 8 Tagen“, „heute“, „3 Tage überfällig“ (rot) oder „abgeschlossen“ (`deadlineHint` in `lib/hub-data.ts`). Das Datum verlinkt auf den Kalender an diesem Tag (`/dashboard/calendar?day=JJJJ-MM-TT`).
- Die Terminierungen erscheinen im **Kalender** als ganztägige Projektziele „Ziel · …“ (orange, abgeschlossene grau), in der Tagesansicht und in der Liste „Projekt-Terminierungen“. Kunden sehen die Ziele ihrer eigenen Projekte, Admins die aller Kunden mit Firmennamen; die Quelle sind dieselben Projektdaten wie im Reiter „Projekte“, es gibt keine eigene Tabelle. Projektziele zählen nicht als belegte Zeit. Tabelle und Kalender rechnen mit demselben Stichtag (bei Demo-Konten der 15. Oktober 2026 der Beispieldaten).
- Die Meilensteinbeschreibung zeigt den aktuellen Meilenstein, also den zuletzt erreichten (`currentMilestone` in `lib/hub-data.ts`): Titel, Kurzbeschreibung und Datum. Beschreibungen gibt es bisher nur in den fiktiven Beispieldaten.
- Neuer Reiter **Kalender** für Admins und Kunden, in Sidebar und Tab-Bar (`/dashboard/calendar`, `/preview/calendar`).
- Admins legen Termine an, optional für einen Kunden, und hinterlegen einen Microsoft-Teams-Link. Der Link wird von Hand aus Teams oder Outlook eingefügt; akzeptiert werden nur Teams-Domains. Termine lassen sich bearbeiten, absagen (mit Hinweis an den Kunden) und löschen. Überschneidungen zeigt das Formular an, blockiert sie aber nicht.
- Kundenanfragen stehen beim Admin unter „Offene Anfragen“. Er nimmt sie an (Zeit anpassbar, Teams-Link eintragen) oder lehnt sie mit Begründung ab.
- Kunden sehen pro Tag, wie stark der OALAB-Kalender belegt ist (frei, gut verfügbar, stark belegt, ausgebucht). In der Tagesansicht erscheinen fremde Termine nur als anonyme „Belegt“-Blöcke, ohne Titel oder Kunde.
- Kunden fragen Termine in freien Zeiträumen an: 30 bis 90 Minuten, Mo–Fr 9–17 Uhr (Europe/Berlin), höchstens fünf offene Anfragen. Sie sehen den Status, können offene Anfragen zurückziehen und treten bestätigten Terminen über „Teams-Meeting beitreten“ bei.
- Technik: Migration `supabase/migrations/20261022120000_hub_calendar.sql`, am 22. Oktober 2026 auf `tjbslvwvisxjjcxfhbgm` angewendet. Tabelle `hub_appointments` mit RLS: Admins dürfen alles; Kunden lesen ihre Termine und legen nur Anfragen ohne Teams-Link an. `hub_calendar_busy()` liefert Angemeldeten nur die Zeitblöcke bestätigter Termine, `hub_withdraw_appointment_request()` zieht eine eigene offene Anfrage zurück. Data-API-Grants sind explizit gesetzt.
- Arbeitszeit, Zeitzone samt Sommerzeitwechsel, freie Slots und Teams-Links regelt `lib/hub-calendar/rules.ts`; `tests/hub-calendar.test.mjs` prüft das. Vorschau und öffentliche Demo zeigen fiktive Termine (`lib/hub-calendar/fixtures.ts`); Änderungen dort bleiben im Browserfenster.
- Lokal mit echten Demo-Logins geprüft: Nordlicht fragt an, der Admin bestätigt mit Teams-Link, Nordlicht sieht den Termin samt Link; der Termin von Form & Feld erscheint bei Nordlicht nur als „Belegt“. Drei Testtermine vom 23. Oktober 2026 („Testtermin: …“, „Testanfrage …“) liegen noch in der Datenbank.
- Offen: E-Mail-Benachrichtigung bei neuer Anfrage und bei Bestätigung, Teams-Meetings automatisch über Microsoft Graph, konfigurierbare Zeiten und Feiertage, Erinnerungen vor dem Termin.

### Vorgabe vom 22. Oktober 2026: Suche, Filter und Sortierung in allen Tabellen; Zeilen als Blobs

- Jede Tabelle der Plattform (derzeit Projekte und Dateien) zeigt oben zunächst nur das Suchfeld. Der Knopf „Erweiterte Suche“ rechts im Feld (auf schmalen Smartphones nur das Regler-Symbol) klappt darunter ein Glas-Panel mit Filtern und „Sortieren“ auf; eine Zahl am Knopf zeigt aktive Filter auch im eingeklappten Zustand (Vorgabe vom 22. Oktober 2026, ersetzt die offene Leiste mit „Sortieren“ oben rechts). Auf dem Smartphone stehen die Filter paarweise nebeneinander.
- Suche: Groß-/Kleinschreibung und Umlaute zählen nicht („gefuhl“ findet „Gefühl“), mehrere Wörter müssen alle vorkommen, auch verteilt auf verschiedene Spalten.
- Sortieren: per Klick auf eine Spaltenüberschrift (zweiter Klick dreht die Richtung, Pfeil zeigt sie, `aria-sort` für Screenreader) oder in der erweiterten Suche über „Sortieren“ mit Richtungspfeil. Beides nutzt denselben Zustand, das Feld ist auf dem Smartphone der einzige Weg.
- Projekte: Suche über Titel, Bereich, Meilenstein, Status, Startzeitpunkt und nächsten Termin (Admins auch Kunde). Filter Alle/Aktiv/Abgeschlossen (die Zahlen gelten für Suche und übrige Filter), Bereich, beim Admin Kunde. Sortierung nach nächstem Termin (Standard, früheste zuerst), Startzeitpunkt, Titel, Bereich, Status („Dein Feedback“ zuerst), Fortschritt, beim Admin Kunde. Abgeschlossene Projekte bleiben bei jeder Sortierung unten (Entscheidung vom 22. Oktober 2026).
- Dateien: Suche zusätzlich über Kategorie und (Admins) Kunde. Neuer Filter Format. Sortierung nach Bereitgestellt (Standard, neueste zuerst), Titel, Kategorie, Format, Größe.
- Leere Treffer zeigen „Suche und Filter zurücksetzen“. Bei Dateien bleibt der Kundenfilter dabei stehen, weil er auch die Ordner bestimmt.
- Zeilen sind eigene Glas-Blobs mit abgerundeten Ecken und 4 px Abstand (Smartphone 6 px), statt durch Trennlinien in einer gemeinsamen Karte zu liegen. Die Zellen tragen den Hintergrund (`border-spacing`), damit die Tabellen echte Tabellen bleiben; ein gemeinsamer `drop-shadow` liegt unter allen Blobs.
- Technik: Regeln in `lib/table-tools.ts` (`matchesSearch`, `sortRows`, `nextSort`), Bausteine in `components/hub/table-tools.tsx` (`TableSearch`, `FilterSelect`, `SortControl`, `SortHeader`), Tests in `tests/table-tools.test.mjs`.

### Vorgabe vom 22. Oktober 2026: Ordner, Mehrfach-Upload und ZIP-Download

- Admins laden bis zu 20 Dateien auf einmal hoch, per Auswahl oder Hineinziehen (je bis 50 MB).
    - Den Titel jeder Datei kann man in der Liste anpassen; jede Datei zeigt ihren eigenen Fortschritt.
    - Kategorie, Beschreibung, Kunden und Ordner gelten für alle Dateien des Uploads. Ein Ordner lässt sich wählen, wenn genau ein Kunde zugeordnet ist.
- Kunden laden weiterhin nicht selbst hoch (Entscheidung vom 22. Oktober 2026).
- Mehrere Dateien herunterladen: Häkchen setzen, dann „Als ZIP herunterladen“.
    - Der Browser holt jede Datei über ihren eigenen 60-Sekunden-Link und baut die ZIP-Datei selbst. So greifen keine Größengrenzen von Vercel.
    - Bis 500 MB auf einmal; doppelte Dateinamen werden nummeriert, Umlaute bleiben erhalten.
- Ordner gibt es pro Kunde, mit einer Ebene ohne Unterordner. Über der Tabelle stehen „Alle Dateien“, die Ordner, „Ohne Ordner“ und „Neuer Ordner“.
    - Kunden legen Ordner für ihr Unternehmen an; Admins wählen dafür im Filter „Kunde“ den Kunden.
    - Ordner lassen sich umbenennen und löschen. Beim Löschen landen die Dateien in „Ohne Ordner“; es wird keine Datei gelöscht.
    - „Verschieben nach …“ sortiert markierte Dateien ein.
- Technik: Migration `supabase/migrations/20261022170000_hub_folders.sql`, am 22. Oktober 2026 angewendet.
    - Tabelle `hub_folders` mit RLS: Admins dürfen alles, Mitglieder des Kunden verwalten dessen Ordner.
    - Neue Spalte `hub_file_assignments.folder_id`: Der Ordner gilt pro Kundenzuordnung. Ein zusammengesetzter Fremdschlüssel stellt sicher, dass eine Datei nur in einem Ordner desselben Kunden liegt.
    - Kunden dürfen per Spaltenrecht nur `folder_id` ändern.
- Vorschau und öffentliche Demo zeigen die Beispielordner „Briefings“ und „Verträge“. Änderungen dort bleiben im Browserfenster.
- Lokal mit echten Logins geprüft:
    - Nordlicht: Ordner anlegen, umbenennen und löschen (auch mit Inhalt), Verschieben, ZIP mit beiden Dateien byte-genau.
    - Admin: zwei Dateien auf einmal hochgeladen, Nordlicht zugeordnet und in dessen Ordner „Verträge“ abgelegt. Die Testdateien sind wieder gelöscht.
    - Der Ordner „Verträge“ mit dem Servicevertrag von Nordlicht bleibt zur Ansicht bestehen.

### Vorgabe vom 22. Oktober 2026: KI-Assistent und Claude-Code-Befehl

- Die Sprechblase oben rechts heißt jetzt „Assistent & Hilfe“. Sie öffnet für Kunden und Admins einen Chat, der Fragen zu den Funktionen der Plattform beantwortet. Er zeigt Vorschlagsfragen je Rolle, streamt die Antworten, kann neu gestartet werden und behält den Verlauf beim Seitenwechsel.
- Modell: **Claude Opus 5.5** (`claude-opus-5-5`) über `@anthropic-ai/sdk` 1.1.0. Aufwand `low` für schnelle, kurze Antworten. Lehnt das Modell eine Anfrage ab, übernimmt automatisch ein Ersatzmodell (`fallbacks: "default"`).
- Grundlage ist allein die Wissensbasis `lib/hub-assistant/knowledge.ts`. Der Assistent sieht keine Projekte, Dateien oder Termine und ändert nichts. Für Geplantes sagt er, dass es das noch nicht gibt.
- `app/api/assistant/route.ts` antwortet nur echten Supabase-Logins; die Rolle kommt aus dem Token. Der Verlauf ist auf 20 Nachrichten und 1000 Zeichen pro Frage begrenzt. Vorschau und öffentliche Demo senden keine Fragen an Claude.
- Der Chat weist aus, dass eine KI antwortet (Transparenzpflicht seit 02.08.2026), und bittet, keine persönlichen Daten einzugeben.
- CLI-Schnittstelle: Projektbefehl `/hub-hilfe` für Claude Code (`.claude/commands/hub-hilfe.md`). Er liest dieselbe Wissensbasis und bei Bedarf den Code, nur lesend.
- Einrichtung: `ANTHROPIC_API_KEY` in `.env.local` und als Secret in Vercel (Production). Ohne Schlüssel meldet der Chat „noch nicht eingerichtet“.
- Stand der Prüfung: Login-Schutz, Fehlermeldung ohne Schlüssel, Vorschau-Hinweis sowie Darstellung gestreamter Antworten (mit simulierter Antwort) sind im Browser geprüft. Echte Antworten von Claude und der Befehl `/hub-hilfe` sind noch nicht getestet, weil hier weder ein API-Schlüssel noch eine Claude-Code-Anmeldung vorlag.
- Offen: Nutzungslimit pro Nutzer gegen Kosten und Missbrauch, Mengengerüst und Kosten beobachten, Wissensbasis bei jeder Änderung pflegen.

### Vorgabe vom 22. Oktober 2026: WhatsApp-Anbindung des Assistenten

- Der KI-Assistent ist auch per WhatsApp erreichbar. Die Anbindung läuft über die offizielle WhatsApp Cloud API von Meta, direkt und ohne Zwischenanbieter.
- Zugang haben nur verbundene Nummern. Im Profil erzeugt „WhatsApp verbinden“ einen sechsstelligen Code, gültig 15 Minuten. Die Nachricht „VERBINDEN 123456“ an die oalab-Nummer verknüpft die Nummer mit dem Login; „Trennen“ hebt das wieder auf.
- Der Assistent antwortet über WhatsApp passend zur Rolle (Kunde oder Admin), kürzer und mit WhatsApp-Formatierung.
- Unbekannte Nummern erhalten höchstens drei Antworten am Tag, mit einer Anleitung zum Verbinden. Verbundene Nummern haben 30 Fragen am Tag.
- „TEAM“ nennt den Kontakt info@oalab.de, änderbar über `WHATSAPP_SUPPORT_CONTACT`. Meta verlangt diesen Weg zu einem Menschen für Bots.
- Technik: Migration `supabase/migrations/20261022150000_hub_whatsapp.sql`, am 22. Oktober 2026 angewendet. Sie legt drei Tabellen an:
    - `hub_whatsapp_links`: Nutzer lesen und löschen nur die eigene Verknüpfung.
    - `hub_whatsapp_link_codes`: Codes entstehen nur über `hub_create_whatsapp_link_code()`.
    - `hub_whatsapp_messages`: Verlauf und Schutz vor doppelt zugestellten Nachrichten; nur der Webhook greift darauf zu.
- Der Webhook `/api/whatsapp` ist öffentlich, verarbeitet aber nur Lieferungen mit gültiger Meta-Signatur. Er bestätigt sofort und antwortet im Hintergrund (`after()`). Der Gesprächsverlauf wird nach 48 Stunden gelöscht.
- Der Webhook braucht `SUPABASE_SECRET_KEY` in Vercel. Er arbeitet damit nur mit den WhatsApp-Tabellen und liest die Rolle der verknüpften Person.
- Lokal geprüft mit Platzhalterwerten, die danach wieder entfernt wurden:
    - Webhook-Verifizierung; falsches Token und unsignierte Lieferungen werden abgelehnt.
    - Code erzeugen, Verknüpfen per signierter Testnachricht, eine doppelte Lieferung wird ignoriert, „TEAM“, Frage und unbekannte Nummer, Trennen.
    - Das Senden an WhatsApp selbst ist ungetestet, weil hier kein Meta-Zugang vorliegt.
- Offen:
    - Meta-App, Nummer und Token einrichten; Zahlungsmethode hinterlegen (ab der 1.001. Antwort im Monat kostenpflichtig).
    - Der Datenschutz muss ergänzt werden: Nachrichten und Nummern laufen über Meta.
    - Eine Nummer gleichzeitig in der WhatsApp-Business-App und der API zu nutzen, war laut einem Anbieter in der EU zuletzt nicht freigeschaltet.

### Backlog

- Kennzahl-Kacheln im Reiter „Projekte“ (aktive Projekte, Fortschritt, Meilensteine, Feedback): am 22. Oktober 2026 auf Wunsch entfernt. Offen ist, ob sie zurückkommen oder einen anderen Platz bekommen.

### Vorgabe vom 20. Oktober 2026: User-Management für Admins (geplant)

- Admins bekommen einen eigenen Bereich zur Verwaltung der Kundenkonten, aufgebaut als Tabelle wie die Referenz „All Employees“: Kopfzeile mit Gesamtzahl, Filter, Sortieren, Spaltenauswahl und Suche; je Zeile die Aktionen Ansehen, Bearbeiten, Löschen. Der Referenz-Screenshot liegt im Team-Doc „oalab Client Hub – To-dos fürs Team“.
- Spalten: **Kunden-Nr.** (statt Worker ID, mit Kopier-Button) · **Kunde** (Name, darunter die registrierte E-Mail; statt Member) · **Unternehmen** (statt Role) · **Status** (statt Worker Type) · **Letzter Login** (Zeitstempel).
- Status mit Farbe: „Aktivierungslink versenden“ (orange), „Aktiv“ (grün), „Deaktiviert“ (rot).
- Funktionen: neue Konten durch den Admin anlegen (Name, E-Mail, Unternehmen, Kunden-Nr.), Aktivierungslink (erneut) versenden, Passwort-Neuvergabe auslösen (Reset-Link an die registrierte E-Mail), Konto deaktivieren und wieder aktivieren, letzten Login anzeigen, Löschen nur mit Bestätigung.
- Technik: Supabase Auth Admin API (Einladung, Reset-Link, Sperren, `last_sign_in_at`) nur serverseitig mit Secret Key oder über eine Edge Function; aufbauend auf `hub_customers` und `hub_customer_members`.
- Offen: Löschen endgültig oder nur deaktivieren? Mehrere Logins pro Kunde?

### Ergänzung vom 20. Oktober 2026: Dateiaustausch

- Admins laden unter „Dateien“ Dateien mit Titel, Kategorie und Beschreibung hoch und ordnen sie einem oder mehreren Kunden per Kundennummer zu. Ohne Zuordnung liegt eine Datei in der Ablage und kann später zugeordnet werden.
- Kunden sehen ihre zugeordneten Dateien in einer Tabelle mit eigenen Spalten für Datei, Kategorie, Beschreibung, Format/Größe und Bereitstellungsdatum, dazu ein Detaildialog mit allen Angaben. Der Download liefert exakt die hochgeladene Fassung mit Originalnamen; eine beim Upload berechnete SHA-256-Prüfsumme belegt das.
- Kategorien (zentral in `lib/hub-files/catalog.ts` und der Migration): Vertrag, Angebot, Rechnung, Logo & Marke, Design, Website & Inhalte, Dokumentation, Sonstiges. Bis 50 MB pro Datei, keine ausführbaren Dateien.
- Technik: Supabase-Projekt `tjbslvwvisxjjcxfhbgm`, Migration `supabase/migrations/20261020120000_hub_files.sql` mit den Tabellen `hub_customers`, `hub_customer_members`, `hub_files`, `hub_file_assignments`, Row Level Security, expliziten Data-API-Grants und dem privaten Bucket `hub-files`. Uploads gehen direkt vom Browser über eine serverseitig nur für Admins ausgestellte, signierte Upload-URL zu Supabase; Downloads über 60 Sekunden gültige signierte Links. In Produktion wird kein Admin-Schlüssel benötigt.
- Admin-Rechte kommen ausschließlich aus `app_metadata.app_role = oalab_admin`. Öffentliche Demo-Identitäten (signiertes Cookie) erreichen keine echten Dateien; sie und `/preview` zeigen fiktive Musterdateien („Servicevertrag“, „Logo-Datei“) aus `public/demo-files`.
- `npm run files:seed` legt die drei Demo-Kunden mit Kundennummer an, verknüpft die Demo-Logins und lädt je einen fiktiven Servicevertrag (PDF) und eine Logo-Datei (SVG) hoch.
- Live-Nachrichten werden zurückgestellt: Nachrichten aus dem Hub sollen später über den bevorzugten Kanal des Kunden zugestellt werden, z. B. WhatsApp. Angebote, Verträge und Rechnungen laufen vorerst nur als Dateien mit passender Kategorie.

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
- KI-Assistent (Claude) für Admins und Kunden hinter „Assistent & Hilfe“ sowie Claude-Code-Befehl `/hub-hilfe`
- WhatsApp-Anbindung des Assistenten über die WhatsApp Cloud API, Verknüpfen der Nummer per Code im Profil
- Dateiablage mit Ordnern pro Kunde, Mehrfach-Upload für Admins und ZIP-Download mehrerer Dateien
- Kalender für Admins und Kunden: Auslastung, Terminanfragen, Bestätigung mit Microsoft-Teams-Link (Supabase mit RLS)
- Client Hub im Liquid-Glass-Stil mit wählbarem Hintergrund, Glasflächen, Insights, Favoriten, Highlights, Kennzahl-Detailseiten und Darstellungs-Einstellungen; Login- und Auth-Seiten im selben Glas-Stil mit Demo-Konten im Dropdown

### Noch nicht implementiert

- Datenanbindung für Kunden, Unternehmen, Projekte, Aufgaben und Meilensteine
- Persistentes Rollen- und Berechtigungssystem für reale Geschäftsdaten
- Datenbankseitige Mandantentrennung zwischen Kunden (die Demo-Fixtures sind bereits getrennt)
- Löschen und Versionieren von Dateien
- User-Management für Admins (Konten anlegen, Aktivierungslink, Passwort-Neuvergabe, Deaktivieren, letzter Login; Vorgabe siehe oben). Kunden und Logins entstehen bisher nur per Seed
- Echte Kommentare, Nachrichten und Benachrichtigungen; Nachrichten sollen später über den bevorzugten Kanal des Kunden (z. B. WhatsApp) laufen
- Angebote, Verträge, Rechnungen oder Zahlungen
- Kalender-Integrationen (Outlook, automatisch erzeugte Teams-Meetings) und Benachrichtigungen zu Terminen
- Projektspezifisches Datenbankschema, Migrationen und generierte TypeScript-Datenbanktypen
- Umfassende Integrationstests und CI/CD

## 3. Aktuelle Routen

| Route | Status | Zweck |
| --- | --- | --- |
| `/` | Öffentlich | Direkter Login mit vier explizit freigegebenen Online-Fixture-Ansichten; lokal echte Testkonten |
| `/auth/login` | Öffentlich | Derselbe Login mit regulärem Formular und Demo-Konten im Dropdown |
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
| `/dashboard/calendar` | Geschützt | Kalender: Admins planen Termine mit Teams-Link und beantworten Anfragen; Kunden sehen die Auslastung und fragen Termine an |
| `/dashboard/insights` | Geschützt | Insights und alle Highlights |
| `/dashboard/discover` | Geschützt | Entdecken: Kategorien, Kennzahlen und Konto durchsuchen |
| `/dashboard/metrics/<kennzahl>` | Geschützt | Detailseite einer Kennzahl mit Zeitraum-Umschalter |
| `/dashboard/settings` | Geschützt | Profil und Kontoinformationen |
| `/dashboard/settings/appearance` | Geschützt | Darstellung: Hintergrund, Glas, Transparenz |
| `/api/whatsapp` | Öffentlich, nur mit Meta-Signatur | Webhook der WhatsApp Cloud API: Verifizierung (GET) und eingehende Nachrichten (POST) |
| `/api/assistant` | Geschützt (POST) | KI-Assistent: streamt Antworten von Claude zu Funktionen des Hubs |
| `/preview` | Öffentlich | Dashboard-Designvorschau mit fiktiven Daten; vom Login nicht mehr verlinkt |
| `/preview/projects` | Öffentlich | Beispielprojekte mit Filtern und Detaildialogen |
| `/preview/files` | Öffentlich | Beispiel-Dateiliste und Dateiinformationen |
| `/preview/messages` | Öffentlich | Fiktive, nicht sendende Beispielunterhaltung |
| `/preview/calendar` | Öffentlich | Kalender mit fiktiven Terminen; Anfragen bleiben im Browser |
| `/preview/settings` | Öffentlich | Beispiel-Profil |
| `/preview/insights`, `/preview/discover`, `/preview/metrics/<kennzahl>`, `/preview/settings/appearance` | Öffentlich | Dieselben neuen Ansichten mit Beispieldaten |
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

- Datenbanktabellen und Beziehungen außerhalb von Dateiablage und Kalender (beide Migrationen sind angewendet; `npm run db:check` zeigt ausstehende)
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
- `npm test` umfasst 59 Tests für Auth-Weiterleitungen, Seed-Konfiguration, Demo-Zugriffsregeln, lokales Ein-Klick-Login, gemeinsames Branding, die öffentliche Signatur-/Origin-Policy, Kontrast und Darstellungslogik des Hubs sowie die Regeln, RLS-Migration und Musterdateien des Dateiaustauschs, die Kalenderregeln (Zeitzone und Sommerzeit, freie Slots, Teams-Links), die RLS-Migration des Kalenders, die Projekt-Terminierungen, Suche und Sortierung der Tabellen sowie KI-Assistent und WhatsApp-Anbindung unter Node.js 24. In Windows-Checkouts mit `core.autocrlf=true` schlägt der Musterdatei-Test fehl, weil Git die Beispiel-PDFs auf CRLF umstellt (siehe Aufräumbedarf).
- `npm run demo:verify` besteht für alle vier echten Logins inklusive Rolle, Workspace und Abmeldung.
- `npm run demo:smoke` besteht für alle vier Dashboard-Datensichten, fremde Projekt-IDs und den Schutz vor unangemeldetem Zugriff.
- Alle vier lokalen Ein-Klick-Logins und der Kontowechsel sind im Browser geprüft. Produktion ohne öffentliche Freigabe verweigert Demo-POSTs mit 404. `npm run demo:public:smoke -- --local` besteht im explizit freigegebenen Produktionsmodus für alle vier Fixture-Identitäten, Kundentrennung, Abmeldung, Host-/Origin-Prüfung und die Grenze zu echten Auth-Routen. Passwörter fehlen in HTML, Browser-Assets und Deployment-Traces.
- Öffentliche Demo am 15. Oktober 2026 auf der Vercel-Hauptadresse bereitgestellt. `npm run demo:public:smoke` besteht live für alle vier Identitäten. Alle vier Zugänge und der Kontowechsel sind zusätzlich im Live-Browser geprüft; mobile Auswahl bei 390 Pixeln ohne horizontalen Überlauf. Änderungen und Betriebsanleitung sind auf `main` versioniert, die privaten Werte ausschließlich in Vercel beziehungsweise lokal.
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
- [ ] `.gitattributes` mit `public/demo-files/** -text` ergänzen, damit Windows-Checkouts die Musterdateien nicht verändern

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
- [ ] Aus welchem System stammt die Kundennummer, und welches Format hat sie?
- [ ] Woher kommen die aktiven Servicepakete eines Kunden (Serviceplattform, Buchhaltung, Supabase)?
- [ ] Welche Felder benötigt ein Projekt?
- [ ] Welche Projektstatus und Statusübergänge gibt es?
- [ ] Wie werden Fortschritt, Priorität, Budget und Zeitplan dargestellt?
- [ ] Werden Aufgaben, Meilensteine, Deliverables oder Freigaben benötigt?
- [ ] Wer darf Projekte und Projektdaten erstellen oder verändern?
- [ ] Soll es Vorlagen für wiederkehrende Projekttypen geben?

### Kommunikation und Aktivitäten

- [ ] Werden projektbezogene Kommentare oder vollständige Chats benötigt?
- [ ] Über welche Kanäle (z. B. WhatsApp, E-Mail) sollen Nachrichten zugestellt werden, und wo wählt der Kunde seinen bevorzugten Kanal?
- [ ] Müssen Benutzer erwähnt werden können?
- [ ] Welche Aktivitäten sollen in einem Verlauf protokolliert werden?
- [ ] Welche Ereignisse lösen E-Mail- oder In-App-Benachrichtigungen aus?
- [ ] Müssen Benachrichtigungseinstellungen pro Benutzer konfigurierbar sein?

### Dateien und Freigaben

- [ ] Welche Dateitypen und maximalen Größen sind erlaubt?
- [x] Ordner: eine Ebene pro Kunde, von Kunden und Admins anlegbar (Entscheidung vom 22. Oktober 2026). Offen bleiben Tags, Versionen und Unterordner.
- [x] Kunden laden vorerst nicht selbst hoch; nur Admins (Entscheidung vom 22. Oktober 2026). Ob Kunden später hochladen oder löschen dürfen, bleibt offen.
- [ ] Sollen Admins Dateien löschen oder neue Fassungen einer Datei hochladen können?
- [ ] Benötigen Dateien Freigabe- oder Abnahmeprozesse?
- [ ] Müssen Downloads und Änderungen revisionssicher protokolliert werden?

### Angebote, Verträge und Abrechnung

- [ ] Sollen Angebote, Verträge oder Rechnungen im Hub angezeigt werden?
- [ ] Werden Zahlungsstatus oder Online-Zahlungen benötigt?
- [ ] Gibt es dafür bereits ein führendes System oder eine Buchhaltungsintegration?
- [ ] Müssen Dokumente elektronisch bestätigt oder unterschrieben werden?

### Termine und Integrationen

- [ ] Sollen Google Calendar, Outlook oder andere Kalender angebunden werden?
- [ ] Sollen Teams-Meetings automatisch erzeugt werden (Microsoft Graph), statt Links von Hand einzufügen?
- [ ] Welche Zeiten sind buchbar (bisher Mo–Fr 9–17 Uhr)? Gelten Feiertage oder Puffer zwischen Terminen?
- [ ] Wer wird über neue Anfragen benachrichtigt, und erhalten Kunden eine Bestätigung per E-Mail?
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
- [ ] WhatsApp: Datenschutzerklärung um die WhatsApp-Anbindung ergänzen (Meta als Dienstleister, gespeicherte Nummer, Verlauf 48 Stunden) und die Meta-Bedingungen zur Datenverarbeitung prüfen.
- [ ] KI-Assistent: Ist ein Auftragsverarbeitungsvertrag (DPA) mit Anthropic geschlossen? Wie ist der Datentransfer in die USA abgesichert? Die Datenschutzerklärung braucht einen Abschnitt zum Assistenten (Anbieter, Zweck, Rechtsgrundlage, Speicherdauer).
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
