# DESIGN.md – oalab Client Hub

Kurzfassung der Designregeln für den Hub (Kunden-, Freelancer- und Admin-Ansichten). Neue Muster hier nachtragen,
sobald sie live sind. Die Serviceplattform (Chat und Studio) hat ihre eigene `DESIGN.md` im Repo `service-oalab`.

**Vorrang:** ausdrückliche Entscheidung des Nutzers → diese Datei → die vorhandenen Bausteine in `components/hub/`
und `app/glass.css`. Neue Ansichten bauen aus diesen Bausteinen, nicht aus eigenen Varianten.

## Grundsätze

1. **Glas außen, Tabellen innen.** Seitenleiste, Kopf und schwebende Knöpfe sind Glas; Inhalte stehen auf dem weißen
   Blatt `.sheet` (Tokens `--sheet-*`), in Zeilen statt Kacheln.
2. **Ein Akzent** (`--accent-text`, `--accent-rgb`) für Hauptaktion, Auswahl, Fokus und Kontur. Zustände nur über die
   Töne `--tone-ok | todo | info | bad | off` (je mit `-bg` und `-bar`) und `StatusGlyph`.
3. **Hell und dunkel nur über Tokens** (`:root[data-theme]`); keine festen Farben in Bausteinen.
4. **Texte auf Deutsch, mit „du“,** Alltagswörter, keine Technikbegriffe für Kundinnen und Kunden.
5. **Jeder Zustand ist gestaltet:** leer, laden, Fehler, langer Text, Handy.
6. **Dieses Repo ist öffentlich:** keine Kundennamen, Domains oder Zugangsdaten in Code, Doku, Beispielen oder Commits.

## Seitenaufbau

- `AppShell`: Seitenleiste links (ab Tablet), oben `hub-topbar`, auf dem Handy unten die Tab-Leiste.
- Jede Seite beginnt mit `LargeTitleHeader` (Bereichssymbol, Titel, `HeaderActions` mit Glocke und Assistent).
- Darunter das Blatt `.sheet.section-first`. Rückmeldungen nach einer Aktion stehen als `.calendar-notice` darüber.

## Seitenleiste

- Aufbau (`components/hub/glass-sidebar.tsx`): Marke, „Suchen ⌘K“, Übersicht und Insights, Abschnitt **Bereiche**
  (Projekte, Dateien – für Admins „Asset Management“ –, Vertrag & Domain, Nachrichten, Kalender), für Admins
  **Verwaltung** (User Management, KI-Protokoll, Schlüsselbund, Patch Notes), für Kunden **Neuigkeiten** (Patch Notes).
- Alle Navigationssymbole 19 px in Akzentfarbe (`sidebar-accent-icon`); die Bereichsfarben bleiben auf den Seiten.
- Zahlen rechts als `sidebar-count`, Ungelesenes und Offenes als `sidebar-count-alert` (mit `data-tip`).
- Unten die Ecke `sidebar-account`: Logo oder zwei Buchstaben, Name, darunter ein Punkt mit dem Paket; daneben ein
  Zahnrad mit Menü (Profil, Darstellung, Abmelden in Rot, Impressum, Datenschutz).
- Handy: Tab-Leiste mit fünf Einträgen; „Mehr“ führt zu allem, was dort keinen Platz hat.

## Liste links, Kunde rechts

Gilt für Asset Management, Vertrag & Domain, Nachrichten, Schlüsselbund und jede neue Admin-Ansicht „je Kunde“.

- Raster `.sheet.am` mit `.am-grid`: links die Liste (264–316 px), rechts `.am-pane`.
- Liste `.chat-list`: Kopf `h2` mit Anzahl, Suchfeld `.chat-search`, kleiner Umschalter `.chat-filter` (Zahl in
  Akzent), dann `ul.chat-convs`.
