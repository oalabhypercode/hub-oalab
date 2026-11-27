# Planung: Notizen unter Projekte

Stand 22. November 2026 · Entwurf zur Entscheidung · im Hub ist davon noch nichts umgesetzt

Dieser Plan beschreibt einen neuen Bereich **Notizen**: je Kunde ein eigener Notizbereich wie in Notion, mit Seiten und Unterseiten, der mit den Aufgaben, den Projekten und dem Kalender zusammenspielt. Er hängt wie „Aufgaben“ und „Kalender“ unter **Projekte** und ist für Admins, Kunden und Freelancer da. Für jede Seite legt das Team fest, ob Kunde und Freelancer sie sehen, wie heute bei den Dateien („Sichtbar für“).

Die Gestaltung folgt der Vorschau **V2 vom 22. November 2026**, die nach dem Vergleich mit Notion und Microsoft Loop freigegeben ist: Das Schreiben steht im Vordergrund, auf der Seite stehen nur Titelbild, Symbol, Titel und Text, alle Eckdaten liegen hinter einem Zahnrad. Dazu kommen Emojis, Titelbilder und eine Schriftgröße je Gerät. Vorschau (privat, Seite „V2“): https://claude.ai/artifact/QNFjA2RFUNfzsTqanXjj9W

Grundlage ist der Code auf `main` vom 21. November 2026 (nach #137). Datenbankänderungen gehören wie bisher als Migration in `service-oalab`.

## Auf einen Blick

| Frage | Vorschlag |
|---|---|
| Wo | Projekte › Notizen (`/dashboard/projects/notes`), in der Seitenleiste unter Aufgaben und Kalender; am Handy über „Mehr“ |
| Wer | Admins: alle Kunden · Kunden: ihr eigener Bereich · Freelancer: die Bereiche der Kunden, die sie betreuen |
| Gliederung | Kunde › Projekt (oder „Allgemein“) › Seite › Unterseiten |
| Seite | Titelbild, Emoji als Seitensymbol, Titel und Text; keine Eckdaten auf der Seite |
| Einstellungen | ein Zahnrad je Seite (Sichtbar für, Symbol, Titelbild, Projekt, Datum, Termin, Breite) und ein Zahnrad für alle Notizen mit den Standardwerten, einmal festgelegt; dazu „Aa“ für die Schriftgröße (Klein, Mittel, Groß), die jedes Gerät für sich behält |
| Platz zum Schreiben | Seitenliste einklappbar; „Fokus“ blendet zusätzlich Hub-Leiste und Seitenkopf aus |
| Sichtbar für | Nur Team (Standard) · Kunde und Freelancer · Nur Kunde · Nur Freelancer, also die drei Stufen der Dateien plus „Nur Team“ |
| Schreiben | Blockmenü mit „/“, Werkzeugleiste über markiertem Text, saubere Links mit Vorschau, Linkkarten, Tabellen, Emojis auch im Text |
| Aufgaben | Aufgaben aus dem Board als schlanke Liste, Zeile oder Markierung wird Aufgabe, im Aufgabenfenster „Erwähnt in“ |
| Kalender | Termin als Block, Besprechungsnotiz aus dem Termin, Termin anlegen oder anfragen aus der Notiz, Seiten mit Datum im Kalender |
| Technik | zwei neue Tabellen mit Zeilenregeln wie bei den Dateien plus eine Zeile Standardwerte, Editor Tiptap 3 (MIT), Speichern als JSON mit Versionsprüfung |
| Umfang | vier Etappen; nach Etappe 2 ist der Bereich im Alltag nutzbar |

**Wichtigste Regel:** Eine Notiz speichert von Aufgaben, Terminen, Projekten und Dateien nur die Kennung. Titel, Status und Zeit liest der Hub beim Öffnen mit den Rechten der Person, die die Seite ansieht. Eine freigegebene Seite verrät deshalb nie eine interne Aufgabe oder einen fremden Termin.

## 1. So sieht der Bereich aus

### 1.1 Navigation und Adressen

- **Seitenleiste:** Projekte mit den Unterpunkten Aufgaben (Team und Freelancer), Kalender (alle) und neu **Notizen** (alle). Auf Notizen ist Projekte als Elternpunkt markiert, wie heute bei Aufgaben und Kalender.
- **Tablet und Handy:** In „Mehr“ steht bei den Bereichen eine Zeile „Notizen“. Die Tab-Leiste bleibt bei fünf Einträgen.
- **Adressen:** `/dashboard/projects/notes` mit `?customer=`, `?project=` und `?page=`, wie `?customer=` und `?file=` in den anderen Bereichen. Die Designvorschau `/preview/projects/notes` zeigt Beispielseiten.
- **Schnellzugriff:** Im Kopf eines Kunden unter Projekte (die Symbole mit den Ziffern 1–9) kommt „Notizen“ als letzter Eintrag dazu, damit die Ziffern der übrigen bleiben.

### 1.2 Aufbau der Seite

Wie in Notion und Loop: links eine ruhige Seitenliste, rechts eine große Schreibfläche. Beides liegt auf einer Fläche wie die Tabellen des Hubs.

- **Seitenliste links (etwa 264 px, einklappbar):** oben der Kunde mit Logo; ein Klick darauf wechselt den Kunden (Admins: alle, Freelancer: ihre Kunden, Kunden haben keinen Wechsel). Daneben drei kleine Symbole: Suche, Zahnrad „für alle Notizen“ (nur Team) und Einklappen. Darunter „Neue Seite“ und die Seiten, gruppiert nach den Projekten des Kunden und „Allgemein“. Jede Seite zeigt ihr Emoji, Unterseiten klappen über einen Pfeil auf. Ein kleines Symbol rechts zeigt nur bei Seiten, die nicht „Nur Team“ sind, wer sie sieht (Auge: Kunde, Koffer: Freelancer, Personen: beide). Unten liegt der Papierkorb.
- **Schreibfläche rechts:** oben nur eine schmale Leiste mit Pfad (Projekt › Elternseite › Seite), „Bearbeitet vor …“, dem Sichtbarkeits-Symbol (Schloss, Auge …; ein Klick öffnet das Zahnrad), dem Fokus-Knopf, „Aa“ für die Schriftgröße und dem Zahnrad. Darunter, falls gesetzt, das Titelbild über die ganze Breite, das Emoji der Seite, der Titel (40 px) und der Text in einer ruhigen Spalte von 720 px (Breite „Breit“: 980 px). Keine Eckdaten über dem Text.
- **Schrift und Abstände:** Text in 16,5 px mit großzügiger Zeilenhöhe von 31 px, spürbar Luft zwischen Absätzen, Listenpunkten und Checklisten; Überschriften mit viel Abstand nach oben (38 px) und etwas nach unten (10 px); Hinweisboxen, Tabellenzeilen und Aufgabenlisten ebenso luftig. Maßstab ist die Vorschau V2 vom 22. November 2026; die Werte gelten für die Stufe „Mittel“.
- **Schriftgröße je Gerät:** Der Knopf „Aa“ links neben dem Zahnrad öffnet ein kleines Fenster im Glas-Look mit drei Kacheln: Klein (15 px), Mittel (16,5 px, Standard) und Groß (18,5 px). Titel, Überschriften, Abstände, Tabellen, Hinweisboxen und Aufgabenlisten wachsen im selben Verhältnis mit, und die Schreibfläche wird schmaler oder breiter (656, 720 oder 808 px), damit eine Zeile gleich viele Zeichen hat. Am Handy bleibt der Titel kleiner (25, 28 oder 31 px). Die Wahl gilt nur auf dem Gerät, auf dem man sie trifft, für alle Notizen und in jeder Rolle; für andere ändert sich nichts. So liest sich eine Seite am Handy, am Laptop und am großen Bildschirm ähnlich. Dieselbe Wahl steht auch in „Darstellung“.
- **Fokus:** blendet die Seitenleiste des Hubs, den Seitenkopf „Notizen“ und die Seitenliste aus, bis nur die Seite bleibt. Die Leiste des Hubs bleibt außerhalb des Fokus wie heute.
- **Start für Admins:** der zuletzt geöffnete Kunde (im Browser gemerkt wie die Listenansicht).
- **Handy:** erst die Liste, dann die Seite bildschirmfüllend mit Zurück-Pfeil, wie im Chat. Tabellen scrollen dort seitlich in ihrem Kasten.

### 1.3 Seiten und Blöcke

Bedienung wie in Notion und Loop:

- „/“ öffnet das Blockmenü. Markdown-Kürzel (`# `, `- `, `1. `, `[] `, `> `) formatieren beim Tippen. „#“ sucht Aufgaben, „@“ Personen aus dem Team, „:“ Emojis, ⌘K setzt einen Link. Griffe zum Verschieben und „+“ erscheinen erst, wenn die Maus über einem Block steht.
- **Werkzeugleiste über markiertem Text** (im Glas-Look der Hub-Fenster): Textart, Fett, Kursiv, Unterstrichen, Durchgestrichen, Link, Emoji, Kommentar (Etappe 4) und „Als Aufgabe“.
- **Blöcke in Etappe 1:** Text, Überschriften in drei Ebenen, Aufzählung, Nummerierung, Checkliste, Hinweisbox mit Emoji, Aufklapper, Tabelle, Trennlinie, Code, Link (nur `https:` und `mailto:`), Unterseite.
- **Später:** Linkkarte mit abgerufener Vorschau, Bilder im Text (in der eigenen Dateiablage, nie von fremden Servern; umgesetzt am 27.11.2026 als Screenshots mit Strg/⌘ + V, Hineinziehen und „/Bild“, siehe PROJECT_CONTEXT.md), Datei aus dem Asset Management des Kunden (dort gilt weiter „Sichtbar für“ der Datei).
- **Vorlagen (Etappe 2):** Besprechung, Projektbriefing, Abnahme, leere Seite.
- **Speichern** geschieht von selbst, etwa eine Sekunde nach der letzten Eingabe. Oben steht „Gespeichert“, „Speichert …“ oder „Nicht gespeichert – erneut versuchen“. Jede Seite trägt eine Versionsnummer wie die Aufgaben im Board: Hat inzwischen jemand anderes gespeichert, überschreibt der Hub nichts, sondern meldet „Inzwischen von … geändert“ und bietet „Neu laden“; der eigene Text bleibt daneben zum Übernehmen stehen.
- **Bearbeitet gerade (Etappe 3):** Arbeitet jemand anderes an derselben Seite, steht oben „… bearbeitet gerade“.
- **Löschen (Etappe 2)** legt eine Seite samt Unterseiten für 30 Tage in den Papierkorb. Wiederherstellen und endgültig löschen kann nur das Team.
- **Verlauf (Etappe 3):** frühere Fassungen einer Seite, höchstens eine je 10 Minuten und immer eine vor jeder Änderung von „Sichtbar für“. Das Team stellt eine Fassung wieder her.

### 1.4 Zahnrad: Einstellungen je Seite und für alle Notizen

**Je Seite** (Zahnrad oben rechts, ein Fenster im Glas-Look):

- Sichtbar für (die vier Stufen aus Abschnitt 2, als Kacheln), darunter ein Satz, wer die Seite gerade sieht
- Symbol (Emoji) und Titelbild, beides auch direkt auf der Seite änderbar
- Projekt, Datum, verknüpfter Termin
- Breite: Normal oder Breit
- Änderung mitteilen (nur bei freigegebenen Seiten), Verlauf, Link kopieren, In den Papierkorb
- unten: zuletzt bearbeitet von wem und wann

Kunden sehen am Zahnrad nur, dass oalab die Seite geteilt hat, dazu Projekt, Datum und „Link kopieren“. Freelancer sehen zusätzlich, wer die Seite sieht; ändern können sie das nicht.

**Für alle Notizen** (Zahnrad oben in der Seitenliste, nur Team), einmal festgelegt und für alle Kunden gültig:

- wer neue Seiten sieht (Standard „Nur Team“)
- ob eine Freigabe eine Meldung schickt (Standard an)
- ob die Liste nach Projekten gegliedert ist (Standard an)
- die Vorlage für Besprechungsnotizen
- die Standardbreite (Normal)

**Nicht im Zahnrad** steht die Schriftgröße: Sie gilt nur für das eigene Gerät und liegt deshalb am Knopf „Aa“ und in „Darstellung“ (Abschnitt 1.2).

### 1.5 Links, Linkkarten und Tabellen

- **Link im Text:** in der Akzentfarbe, dezent unterstrichen. Fährt man darüber, zeigt eine kleine Karte Titel, Beschreibung, Seitensymbol und Adresse.
- **Adresse einfügen:** Der Editor fragt „Link im Text“ oder „Linkkarte“, wie Notion und Loop. Über die Werkzeugleiste wird markierter Text zum Link oder darunter entsteht eine Linkkarte.
- **Linkkarte:** Titel, zwei Zeilen Beschreibung, Seitensymbol und Adresse, rechts ein Vorschaubild. Die Angaben holt der Hub-Server einmal beim Einfügen (Abschnitt 6.3); ein Klick öffnet die Seite in einem neuen Tab.
- **Tabelle:** dünne Linien, Kopfzeile mit Symbol der Spaltenart (Text, Häkchen, Status, Person), Status als farbige Markierung in den Tönen des Hubs, „Neue Zeile“ am Ende, Spaltenbreiten ziehbar. Am Handy scrollt sie seitlich in ihrem Kasten. Keine Formeln und keine Datenbank-Eigenschaften.

### 1.6 Emojis und Titelbilder

- **Seitensymbol:** ein Emoji groß über dem Titel; es steht auch in der Seitenliste und im Pfad. Ein Klick öffnet die Auswahl: Suche mit deutschen Namen (etwa „rakete“), Kategorien, „Zuletzt benutzt“, „Zufällig“ und „Entfernen“. Ohne Symbol und Titelbild bietet die Seite beim Darüberfahren „Symbol hinzufügen“ und „Titelbild hinzufügen“.
- **Emojis im Text:** „:“ plus Name schlägt passende Emojis vor (Enter übernimmt das erste), dazu „Emoji“ im Blockmenü und in der Werkzeugleiste. Hinweisboxen tragen ein Emoji als Symbol, das sich per Klick tauschen lässt.
- **Emoji-Set:** Gespeichert wird das Emoji als normales Unicode-Zeichen im Dokument; wie es aussieht, bestimmt der Hub. Damit es auf jedem Gerät gleich modern aussieht, nutzt der Hub ein festes Set statt der Emojis von Windows, Android oder Apple (Entscheidung 12). Die Vorschau zeigt Noto Color Emoji.
- **Titelbild:** ein Band über die ganze Breite der Seite. Beim Darüberfahren erscheinen „Titelbild ändern“, „Position“ (oben, Mitte, unten; im Hub später stufenlos durch Ziehen) und „Entfernen“. Die Auswahl hat drei Reiter:
  - **Galerie:** die sechs Hintergründe des Hubs (oalab, Ozean, Aubergine, Smaragd, Glut, Graphit), ruhige Farben und Muster
  - **Aus den Dateien:** Bilder aus dem Asset Management dieses Kunden
  - **Hochladen:** JPG, PNG oder WebP bis 5 MB; der Hub verkleinert das Bild auf 1500 × 500 Pixel und legt es als WebP bei den Dateien des Kunden ab
- **Wer das Titelbild sieht:** Ein hochgeladenes Titelbild ist so sichtbar wie die Seite (signierte Links wie bei den Logos). Ein Bild aus den Dateien bleibt an die Datei gebunden: Wer die Datei nicht sehen darf, sieht stattdessen eine ruhige Farbe.

### 1.7 Was es bewusst nicht gibt

- Datenbanken wie in Notion (Tabellen mit eigenen Eigenschaften): Für Aufgaben übernimmt das die Aufgabenliste aus dem Board (Abschnitt 4).
- Öffentliche Links auf Seiten: Wer eine Seite sehen soll, hat einen Zugang zum Hub.
- Titelbilder oder Bilder von fremden Bildquellen (etwa Bilddatenbanken im Netz): Bilder kommen aus der Galerie, den Dateien des Kunden oder dem Hochladen, damit keine fremden Server mitlesen.
- Gleichzeitiges Tippen mehrerer Personen in Echtzeit (Abschnitt 6.5).

## 2. Sichtbar für

### 2.1 Die vier Stufen

| Sichtbar für | Team | Kunde | Freelancer des Kunden |
|---|---|---|---|
| **Nur Team** (Standard für neue Seiten des Teams) | ✓ | – | – |
| **Kunde und Freelancer** | ✓ | ✓ | ✓ |
| **Nur Kunde** | ✓ | ✓ | – |
| **Nur Freelancer** | ✓ | – | ✓ |

- Die Wörter sind die der Dateien („Kunde und Freelancer“, „Nur Kunde“, „Nur Freelancer“) und des Boards („Nur Team“), damit überall dieselbe Sprache gilt.
- „Freelancer des Kunden“ heißt wie bei den Dateien: alle Freelancer, die diesen Kunden betreuen, nicht nur die eines Projekts (Entscheidung 4).
- Bei Kunden ohne Freelancer zeigt der Hub nur zwei Stufen, „Nur Team“ und „Kunde“ (gespeichert als „Nur Kunde“), so wie „Sichtbar für“ bei Dateien nur bei Kunden mit Freelancer erscheint. Kommt später ein Freelancer dazu, sieht er diese Seiten erst, wenn das Team sie weiter freigibt.
- „Sichtbar für“ ändert nur das Team. Ein ⓘ erklärt die Stufen.
- Seiten, die ein Freelancer anlegt, stehen fest auf „Nur Freelancer“, sehen also Team und Freelancer. Seiten von Kunden (nur falls Etappe 4 kommt) stehen auf „Nur Kunde“, denn Kunden erfahren nicht, wer sie betreut.

### 2.2 Unterseiten

- Eine neue Unterseite übernimmt die Stufe ihrer Elternseite.
- Eine Unterseite ist höchstens so sichtbar wie ihre Elternseite. „Nur Team“ ist enger als alles andere; „Nur Kunde“ und „Nur Freelancer“ sind enger als „Kunde und Freelancer“. Unter „Nur Kunde“ geht also „Nur Kunde“ oder „Nur Team“, nicht aber „Nur Freelancer“.
- Stellt das Team eine Elternseite enger, gehen die Unterseiten mit. Die Rückfrage nennt sie vorher, etwa „3 Unterseiten sind danach ebenfalls nur für das Team sichtbar“.
- So steht für Kunden und Freelancer nie eine sichtbare Seite unter einer, die sie nicht sehen; ihr Baum besteht nur aus Seiten, die sie sehen dürfen.

### 2.3 Freigeben

- Wird eine Seite für Kunde oder Freelancer sichtbar, prüft der Hub vorher die Blöcke darin: „Auf dieser Seite stehen 2 Aufgaben und 1 Termin, die der Kunde nicht sieht. Dort steht für ihn nur ‚Nicht freigegeben‘.“ Freigeben geht trotzdem; das Team entscheidet.
- Wer die Seite neu sehen darf, bekommt eine Meldung in der Glocke und, gebündelt wie bei Dateien, per Mail („Neue Notiz: …“). Spätere Änderungen melden sich nicht von selbst; dafür gibt es den Knopf „Änderung mitteilen“ (Entscheidung 6).

## 3. Wer darf was

| | Team (Admins) | Freelancer | Kunde |
|---|---|---|---|
| Bereiche | alle Kunden | Kunden, die sie betreuen, nur mit bestätigtem Code | nur der eigene |
| Seiten lesen | alle | „Kunde und Freelancer“, „Nur Freelancer“ | „Kunde und Freelancer“, „Nur Kunde“ |
| Seiten anlegen | ✓ | ✓, sichtbar für Team und Freelancer | erst Etappe 4 (optional) |
| Bearbeiten | alle Seiten | Seiten „Nur Freelancer“ | erst Etappe 4: Seiten, bei denen das Team „Kunde schreibt mit“ einschaltet |
| Sichtbar für ändern, löschen, wiederherstellen | ✓ | – | – |
| Aufgabe aus der Notiz | ✓ | ✓, wie im Board ohne „Sichtbar für“ | – |
| Termin aus der Notiz | eintragen | anfragen | anfragen |

Zu den Freelancern: Im Board ändern sie auch Aufgaben, die der Kunde sieht. Bei Notizen schlägt der Plan eine engere Grenze vor: Freelancer schreiben nur auf Seiten, die der Kunde nicht sieht. So geht kein Text eines Freelancers am Team vorbei an den Kunden (Entscheidung 3).

Gesperrte Zugänge sehen nichts. Notizen archivierter Kunden verschwinden wie ihre Dateien und Termine überall außer im User Management (Abschnitt 6.1).

## 4. Zusammenspiel mit Aufgaben und Projekten

Die Aufgaben sind Studios eigene Zeilen (`studio_tasks` und Nachbarn). Notizen legen keine zweite Aufgabenliste an, sondern verweisen auf diese Zeilen und schreiben über denselben Code wie das Board (`createTaskAs`, `updateTaskAs` in `lib/hub-tasks/write.ts`).

1. **Aufgaben als schlanke Liste** („/Aufgabe“ oder „#“ mit Nummer oder Titel): je Aufgabe eine Zeile mit Nummer, Titel, Fälligkeit, Spalte, Zuständigen und „Beim Kunden“, mehrere Aufgaben in einem Kasten „Aufgaben · Projekt“ mit „Im Board“. Im Fließtext erscheint eine Aufgabe als kleine Erwähnung. Ein Klick öffnet das Aufgabenfenster des Boards als Seitenleiste, bei Kunden das Projektfenster. Das Häkchen am Block setzt die Aufgabe auf „Erledigt“, mit Versionsprüfung und nur für die, die das im Board dürfen.
2. **Zeile wird Aufgabe:** An jeder Checklisten-Zeile und an markiertem Text steht „Als Aufgabe anlegen“: Projekt (vorbelegt von der Seite), Spalte „Zu erledigen“, Zuständig, Fällig und für das Team „Sichtbar für“ der Aufgabe. Vorbelegt ist „Nur Team“ auf internen Seiten, sonst „+ Freelancer“; „+ Kunde“ wählt das Team bewusst. Danach ist die Zeile ein Aufgaben-Block. „Alle offenen Punkte als Aufgaben“ legt bis zu 20 auf einmal an, wie der Assistent.
3. **Aufgabenliste als Block** („/Aufgabenliste“): die Aufgaben eines Projekts mit Filter (offen, beim Kunden, fällig bis, mir zugewiesen), lebend wie eine verknüpfte Ansicht in Notion. Sie zeigt nur, was die Person auch im Board oder im Projektfenster sieht.
4. **Projekt als Block** („/Projekt“): Status, Fortschritt und Zieltermin wie in der Projekttabelle.
5. **Rückverweise:** Im Aufgabenfenster (Board und Kalender) steht „Erwähnt in“ mit den Seiten, die die Aufgabe nennen. Im Projektfenster (Team und Kunden) gibt es einen Abschnitt „Notizen“ mit den Seiten des Projekts und, für Team und Freelancer, „Neue Notiz zu diesem Projekt“. Auch hier erscheinen nur Seiten, die die Person sieht.
6. **Meldungen:** Eine Aufgabe aus einer Notiz meldet sich wie jede andere über `notifyTaskChange`, und Studio führt sie in seinem Verlauf unter dem Namen der Person.

Freelancer sehen im Board nur die Projekte, an denen sie arbeiten. Aufgaben anderer Projekte erscheinen bei ihnen als „Nicht freigegeben“, und „Als Aufgabe anlegen“ bietet nur ihre Projekte an.

## 5. Zusammenspiel mit dem Kalender

1. **Termin als Block** („/Termin“): Auswahl aus den Terminen des Kunden, kommende zuerst. Der Block zeigt Tag, Uhrzeit, Status (angefragt, bestätigt, abgesagt) und „Teams-Meeting beitreten“. Freelancer sehen die Termine der Kunden heute nicht (Datenbankregel); bei ihnen steht dort „Termin (nicht sichtbar)“.
2. **Besprechungsnotiz aus dem Termin:** Im Terminfenster des Kalenders steht „Notiz anlegen“ bzw. „Notiz öffnen“. Die neue Seite nutzt die Vorlage Besprechung (Titel und Datum des Termins, Teilnehmer, Agenda, Notizen, Beschlüsse, nächste Schritte als Checkliste), hängt am Termin und steht auf „Nur Team“. Je Termin gibt es eine Besprechungsnotiz (Entscheidung 7). Kunden sehen „Notiz öffnen“ nur, wenn die Seite für sie freigegeben ist.
3. **Termin aus der Notiz:** An markiertem Text steht für das Team „Termin anlegen“: Das Terminfenster öffnet sich mit Kunde und Titel vorbelegt, die Meldung an den Kunden läuft wie bisher. Kunden und Freelancer bekommen „Termin anfragen“: das Anfragefenster mit den Regeln der Verfügbarkeit (`requestAppointmentAs`). Danach steht der Termin als Block in der Seite.
4. **Seiten mit Datum:** Eine Seite kann ein Datum tragen. Sie erscheint dann im Kalender als kleiner Eintrag „Notiz · Titel“, ganztägig und ohne belegte Zeit wie die Projektziele, und nur für die, die die Seite sehen. Im Kalender lassen sich Notizen ein- und ausblenden.
5. **Notiz am Termin:** Termine mit Besprechungsnotiz tragen im Kalender ein kleines Notiz-Symbol; ein Klick öffnet die Notiz.

## 6. Technik

### 6.1 Datenbank (Migration in `service-oalab`)

`hub_note_pages`, eine Zeile je Seite:

| Spalte | Inhalt |
|---|---|
| `id` | uuid |
| `customer_id` | Hub-Kunde, nur Art „customer“ (Fremdschlüssel auf `(id, kind)` wie bei den Domains), `on delete cascade` |
| `project_id` | Studio-Projekt (`customer_projects`), leer für „Allgemein“; ein Trigger prüft, dass es zur Organisation des Kunden gehört |
| `parent_id` | Elternseite, gleicher Kunde, keine Kreise, höchstens fünf Ebenen |
| `appointment_id` | Termin der Besprechungsnotiz, eindeutig, gleicher Kunde, `on delete set null` |
| `title` | 1 bis 200 Zeichen |
| `icon` | ein Emoji als Unicode-Zeichen (auch zusammengesetzte), höchstens 16 Zeichen |
| `cover_kind`, `cover_value`, `cover_position` | Titelbild: Galerie (Schlüssel), Datei (ID aus dem Asset Management) oder hochgeladen (Speicherpfad); Position 0 bis 100 % |
| `width` | `normal` oder `wide` |
| `audience` | `team`, `both`, `customer`, `freelancer`; Standard `team` |
| `content` | das Dokument als JSON (Tiptap), höchstens 1 MB |
| `content_text` | reiner Text für die Suche, geschrieben vom Hub-Server |
| `dated_on` | Datum der Seite, optional |
| `position` | Reihenfolge unter Geschwistern |
| `version` | steigt bei jedem Speichern; geschrieben wird nur, solange die erwartete Version stimmt |
| `created_by`, `created_at`, `updated_by`, `updated_at` | wer und wann |
| `deleted_at`, `deleted_by` | Papierkorb |

`hub_note_links` hält fest, wer auf wen verweist (`page_id`, `target_kind` aus task, project, appointment, file, page, `target_id`). Ein Trigger liest die Verweise bei jedem Speichern aus dem JSON. So stimmen die Rückverweise, egal ob der Hub schreibt oder später der Assistent oder der Claude-Connector.

`hub_note_settings` hält in einer Zeile die Standardwerte für alle Notizen (Abschnitt 1.4); schreiben dürfen nur Admins. Linkkarten speichern Titel, Beschreibung, Adresse und den Speicherpfad ihres Vorschaubilds im Block selbst.

Später kommen `hub_note_revisions` (Verlauf, nur Team, 90 Tage) und `hub_note_presence` (wer gerade bearbeitet, Herzschlag alle 15 Sekunden) dazu.

**Zeilenregeln (RLS)**, mit ausdrücklichen Rechten für die Data-API wie bei allen Hub-Tabellen:

- **Admins:** alles, über dieselbe Admin-Prüfung wie bei `hub_files`.
- **Kunden:** lesen Seiten ihres Kunden (über `hub_customer_members` mit aktivem Profil) mit `audience` `both` oder `customer`, nicht im Papierkorb, Kunde nicht archiviert.
- **Freelancer:** lesen Seiten mit `audience` `both` oder `freelancer` über `hub_freelancer_sees()` (aktives Profil und `aal2`), anlegen und ändern nur Seiten mit `audience` `freelancer`.
- Ein Trigger verhindert, dass jemand außer dem Team `audience`, `customer_id` oder den Papierkorb ändert, setzt die Unterseiten-Regel durch (2.2) und stellt Unterseiten mit enger.
- `hub_inbox` lernt die Meldungsart `note.shared`.
- `hub_delete_customer` nimmt die Notizen über die Kaskade mit, und die Vorschau „was wegfällt“ zählt sie mit. `hub_archive_customer` braucht nichts Neues, weil die Regeln archivierte Kunden ausblenden.
- Geprüft wird wie bisher in PGlite mit den echten Hub-Migrationen: Kunde sieht nur Freigegebenes des eigenen Kunden, Freelancer nur mit `aal2` und nur bei ihren Kunden, Freelancer ändern `audience` nicht, Unterseiten-Regel, archivierter Kunde unsichtbar, Löschen räumt auf.

### 6.2 Editor

**Tiptap 3** (MIT-Lizenz, auf ProseMirror). Seit Version 3 sind auch der Griff zum Verschieben, Emoji und die Dateiablage quelloffen, und Erwähnungen kennen mehrere Auslöser wie „@“, „#“ und „:“. Tabellen bringt das Paket `@tiptap/extension-table` mit. Die Emoji-Erweiterung speichert Unicode und zeigt die Bilder des gewählten Emoji-Sets, die der Hub selbst ausliefert. Dazu kommen eigene Erweiterungen: das Blockmenü auf „/“, die Verweis-Blöcke (Aufgabe, Aufgabenliste, Projekt, Termin, Datei, Unterseite) als React-Ansichten und die Hinweisbox. Der Editor wird nur auf der Notizen-Seite nachgeladen, damit der übrige Hub nicht schwerer wird. Wer nur lesen darf, sieht dieselbe Darstellung ohne Bearbeiten.

Verglichen wurden:

- **BlockNote:** sieht ohne Arbeit wie Notion aus, bringt aber ein eigenes Oberflächenpaket und eigene Stile mit, die mit dem Glas-Design des Hubs kollidieren; einige Zusatzpakete stehen nicht unter einer freien Lizenz.
- **Lexical:** frei und solide, aber Blockmenü, Griff und Erwähnungen wären deutlich mehr eigener Code.

Vor dem Einbau prüfen: aktuelle Version, Lizenz jedes einzelnen Pakets (die Erweiterung „Unique ID“ war bei der Recherche nicht eindeutig frei und wird nicht gebraucht) und das Zusammenspiel mit React 19 und Next.js 16.

### 6.3 Inhalt und Sicherheit

- Gespeichert wird JSON, nie HTML. Der Server prüft jedes Speichern gegen eine Liste erlaubter Blöcke und Formate, lässt Links nur mit `https:` und `mailto:` zu, begrenzt die Größe auf 1 MB und rechnet daraus `content_text`. Unbekannte Blöcke lehnt er ab.
- Verweis-Blöcke tragen nur die Kennung (bei Aufgaben dazu die Nummer). Beim Öffnen löst der Server alle Verweise einer Seite in einem Zug auf, mit der Sitzung der Person: Studios Zeilenregeln und die Regeln von `hub_appointments` und `hub_files` entscheiden. Was die Person nicht sehen darf, kommt als „Nicht freigegeben“ zurück, ohne Titel.
- **Linkvorschau:** Der Hub-Server ruft eine eingefügte Adresse einmal ab: nur `http` und `https` auf den Ports 80 und 443, nie interne oder private Adressen (Schutz gegen SSRF, auch nach Weiterleitungen), höchstens 1 MB und 5 Sekunden, ohne Cookies. Das Vorschaubild speichert er verkleinert in der eigenen Dateiablage, sodass Browser von Kunden nie etwas von fremden Servern laden.
- **Titelbilder und Emojis** kommen vom Hub selbst (eigene Dateiablage, eigene Kopie des Emoji-Sets), nie von fremden Servern oder CDNs.
- Admin-Protokoll (`hub_admin_events`): Seite angelegt, freigegeben (Stufe vorher und nachher), gelöscht, wiederhergestellt; nie der Inhalt.
- Datenschutz: Notizen sind Inhalte im Hub wie Chat und Dateien. Vor dem Livegang prüfen, ob die Datenschutzerklärung sie abdeckt, und die Fristen festhalten (Papierkorb 30 Tage, Verlauf 90 Tage).

### 6.4 Code im Hub

- `lib/hub-notes/`: `types.ts`; `rules.ts` mit Stufen, Unterseiten-Regel, Prüfung des JSON, Auslesen von Text und Verweisen und der Vorbelegung Seitenstufe → Aufgabenstufe (eigenständig, damit `node --test` sie lädt); `server.ts` (Baum und Seite laden, Verweise auflösen, ohne Migration der Hinweis „Notizen sind noch nicht eingerichtet“); `write.ts` (Kern fürs Speichern, später auch für Assistent und Connector); `actions.ts`; `fixtures.ts` für die Vorschau.
- Dazu in `lib/hub-notes/`: `emoji.ts` (Liste mit deutschen Namen, Suche für Auswahl und „:“), `covers.ts` (Galerie und Prüfung der Titelbilder), `link-preview.ts` (Abruf mit Schutz aus Abschnitt 6.3).
- Oberfläche: `components/hub/screens/notes.tsx`, `notes-tree.tsx`, `notes-editor.tsx`, `notes-blocks.tsx`, `notes-panels.tsx`, `notes-settings.tsx` (beide Zahnräder), `notes-emoji-picker.tsx`, `notes-cover.tsx`, Stile in `app/notes.css` (hell und dunkel, Fenster im Glas-Look).
- Schriftgröße: Feld `notesTextSize` (`small`, `medium`, `large`; Standard `medium`) im Erscheinungsbild in `lib/appearance.ts`. Es liegt wie Breite und Listenansicht je Gerät im Browser (`oalab-hub-appearance`); das Skript vor dem ersten Bild setzt es als `data-notes-text` an `<html>`, sodass beim Laden nichts springt. Der Knopf „Aa“ in `notes-settings.tsx` und eine neue Zeile „Schriftgröße der Notizen“ in `components/hub/screens/appearance.tsx` schreiben denselben Wert. In `app/notes.css` hängen alle Maße der Schreibfläche an wenigen Variablen, die die drei Stufen setzen. Keine Spalte in der Datenbank.
- Navigation: `lib/hub-routes.ts`, `lib/hub-data.ts`, `components/hub/glass-sidebar.tsx`, „Mehr“ in `components/hub/screens/workspace.tsx`, `components/hub/project-links.tsx`, `app/dashboard/[section]/[detail]/page.tsx`, `components/hub/hub-view.tsx`.
- Aufgaben und Projekte: „Erwähnt in“ in `tasks-panel.tsx`, Abschnitt „Notizen“ in `projects-panel.tsx` und im Projektfenster der Kunden.
- Kalender: „Notiz anlegen/öffnen“ in `calendar-panels.tsx`, Einträge mit Datum und Symbol am Termin in `calendar-views.tsx`, Seiten mit Datum im Zeitfenster über `lib/hub-calendar/server.ts`.
- Meldungen: `note.shared` in `lib/hub-notify/rules.ts`, `notifyNoteShared` in `lib/hub-notify/server.ts` nach dem Muster von `notifyFileShared`, Mail-Vorlage.
- Archiv: `lib/hub-archive` blendet für Admins Notizen archivierter Kunden aus.
- Wissen des Assistenten (`lib/hub-assistant/knowledge.ts`), `/hub-hilfe`, Patch Notes, `PROJECT_CONTEXT.md`.
- Tests: `tests/hub-notes.test.mjs` (Regeln, Prüfung des JSON, Verweise) in `npm test`; `tests/hub-navigation.test.mjs` erweitern; `tests/appearance.test.mjs` prüft, dass ein gespeichertes Erscheinungsbild ohne Schriftgröße „Mittel“ ergibt.

### 6.5 Warum keine Echtzeit-Mitschrift

Gleichzeitiges Tippen wie in Notion braucht Yjs, einen eigenen WebSocket-Dienst (etwa Hocuspocus) auf Server 2 und eine andere Speicherform als JSON mit Versionsnummer. Bei wenigen Schreibenden je Kunde reichen automatisches Speichern, Versionsprüfung und „bearbeitet gerade“. Stört es später, kommt die Mitschrift als eigener Plan.

## 7. Etappen

| Etappe | Inhalt | Umfang |
|---|---|---|
| **1 Grundgerüst** | Migration (Seiten, Verweise, Standardwerte, Regeln), Navigation, Seitenliste je Kunde und Projekt (einklappbar), Fokus, Zahnrad je Seite und für alle Notizen, Schriftgröße je Gerät, Editor mit den Grundblöcken inklusive Tabelle und Aufklapper, Werkzeugleiste, Links im Text, Emojis (Seitensymbol, im Text, Hinweisbox), Titelbilder aus der Galerie, automatisches Speichern mit Versionsprüfung, Sichtbar für mit Unterseiten-Regel, Sicht der Kunden (lesen) und Freelancer (lesen, in „Nur Freelancer“ schreiben), Vorschau, Tests | groß: ein PR in `service-oalab`, zwei im Hub |
| **2 Aufgaben, Projekte, Links und Bilder** | Aufgaben als Liste, „#“, Zeile oder Markierung → Aufgabe, Projekt-Block, „Erwähnt in“, Abschnitt „Notizen“ im Projektfenster, Schnellzugriff, Prüfung und Meldung beim Freigeben, Papierkorb, Vorlagen; Linkkarten und Linkvorschau mit Abruf durch den Server, Titelbilder aus den Dateien und hochgeladen | mittel bis groß |
| **3 Kalender** | Termin-Block, Besprechungsnotiz aus dem Termin, Termin anlegen oder anfragen aus der Notiz, Datum mit Anzeige im Kalender, Symbol am Termin, Verlauf, „bearbeitet gerade“, Notizen in der Suche | mittel |
| **4 optional** | Kunden schreiben mit und legen eigene Seiten an, Bilder im Text, Kommentare, Export als PDF, Assistent „Aufgaben aus dieser Notiz vorschlagen“ (wie bei Meetingtranskripten, mit Belegzitat), Werkzeuge im Claude-Connector, Kachel in der Übersicht, eigener Bereich zwischen oalab und jedem Freelancer | je Punkt klein bis mittel |

Jede Etappe geht einzeln live, mit Patch Notes. Ohne Migration liest der Hub fehlertolerant und zeigt „Notizen sind noch nicht eingerichtet“. Assistent und Claude-Connector bekommen wie bisher einen eigenen Plan und eine eigene Freigabe.

## 8. Entscheidungen

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Vier Stufen „Sichtbar für“ mit „Nur Team“ als Standard? | Ja |
| 2 | Unterseiten höchstens so sichtbar wie die Elternseite; eine engere Elternseite nimmt sie mit? | Ja |
| 3 | Freelancer schreiben nur auf Seiten „Nur Freelancer“? Alternativen: alles, was sie sehen (wie im Board), oder nur lesen | Nur „Nur Freelancer“ |
| 4 | Freelancer sehen freigegebene Seiten je Kunde (wie Dateien), nicht nur die ihrer Projekte (wie Aufgaben)? | Je Kunde |
| 5 | Kunden in Etappe 1 bis 3 nur lesend, Mitschreiben je Seite erst in Etappe 4? | Ja |
| 6 | Meldung nur beim ersten Freigeben, danach „Änderung mitteilen“ von Hand? | Ja |
| 7 | Eine Besprechungsnotiz je Termin? | Ja |
| 8 | Editor Tiptap 3? | Ja |
| 9 | Ohne Echtzeit-Mitschrift starten? | Ja |
| 10 | Eigener Notizbereich zwischen oalab und jedem Freelancer, wie „Meine Dateien“? | Später (Etappe 4) |
| 11 | Reihenfolge Grundgerüst → Aufgaben und Projekte → Kalender? | Ja |
| 12 | Welches Emoji-Set? Microsoft Fluent Emoji 3D (der Look von Loop, MIT-Lizenz laut Projekt), Noto Color Emoji (Google, SIL OFL 1.1, als Schrift am einfachsten) oder die Emojis des jeweiligen Geräts | Fluent Emoji 3D, vom Hub selbst ausgeliefert; Lizenz vor dem Einbau prüfen |
| 13 | Titelbilder nur aus Galerie, Dateien des Kunden und Hochladen, keine fremden Bildquellen? | Ja |
| 14 | Linkvorschau holt der Hub-Server mit Schutz gegen interne Adressen und speichert das Bild selbst? | Ja |
| 15 | Die Leiste des Hubs nur im Fokus ausblenden, sonst bleibt sie wie heute? | Ja |
| 16 | Schriftgröße in drei Stufen (Klein, Mittel, Groß) je Gerät statt im Konto, mit „Aa“ in den Notizen und einer Zeile in „Darstellung“? Sie gilt zunächst nur für die Notizen | Ja |

## 9. Abnahme

- Neue Seite des Teams: Kunde und Freelancer sehen sie nicht, weder im Hub noch bei einer direkten Abfrage mit ihrer Rolle.
- „Nur Kunde“: Der Kunde sieht die Seite und bekommt eine Meldung, der Freelancer nicht. „Nur Freelancer“ umgekehrt.
- Eine Unterseite unter „Nur Team“ lässt sich nicht freigeben; eine engere Elternseite nimmt ihre Unterseiten mit.
- Freigegebene Seite mit interner Aufgabe: Der Kunde sieht „Nicht freigegeben“, und der Titel steht auch nicht in der Antwort des Servers.
- Zwei Admins auf derselben Seite: Der Zweite bekommt „Inzwischen geändert“, kein Text geht verloren.
- Zeile → Aufgabe: Die Aufgabe steht im Board und in Studio (mit Studios Verlauf) und in der Notiz als Block; das Häkchen setzt sie auf „Erledigt“.
- Termin → Besprechungsnotiz: Symbol im Kalender; der Kunde sieht „Notiz öffnen“ erst nach der Freigabe.
- Freelancer ohne bestätigten Code sieht keine Notizen seiner Kunden.
- Archivierter Kunde: Notizen verschwinden und kommen mit „Wiederherstellen“ zurück. Gelöschter Kunde: Notizen sind gelöscht.
- Handy: Liste, Seite und Blockmenü sind bedienbar, die Tab-Leiste verdeckt den Editor nicht, Tabellen scrollen seitlich in ihrem Kasten.
- Auf der Seite stehen nur Titelbild, Symbol, Titel und Text; alle Eckdaten erreicht man über das Zahnrad. Die Standardwerte für alle Notizen wirken auf neue Seiten.
- Seitenliste einklappen und wieder ausklappen; Fokus blendet Hub-Leiste, Kopf und Liste aus und stellt sie wieder her.
- Seitensymbol und Titelbild: gewählt, in Liste und Pfad sichtbar, nach dem Neuladen noch da. Ein Titelbild aus einer Datei „Nur Freelancer“ sieht der Kunde als ruhige Farbe.
- Emojis mit „:“ und Name im Text, in Hinweisboxen und als Seitensymbol sehen auf Mac, Windows und Android gleich aus.
- Linkvorschau: eine interne Adresse (etwa `127.0.0.1` oder `10.0.0.1`, auch über eine Weiterleitung) wird abgelehnt; eine normale Adresse ergibt eine Karte mit Bild aus der eigenen Dateiablage.
- Schriftgröße: am Handy „Klein“, am Mac „Groß“ gewählt; beide Geräte behalten ihre Wahl nach dem Neuladen, beim Laden springt nichts, und andere Personen sehen weiter ihre eigene Stufe. Bei „Klein“ und „Groß“ passen in eine Zeile so viele Zeichen wie bei „Mittel“.
