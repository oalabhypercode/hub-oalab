# Planung: Kalender des Hubs mit Apple Kalender synchron halten

Stand 22. November 2026 · alle Entscheidungen getroffen (Abschnitt 8) · Etappe 1 gebaut auf dem Branch `feat/kalender-abo` (Migration 202611220001 in `service-oalab`, Branch `feat/hub-calendar-feeds`), noch nicht live · Etappe 2 und 3 entfallen (Entscheidung 10): Es bleibt beim abonnierbaren Kalender · Umsetzung in Abschnitt 11

Ziel: Was im Kalender des Hubs steht, soll ohne Zutun im Apple Kalender auf iPhone, iPad und Mac stehen und dort aktuell bleiben. Dieser Plan vergleicht die möglichen Wege, schlägt drei Etappen vor und beschreibt die erste so genau, dass sie gebaut werden kann. Grundlage ist der Code auf `main` vom 21. November 2026 (nach #137), Apples Hilfeseiten zu Kalenderabos (Stand Mai 2026) und Microsofts Dokumentation zu Frei/Belegt in Microsoft Graph (Stand November 2026).

## Auf einen Blick

- **Etappe 1, für alle: persönliches Kalender-Abo.** Jede Person (Admin, Kunde, Freelancer) bekommt im Hub einen geheimen Abo-Link. Ein Tipp auf „Mit Apple Kalender abonnieren“ legt in Apple Kalender den Kalender „oalab“ an; mit „iCloud“ als Ort steht er auf allen Geräten derselben Apple-ID. Danach holt Apple den Stand von selbst: Neue, verschobene und abgesagte Termine kommen ohne Mail und ohne Löschen von Hand nach. Kosten keine, Richtung nur Hub → Apple.
- **Etappe 2, fürs Team: belegte Zeiten aus iCloud und Microsoft 365 zurück in den Hub.** Das Team führt seine Kalender in beiden. Termine dort sperren die Zeiten, die Kunden anfragen können; Titel und Inhalte bleiben draußen. **Entfällt** (Entscheidung 10): Es reicht ein Kalender, den man mit dem Link in Apple Kalender und Outlook abonniert; der Hub greift nicht auf iCloud oder Microsoft 365 zu und braucht keine App-Registrierung.
- **Etappe 3, optional fürs Team: Abgleich in Sekunden** über Microsoft 365. Derzeit nicht nötig, weil Minuten bis etwa eine Stunde reichen (Entscheidung 8); interessant bleibt sie, falls Teams-Meetings von selbst entstehen sollen.
- **Nicht empfohlen:** den Hub zum vollwertigen CalDAV-Server machen, damit man Hub-Termine in Apple Kalender bearbeiten kann. Das ist viel Aufwand, und die Regeln des Hubs (Anfragen, Verfügbarkeit, Meldungen an Kunden, Teams-Links) ließen sich beim Bearbeiten in Apple nicht durchsetzen.
- **Zur Aktualität:** Wie oft Apple ein Abo abruft, bestimmt Apple, nicht der Hub. Am Mac stellt man es je Kalender ein („Automatisch aktualisieren“), iPhone und iCloud rufen in eigenen Abständen ab, die Apple nicht veröffentlicht. Zu erwarten sind Minuten bis etwa eine Stunde. Wer Sekunden braucht, braucht Etappe 3.

## 1. Ausgangslage

- Der Kalender liegt unter Projekte › Kalender. Termine stehen in `hub_appointments` (Angefragt, Bestätigt, Abgelehnt, Abgesagt), oft mit Teams-Link. Dazu zeigt der Kalender Projektziele und Aufgaben mit Fälligkeit. Admins sehen alles, Kunden ihre eigenen Termine und die Auslastung, Freelancer ihre eigenen Anfragen und Termine.
- Heute gibt es nur den Weg über die Mail: Bei neuen, bestätigten und verschobenen Terminen steht „In deinen Kalender eintragen“ mit Apple, Google, Outlook und .ics (`lib/hub-calendar/links.ts`, `app/api/calendar/[id]/[target]`). Das legt eine **Kopie** an. Verschiebt oder sagt oalab ab, bleibt die Kopie stehen; die Mail bittet, den alten Eintrag selbst zu löschen. Termine ohne Mail, etwa interne des Teams, kommen gar nicht hinüber.
- Für den Bau gut: Der Hub erzeugt schon heute gültige Kalender-Einträge (feste UID je Termin, Zeiten in UTC, Faltung und Maskierung nach RFC 5545). Das Abo baut darauf auf. Der Proxy lässt `/api/calendar/…` schon heute ohne Sitzung durch.

## 2. Wie Apple Kalender fremde Kalender einbindet

| Weg | Richtung | Wie aktuell | Aufwand | Passt für |
|---|---|---|---|---|
| **A Kalender-Abo** (ICS-Datei unter fester Adresse, Link mit `webcal://`) | Hub → Apple, in Apple schreibgeschützt | Apple ruft regelmäßig ab: Minuten bis etwa eine Stunde | klein bis mittel | alle Rollen |
| **B Einladungen per Mail** (Einladung, Änderung, Absage mit derselben UID) | Hub → Apple | so schnell wie die Mail, Annehmen in Mail oder Kalender nötig | mittel | Kunden, aber je Änderung eine Mail |
| **C Hub schreibt in den iCloud-Kalender** (CalDAV mit app-spezifischem Passwort) | Hub → Apple sofort, zurück nur per Abfrage | Sekunden | mittel bis groß | nur das Team |
| **D Microsoft 365 dazwischen** (Microsoft Graph; Apple Kalender zeigt das Microsoft-Konto) | beide Richtungen | Sekunden, mit Push | mittel bis groß | nur das Team, wenn dessen Kalender in Microsoft 365 liegt |
| **E Hub als CalDAV-Server** (Apple bekommt ein CalDAV-Konto auf den Hub) | beide Richtungen | Abfrage alle paar Minuten | groß | theoretisch alle |

- **A** ist der übliche Weg für Kalender aus Web-Anwendungen. Apple nennt ihn „Kalenderabo hinzufügen“; ein Tipp auf einen `webcal://`-Link öffnet den Dialog direkt. Mit iCloud als Ort gilt das Abo auf allen Geräten derselben Apple-ID.
- **B** ergänzt A nicht sinnvoll: Wer abonniert hat, braucht keine Einladungen, und ohne Abo erzeugt jede Änderung eine weitere Mail.
- **C** verlangt, dass der Hub ein app-spezifisches Passwort der Apple-ID speichert. Das öffnet nicht nur den Kalender, sondern auch Mail und Kontakte dieser Apple-ID. Für Kunden ausgeschlossen, für das Team nur mit gutem Grund.
- **D** lohnt sich, wenn das Team ohnehin mit Outlook arbeitet: Der Hub legt den Termin im Outlook-Kalender an, Microsoft erzeugt das Teams-Meeting gleich mit (heute fügt das Team den Link von Hand ein), und das iPhone zeigt das Konto mit Push.
- **E:** Der Hub müsste WebDAV und CalDAV sprechen (RFC 4918, 4791, 6578), eigene App-Passwörter ausgeben (der zweite Faktor des Hubs funktioniert in CalDAV nicht) und jede Änderung aus Apple in die Regeln des Hubs übersetzen. Verschiebt jemand in Apple einen Kundentermin, müsste der Hub die Verfügbarkeit prüfen und den Kunden benachrichtigen; eine abgelehnte Änderung zeigt Apple Kalender nur als Synchronisationsfehler.

## 3. Empfehlung: drei Etappen

1. **Kalender-Abo für alle (Weg A).** Löst „immer synchron“ für Admins, Kunden und Freelancer in Richtung Apple.
2. **Belegte Zeiten aus den Kalendern des Teams in iCloud und Microsoft 365 in den Hub.** Damit stimmt auch die Gegenrichtung für das, worauf es ankommt: keine Anfragen in Zeiten, in denen das Team anderweitig verplant ist.
3. **Nur bei Bedarf: Abgleich in Sekunden über Microsoft 365 (Weg D).** Stand 22. November 2026 nicht nötig.

Termine werden weiter im Hub angelegt, verschoben und abgesagt. Jeder Eintrag im Abo trägt den Link zurück in den Hub.

## 4. Etappe 1 im Detail: das Kalender-Abo

### 4.1 Was im Abo steht

| | Admins | Kunden | Freelancer |
|---|---|---|---|
| Bestätigte Termine | alle, als „Firma: Titel“ | eigene | eigene |
| Offene Anfragen | wählbar, als „Anfrage: …“ und vorläufig markiert | wählbar, eigene | wählbar, eigene |
| Projektziele (ganztägig) | wählbar | wählbar, eigene Projekte | – |
| Aufgaben mit Fälligkeit (ganztägig) | wählbar: mir zugewiesene oder alle | wählbar: Aufgaben, bei denen sie am Zug sind | – |
| Abgesagte und abgelehnte Termine | verschwinden aus dem Abo | verschwinden | verschwinden |

- Standard beim Anlegen: bestätigte Termine und offene Anfragen. Die übrigen Inhalte schaltet jede Person selbst dazu.
- Freelancer bekommen in Etappe 1 nur ihre eigenen Termine und Anfragen, also keine Daten von Kunden. Fälligkeiten aus dem Board kämen dazu, wenn der Bedarf da ist.
- Jeder Eintrag: Titel (bei Kunden und Freelancern mit „· oalab“ wie heute), Beginn und Ende, Teams-Link als Ort und in den Notizen (Entscheidung 3), die Beschreibung des Termins (gekürzt) und der Link „Termin im oalab Client Hub“. Nie die interne Antwortnotiz oder Kontaktdaten. Kunden sehen wie im Hub nie fremde Termine; die Auslastung kommt nicht ins Abo.
- Ganztägige Einträge (Ziele, Fälligkeiten) blockieren in Apple keine Zeit.
- Absagen meldet weiter die Glocke mit Mail; im Abo verschwindet der Termin beim nächsten Abruf.

### 4.2 Adresse und Schlüssel

- Je Login höchstens ein Abo. Adresse `https://hub.oalab.de/api/calendar/feed/<Schlüssel>/oalab.ics`; der Knopf für Apple öffnet dieselbe Adresse mit `webcal://`. Das feste Segment `feed` geht in Next.js vor der vorhandenen Route `[id]`.
- Der Schlüssel besteht aus 32 zufälligen Byte (base64url). Die Datenbank speichert nur seine SHA-256-Prüfsumme, wie bei den Verbindungen des Claude-Connectors. Der Hub zeigt den Link einmal beim Anlegen, mit Kopieren und QR-Code (die Bibliothek `qrcode` ist schon da). Geht er verloren, erzeugt man einen neuen; der alte hört sofort auf zu gehen.
- Anlegen: Kunden mit ihrer normalen Sitzung, Admins und Freelancer nur mit bestätigtem Code (`aal2`), denn der Link liest danach ohne Code.
- Das Abo endet von selbst, wenn der Zugang deaktiviert, gelöscht oder archiviert wird, die Rolle wechselt, ein Admin den zweiten Faktor zurücksetzt oder 180 Tage lang niemand abruft.
- Gelesen wird mit den Rechten der Person: Die Route erzeugt je Abruf einen kurzlebigen Schlüssel mit ihren Claims (`createOwnClaimsClient`, wie beim Claude-Connector). Die Zeilenregeln entscheiden also genau wie im Hub; der Server-Schlüssel liest nur die Zeile des Abos.

### 4.3 Die Antwort

- `GET` und `HEAD`, ohne Sitzung. `Content-Type: text/calendar; charset=utf-8`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`.
- `ETag` über den Inhalt: Ein unveränderter Stand antwortet `304`. Das spart Arbeit, wenn mehrere Geräte alle paar Minuten fragen.
- Kalenderkopf: Name „oalab“ (`NAME`, `X-WR-CALNAME`), `X-WR-TIMEZONE:Europe/Berlin` und als Wunsch-Abstand `REFRESH-INTERVAL;VALUE=DURATION:PT15M` (RFC 7986) sowie `X-PUBLISHED-TTL:PT15M`. Ob Apple diese Angaben beachtet, ist nicht dokumentiert; Etappe 1 misst es.
- Zeitraum 90 Tage zurück bis 12 Monate voraus, höchstens 2000 Einträge.
- Je Termin dieselbe UID wie in den Mail-Dateien (`<id>@hub.oalab.de`), `SEQUENCE` aus der letzten Änderung, `LAST-MODIFIED`, `STATUS:CONFIRMED` bzw. `TENTATIVE` für Anfragen. Zeiten in UTC; ganztägige Einträge als Datum mit `TRANSP:TRANSPARENT`.
- Erinnerung 15 Minuten vorher wie in den heutigen Mail-Dateien. Im Abo-Dialog am Mac ist „Entfernen: Hinweise“ üblicherweise angehakt; wer die Erinnerung will, nimmt den Haken heraus. Die Anleitung im Hub sagt das.
- Höchstens 60 Abrufe je Stunde und Abo, darüber `429`. Ein falscher oder beendeter Schlüssel ergibt `404`, ohne zu verraten, ob es ihn je gab.

### 4.4 Oberfläche

- **Kalender:** Knopf „Abonnieren“ im Kopf. Er öffnet eine Seitenleiste „Kalender abonnieren“ mit
  - den Schaltern aus 4.1,
  - „Mit Apple Kalender abonnieren“ (iPhone, iPad, Mac), „Mit Google Kalender“, „In Outlook“, „Link kopieren“ und dem QR-Code fürs Handy,
  - zwei Sätzen Anleitung je Gerät (4.5),
  - nach dem Anlegen dem Stand: „Abo aktiv · zuletzt abgerufen vor 6 Minuten · Apple“ (aus dem User-Agent nur die Art des Programms), dazu „Neuen Link erzeugen“ und „Abo beenden“.
- **Profil:** Karte „Kalender-Abo“ neben „Verbundene Apps“ mit Stand und denselben Knöpfen.
- **Mails:** Wer ein aktives Abo hat, bekommt in Termin-Mails statt der vier Knöpfe den Satz „Steht automatisch in deinem Kalender oalab.“ Ohne Abo bleiben die Knöpfe, darunter der Hinweis „Immer aktuell: Kalender abonnieren“.
- **Verlauf:** Anlegen, Erneuern und Beenden eines Abos stehen im Verlauf des Kontos, bei Admins auch im Admin-Protokoll.

### 4.5 So abonniert man (Text für die Anleitung im Hub)

Die Bezeichnungen können je nach Systemversion leicht abweichen.

- **iPhone und iPad (iOS und iPadOS 26):** Im Hub „Mit Apple Kalender abonnieren“ tippen und bestätigen. Von Hand: Kalender-App › Kalender › Kalender hinzufügen › Kalenderabo hinzufügen, Link einfügen, „Suchen“, Titel und Farbe wählen, als Account „iCloud“, „Fertig“. Unter iOS 18 heißt der Knopf „Abonnieren“, der Weg ist derselbe.
- **Mac:** Im Hub „Mit Apple Kalender abonnieren“ klicken, oder in Kalender › Ablage › Neues Kalenderabonnement den Link einfügen. Ort „iCloud“ (dann auf allen Geräten), „Automatisch aktualisieren“ auf die kürzeste Stufe, bei Bedarf den Haken bei „Entfernen: Hinweise“ herausnehmen.
- **Einmal reicht:** Mit Ort iCloud genügt ein Abo für alle Geräte. Wer zusätzlich auf jedem Gerät abonniert, sieht Termine doppelt. Termine, die früher über die Mail-Knöpfe eingetragen wurden, stehen in einem anderen Kalender und können gelöscht werden.
- **Google Kalender:** Weitere Kalender › Per URL, Link einfügen. Google aktualisiert Abos erfahrungsgemäß nur alle paar Stunden.
- **Outlook:** Kalender hinzufügen › Aus dem Web abonnieren, Link einfügen. Auch Outlook aktualisiert Abos erfahrungsgemäß langsamer als Apple.

### 4.6 Technik

- **Migration in `service-oalab`:** `hub_calendar_feeds` mit `id`, `user_id`, `token_hash` (eindeutig), `options` (jsonb), `created_at`, `last_fetched_at`, `last_client` (apple, google, microsoft, andere) und `revoked_at`. Keine Rechte für Logins: Lesen und Schreiben nur der Hub-Server mit der Service-Rolle nach Prüfung der Sitzung, wie bei `hub_claude_connections`.
- **Hub:**
  - `lib/hub-calendar/feed.ts`, eigenständig für `node --test`: Einträge aus Terminen, Zielen und Aufgaben, Kalenderkopf, Prüfsumme; nutzt `calendarEvent`, Maskierung und Faltung aus `links.ts`.
  - `lib/hub-calendar/feed-store.ts`: Schlüssel erzeugen, prüfen, beenden; das automatische Ende aus 4.2.
  - `app/api/calendar/feed/[token]/[file]/route.ts`.
  - Server Actions in `lib/hub-calendar/actions.ts`, Seitenleiste `components/hub/screens/calendar-feed.tsx`, Profilkarte, Mail-Vorlagen in `lib/hub-mail/templates.ts`.
- **Tests:** `tests/hub-calendar-feed.test.mjs` (Faltung, Maskierung, UTC, ganztägige Einträge, Status, Zeitraum, Inhalte je Rolle und Schalter, Schlüssel nur als Prüfsumme, falscher Schlüssel → 404) in `npm test`.
- **Datenschutz:** Die Datenschutzerklärung bekommt einen Absatz zum Kalender-Abo: was darin steht, dass der Link ohne Anmeldung funktioniert und geheim bleiben sollte, dass der gewählte Kalenderdienst (Apple iCloud, Google, Microsoft) die Termine auf Wunsch der Person abruft, und wie man das Abo beendet.
- **Messen nach dem Livegang:** Abstände der Abrufe je Programm (iCloud, iPhone direkt, Mac, Google, Outlook) aus `last_fetched_at` und dem Server-Log, damit die Anleitung realistische Zeiten nennt.

## 5. Etappe 2: belegte Zeiten aus iCloud und Microsoft 365 in den Hub (nur Team) – entfällt

Entfällt nach Entscheidung 10. Der Abschnitt bleibt als Hintergrund stehen, falls die Gegenrichtung später doch gewünscht ist; eine gebaute Fassung liegt im Verlauf (Abschnitt 11.3).

- **Wozu:** Kunden fragen Termine nur in freien Zeiten an (`hub_calendar_busy()` und die Verfügbarkeit). Termine, die das Team in iCloud oder in Microsoft 365 (Outlook) führt, kennt der Hub heute nicht; Anfragen in solche Zeiten sind möglich.
- **Wo:** Kalender › Verfügbarkeit, neuer Abschnitt „Andere Kalender berücksichtigen“. Admins hinterlegen dort ihre Quellen, beliebig viele aus iCloud und Microsoft 365; jede sperrt Zeiten für alle Anfragen.
- **Quelle iCloud:** Auf iCloud.com einen Kalender öffentlich machen (Kalender-Info › Öffentlicher Kalender › Link kopieren) und den Link im Hub einfügen. Apple sagt dazu, dass Abonnenten den Kalender sehen, aber nicht ändern können; wer den Link kennt, sieht also alle Einträge. Der Hub speichert ihn deshalb verschlüsselt (wie die Passwörter im Schlüsselbund, mit `HUB_VAULT_KEY`) und zeigt ihn nie wieder an.
- **Quelle Microsoft 365 (über Microsoft Graph, Entscheidung 9):** Der Hub fragt Frei/Belegt mit `getSchedule` ab, bis zu 20 Postfächer je Anfrage. Zurück kommen nur Beginn, Ende und Status, keine Titel, und es braucht keinen öffentlichen Link. Dafür einmalig eine App-Registrierung in Microsoft Entra ID mit der Anwendungsberechtigung `Calendars.ReadBasic`, in Exchange Online auf die Postfächer des Teams begrenzt (RBAC für Anwendungen). Mandanten-ID, Client-ID und Geheimnis trägt der Admin selbst in die Umgebung des Hubs ein; im Hub wählt man danach nur noch das Postfach. Persönliche Microsoft-Konten (Outlook.com) gehen so nicht.
- **Rückfall ohne App-Registrierung:** In Outlook den Kalender mit „Kann sehen, wann ich beschäftigt bin“ veröffentlichen und den ICS-Link wie bei iCloud einfügen; er enthält nur Belegt-Zeiten. Wie schnell Änderungen darin ankommen, dokumentiert Microsoft nicht; das wird vor dem Einbau gemessen.
- **Abruf** alle 10 Minuten, im Zeitplan, der heute alle 5 Minuten die Benachrichtigungen verschickt. ICS-Quellen liest eine geprüfte Bibliothek (etwa ical.js; Lizenz vor dem Einbau prüfen), weil wiederkehrende Termine, Ausnahmen und Zeitzonen sauber aufgelöst werden müssen.
- **Gespeichert** werden nur Beginn und Ende der nächsten 12 Wochen, ohne Titel, Ort oder Teilnehmer: die Quellen in `hub_calendar_sources` (Admin, Art, verschlüsselter Link oder Postfach, Regeln, letzter Abruf, letzter Fehler), die Zeiten in `hub_calendar_external_busy`, beide nur für die Service-Rolle. `hub_calendar_busy()` und die freien Zeiten beziehen sie ein; Kunden sehen wie bisher nur „Belegt“, Admins im Hub-Kalender graue Blöcke „Privat“.
- **Regeln je Quelle:** ganztägige Einträge ignorieren (Standard an, sonst sperren Geburtstage ganze Tage), als „frei“ markierte und abgesagte Einträge ignorieren. Termine des Hubs zählen nicht doppelt: Einträge mit der UID des Hubs (`…@hub.oalab.de`) überspringt der Hub. Frei/Belegt von Microsoft liefert keine UID mit; alte Kopien von Hub-Terminen aus den Mail-Knöpfen sollte das Team deshalb löschen, sobald das Abo läuft, sonst sperren sie nach einer Verschiebung die alte Zeit.
- **Störung:** Ist eine Quelle 24 Stunden nicht erreichbar, bekommt der Admin eine Meldung in der Glocke; bis dahin gelten die zuletzt gelesenen Zeiten.
- **Nicht empfohlen:** CalDAV mit app-spezifischem Passwort, denn es öffnet auch Mail und Kontakte der Apple-ID.

## 6. Etappe 3 (optional): Abgleich in Sekunden

Stand 22. November 2026 nicht geplant: Minuten bis etwa eine Stunde reichen (Entscheidungen 8 und 10). Kommt sie später, braucht sie eine eigene App-Registrierung in Microsoft Entra ID.

- **Microsoft 365:** App-Registrierung in Microsoft Entra ID mit Kalenderrechten, begrenzt auf die Postfächer des Teams. Der Hub legt bestätigte Termine im Outlook-Kalender des zuständigen Admins an, ändert und löscht sie sofort, mit Teams-Meeting; der Teams-Link kommt von selbst in den Hub. Microsoft meldet Änderungen in Outlook per Webhook. Termine mit Kunden bleiben im Hub führend; aus Outlook übernimmt der Hub nur Frei/Belegt und weist auf Abweichungen hin. Apple Kalender zeigt das Microsoft-Konto auf iPhone und Mac mit Push.
- **iCloud direkt (Weg C)** nur, wenn die Kalender des Teams in iCloud liegen und Sekunden wirklich nötig sind; dafür bräuchte der Hub ein app-spezifisches Passwort im Schlüsselbund.

## 7. Etappen und Umfang

| Etappe | Inhalt | Umfang |
|---|---|---|
| **1 Kalender-Abo** | Tabelle, Abo-Route, Seitenleiste, Profilkarte, Mail-Hinweis, Datenschutz, Tests, Messung | mittel: ein PR in `service-oalab`, einer im Hub |
| **2 Belegt aus iCloud und Microsoft 365** | Quellen in der Verfügbarkeit (iCloud-Link, Postfach in Microsoft 365), App-Registrierung, Abruf, Speicher, Einbezug in `hub_calendar_busy()` und freie Zeiten | entfällt (Entscheidung 10) |
| **3 Microsoft 365** | Termine schreiben, Teams-Meetings, Webhooks | groß, eigener Plan; derzeit nicht nötig |

## 8. Entscheidungen

Alle Entscheidungen sind am 22. November 2026 getroffen:

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Etappe 1 bauen: Kalender-Abo für Admins, Kunden und Freelancer? | Ja, für alle drei Rollen |
| 2 | Standard-Inhalt bestätigte Termine und offene Anfragen, Ziele und Aufgaben wählbar? | Ja |
| 3 | Teams-Link ins Abo? Er steht heute schon in den Mail-Dateien; ohne ihn fehlt am Handy das Wichtigste. Die Lobby in Teams schützt zusätzlich. | Ja |
| 4 | Abo für Admins und Freelancer nur mit bestätigtem Code anlegen? | Ja |
| 5 | Link nur einmal zeigen (nur die Prüfsumme gespeichert), danach „Neuen Link erzeugen“? | Ja |
| 6 | In Termin-Mails für Abonnenten einen Satz statt der vier Knöpfe? | Ja |
| 7 | Wo liegen die Kalender des Teams? | In iCloud und in Microsoft 365 (Outlook); hinfällig mit Entscheidung 10 |
| 8 | Etappe 3 nur, wenn Minuten Verzug stören oder Teams-Links automatisch kommen sollen? | Ja; Minuten bis etwa eine Stunde reichen, Etappe 3 ist derzeit nicht nötig |
| 9 | Microsoft 365 über eine App-Registrierung mit `Calendars.ReadBasic` lesen, begrenzt auf die Postfächer des Teams, statt über veröffentlichte Kalender? | Hinfällig mit Entscheidung 10 |
| 10 | Etappe 2 überhaupt bauen (belegte Zeiten aus iCloud und Microsoft 365, App-Registrierung in Entra ID)? | Nein (22. November 2026, nach dem Bau): Gewünscht ist nur ein Kalender, den man in Apple Kalender und Outlook abonniert; wer den Link hat, kann ihn abonnieren. Etappe 2 ist wieder entfernt, Abschnitt 10 entfällt |

## 9. Abnahme Etappe 1

- iPhone mit iOS 26 und Mac: per Knopf abonnieren, Ort iCloud. Termin im Hub anlegen, verschieben, absagen: Er erscheint, verschiebt sich und verschwindet. Die Zeiten bis dahin werden notiert.
- Ein Kunde sieht nur seine eigenen Termine, ein Freelancer nur seine eigenen.
- Falscher oder beendeter Link: 404. Nach „Neuen Link erzeugen“ geht der alte nicht mehr.
- Deaktivierter Zugang: Das Abo liefert nichts mehr.
- Google Kalender und Outlook: Das Abo funktioniert; Abstände notieren.
- Seitenleiste und QR-Code in hell und dunkel sowie in Handy-Breite lesbar.

## 10. Abnahme Etappe 2 – entfällt

Entfällt mit Entscheidung 10.

## 11. Umsetzung (22. November 2026)

### 11.1 Was gebaut ist

Tabelle `hub_calendar_feeds` (nur Prüfsumme, Rolle beim Anlegen, Inhalte, letzter Abruf und Programm, Zähler je Stunde, Ende). Abo-Adresse `app/api/calendar/feed/[token]/[file]` (GET und HEAD, ETag und 304, 429 ab 60 Abrufen je Stunde, 404 für falsche und beendete Schlüssel); sie braucht keine Anmeldung, wer den Link hat, kann ihn abonnieren. Knopf „Abonnieren“ im Kalenderkopf, Fenster „Kalender abonnieren“ mit den drei Schritten der Vorschau (Apple Kalender, Google, Outlook, Link kopieren, QR-Code, Anleitung je Gerät), Karte „Kalender-Abo“ im Profil, Satz in Termin-Mails für Abonnenten, Absatz in der Datenschutzerklärung. Das Abo endet beim Rücksetzen des zweiten Faktors, beim Deaktivieren und beim Rollenwechsel durch einen Admin sofort, sonst beim nächsten Abruf (Zugang nicht aktiv, gesperrt, andere Rolle, 180 Tage ohne Abruf).

### 11.2 Abweichungen vom Plan

- **Code beim Anlegen:** Statt eines eigenen Code-Fensters führt „Mit Code bestätigen“ über die vorhandene Bestätigungsseite des Hubs und zurück zum offenen Abo-Fenster (`?abo=1`), wie bei den Aufgaben im Kalender.
- **„Abo beenden“ und „Neuen Link erzeugen“** fragen im Fenster selbst nach (wie „Endgültig löschen“ bei Terminen), nicht in einem eigenen Dialog.
- **Outlook und Google:** Für das Abonnieren gibt es keinen dokumentierten Direktlink. Die Knöpfe öffnen Googles `cid=`-Link bzw. Outlooks „Aus dem Web abonnieren“ und kopieren den Link zusätzlich, damit man ihn notfalls einfügt.

### 11.3 Etappe 2 gebaut und wieder entfernt

Etappe 2 war auf `feat/kalender-abo` gebaut (Commit `adb0b8c`, dazu Migration 202611220002 in `service-oalab`, Commit `c8fa6fb`) und ist nach Entscheidung 10 wieder entfernt. Soll die Gegenrichtung später doch kommen, lässt sie sich aus diesen Commits zurückholen. Die Meldungsart `calendar.source`, die die Migration der Notizen (`202611221002`) schon erlaubt, bleibt dann ungenutzt; das schadet nicht.

### 11.4 Livegang

Erst die Migration 202611220001 in `service-oalab` einspielen, dann den Hub ausrollen. Ohne Migration sagt der Hub freundlich, dass die Erweiterung der Datenbank fehlt; die Abo-Adresse antwortet dann mit 503.