- Oben der Überblick (`.am-tile` mit Symbol), danach `am-list-label` „Kunden von A bis Z“.
- Jede Zeile `.chat-conv`: Kundenzeichen 40 px (Logo oder zwei Buchstaben, `CustomerSign`), Name fett, gedämpfte
  Unterzeile (Kundennummer · Stand), rechts höchstens eine Pille (`.chat-pill.tone-*`, z. B. „Gekündigt“).
  **Keine Kästen:** zwischen den Zeilen eine Linie, die erst beim Text beginnt.
- **Auswahl:** Tönung `--sheet-select` und links ein 3-px-Balken in Akzent (`aria-current`). Hover: `--sheet-hover`.
- Rechts der Kopf `.am-pane-head`: großes Zeichen, Name 17 px fett, Unterzeile 12,5 px gedämpft; Aktionen rechts
  (`sheet-action`, die Hauptaktion mit `is-primary`).
- Darunter `sheet-toolbar` (Suche, Umschalter, Menüs), der Inhalt in `.am-scroll`, unten `sheet-footer`
  (links die Anzahl, rechts ein Hinweis).
- Die Auswahl steht in der URL (`?customer=`), damit Links aus Glocke, Suche und Assistent dort landen.
- Unter 820 px Blattbreite eine Spalte: erst die Liste, dann der Kunde mit Zurück-Pfeil (`.chat-back`).

## Tabellen und Gruppen

- `file-table` und `project-table`: Kopfzeile 34 px, 12 px gedämpft; Zeilen 40 px in der Ansicht „Detail“,
  niedriger in „Minimal“ (Einstellung `appearance.listView`, Umschalter Minimal | Detail).
- Eine Angabe pro Zelle; eine zweite Angabe steht als `small` darunter.
- Gruppen mit `TableGroup`: Pfeil, Zeichen, Name, Anzahl, rechts Aktionen und ⓘ; zuklappbar.
- Spalten treten bei schmaler Fläche zurück (Container-Abfragen); auf dem Handy werden Zeilen zu zweizeiligen Karten.
- Sortieren über `SortHeader` und `SortControl`, Filter und Gruppen über `ToolbarMenu`.

## Zeilen markieren: der Schleier

Seit 9.11.2026 im User Management (Zugänge), Vorbild für jeden Zustand einer ganzen Zeile, etwa den Status eines
Projekts. **Die Zeile trägt die Farbe, nicht ein Knopf.**

- **Schleier über die ganze Zeile:** auf der linken Hälfte voll in der Zustandsfarbe, nach rechts transparent
  auslaufend: `background-image: linear-gradient(to right, var(--row-veil) 0%, var(--row-veil) 50%, transparent 100%)`
  am `tr`.
- **Balken links:** 4 px breit, rund, 4 px vom Rand und 8 px von oben und unten (`td:first-child::before`), in der
  Balkenfarbe des Zustands. Auf dem Handy, wo Zeilen Karten sind, läuft er als `inset`-Schatten über die ganze Karte.
- **Farben:** Rot `--veil-none` mit Balken `--veil-none-bar` für Probleme (ohne Zugang, gefährdet), Gelb `--veil-open`
  mit `--veil-open-bar` für Wartendes (noch nie angemeldet, pausiert). Weitere Zustände nehmen einen schwachen Schleier
  ihres Tons (höchstens etwa 8 % Deckkraft) und `--tone-*-bar` als Balken. Zustände ohne Handlungsbedarf dürfen
  ungefärbt bleiben.
- **Geöffnete Zeile:** Tönung in Akzent (7 %) und Balken in `--accent-text`; sie liegt über dem Schleier.
- **Hover** färbt die Zeile unter dem Schleier (`background-color` am `tr`, die Zellen bleiben durchsichtig), sonst
  würden die Zellen den Schleier verdecken.
- **Legende** rechts im Fuß (`sheet-footer`): ein Punkt je Farbe (`.veil-dot`) mit Anzahl, z. B. „2 ohne Zugang“; nur
  die Farben, die gerade vorkommen.
