# Planung: Einklappbare Sidebar und mitwachsender Arbeitsbereich

Stand 22. November 2026 · Vorschau V3 freigegeben („Passt, umsetzen“) · umgesetzt auf dem Branch `feat/sidebar-liquid-glass` mit den Empfehlungen aus Abschnitt 6

Dieser Plan beschreibt zwei Änderungen für den Hub am Rechner, also ab 1024 px Fensterbreite:

1. **Die Sidebar lässt sich einklappen.** Eingeklappt bleibt eine schmale Leiste mit den Symbolen. Fährt man mit der Maus über ein Symbol, steht der Name daneben. Der Arbeitsbereich rechts bekommt so 200 px mehr Platz, vor allem für Notizen, Aufgaben, Kalender und Tabellen.
2. **Der Arbeitsbereich wächst mit dem Bildschirm.** Heute endet der Inhalt bei 1040 px (Tabellen-Seiten 1240 px, Board und Kalender 1720 px). Auf einem 4K-Monitor bleibt so mehr als die Hälfte der Fläche leer. Künftig nutzt jede Seite die ganze Breite neben der Sidebar.

Handy und Tablet (unter 1024 px) bleiben, wie sie sind: unten die Tab-Leiste, oben das Logo.

Vorschau (privat): https://claude.ai/artifact/STafMcH7JjbQMvJkajNME7 mit den Seiten „V3 · Klares Glas“ (Stand dieses Plans), „V2 · Liquid Glass“, „V1 · Sidebar einklappen“ (MacBook Pro 14″, 1512 × 982) und „Breite auf 4K“ (2560 × 1440, dazu Full HD). Die Flächen sind bedienbar: Der Knopf klappt ein und aus, über den Symbolen gleitet ein Glastropfen und erscheinen die Namen, Übersicht, Aufgaben, Notizen, User Management und Darstellung lassen sich anklicken. Die Fläche „Animation“ spielt Tropfen und Ein- und Ausklappen von selbst ab.

V2 (22. November 2026) setzt die Rückmeldung zu V1 um: runde Auswahl wie bei Glocke und Assistent oben rechts, ein Liquid-Glass-Effekt statt bloßem Aufhellen, ein Tropfen beim Darüberfahren, federndes Ein- und Ausklappen und eingerückte Unterpunkte mit Verbindungslinie auch im eingeklappten Zustand (Abschnitt 1.7). V3 (am selben Tag) setzt die Rückmeldung zu V2 um: Der Knopf zum Ein- und Ausklappen ist ein Griff am Rand der Sidebar, weiter unten, damit um das Logo Platz bleibt, und das Glas ist klarer, nach dem Vorbild von Apple.

