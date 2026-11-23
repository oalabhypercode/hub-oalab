# Planung: Änderungen im Chat mitteilen und eine aufgeräumte Glocke

Stand 23. November 2026 · Plan, noch nichts gebaut · Entscheidungen offen (Abschnitt 7)

Dieser Plan beschreibt vier Wünsche vom 23. November 2026:

1. **Änderungen landen im Chat.** Was oalab für einen Kunden ändert, etwa ein neuer Termin, soll von selbst im privaten Chat zwischen Kunde und oalab unter „Nachrichten“ erscheinen, damit der Kunde es dort direkt sieht. Welche Arten von Änderungen das sind, lässt sich je Chat abonnieren.
2. **Die Glocke zeigt nur, was neu ist.** Gelesene Meldungen verschwinden.
3. **Die Zeit steht links** neben dem Symbol statt unter dem Text.
4. **Das Fenster der Glocke wächst mit dem Bildschirm.**

Abschnitt 1 erklärt, warum die Glocke heute alles zeigt. Die Glocke (Wünsche 2 bis 4) ist Etappe 1 und kommt ohne Datenbank aus. Der Chat (Wunsch 1) ist Etappe 2. Ein echter Terminvorschlag, den der Kunde im Chat annimmt, ist Etappe 3.

Grundlage ist der Code auf `main` vom 23. November 2026 (nach #157) und die Tabellen der Glocke und des Chats in `service-oalab` (Migrationen `202610300001_hub_notifications` und `202611040001_hub_private_chat`).

## Feste Regel: Nachrichten im Hub und Service bleiben getrennt

- Die Nachrichten im Hub (der private Chat unter „Nachrichten“, Reiter „Privat“) sind reine Kommunikation mit oalab: unbegrenzt und ohne Berechnung. Die Serviceplattform rechnet je Anfrage ab und hängt an Abrechnung und KI. Beides bleibt bei jeder Änderung strikt getrennt (Vorgabe vom 23. November 2026, gilt für alle künftigen Änderungen).
- Für diesen Plan heißt das: Karten, Abos, Meldungen und die Glocke betreffen nur den Hub. Nichts davon schreibt in Anfragen oder Gespräche der Serviceplattform, legt dort eine Anfrage an, zählt auf das Service-Kontingent oder stößt deren KI an. Umgekehrt kommt nichts aus der Serviceplattform als Nachricht oder Karte in den Chat des Hubs.
- Heute liest der Hub die Anfragen der Serviceplattform nur: Admins sehen sie unter „Nachrichten“ im Reiter „Service“, Claude mit `list_conversations` und `read_conversation` (Art `service`). Geschrieben wird aus dem Hub nur in den privaten Chat. Ob der Reiter „Service“ aus „Nachrichten“ herauszieht, ist Entscheidung 15.

## Auf einen Blick

| Frage | Vorschlag |
|---|---|
| Warum zeigt die Glocke alles? | Sie ist als Verlauf gebaut: Sie lädt die 30 neuesten Meldungen, gelesen oder nicht, und „gelesen“ macht nur die Schrift dünner (Abschnitt 1) |
| Glocke | nur ungelesene Meldungen; Anklicken, ein Haken am Ende der Zeile und „Alle als gelesen markieren“ lassen sie verschwinden, „Rückgängig“ holt sie zurück; Gelesenes steht weiter in der Übersicht unter „Früher“ |
| Zeit | eigene Spalte ganz links vor dem Symbol: oben der Tag („Heute“, „Gestern“, „Mo.“, „22. Nov.“), darunter die Uhrzeit |
| Fenster | wächst mit: etwa 62 % der Fensterbreite, 760 bis 1280 px breit, und so hoch, wie der Bildschirm Platz hat; nur die Liste scrollt |
| Chat | jede Änderung, die der Kunde heute in der Glocke erfährt, kann zusätzlich als Karte im Chat stehen: Termine, Dateien, Notizen, Aufgaben, Projekte, neu auch Vertrag & Domain |
| Abonnieren | je Chat ein Knopf „Abos“ mit einem Schalter je Bereich; gilt für alle in diesem Chat |
| Terminanfragen | stehen als Karte im Chat; Admins bestätigen dort direkt und hören in Glocke und Telegram davon |
| Terminvorschlag | Etappe 3: oalab schlägt bis zu drei Zeiten vor, der Kunde nimmt eine im Chat an |
| Service | bleibt strikt getrennt: Nichts aus diesem Plan schreibt in die Serviceplattform oder zählt auf ihr Kontingent |
| Umfang | Etappe 1 klein (ein PR, keine Datenbank); Etappe 2 mittel bis groß (Migration in `service-oalab` und ein PR); Etappe 3 mittel (Migration und ein PR) |

## 1. Befund: Warum die Glocke alle Meldungen zeigt

- **Die Glocke ist als Verlauf gebaut, nicht als Posteingang.** `loadInbox()` in `lib/hub-notify/server.ts` lädt die 30 neuesten Meldungen der Person, gelesene wie ungelesene, und `components/hub/notifications-panel.tsx` zeigt alle davon. „Gelesen“ ändert nur zwei Kleinigkeiten: Der Titel ist nicht mehr fett, und an der Uhrzeit fehlt das farbige „· neu“. Nach „Alle als gelesen markieren“ bleibt die Liste deshalb gleich lang und sieht fast gleich aus.
- Die Markierung selbst funktioniert: Sie wird gespeichert, und die Zahl an der Glocke geht zurück. Es ist kein Speicherfehler, sondern eine Frage der Darstellung. Die Übersicht geht ebenfalls davon aus; gibt es mehr gelesene Meldungen, als sie unter „Früher“ zeigt, steht dort heute „Ältere Benachrichtigungen findest du in der Glocke oben rechts.“
- **Dabei fallen zwei kleinere Fehler auf:**
  - Die Zahl an der Glocke zählt alle ungelesenen Meldungen, die Liste zeigt aber nur die 30 neuesten. Kommen 30 neuere hinzu, fällt eine ältere ungelesene aus der Liste, obwohl die Glocke sie weiter zählt. Man findet sie dann nicht mehr und wird sie nur mit „Alle als gelesen markieren“ los.
  - Das Fenster übernimmt den Lesestand einmal beim Öffnen. Liest man dieselbe Meldung währenddessen in einem zweiten Tab oder auf einem anderen Gerät, bleibt sie im offenen Fenster fett, bis man es schließt.

## 2. Etappe 1: Die Glocke zeigt nur, was neu ist

Das Fenster behält sein Glas, seine Schrift, die Symbole und die drei Spalten aus „Glocke V3“, hell wie dunkel. Neu sind die Zeitspalte links, der Haken am Ende der Zeile und die Größe.

### 2.1 Nur Ungelesenes

- Die Glocke zeigt nur noch ungelesene Meldungen, die neueste oben. Jede Zeile sieht aus wie heute eine ungelesene (Titel fett); das „· neu“ entfällt, weil in der Glocke nur noch Neues steht.
- Eine Meldung gilt als gelesen und verschwindet,
  - wenn man sie anklickt (öffnet wie heute die passende Seite),
  - neu: wenn man den runden Haken am Ende der Zeile klickt („Als gelesen markieren“); das Fenster bleibt offen. Am Rechner erscheint der Haken beim Darüberfahren und mit der Tastatur, am Handy und Tablet steht er immer da,
  - wenn man „Alle als gelesen markieren“ klickt,
  - wenn man sie in der Übersicht anklickt oder mit × ausblendet,
  - bei Chat-Meldungen wie heute, sobald man den Chat öffnet.
- Die Zeile gleitet kurz aus der Liste (etwa 0,2 s wie das × in der Übersicht, mit „Bewegung reduzieren“ sofort), und die Zahl an der Glocke zählt mit.
- Danach steht unten einige Sekunden „Als gelesen markiert · Rückgängig“ (Entscheidung 3). „Rückgängig“ holt die Zeilen zurück und macht sie wieder ungelesen, auch nach „Alle als gelesen markieren“.
- Ist nichts mehr ungelesen, zeigt die Glocke den heutigen Zustand „Du bist auf dem neuesten Stand.“ mit dem Text je Rolle, darunter neu einen Link „Frühere Benachrichtigungen in der Übersicht“.
- Gelesenes geht nicht verloren: Die Übersicht zeigt wie heute unter „Neu“ das Ungelesene und unter „Früher“ die letzten acht gelesenen Meldungen.
- Die Glocke lädt alle ungelesenen Meldungen, bis 100; darüber steht unten „und 23 weitere“, und „Alle als gelesen markieren“ gilt für alle. Damit stimmen Zahl und Liste immer überein.
- Gilt für Admins, Kunden und Freelancer, am Rechner, Tablet und Handy, und in der Designvorschau unter `/preview`.

### 2.2 Die Zeit steht links neben dem Symbol

Jede Zeile bekommt ganz links eine schmale Spalte für die Zeit, vor dem Symbol: oben der Tag, darunter die Uhrzeit, beide rechtsbündig zum Symbol hin, in Ziffern gleicher Breite und in der Farbe für Nebentext. Die Zeit unter dem Text entfällt.

| Wann | oben | unten |
|---|---|---|
| heute | Heute | 09:40 |
| gestern | Gestern | 17:05 |
| in den letzten sieben Tagen | Mo. | 11:20 |
| früher in diesem Jahr | 22. Nov. | 09:40 |
| in einem früheren Jahr | 22.11.25 | 09:40 |

- Alles in deutscher Zeit (Europe/Berlin), auch wenn das Gerät anders eingestellt ist. Fährt man mit der Maus darüber, nennt der Hinweis das volle Datum mit Uhrzeit.
- Am Rechner (ab 641 px Breite): Zeit · Symbol mit Kunde oder Bereich · Nachricht · Von · Haken.
- Am Handy (bis 640 px): Die Zeit bleibt links als schmale Spalte über die ganze Höhe der Zeile. Rechts daneben stehen wie heute untereinander Symbol mit Ort, Nachricht und Von, der Haken oben rechts.

```
 Heute    (▣)  Nordlicht Studio                    Aufgabe geändert                     Mara         ( ✓ )
 09:40         Website-Relaunch › #12 Startseite   Status: Review · Fällig: 27. Nov.    Freelancer
 ──────────────────────────────────────────────────────────────────────────────────────────────────────
 Gestern  (▣)  Dateien                             Neue Datei                           oalab        ( ✓ )
 17:05                                             logo-final.svg                       Team
```

### 2.3 Das Fenster wächst mit dem Bildschirm

- **Breite:** heute höchstens 760 px. Neu etwa 62 % der Fensterbreite, mindestens 760 px (wo so viel Platz ist) und höchstens 1280 px. Die Spalten wachsen mit: „Wo“ von 220 bis 300 px, „Von“ von 120 bis 180 px, die Nachricht bekommt den Rest.
- **Höhe:** Heute endet die Liste bei 520 px, das sind etwa sechs Meldungen. Neu reicht das Fenster bis 32 px an den oberen und unteren Rand. Überschrift und „Alle als gelesen markieren“ bleiben stehen, nur die Liste scrollt. Mit wenigen Meldungen bleibt das Fenster so klein wie nötig.
- Unter 641 px bleibt es wie heute: volle Breite mit 16 px Rand.

Richtwerte, gemessen am Browserfenster mit Leiste:

| Bildschirm | Breite heute | Breite neu | sichtbare Meldungen heute → neu |
|---|---|---|---|
| iPad hochkant (820 px) | 760 px | 760 px | etwa 6 → 12 |
| MacBook Pro 14″ (1512 × 982) | 760 px | rund 940 px | etwa 6 → 9 |
| Full HD (1920 × 1080) | 760 px | rund 1190 px | etwa 6 → 11 |
| 4K, skaliert (2560 × 1440) | 760 px | 1280 px | etwa 6 → 16 |
| 4K bei 100 % (3840 × 2160) | 760 px | 1280 px | etwa 6 → 27 |

### 2.4 Übersicht, Hilfe und Texte

- Übersicht: Der Satz „Ältere Benachrichtigungen findest du in der Glocke oben rechts.“ wird zu „Ältere gelesene Benachrichtigungen zeigt der Hub nicht mehr an.“ Das × blendet eine Meldung wie bisher aus; weil es sie als gelesen markiert, verschwindet sie damit auch aus der Glocke.
- Wissen des Assistenten (`lib/hub-assistant/knowledge.ts`, Absätze zu Glocke und Übersicht) und `/hub-hilfe` (`.claude/commands/hub-hilfe.md`).
- Patch Notes: „Verbessert: Die Glocke zeigt nur Neues“ für Admins, Kunden und Freelancer.

### 2.5 Technik

- `lib/hub-notify/server.ts`, `loadInbox()`: zwei Abfragen statt einer, alle ungelesenen (höchstens 100) und die 30 neuesten insgesamt (für „Früher“ in der Übersicht), nach `id` zusammengeführt, neueste zuerst. Die Live-Prüfung (`liveVersion`, `app/api/live/route.ts`) bleibt, wie sie ist: Ihre zehn neuesten Zeilen stecken in der zusammengeführten Liste, also rechnen Seite und Server weiter denselben Wert. Lüde die Glocke nur noch Ungelesenes, müsste die Live-Prüfung mitwandern, sonst lädt die Seite alle 15 Sekunden neu.
- `components/hub/notifications-panel.tsx`: zeigt die Meldungen ohne die gelesenen und ohne die eben markierten. Der Lesestand kommt aus den Daten der Seite plus den eben markierten; das behebt den zweiten Fehler aus Abschnitt 1. Die Zeile bleibt ein Link, der Haken steht daneben als eigener Knopf (kein Knopf im Link). Dazu das Ausblenden, die Leiste „Rückgängig“ und der Link im leeren Zustand.
- `lib/hub-notify/actions.ts`: neu `markNoticesUnread(ids)` für „Rückgängig“. Die Rechte erlauben das schon heute: Jeder Login darf `read_at` seiner eigenen Meldungen ändern.
- Neue reine Funktion für die Zeitspalte (Tag und Uhrzeit in deutscher Zeit) in `lib/hub-notify/columns.ts`.
- `app/glass.css`: `.hub-modal.notifications-modal` mit mitwachsender Breite und als Spalte aus Kopf, Liste und Fuß; `.notice-list` ohne die 520 px, sie füllt die Höhe und scrollt; `.notice-row` mit Zeit- und Hakenspalte; Raster am Handy; Ausblenden.
- `components/hub/notification-center.tsx`: der Satz unter „Früher“.
- Designvorschau: Die Beispiel-Meldungen bekommen Zeiten von heute, gestern, einem Wochentag und einem älteren Datum.
- Tests (`node --test`): Zeitspalte um Mitternacht, zum Jahreswechsel und beim Wechsel von Sommer- und Winterzeit; Zusammenführen von ungelesenen und neuesten Meldungen; gleiche Live-Version auf Seite und Server.
- Keine Migration, kein `service-oalab`.

## 3. Etappe 2: Änderungen im Chat mitteilen und abonnieren

### 3.1 Heute

- Unter „Nachrichten“ hat jeder Kunde einen privaten Chat mit oalab, einen für die ganze Firma: Alle Logins des Kunden und das oalab-Team lesen mit. Freelancer haben ihren eigenen Chat mit oalab. Im Chat steht nur, was Menschen schreiben.
- Was oalab ändert, erfährt der Kunde in der Glocke und etwa eine Viertelstunde später in einer gebündelten Mail, Termine zusätzlich im Kalender-Abo, wer es eingerichtet hat. Das Team erfährt jede Nachricht eines Kunden zusätzlich über Telegram.
- Ein neuer Termin steht deshalb in Glocke und Mail, aber nicht im Chat. Wer im Chat gerade „Passt dir Dienstag?“ liest, sieht dort nicht, dass der Termin längst eingetragen ist.
- Terminanfragen von Kunden meldet der Hub dem Team weder in der Glocke noch per Mail oder Telegram. Sie stehen nur im Kalender im Streifen „offene Anfragen“, in der Kundenliste und in der Übersicht der Admins unter „Neu“.
- Unter „Vertrag & Domain“ (Verlauf, Domains, E-Mail-Adressen, Pakete) löst heute keine Änderung eine Meldung aus.
- Für den Bau gut: Jede Änderung, die einen Kunden heute erreicht, läuft durch eine Stelle, die Meldungen in `lib/hub-notify/server.ts`. Dort ist schon entschieden, wer sie sehen darf, etwa „Sichtbar für“ bei Dateien oder „Nur Team“ bei Aufgaben. Kalender, Dateien, Notizen und Aufgaben schreiben über dieselben Wege, ob im Hub, mit dem Assistenten oder mit Claude.

### 3.2 Die Idee

- Der Chat bekommt neben Nachrichten eine zweite Art von Einträgen: **Karten für Änderungen**. Jede Meldung, die ein Kunde heute in der Glocke bekommt, kann zusätzlich als Karte in seinem Chat erscheinen, zu der Zeit, zu der sie passiert ist.
- So wird der Chat der gemeinsame Verlauf zwischen Kunde und oalab. Die Glocke bleibt die Liste dessen, was noch neu ist (Etappe 1).
- Was in einen Chat kommt, bestimmen die **Abos dieses Chats**: ein Schalter je Bereich (Abschnitt 3.5).
- Weil die Karten an den Meldungen hängen, gilt das für jede Änderung, auch für künftige: Wer eine neue Art von Meldung einführt, ordnet sie einem Bereich zu, und sie kann in den Chat.

### 3.3 Was in den Chat kommt

| Bereich | Änderung | Karte im Chat | heute in der Glocke |
|---|---|---|---|
| Termine | neuer Termin mit dem Kunden | „Neuer Termin“ mit Tag, Uhrzeit, Dauer und Teams-Link; „Im Kalender öffnen“ und „In meinen Kalender“ (Apple, Google, Outlook, .ics wie in der Mail) | Kunde |
| Termine | Anfrage bestätigt, auch mit neuer Zeit | „Termin bestätigt“ | Kunde |
| Termine | Termin verschoben | „Termin verschoben“ mit alter und neuer Zeit | Kunde |
| Termine | Termin abgesagt, Anfrage abgelehnt | mit dem Grund, etwa einem Gegenvorschlag | Kunde |
| Termine | **neu:** Terminanfrage des Kunden | Karte auf der Seite des Kunden; Admins sehen darin „Bestätigen“ und „Im Kalender beantworten“ | niemand (neu: Admins) |
| Termine | **neu:** Anfrage zurückgezogen | kurze graue Zeile | niemand |
| Dateien | neue Datei für den Kunden, auch mehrere auf einmal | „Neue Datei“ oder „3 neue Dateien“ mit den Namen; „Öffnen“ | Kunde |
| Notizen | Notiz freigegeben, „Änderung mitteilen“ | „Neue Notiz“ oder „Notiz geändert“ mit dem Titel; „Öffnen“ | Kunde |
| Aufgaben | „Du bist am Zug“, neue Aufgabe, sichtbare Änderung | Projekt › Aufgabe und was sich geändert hat; „Öffnen“ | Kunde |
| Projekte | Status oder Zieltermin geändert | „Projekt aktualisiert“ | Kunde |
| Vertrag & Domain | **neu:** neuer Eintrag im Verlauf, Domain oder E-Mail-Adresse angelegt oder geändert, Paket geändert | „Neu unter Vertrag & Domain“ mit dem Eintrag; „Öffnen“; nie Passwörter oder Zugangsdaten | niemand (neu: Kunde) |

Nie in den Chat kommt, was nur das Team sieht („Nur Team“, nicht freigegebene Notizen, Dateien nur für Freelancer), interne Termine ohne Kunde, Registrierungen und die Hinweise für Admins in der Übersicht. Die Regel: Eine Karte gibt es nur, wenn der Kunde dieselbe Änderung auch in der Glocke bekommt.

Freelancer-Chats (Entscheidung 11) bekommen dieselben Karten für das, was ein Freelancer heute in der Glocke erfährt: Dateien für ihn und seine Kunden, Aufgaben in seinen Projekten, Freigaben bei Kunden und Antworten auf seine Terminanfragen.

### 3.4 So sieht eine Karte aus

```
  Lena von oalab
  ┌──────────────────────────────────────────────┐
  │ (▣) Neuer Termin                             │
  │     Abstimmung Texte                         │
  │     Di., 24. Nov. · 10:00–10:30 · Teams      │
  │     ( Im Kalender öffnen ) ( In meinen … )   │
  │                                        09:41 │
  └──────────────────────────────────────────────┘
```

- Eine Karte steht im Verlauf wie eine Nachricht von oalab: beim Kunden links, mit dem Vornamen der Person, die die Änderung gemacht hat („Lena von oalab“), bei Admins rechts. Was das Studio von selbst meldet (Projektstatus, „Du bist am Zug“), kommt von „oalab“. Eine Terminanfrage steht auf der Seite des Kunden, mit seinem Namen.
- Aufbau: Symbol in der Farbe des Bereichs wie in der Glocke, eine kurze Überschrift, darunter das Wichtigste in zwei, drei Zeilen, unten ein oder zwei runde Knöpfe. Uhrzeit und Lesehäkchen wie bei Nachrichten. Glas und Farben folgen dem Chat, hell wie dunkel.
- Der Stand bleibt aktuell: Ist ein Termin inzwischen bestätigt, verschoben oder abgesagt, trägt seine ältere Karte ein kleines Schild („bestätigt“, „verschoben“, „abgesagt“); die Änderung selbst steht als neue Karte darunter.
- Auf eine Karte antwortet man wie auf jede Nachricht.
- In der Liste der Chats steht eine Karte als eine Zeile Text, etwa „Neuer Termin: Abstimmung Texte, Di., 24. Nov., 10:00“.
- Mehrere Dateien auf einmal oder mehrere Änderungen an derselben Aufgabe werden zu einer Karte, solange sie die letzte im Chat ist und die andere Seite sie noch nicht gesehen hat, so wie die Glocke heute Zeilen zusammenfasst.

### 3.5 Abonnieren

- Im Kopf jedes Chats, links neben „Privat“, steht ein runder Glasknopf „Abos“ (Glocke mit Plus). Er öffnet ein kleines Glasfenster „Im Chat mitteilen“ mit je einem Schalter: Termine, Dateien, Notizen, Aufgaben, Projekte, Vertrag & Domain. Darunter: „Gilt für alle in diesem Chat. Die Glocke meldet weiterhin alles.“
- Ein Abo gilt für den ganzen Chat, weil alle denselben Verlauf sehen. Admins stellen es je Kunde ein, Kunden für ihren Chat (Entscheidung 6). Jede Änderung steht als graue Zeile im Chat („Jana Sommer hat Aufgaben abonniert“), damit beide Seiten wissen, warum Karten kommen oder ausbleiben. Diese Zeilen zählen nicht als neue Nachricht.
- Voreinstellung für alle Chats, bestehende wie neue (Entscheidung 7): Termine, Dateien, Notizen, Projekte und Vertrag & Domain an, Aufgaben aus, weil sich Aufgaben oft ändern.
- Ein Abo gilt ab dem Einschalten; frühere Änderungen erscheinen nicht nachträglich.
- Später möglich, nicht Teil dieses Plans: einzelne Dinge abonnieren, etwa „Diesem Projekt folgen“. Die Tabelle der Abos ist dafür vorbereitet (Abschnitt 3.7).

### 3.6 Zusammenspiel mit Glocke, Mail, Telegram und Kalender-Abo

- **Glocke:** Eine Karte erzeugt keine zusätzliche Meldung „Neue Nachricht von oalab“. Der Kunde bekommt für eine Änderung eine Meldung, nicht zwei.
- **Gesehen ist gelesen** (Entscheidung 8): Öffnet jemand den Chat, gelten die Meldungen zu den Karten darin als gelesen und verschwinden aus seiner Glocke.
- **Nachrichten-Zahl:** Eine neue Karte von oalab macht den Chat für den Kunden ungelesen, wie eine Antwort. Die Zahl an „Nachrichten“ in Sidebar und Tab-Leiste zeigt das; so sieht der Kunde die Änderung direkt.
- **Mail:** unverändert. Die gebündelte Mail bleibt die Aufzeichnung jeder Änderung (Entscheidung vom 30. Oktober 2026), mit den Kalender-Knöpfen.
- **Telegram:** meldet wie bisher jede Nachricht eines Kunden, neu auch Terminanfragen (Entscheidung 9). Der Hinweis im Chat und die Datenschutzerklärung (Abschnitt Nachrichten) nennen das.
- **Admins** bekommen für Terminanfragen eine Meldung in der Glocke („Neue Terminanfrage von Nordlicht Studio“).
- **Kalender-Abo:** unverändert.

### 3.7 Technik

Datenbank (Migration in `service-oalab`, als Import in Coolify vor dem PR des Hubs):

- `hub_private_messages` bekommt zwei Spalten, die bei normalen Nachrichten leer bleiben: `event` (jsonb: Art, Bereich, Bezug wie Termin-, Datei-, Notiz-, Aufgaben- oder Projekt-ID, der Text der Karte und ihr Link) und `event_key` (eindeutig je Chat, damit eine wiederholte Runde keine doppelte Karte schreibt). `body` trägt die Karte als eine Zeile Text; so zeigen Liste und Claude sie ohne Umbau. `author_id` ist die Person, die die Änderung gemacht hat, leer bei Änderungen aus dem Studio.
- Karten schreibt nur der Server mit dem Server-Schlüssel, so wie Meldungen. Die Rechte der Logins bleiben: Sie dürfen weiter nur `customer_id`, `side`, `body` und `client_id` einfügen, eine Karte können sie also nicht fälschen.
- Neue Tabelle `hub_chat_subscriptions` mit `customer_id`, `subject` (etwa `area:appointments`, später auch `project:<id>`), `enabled`, `updated_by` und `updated_at`; Schlüssel aus Kunde und Subjekt. Zeilenrechte: Admins alles, die Logins eines Kunden lesen und ändern die Abos ihres Chats. Ohne Zeile gilt die Voreinstellung.
- `hub_inbox`: neue Meldungsarten `appointment.requested` (an Admins) und `contract.changed` (Vertrag & Domain, an Kunden) in der Prüfung der erlaubten Arten.

Hub:

- `lib/hub-chat-events/rules.ts` (rein, mit Tests): Bereiche und Voreinstellung, welche Meldungsart zu welchem Bereich gehört, wie aus einer Meldung eine Karte wird (Überschrift, Zeilen, Link, Schlüssel, Textzeile) und wann Karten zusammengefasst werden.
- `lib/hub-chat-events/server.ts`: `postChatEvent(…)` liest die Abos des Chats und schreibt die Karte oder fasst sie mit der letzten zusammen. Wirft nie: Eine Karte, die nicht geschrieben werden kann, bricht die Änderung nicht ab; im Server-Log stehen nur Art und Code.
- Angeschlossen in `lib/hub-notify/server.ts`, dort, wo schon entschieden ist, dass der Kunde die Meldung bekommt: `notifyCustomers` (Termine, mit der Person, die geändert hat), `notifyFileShared` und `notifyFilesShared` (nur Dateien, die der Kunde sieht), `notifyNote` (nur bei Freigabe für den Kunden), `notifyTaskChange` (nur der Teil für Kunden) und `collectStudioNotices` („Du bist am Zug“, Projektstatus). So kommt alles, was die Glocke des Kunden erreicht, auch in den Chat, und nichts, was nur das Team sieht.
- `lib/hub-calendar/write.ts`: `requestAppointmentAs` und `withdrawRequestAs` schreiben die Karte auf der Seite des Kunden, die Meldung an die Admins und die Zeile für Telegram. „Bestätigen“ in der Karte bestätigt die Anfrage so, wie sie gestellt ist (neue Aktion auf Basis von `writeAppointment`); für eine andere Zeit oder eine Absage führt „Im Kalender beantworten“ in den Kalender.
- `lib/hub-contracts/write.ts` und `lib/hub-domains/write.ts`: Meldung und Karte für Einträge, die der Kunde sieht.
- Lesen: `lib/hub-private-chat/server.ts` liest `event` mit, `PrivateChatMessage` bekommt das Feld `event`. Für die Schilder an Terminkarten liest der Hub den aktuellen Stand der Termine dieses Chats in einer Abfrage nach. `markPrivateRead` markiert zusätzlich die Meldungen des Lesers, deren Link zu einer Karte im Chat gehört (Entscheidung 8). Die Regel für „ungelesen“ (`chatUnread`) überspringt die grauen Abo-Zeilen.
- Oberfläche: `components/hub/screens/private-chat.tsx` mit der Karte, dem Knopf „Abos“ und seinem Fenster; Stile bei den Chat-Stilen in `app/glass.css`.
- Claude-Verbindung (`lib/hub-mcp/areas.ts`): Karten erscheinen in `read_conversation` als Zeile mit „[Hub]“ davor.
- Designvorschau: Beispielkarten in `lib/hub-private-chat/fixtures.ts`.
- Wissen des Assistenten, `/hub-hilfe`, Hinweis im Chat und Datenschutzerklärung (Telegram), Patch Notes.
- Trennung von Service: kein Aufruf der Serviceplattform und kein Schreiben in ihre Tabellen; `lib/hub-conversations` und der Reiter „Service“ bleiben unberührt. Ein Test prüft, dass die neuen Module nichts aus `lib/hub-conversations` und keine Adresse der Serviceplattform verwenden.

## 4. Etappe 3: Termine vorschlagen und im Chat annehmen

### 4.1 Heute

Einen echten Terminvorschlag gibt es noch nicht. Legt ein Admin einen Termin mit einem Kunden an, ist er sofort „Bestätigt“. Kunden können nur selbst anfragen; einen Gegenvorschlag schreibt oalab heute als Grund in die Absage. Etappe 2 bringt jeden Termin als Karte in den Chat; zustimmen kann der Kunde dort aber noch nicht.

### 4.2 Neu

- Im Fenster „Neuer Termin“ steht neben „Speichern“ ein zweiter Knopf „Vorschlagen“, sobald ein Kunde gewählt ist. oalab trägt bis zu drei Zeiten ein (Entscheidung 13).
- Der Vorschlag kommt immer als Karte „Terminvorschlag“ in den Chat, auch ohne Abo „Termine“, weil er eine Antwort braucht, und in die Glocke. Der Kunde tippt die passende Zeit an („Annehmen“). „Keine passt“ öffnet das bekannte Fenster „Termin anfragen“.
- Danach zeigt die Karte „Angenommen: Di., 24. Nov., 10:00 · Jana Sommer“. Der Termin ist bestätigt, die anderen Zeiten sind wieder frei. Der Kunde bekommt wie heute die Bestätigung mit den Kalender-Knöpfen, das Team eine Meldung in der Glocke („Terminvorschlag angenommen“) und die Karte im Chat.
- Vorschläge halten ihre Zeiten für andere Kunden frei, bis der Kunde antwortet, höchstens drei Tage (Entscheidung 14). Danach verfallen sie, und die Karte zeigt „abgelaufen“.
- Im Kalender stehen Vorschläge gestrichelt als „Vorgeschlagen“, beim Kunden mit denselben Knöpfen wie in der Karte. Ins Kalender-Abo kommen sie erst, wenn sie angenommen sind.

### 4.3 Technik

- Migration in `service-oalab`: Stand „Vorgeschlagen“ für `hub_appointments`, eine Spalte, die die Zeiten eines Vorschlags verbindet, eine Datenbankfunktion zum Annehmen (prüft Kunde, Stand und Ablauf, bestätigt die gewählte Zeit und gibt die anderen frei), die Belegt-Abfrage `hub_calendar_busy` zählt offene Vorschläge mit, neue Meldungsarten `appointment.proposed` und `appointment.accepted`.
- Hub: Fenster „Neuer Termin“, Kalenderansichten und Stand, Karte mit Auswahl, Ablauf in der regelmäßigen Runde (`runNotificationSweep`), Kalender-Abo (nur angenommene), Claude-Werkzeug `create_appointment` mit Vorschlag, Wissen, Hilfe, Patch Notes.

## 5. Etappen und Reihenfolge

| Etappe | Inhalt | Umfang | Datenbank | Patch Notes |
|---|---|---|---|---|
| 1 | Glocke: nur Ungelesenes, Haken, Rückgängig, Zeit links, Fenster wächst | klein, ein PR im Hub | nein | Verbessert, alle Rollen |
| 2 | Karten im Chat, Abos, Terminanfragen an das Team, Vertrag & Domain | mittel bis groß: Migration in `service-oalab` und ein PR im Hub | ja | Neu, Kunden und Admins |
| 3 | Terminvorschlag zum Annehmen | mittel: Migration und ein PR | ja | Neu, Kunden |

- Etappe 1 kann sofort und unabhängig live gehen.
- Etappe 2 kommt vor Etappe 3, weil der Vorschlag die Karten braucht. Freelancer-Chats folgen als kleiner eigener Schritt nach Etappe 2.
- Bei Etappe 2 und 3 geht zuerst die Migration live (Import in Coolify), dann der PR des Hubs, wie beim Kalender-Abo.
- Vor dem Bau von Etappe 2 zeigt eine Vorschau die Karten und das Abo-Fenster, auf derselben Vorschau-Fläche wie „Glocke V3“, hell und dunkel, am Rechner und am Handy.

## 6. Datenschutz, Sicherheit und Trennung von Service

- Nachrichten im Hub und Service bleiben getrennt (siehe „Feste Regel“ oben): Karten und Abos gibt es nur im privaten Chat; der Reiter „Service“ bekommt keine Karten, keine Abos und keine Meldungen aus diesem Plan, und nichts geht an die Serviceplattform.
- Eine Karte gibt es nur, wenn der Kunde dieselbe Änderung auch in der Glocke bekommt. Was nur das Team oder nur Freelancer sehen, kommt nie in den Chat.
- Karten schreibt nur der Server; aus dem Browser lässt sich keine Karte anlegen oder ändern.
- Eine Karte nennt nur, was heute schon in Glocke und Mail steht (Titel, Zeit, Dateiname), nie den Inhalt einer Notiz oder Datei und nie Passwörter oder Zugangsdaten.
- Eine Karte bleibt im Chat, auch wenn die Datei oder Notiz später zurückgezogen wird, wie eine gesendete Nachricht. Ihr Link führt dann zu „nicht mehr verfügbar“.
- Terminanfragen gehen neu auch an die Telegram-Gruppe des Teams; der Hinweis im Chat und die Datenschutzerklärung sagen das, bevor es gilt.
- Jede Änderung eines Abos steht mit Namen im Chat.

## 7. Entscheidungen

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Zeigt die Glocke nur Ungelesenes, und steht Gelesenes nur noch in der Übersicht unter „Früher“? | Ja |
| 2 | Haken am Ende jeder Zeile, um eine Meldung ohne Öffnen als gelesen zu markieren? | Ja; am Rechner beim Darüberfahren, am Handy immer sichtbar |
| 3 | „Rückgängig“ nach dem Markieren? | Ja, etwa sechs Sekunden, auch nach „Alle als gelesen markieren“ |
| 4 | Zeit links in zwei Zeilen (Tag, Uhrzeit) oder in einer Zeile wie in der Übersicht („vor 12 Min.“)? | Zwei Zeilen: auf einen Blick klar, immer gleich breit, ändert sich nicht beim Hinsehen |
| 5 | Fenster: etwa 62 % der Breite, 760 bis 1280 px, Höhe bis 32 px an den Rand? | Ja |
| 6 | Wer stellt die Abos eines Chats ein: nur Admins oder beide Seiten? | Beide Seiten, jede Änderung als graue Zeile im Chat |
| 7 | Voreinstellung der Abos | Termine, Dateien, Notizen, Projekte und Vertrag & Domain an; Aufgaben aus |
| 8 | Markiert das Öffnen des Chats die Meldungen zu den Karten darin als gelesen? | Ja; die Mail bleibt unverändert |
| 9 | Terminanfragen: Karte im Chat, Meldung in der Glocke der Admins und Telegram? | Ja, alle drei |
| 10 | Bekommt Vertrag & Domain Meldungen und Karten (Verlauf, Domains, E-Mail-Adressen, Pakete)? | Ja, in Etappe 2 |
| 11 | Bekommen Freelancer-Chats ebenfalls Karten? | Ja, als kleiner eigener Schritt nach Etappe 2 |
| 12 | Etappe 3 (echter Terminvorschlag) bauen? | Ja, nach Etappe 2 |
| 13 | Ein Vorschlag mit einer Zeit oder mit bis zu drei Zeiten zur Wahl? | Bis zu drei |
| 14 | Halten Vorschläge ihre Zeiten für andere Kunden frei, und wie lange? | Ja, bis zur Antwort, höchstens drei Tage |
| 15 | Reiter „Service“ unter „Nachrichten“ (Admins lesen dort die Anfragen der Serviceplattform mit): bleibt er dort, oder zieht er in einen eigenen Bereich, damit „Nachrichten“ nur die Kommunikation im Hub zeigt? | Eigener Bereich „Service“ für Admins, außerhalb von „Nachrichten“; Claude bekommt dafür getrennte Werkzeuge für Chat und Service |

## 8. Abnahme

Für alle Etappen:

- Keine Etappe legt auf der Serviceplattform eine Anfrage, Nachricht oder Buchung an; das Service-Kontingent bleibt unverändert, der Reiter „Service“ zeigt dasselbe wie vorher.

Etappe 1:

- In der Glocke stehen nur ungelesene Meldungen. Nach Anklicken, Haken oder „Alle als gelesen markieren“ verschwinden sie, die Zahl an der Glocke geht zurück, und nach dem Neuladen kommen sie nicht wieder.
- „Rückgängig“ holt sie zurück; nach dem Neuladen sind sie weiter ungelesen.
- Mit 35 ungelesenen und 40 gelesenen Meldungen zeigt die Glocke alle 35; Zahl und Liste stimmen überein.
- Die Zeit steht links vor dem Symbol; „Heute“, „Gestern“, Wochentag und Datum stimmen um Mitternacht und zum Jahreswechsel in deutscher Zeit.
- Auf 390, 820, 1512, 1920, 2560 und 3840 px Breite: Breite wie in Abschnitt 2.3, Überschrift und Knopf bleiben stehen, nur die Liste scrollt, nirgends eine waagrechte Scrollleiste.
- Übersicht: „Neu“ und „Früher“ stimmen; was dort mit × ausgeblendet wird, ist auch aus der Glocke verschwunden.
- Eine neue Meldung erscheint bei offenem Fenster ohne Neuladen, und die Seite lädt sich nicht ständig neu.
- Hell und dunkel, als Admin, Kunde und Freelancer, in der Designvorschau.

Etappe 2:

- Ein Admin legt einen Termin mit einem Kunden an, im Kalender, mit dem Assistenten oder mit Claude: Die Karte steht innerhalb von Sekunden im Chat dieses Kunden, „Nachrichten“ zeigt beim Kunden eins mehr, die Glocke eine Meldung und keine zweite „Neue Nachricht“.
- Verschieben und Absagen: eine neue Karte, die ältere trägt das Schild.
- Abo „Termine“ aus: Der nächste Termin kommt nicht in den Chat; im Chat steht, wer es abgeschaltet hat.
- Datei nur für Freelancer, Aufgabe „Nur Team“, nicht freigegebene Notiz: keine Karte.
- Zehn Dateien auf einmal: eine Karte.
- Terminanfrage eines Kunden: Karte auf seiner Seite, Meldung in der Glocke der Admins, Zeile in Telegram. „Bestätigen“ in der Karte bestätigt sie; der Kunde bekommt Karte, Meldung und Mail.
- Öffnet der Kunde den Chat, verschwinden die Meldungen zu den Karten aus seiner Glocke.
- Läuft die regelmäßige Runde zweimal über dieselbe Änderung, gibt es keine doppelte Karte.
- Die Liste der Chats und Claude (`read_conversation`) zeigen Karten als Textzeile.

Etappe 3:

- Vorschlag mit drei Zeiten: Die Karte zeigt drei Zeiten; „Annehmen“ bestätigt eine, die anderen sind wieder frei; das Team bekommt Meldung und Karte.
- Ein anderer Kunde kann eine vorgeschlagene Zeit nicht anfragen, solange der Vorschlag offen ist.
- Nach drei Tagen ohne Antwort zeigt die Karte „abgelaufen“, und die Zeiten sind frei.