- **Knöpfe in markierten Zeilen bleiben klein und ruhig:** z. B. ein Status-Auswahlfeld 24 px hoch, weiße Fläche mit
  Haarlinie, Text 12 px; nur das Zustandszeichen trägt die Farbe. Es öffnet die Hub-Liste und trägt offen die
  Akzent-Kontur.

## Panels zum Ansehen und Bearbeiten

- `AssetPanel` (`.am-panel`); im User Management und für Einträge „je Kunde“ schwebend am rechten Rand (`.um-panel`,
  bis 480 px breit). Kein Dialog: Liste und Kunde bleiben daneben benutzbar.
- Kopf: Zeichen, Titel, Unterzeile, Schließen. Abschnitte `.um-sec` mit Überschrift (13 px) und Meta rechts;
  Felder `.um-field` mit `.am-label` und `.am-input` / `.am-textarea`, zweispaltig in `.um-grid`.
- Fuß: links „Abbrechen“, rechts die Hauptaktion. Escape schließt zuerst eine offene Liste, dann das Panel; der
  Fokus kehrt dorthin zurück, wo er herkam.

## Auswahllisten (Dropdowns)

Seit 12.11.2026 (Vorschlag „Studio“), verbindlich für jede Auswahl im Hub:

1. **Nie die Liste des Browsers:** kein `<select>`, kein `<datalist>`. Immer `Select` oder `SuggestInput` aus
   `components/hub/select.tsx` (geprüft in `tests/hub-select.test.mjs`).
2. Das Feld bleibt, die Liste öffnet als **weißes Blatt wie die Tabellen**: `--menu-bg`, Radius `--menu-radius`
   (12 px), Innenabstand `--menu-pad` (5 px), Zeilen `--menu-item-h` (34 px) mit Radius 8 px.
3. Die Wahl trägt ein **Häkchen** und die Tönung `--menu-selected`; Hover und Pfeiltasten markieren eine Zeile mit
   `--menu-hover` (`.is-active`).
4. Optionen können vorne ein Zeichen haben (Symbol, Farbpunkt `toneDot`, Logo `customerOption`), davor gedämpft eine
   Nummer (`prefix`) und rechts eine Zahl oder Notiz (`meta`); lange Listen bekommen Gruppen-Überschriften (`group`).
5. **Ab 11 Einträgen** oben ein Suchfeld und unten die Tastenhilfe (↑ ↓ wählen, ↵ übernehmen, esc schließen).
6. Die Liste **schwebt im Top-Layer** (Popover API): unter dem Feld, darüber, wenn dort mehr Platz ist, nie über den
   Bildschirmrand. Sie ist mindestens so breit wie ihr Feld (mindestens 200 px), bei `variant="field"` genau so breit.
7. Solange die Liste offen ist, trägt das Feld die **Akzent-Kontur** `--select-open-ring`.
8. **Tastatur wie ein natives Select:** Pfeile, Pos1/Ende, Buchstaben springen, Enter übernimmt (und speichert keinen
   Dialog), Escape schließt nur die Liste.
9. **Handy:** ein Blatt von unten mit Griff, Titel und Schließen, Zeilen 46 px, ohne Tastenhilfe.
10. **Bauformen:** in Panels `.um-pick` (Zeichen links, `Select variant="bare"`, rechts `ChevronDown` 16 px); in
    Filtermenüs `.customer-filter` (Symbol und `Select variant="bare" chevron` mit `ChevronsUpDown`); in Glas-Formularen
    `variant="field"`. Ein eigener Auslöser (z. B. eine Status-Pille) nutzt dieselbe Liste und dieselbe Kontur.
11. Alle anderen Menüs (`ToolbarMenu` mit `.sheet-pop`, das „Mehr“-Menü, das Zahnrad-Menü) stehen auf derselben
    Fläche; Auswahlen darin sind `.sheet-choice` mit Häkchen.

## Hover-Hinweise („Konturfenster“)