Grundlage ist der Code auf `main` vom 22. November 2026 (nach #141). Notizen (`feat/notizen`) und Kalender-Abo (`feat/kalender-abo`) entstehen parallel; Abschnitt 5 regelt das Zusammenspiel.

## Auf einen Blick

| Frage | Vorschlag |
|---|---|
| Für wen | alle Rollen am Rechner ab 1024 px; Handy und Tablet unverändert |
| Sidebar | ausgeklappt wie heute (272 px) oder eingeklappt (72 px, nur Symbole) |
| Umschalten | runder Griff aus Glas am rechten Rand der Sidebar, zwischen Suche und Einträgen; er fährt mit dem Rand mit; dazu ⌘ . (Windows: Strg + .) |
| Aussehen | runde Formen aus Liquid Glass: ausgeklappt Kapseln, eingeklappt Kreise, wie Glocke und Assistent oben rechts; beim Darüberfahren gleitet ein Glastropfen von Eintrag zu Eintrag; Ein- und Ausklappen federt |
| Darüberfahren | eingeklappt zusätzlich der Name rechts neben dem Symbol, bei Zahlen mit zweiter Zeile, z. B. „Nachrichten · 1 ungelesen“ |
| Unterpunkte | Aufgaben, Kalender und Notizen nach rechts versetzt, mit Verbindungslinie zu Projekte, auch eingeklappt |
| Merken | je Gerät, wie Breite und Listenansicht; beim Laden springt nichts |
| Arbeitsbereich | jede Seite nutzt die ganze Breite neben der Sidebar; Tabellen, Board, Kalender und Panels ziehen sich mit, die Übersicht stellt die Widgets neben die Benachrichtigungen, Profil und Darstellung ordnen ihre Karten in Spalten |
| Lesbarkeit | Fließtext bleibt schmal (Notizen 720 px, Seite „Breit“ 980 px); Dialoge, Menüs und Fenster behalten ihre Größe |
| Darstellung › Breite | „Standard“ wächst künftig mit, „Breit (XL)“ bleibt der Modus bis knapp an den Rand |
| Umfang | klein bis mittel: ein PR im Hub, vor allem CSS; keine Datenbank, kein `service-oalab` |

## 1. Die Sidebar einklappen

### 1.1 Ausgeklappt (wie heute)

Alles bleibt, wie es ist: 272 px breites Glas, 12 px vom Rand, Logo, Suche, Bereiche mit Zahlen, Konto-Ecke mit Zahnrad. Neu ist nur ein runder Griff aus Glas (28 px) am rechten Rand, in der Fuge zwischen Suche und Einträgen: halb auf der Sidebar, halb daneben, mit einem Pfeil nach links. Er fährt beim Ein- und Ausklappen mit dem Rand mit, und um das Logo bleibt der Abstand frei. Sein Hinweis lautet „Sidebar einklappen“ mit „⌘ .“.

### 1.2 Eingeklappt

Eine 72 px schmale Leiste im selben Glas, mit derselben Rundung und denselben 12 px Abstand zum Rand. Sie zeigt dieselben Einträge in derselben Reihenfolge, nur als Symbole:

- oben das Logo (führt zur Übersicht) mit freiem Raum darum; der Griff zum Ausklappen sitzt am rechten Rand an derselben Stelle wie ausgeklappt, der Pfeil zeigt nach rechts
- die Lupe für die Suche
- Übersicht und Insights
- eine feine Linie statt der Überschrift „Bereiche“, dann Projekte mit Aufgaben, Kalender und künftig Notizen direkt darunter, Dateien (Admins: Asset Management), Vertrag & Domain (Freelancer: Kunden), Nachrichten
- eine feine Linie statt „Verwaltung“ (Admins: User Management, KI-Protokoll, Schlüsselbund) beziehungsweise „Neuigkeiten“, dann Patch Notes
- unten das Profilbild, bei Kunden mit Logo das Logo

Der aktive Bereich liegt in einem Kreis aus Glas (Abschnitt 1.7). Auf Aufgaben, Kalender und Notizen bleibt Projekte als Elternpunkt markiert. Unterpunkte behalten ihr etwas kleineres Symbol, sitzen etwas nach rechts versetzt und hängen über eine feine Linie an Projekte, wie ausgeklappt.

Zahlen: Reine Mengen (Projekte, Dateien) entfallen in der Leiste und stehen im Hinweis. Zahlen, die etwas verlangen (ungelesene Nachrichten, offene Registrierungen), bleiben als kleiner Punkt mit Zahl oben rechts am Symbol, wie in der Tab-Leiste am Handy.

### 1.3 Hinweis beim Darüberfahren

Der Hub hat seit dem 12. November eine eigene Hinweis-Ebene: ein dunkles Schild mit Pfeil, nach 0,4 s, sofort beim Weiterfahren zum Nachbarn, auch bei Tastaturfokus. Die Leiste nutzt sie, mit einer Neuerung: Das Schild steht rechts neben dem Symbol, der Pfeil zeigt nach links.

- Name des Bereichs; bei Unterpunkten zusätzlich „Unter Projekte“.
- Zahlen als zweite, hellere Zeile: „3 Projekte“, „1 ungelesen“, „2 offene Registrierungen“.
- Suche mit „⌘K“, der Knopf mit „⌘ .“.
- Profilbild: Name und Pakete (beim Team „oalab-Team“).
- Nur eingeklappt; ausgeklappt stehen die Namen ohnehin da.

### 1.4 Konto-Ecke

Eingeklappt bleibt nur das Profilbild. Ein Klick öffnet das bekannte Konto-Menü (Profil, Darstellung, Abmelden, Impressum · Datenschutz), rechts neben der Leiste und unten bündig, weil 72 px dafür zu schmal sind. Oben im Menü stehen zusätzlich Name und Pakete, die in der Leiste fehlen. Ausgeklappt bleibt alles wie heute: Der Name führt zum Profil, das Zahnrad öffnet das Menü.

### 1.5 Umschalten, merken, Bewegung

- Knopf oder ⌘ . (Windows: Strg + .) klappt ein und aus. Das Kürzel ist im Hub frei und liegt auf deutschen Tastaturen ohne Umweg; in Textfeldern und im Editor der Notizen hat es keine andere Bedeutung.
- Der Zustand gilt je Gerät und liegt im Browser beim Erscheinungsbild (`oalab-hub-appearance`), wie Breite und Listenansicht. Das Skript vor dem ersten Bild setzt ihn an `<html>`, sodass eine eingeklappte Sidebar beim Laden nicht erst breit erscheint.
- Neue Geräte starten ausgeklappt, also wie heute.
- Die Sidebar klappt federnd ein und aus (Abschnitt 1.7); der Arbeitsbereich zieht weich mit. Mit „Bewegung reduzieren“ wechselt sie ohne Animation.
- Bildschirmleser: Der Knopf heißt „Sidebar einklappen“ oder „Sidebar ausklappen“ und meldet, ob sie offen ist. Jeder Eintrag behält seinen Namen, eingeklappt nur unsichtbar; für Bildschirmleser ändert sich also nichts.

### 1.6 Notizen und andere Stellen

- **Notizen:** Der Fokus blendet die Sidebar ganz aus (Entscheidung 15 im Notizen-Plan). Nach dem Fokus kehrt sie in den Zustand davor zurück, also ein- oder ausgeklappt. Die Seitenliste der Notizen (264 px) klappt weiter für sich ein. Mit eingeklappter Sidebar passt am MacBook eine Seite in „Breit“ (980 px) bequem neben die Seitenliste.
- Die kompakte Titelleiste beim Scrollen, der angedockte Assistent und die Fenster am rechten Rand (Aufgabenfenster, User-Panel) richten sich nach der neuen Breite.
- Unter 1024 px gibt es weder Knopf noch Kürzel; dort bleibt die Tab-Leiste.

### 1.7 Aussehen und Bewegung (Vorschau V2)

- **Runde Formen:** Alles, was man in der Sidebar anklickt, ist rund wie Glocke und Assistent oben rechts. Ausgeklappt sind Auswahl, Suche und Konto Kapseln mit runden Enden, eingeklappt Kreise (Einträge 40 px, Unterpunkte 34 px). Beim Einklappen wird aus der Kapsel ein Kreis. Das Symbol bleibt dabei an seiner Stelle. Einklappen, Zahnrad, Glocke und Assistent sind runde Knöpfe aus demselben Glas.
- **Klares Liquid Glass statt Aufhellen (V3):** Das Glas ist klar wie bei Apple, ohne milchigen Schleier, ohne dunkle Innenschatten und ohne Unschärfe in der Mitte. Seine Form zeigt sich nur durch einen feinen Lichtrand, der oben links und unten rechts heller ist und an den Seiten fast verschwindet, durch Brechung in einem schmalen Band am Rand und durch einen weichen Schatten. Die Auswahl ist dasselbe Glas mit einem Hauch Akzentfarbe. Beim Darüberfahren liegt ein Glastropfen über dem Eintrag; Symbol und Name bleiben darunter scharf und in voller Farbe. Ein schwaches Licht von innen folgt der Maus, das Symbol darunter wächst leicht wie unter einer Lupe.
- **Tropfen:** Es gibt genau einen Tropfen. Er gleitet beim Darüberfahren von Eintrag zu Eintrag, dehnt sich in der Bewegung, federt beim Ankommen nach und zerfließt, wenn die Maus die Sidebar verlässt. Mit der Tastatur folgt er dem Fokus. Ausgeklappt und eingeklappt verhält er sich gleich.
- **Ein- und Ausklappen federt:** Die Leiste schwingt beim Ausklappen etwa 18 px über ihre Breite hinaus und beim Einklappen etwa 12 px darunter, dann federt sie zurück (gedämpfte Feder, 0,8 s). Namen blenden beim Einklappen sofort aus und beim Ausklappen kurz verzögert ein. Der Arbeitsbereich zieht weich mit, ohne zu federn, damit die Seite ruhig bleibt.
- **Variante Kreis:** Ausgeklappt kann die Auswahl statt einer Kapsel auch nur ein Kreis um das Symbol sein (Fläche „Variante Kreis“); der Name steht dann ohne Fläche in der Akzentfarbe daneben (Entscheidung 10).
- **Browser:** Die Brechung im Glas läuft über einen SVG-Filter und zeigt sich in Chrome, Edge und der Claude-App. Safari und Firefox zeigen denselben Tropfen mit Rand, Lichtpunkt und Bewegung, nur ohne Brechung.
- **Rücksicht:** Mit „Bewegung reduzieren“ springt die Sidebar ohne Federn, und der Tropfen erscheint ohne Gleiten. Mit „Transparenz reduzieren“ ist das Glas deckend, ohne Unschärfe und Brechung.

## 2. Der Arbeitsbereich wächst mit

### 2.1 Heute

Gemessen in der Designvorschau (`/preview`), Fenster in CSS-Pixeln, Sidebar ausgeklappt, Breite „Standard“. Platz neben der Sidebar = Fensterbreite − 340 px (12 px Rand, 272 px Sidebar, zweimal 28 px Abstand):

| Bildschirm | Platz neben der Sidebar | Übersicht, Insights, Profil | Tabellen-Seiten | Aufgaben, Kalender |
|---|---|---|---|---|
| MacBook Pro 14″ (1512 × 982) | 1172 px | 1040 px | 1172 px | 1172 px |
| Full HD (1920 × 1080) | 1580 px | 1040 px | 1240 px | 1580 px |
| 4K mit 150 % (2560 × 1440) | 2220 px | 1040 px (47 %) | 1240 px (56 %) | 1720 px (77 %) |
| 4K mit 100 % (3840 × 2160) | 3500 px | 1040 px (30 %) | 1240 px (35 %) | 1720 px (49 %) |

„Breit (XL)“ hilft nur teilweise: Tabellen reichen bis an den Rand, alle anderen Seiten enden bei 1240 px. Eingeklappt kommen künftig überall 200 px dazu.

### 2.2 Neu: jede Seite nutzt die ganze Breite

Der Inhalt hat keine feste Höchstbreite mehr. Jede Seite beginnt links an derselben Stelle neben der Sidebar und endet 28 px vor dem rechten Rand (bei „Breit (XL)“ 12 px). Titel, Glocke und Assistent springen beim Seitenwechsel also nicht mehr hin und her, wie heute zwischen 1040, 1240 und 1720 px.

Damit nichts nur in die Breite gezogen wird, ordnet jede Art von Seite ihren Inhalt:

| Art | Seiten | So nutzt sie die Breite |
|---|---|---|
| Arbeitsflächen | Projekte, Aufgaben, Kalender, Dateien und Asset Management, Nachrichten, Vertrag & Domain, User Management, KI-Protokoll, Schlüsselbund, Patch Notes, Kunden (Freelancer), künftig Notizen | ziehen sich auf die ganze Breite: breitere Spalten im Board und Tage im Kalender, mehr Platz für Gesprächs- und Detailbereiche; Tabellen kürzen Namen, E-Mails und Firmen nicht mehr, und Spalten, die heute in schmalen Fenstern wegfallen, bleiben länger sichtbar |
| Übersichten | Übersicht, Insights | Willkommen-Karte über die ganze Breite; ab etwa 1500 px Platz stehen die beiden Widget-Stapel nebeneinander rechts der Benachrichtigungen statt untereinander (also ab Full HD); Kennzahlen und Karten der Insights in mehr Spalten |
| Einstellungen | Profil, Darstellung | Karten nebeneinander in Spalten von mindestens 460 px; am MacBook zwei, auf 4K vier; jede Karte behält eine gute Breite |

Was schmal bleibt:

- Fließtext: Notizen 720 px (Seite „Breit“ 980 px), Einleitungen wie in den Patch Notes 680 px, Chat-Blasen wie heute.
- Dialoge, Menüs, Hinweise und Fenster am Rand (Glocke, Suche, Aufgabenfenster) behalten ihre Größe.

### 2.3 Darstellung › Breite

Heute: „Standard“ (1040 px, Tabellen 1240 px) und „Breit (XL)“ (12 px Rand, Tabellen bis an den Rand und bis unten). Neu:

- **Standard** wächst mit dem Bildschirm wie oben beschrieben, mit 28 px Rand.
- **Breit (XL)** bleibt der Modus „wie ein Programm im Vollbild“: 12 px Rand, Tabellen und Panels reichen auf jeder Seite bis knapp über den unteren Rand.
- Der Text unter der Wahl wird angepasst: „Standard nutzt die ganze Fläche neben der Sidebar und wächst mit dem Bildschirm. Breit (XL) rückt bis knapp an den Rand, auch nach unten. Auf Handy und Tablet bleibt alles gleich.“
- Eine Wahl für die alte feste Breite gibt es nicht mehr (Entscheidung 6).

## 3. Technik

- `lib/appearance.ts`: neues Feld `sidebar` (`expanded` | `collapsed`, Standard `expanded`) im Erscheinungsbild; `normalizeAppearance` und `resolveAppearance` lesen es, `applyAppearanceToDocument` setzt `data-sidebar` an `<html>`. Damit übernimmt es das Skript vor dem ersten Bild von selbst. Ungültige oder fehlende Werte ergeben „ausgeklappt“.
- `components/hub/glass-sidebar.tsx`: Knopf zum Ein- und Ausklappen mit `aria-expanded` und `aria-controls`. Alle Einträge laufen über eine kleine gemeinsame Funktion, die Symbol, Namen, Zahl, Punkt und Hinweis setzt (`data-tip-compact`, `data-tip-label` am sichtbaren Namen, `data-tip-sub` für die Zahl, `data-tip-side="right"`), damit spätere Einträge wie Notizen von selbst passen. Konto-Menü eingeklappt rechts neben der Leiste, mit Namen und Paketen oben.
- `components/hub/app-shell.tsx`: Kürzel ⌘ . neben ⌘K; schreibt über `useAppearance` denselben Wert wie der Knopf.
- Liquid Glass (V2): ein Tropfen-Element in der Sidebar, dessen Lage und Größe ein Zeiger-Handler über CSS-Variablen setzt; Federkurven als CSS `linear()` (gedämpfte Feder, in Chrome, Safari und Firefox); Brechung über einen SVG-Filter (`feTurbulence` und `feDisplacementMap`) auf einer Glasschicht, die nur am Rand sichtbar ist; Auswahl und runde Knöpfe als Glas mit Randlicht und Schatten. Gilt für `glass-sidebar.tsx`, `HeaderActions` in `app-shell.tsx` und `components/hub/glass.tsx` (runde Knöpfe). Einträge bekommen eine runde Hülle um das Symbol; Unterpunkte die Klasse für Versatz und Linie.
- `components/hub/tooltip.tsx`: `data-tip-side="right"` stellt das Schild rechts neben das Element, der Pfeil zeigt nach links; reicht der Platz rechts nicht, fällt es auf oben oder unten zurück. `data-tip-compact` zeigt den Hinweis schon heute nur, solange der Name verborgen ist; das nutzt die eingeklappte Leiste.
- `app/glass.css`: Variable `--sidebar-w` (272 px, eingeklappt 72 px) statt der festen 272 px in `.hub-main`, `.compact-nav` und dem XL-Block; Stile der Leiste unter `:root[data-sidebar="collapsed"]` ab 1024 px; Übergang nur ohne `data-reduce-motion="true"`; `.hub-content`, `.hub-notice` und `.hub-topbar` ohne Höchstbreite; die Regel für Tabellen-Seiten (1240 px) und die Mittelung der kompakten Titelleiste ab 1404 px entfallen.
- `app/tasks.css`, `app/calendar.css`: die Grenze von 1720 px entfällt.
- `app/overview.css`: Widget-Stapel nebeneinander, sobald die Fläche breit genug ist (Container-Abfrage um `.nt-zone`); Raster der Insights mit mehr Spalten.
- Profil und Darstellung: Kartenstapel in Spalten (`columns: 460px`), Karten brechen nicht über zwei Spalten.
- Tabellen: die festen Höchstbreiten einzelner Zellen (Namen 170 px, E-Mail 180 bis 200 px, Firma 160 px) gelten nur noch, solange das Blatt schmal ist.
- Durchsehen, was heute auf 1240 px gebaut ist: Vertrag & Domain und Asset Management (`.am`), Projekte für Admins, User Management, Schlüsselbund, KI-Protokoll, Patch Notes. Ihre Container-Abfragen (`@container sheet`) blenden Spalten nur bei schmaler Breite aus; das passt.
- Darstellung: Text der Karte „Breite“.
- Wissen des Assistenten (`lib/hub-assistant/knowledge.ts`), `/hub-hilfe`, Patch Notes.
- Tests: `tests/appearance.test.mjs` prüft, dass ein gespeichertes Erscheinungsbild ohne Sidebar-Wert „ausgeklappt“ ergibt, ein ungültiger Wert ebenso, und dass `data-sidebar` gesetzt wird.

## 4. Umfang und Reihenfolge

Ein PR im Hub, keine Migration, kein Eingriff in `service-oalab`. Sidebar und Breite gehen zusammen live, weil beide an denselben Stellen ansetzen (Breite der Sidebar, Rand des Inhalts) und eine Abnahme reicht. Patch Notes für Kunden und Freelancer: „Neu: Sidebar einklappen“ und „Verbessert: Mehr Platz auf großen Bildschirmen“.

Vor dem Livegang einmal jede Seite auf 1512, 1920, 2560 und 3840 px Breite ansehen, je ein- und ausgeklappt, hell und dunkel, als Admin, Kunde und Freelancer (Abschnitt 7).

## 5. Zusammenspiel mit Notizen und Kalender-Abo

- **Notizen** (`feat/notizen`) ändert ebenfalls `glass-sidebar.tsx` (neuer Unterpunkt), `lib/appearance.ts` (Schriftgröße je Gerät) und `components/hub/screens/appearance.tsx`. Die Überschneidungen sind klein. Empfehlung: Sidebar und Breite zuerst, weil kleiner; Notizen übernimmt danach `main` und hängt den Unterpunkt über die gemeinsame Funktion ein, damit er eingeklappt Symbol und Hinweis hat.
- Der Fokus der Notizen blendet die Sidebar über ein eigenes Kennzeichen aus; der gemerkte Zustand der Sidebar bleibt davon unberührt.
- **Kalender-Abo** (`feat/kalender-abo`) legt im Profil eine neue Karte an; sie reiht sich in die neuen Spalten ein. Der Kalender selbst wird breiter, sonst ändert sich für das Abo nichts.
- Patch-Notes-Pakete: Wer am selben Tag als Zweiter live geht, legt seine Einträge ins Paket des Tages.

## 6. Entscheidungen

Am 22. November 2026 mit der Freigabe von V3 entschieden: Umgesetzt ist jeweils die Empfehlung.

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Wo sitzt der Knopf zum Ein- und Ausklappen? | Entschieden am 22.11.2026: runder Griff am rechten Rand, zwischen Suche und Einträgen (V3) |
| 2 | Tastenkürzel ⌘ . (Windows: Strg + .)? | Ja |
| 3 | Zustand je Gerät merken, neue Geräte starten ausgeklappt? | Ja |
| 4 | Eingeklappt öffnet das Profilbild das Konto-Menü (statt eines eigenen Zahnrads)? | Ja |
| 5 | Eingeklappt nur Zahlen mit Handlungsbedarf als Punkt am Symbol, alle anderen im Hinweis? | Ja |
| 6 | „Standard“ wächst künftig mit, ohne Wahl für die alte feste Breite? Alternative: dritte Wahl „Kompakt“ mit 1040 px | Ja, ohne „Kompakt“ |
| 7 | Übersicht: Widget-Stapel ab etwa 1500 px Platz nebeneinander? | Ja |
| 8 | Profil und Darstellung: Karten in Spalten nebeneinander? | Ja |
| 9 | Sidebar und Breite vor den Notizen live bringen? | Ja |
| 10 | Auswahl ausgeklappt als Kapsel über die ganze Zeile oder nur als Kreis um das Symbol? | Kapsel (Kreis bleibt eingeklappt) |
| 11 | Brechung im Glas nur dort, wo der Browser sie kann (Chrome, Edge), sonst derselbe Tropfen ohne Brechung? | Ja |
| 12 | Glocke, Assistent und die anderen runden Knöpfe im ganzen Hub ebenfalls aus Liquid Glass? | Ja, im selben PR |

## 7. Abnahme

- Knopf und ⌘ . klappen ein und aus; nach dem Neuladen bleibt der Zustand, beim Laden springt nichts.
- Eingeklappt zeigt jedes Symbol beim Darüberfahren und bei Tastaturfokus seinen Namen rechts daneben; ausgeklappt erscheint kein doppelter Hinweis.
- Ungelesene Nachrichten und offene Registrierungen sind eingeklappt als Punkt mit Zahl zu sehen.
- Konto-Menü eingeklappt: öffnet rechts neben der Leiste; Profil, Darstellung, Abmelden, Impressum und Datenschutz funktionieren; Escape schließt es.
- „Bewegung reduzieren“: Ein- und Ausklappen ohne Animation, der Tropfen ohne Gleiten.
- Tropfen: folgt der Maus und dem Tastaturfokus über alle Einträge, ausgeklappt und eingeklappt; Symbol und Name bleiben darunter lesbar, hell und dunkel.
- Unterpunkte: ausgeklappt und eingeklappt nach rechts versetzt, die Linie zu Projekte durchgehend sichtbar.
- Ein- und Ausklappen federt sichtbar, ohne dass Einträge über den Rand der Leiste ragen.
- Unter 1024 px sieht alles aus wie heute.
- Auf 1512, 1920, 2560 und 3840 px Breite, je ein- und ausgeklappt: Jede Seite nutzt die ganze Breite, nirgends eine waagrechte Scrollleiste, kein Blatt endet vor dem rechten Rand.
- Übersicht: ab Full HD stehen die Stapel nebeneinander, am MacBook untereinander wie heute.
- Profil und Darstellung: Karten in Spalten, keine Karte schmaler als 460 px.
- Notizen: Text bleibt 720 px (Breit 980 px) breit; Fokus blendet die Sidebar aus und stellt den vorigen Zustand wieder her.
- Assistent angedockt: Der Arbeitsbereich wird schmaler, nichts liegt übereinander.
- „Breit (XL)“: 12 px Rand und bis unten wie bisher.
- Hell und dunkel, Admin, Kunde und Freelancer.
