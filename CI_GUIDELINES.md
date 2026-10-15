# oalab Corporate Identity

Stand: 15. Oktober 2026. Diese Vorgaben gelten für Anmeldung, Client Hub und zukünftige oalab-Oberflächen. Die Startseite zeigt direkt den Login. Der Plattformname lautet **oalab**, durchgehend kleingeschrieben. Die Produktbezeichnung ist **oalab Client Hub**.

## Logos

Das gelieferte Hauptlogo liegt unverändert in `public/brand/oalab-logo.png`. Seine weißen und silbernen Elemente benötigen einen dunklen Hintergrund; auf weißen Flächen wird es deshalb auf einer Fläche mit dem Markenverlauf dargestellt. Das Logo wird weder nachgebaut noch umgefärbt, verzerrt oder beschnitten.

Die gelieferte Iconvariante liegt unverändert in `public/brand/oalab-icon.png`. Sie dient als App-Icon, Browser-Icon und Vorschaubild. Beide Dateien enthalten bereits ihre eigene Logoschrift; diese wird nicht durch Inter ersetzt. Bei kleinen Darstellungen steht der lesbare Plattformname zusätzlich neben dem Logo.

Logoformat und Seitenverhältnis bleiben erhalten. Um das sichtbare Logo bleibt mindestens ein Zehntel seiner Darstellungsbreite frei. Die gemeinsame Komponente in `components/hub/wordmark.tsx` bindet die Originaldatei ein.

## Markenfarben

Die Farben stammen aus den Hintergrundflächen der gelieferten Iconvariante. Der Verlauf beginnt in dunklem Bordeaux, geht über Rot und endet in Orange.

| Verwendung | Farbwert | CSS Token |
| --- | --- | --- |
| Bordeaux und primärer Akzent | `#7E004B` | `--oalab-bordeaux` |
| Rot im Übergang | `#8F1D21` | `--oalab-red` |
| Orange im Übergang | `#F37222` | `--oalab-orange` |
| Haupttext | `#252027` | `--oalab-ink` |
| Sekundärer Text | `#6F626B` | `--oalab-muted` |
| Hintergrund | `#FAF8F7` | `--oalab-paper` |
| Linien und Trennflächen | `#E9E2E5` | `--oalab-line` |
| Dezente Akzentfläche | `#F7EDF2` | `--oalab-soft` |

Der digitale Markenverlauf wird in `app/brand.css` definiert:

```css
linear-gradient(160deg, #7e004b 0%, #8f1d21 48%, #f37222 100%)
```

Große Markenflächen, dekorative Akzente und Fortschrittsanzeigen verwenden `--oalab-gradient`. Für Buttons mit weißer Beschriftung und textreiche Fokusflächen wird der dunkle Ausschnitt `--oalab-gradient-action` verwendet: `linear-gradient(120deg, #7e004b, #8f1d21)`.

Orange ist kein Ersatz für gut lesbare Schriftfarben: Weißer kleiner Text auf dem hellen orangefarbenen Ende erreicht nicht den erforderlichen Kontrast. Dort liegen Texte auf einer ausreichend dunklen zusätzlichen Fläche. Kleine Links, Fokusrahmen und aktive Navigation verwenden Bordeaux. Statusfarben dürfen eine fachliche Bedeutung tragen; die fiktiven Kundenmarken in Beispielprojekten behalten ihre eigenen Gestaltungen.

## Schrift

**Inter** ist die einheitliche Schrift für alle oalab-Oberflächen: Überschriften, Fließtext, Navigation, Formulare, Buttons, Tabellen und Dialoge. Die Anwendung lädt die variable Schrift über `next/font/google` und liefert sie anschließend selbst aus; der Browser benötigt keine Verbindung zu Google Fonts.

Der gemeinsame Font-Token ist `--font-inter`; die Tailwind-Klasse `font-sans` und die globalen HTML-Regeln verwenden denselben Token. Formularelemente erben die Schrift. Als technische Rückfallebene dienen Arial und die generische Sans-Serif-Schrift des Systems.

Für Fließtext wird Gewicht 400, für hervorhebende Texte und Navigation 500 bis 600 verwendet. Große Überschriften dürfen variable Zwischengewichte nutzen. Keine zusätzliche Display- oder Monospace-Schrift für normale UI-Texte einführen.

## Umsetzung und Pflege

Markenwerte werden ausschließlich in `app/brand.css` gepflegt und über CSS-Variablen wiederverwendet. `app/hub.css` gestaltet Workspace und Authentifizierung. Neue Seiten übernehmen das Root-Layout und die gemeinsamen Logo-Komponenten.

Bei Änderungen sind Login und Workspace jeweils auf Desktop und Mobilgeräten zu prüfen. Logo, Lesbarkeit, Tastaturfokus und horizontale Überläufe gehören zur Abnahme. Neue Markenentscheidungen werden hier und in `PROJECT_CONTEXT.md` dokumentiert.