1. **Nie `title=`** an einem Element, immer `data-tip` (Text). Dazu `data-tip-sub` (zweite, leichtere Zeile),
   `data-tip-kbd` (Tastenkürzel) oder `data-tip-compact` mit `data-tip-label` (nur, wenn der Knopftext versteckt ist).
2. **Eine Ebene für den ganzen Hub** (`TooltipLayer` in `components/hub/tooltip.tsx`): dunkles Schild `--tip-bg` mit
   Pfeil über dem Element, darunter, wenn oben kein Platz ist.
3. Erscheint **nach 0,4 s**, beim Wechsel zum Nachbarn sofort, auch bei Tastaturfokus; verschwindet bei Klick,
   Scrollen und Escape.
4. Kein Hinweis, solange die Liste des Elements offen ist; keiner auf Geräten ohne Hover (Handy).
5. Nur Text, nie HTML.

## Kontur und Auswahl: Hover, Klick, Fokus

| Zustand | Aussehen | Wo |
| --- | --- | --- |
| Hover in Listen und Tabellen | Fläche `--sheet-hover` (in Menüs `--menu-hover`) | Zeilen, `.chat-conv`, Menüpunkte |
| Gewählter Eintrag in der Liste links | Tönung `--sheet-select` und 3-px-Balken in Akzent am Rand | `.chat-conv` (`aria-current`) |
| Zustand einer Tabellenzeile | Schleier nach rechts auslaufend und runder 4-px-Balken in der Zustandsfarbe | siehe „Zeilen markieren“ |
| Geöffnete Tabellenzeile | Tönung in Akzent (7 %) und runder 4-px-Balken in Akzent, über dem Schleier | Zeile, deren Panel offen ist |
| Gewählte Option | `--menu-selected`, Akzentschrift, Häkchen | Auswahllisten, `.sheet-choice` |
| Suchfeld aktiv, Liste offen | Akzent-Kontur: Linie 1 px innen plus 3 px Hof (`--select-open-ring`) | `.sheet-search`, `.chat-search`, `.um-pick`, Filter, Status-Pillen |
| Eingabe in Panels | Linie 2 px in Akzent innen | `.am-input`, `.am-textarea` |
| Tastaturfokus auf Knöpfen | Ring `0 0 0 3px var(--focus-gap), 0 0 0 6px var(--accent-text)` | Knöpfe, Karten, Ablagezonen |
| Tastaturfokus in Tabellen | Ring um die ganze Zeile | `.project-row` |

## ⓘ „Kurz erklärt“

- Jede Sonderfunktion bekommt ein ⓘ an der Stelle, wo man sie benutzt (`useInfo` aus `components/hub/info-box.tsx`).
- Höchstens drei Zeilen, jede mit fettem Anfang und höchstens 64 Zeichen, dazu eine Frage für „Mehr dazu im
  Assistenten“. Lange Erklärungen gehören nach `lib/hub-assistant/knowledge.ts`, jede Stelle in
  `tests/info-boxes.test.mjs`.

## Zeichen und Status

- Zustände mit `StatusGlyph` und den Tönen, Pillen `.chat-pill.tone-*`. Keine eigenen Farben für Zustände.
- Kunden und Firmen erscheinen als Logo oder zwei Buchstaben (`CustomerSign`, `LogoMark`), das oalab-Team mit dem
  oalab-Logo.

## Bewegung

- Ein Schalter für Hub und Service (Darstellung › Bewegung, Cookie `oalab_reduce_motion`, Attribut
  `data-reduce-motion`). Die Geräteeinstellung wird nicht gelesen: kein `prefers-reduced-motion` in CSS oder Code
  (geprüft in `tests/appearance.test.mjs`); das Abschalten steht in `app/motion.css`.

## Prüfen

- `npx tsc --noEmit`, `npm run lint`, `npm test`.
- Sichtprüfung hell und dunkel bei 1280, 1440 und 1920 px sowie 390 px (Handy).
- Admin-Ansichten lokal über eine temporäre Seite unter `app/preview/` mit `role="oalab_admin"`; danach die Seite und
  `.next/dev` löschen.
