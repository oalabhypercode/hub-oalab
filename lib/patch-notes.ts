/**
 * Patch notes of the hub: one package per go-live day, newest first. Every change that reaches `main` adds its
 * entries here (rule in CLAUDE.md). Self-contained (no imports) so tests can check it directly.
 *
 * Admins see every entry. Customers see only entries marked `customers: true`, and only packages that contain one;
 * the package summary is for admins. Texts are plain German for people who use the hub, never names, addresses,
 * keys or infrastructure details.
 */

export type PatchChangeKind = "new" | "improved" | "fixed" | "security";

export type PatchChange = {
  kind: PatchChangeKind;
  title: string;
  text: string;
  /** Shown to customers as well; without it the entry stays internal. */
  customers?: true;
};

export type PatchPackage = {
  number: number;
  /** Go-live day, YYYY-MM-DD. */
  date: string;
  title: string;
  /** What the package is about, for admins. */
  summary: string;
  changes: PatchChange[];
};

export const patchKindLabels: Record<PatchChangeKind, string> = {
  new: "Neu",
  improved: "Verbessert",
  fixed: "Behoben",
  security: "Sicherheit",
};

export const patchPackages: PatchPackage[] = [
  {
    number: 13,
    date: "2026-11-04",
    title: "Privater Chat, Rechtstexte, Begrüßung ohne Ton und Mitdenken",
    summary: "Unter Nachrichten schreiben Kunden jetzt privat mit oalab statt in Service-Anfragen, und Admins antworten direkt im Hub. Admins haben dafür die Reiter „Privat“ und „Service“, sehen ihre Kunden mit Logo und werden bei neuen Nachrichten in der Glocke, per E-Mail und in ihrer Telegram-Gruppe benachrichtigt; Service-Anfragen laufen nur noch über die Serviceplattform. Impressum und Datenschutzerklärung sind jetzt eigene, öffentliche Seiten im Hub, erreichbar von jeder Seite in höchstens zwei Klicks und aus jeder E-Mail; für Telegram beschreibt die Datenschutzerklärung schon den Betrieb mit echten Kunden (nur Firmenname), während der Testphase kommt weiter der volle Text. Außerdem begrüßt der Avatar oben in der Übersicht nur noch ohne Ton, und unten in der Gesprächsliste denkt ein Avatar von oalab mit.",
    changes: [
      { kind: "new", title: "Privater Chat mit oalab", text: "Unter Nachrichten schreibst du jetzt direkt mit deinem oalab-Team, in einem privaten Chat für deine Firma. Nur ihr und oalab lest mit; zwei Häkchen zeigen, dass deine Nachricht gelesen wurde.", customers: true },
      { kind: "improved", title: "Service-Anfragen auf der Serviceplattform", text: "Anfragen wie Änderungen an deiner Website stellst du jetzt direkt auf der Serviceplattform. Unter dem Chat führen „Anfrage stellen“ und „Meine Anfragen“ dorthin; die Gespräche zu Anfragen stehen nicht mehr im Hub.", customers: true },
      { kind: "new", title: "Antworten von oalab in der Glocke", text: "Antwortet dir oalab im Chat, siehst du das in der Glocke und in der gesammelten E-Mail. Hast du die Antwort vorher schon im Hub gelesen, fällt sie aus der E-Mail heraus.", customers: true },
      { kind: "new", title: "Reiter „Privat“ und „Service“", text: "Admins sehen unter Nachrichten zwei Reiter: „Privat“ mit den Chats aller Kunden zum Antworten und „Service“ mit den Gesprächen der Serviceplattform zum Mitlesen. Über den Stift schreibt ihr auch Kunden an, die noch nichts geschrieben haben." },
      { kind: "new", title: "Benachrichtigung bei Kundennachrichten", text: "Schreibt ein Kunde im Chat, zeigt die Glocke das jedem Admin sofort an. Nach einigen Minuten folgt eine E-Mail, aber nur, solange niemand aus dem Team den Chat gelesen hat; abschalten lässt sie sich im Profil." },
      { kind: "new", title: "Nachrichten in Telegram", text: "Schreibt ein Kunde im Chat, kommt seine Nachricht mit Firma und Name auch in die Telegram-Gruppe des Teams, mit einem Knopf in den Hub zum Antworten. Im Profil prüft ihr das mit „Testmeldung senden“." },
      { kind: "improved", title: "Kundenlogos in den Chats", text: "In beiden Reitern steht bei jedem Kunden sein Logo aus dem Asset Management. Ohne Logo bleiben wie bisher die Anfangsbuchstaben." },
      { kind: "improved", title: "Begrüßung ohne Ton", text: "Der Avatar oben in deiner Übersicht begrüßt dich jetzt immer ohne Ton. Der Lautsprecher in seiner Sprechblase fällt weg, alles andere bleibt wie gewohnt.", customers: true },
      { kind: "new", title: "Mitdenken in Nachrichten", text: "Unten in deiner Gesprächsliste steht jetzt ein Ansprechpartner von oalab als Avatar und denkt mit: In einer Gedankenblase zeigt er, wie du ein Gespräch beginnst. Er taucht bei jedem Öffnen von Nachrichten einmal auf, ohne Ton; mit „Bewegung reduzieren“ steht er still.", customers: true },
      { kind: "new", title: "Impressum und Datenschutz", text: "Impressum und Datenschutzerklärung haben jetzt eigene Seiten im Hub, auch ohne Anmeldung. Du findest sie am Rechner im Menü am Zahnrad unten links, am Handy unter „Mehr“, im Profil, unter jeder Anmeldeseite und am Ende jeder E-Mail.", customers: true },
      { kind: "improved", title: "Hinweis im Chat", text: "Oben im Chat mit oalab steht jetzt ein kurzer Hinweis, wie unser Team von neuen Nachrichten erfährt. „Mehr dazu“ führt direkt zur passenden Stelle der Datenschutzerklärung.", customers: true },
    ],
  },
  {
    number: 12,
    date: "2026-11-03",
    title: "Begrüßung und Ladeanimation",
    summary: "Nach der Anmeldung begrüßt der Hub jetzt mit dem oalab-Logo, und wo etwas lädt, dreht sich das Logo statt grauer Platzhalter oder eines Kreises. Kunden begrüßt oben in der Übersicht außerdem ein sprechender Avatar von oalab mit Sprechblase. Im Asset Management öffnen sich Hochladen und die Details einer Datei jetzt rechts neben der Liste statt in einem Fenster. Dateien lassen sich direkt in einen Ordner ziehen, die Kategorie gilt je Datei, und aus einem Bild wird mit einem Klick das Logo des Kunden. Außerdem lassen sich Dateien jetzt bearbeiten und löschen.",
    changes: [
      { kind: "new", title: "Begrüßung nach der Anmeldung", text: "Nach der Anmeldung begrüßt dich der Hub mit dem oalab-Logo und deinem Vornamen, während dein Workspace im Hintergrund lädt. Danach blendet die Übersicht wie gewohnt ein.", customers: true },
      { kind: "new", title: "Persönliche Begrüßung in der Übersicht", text: "Oben in deiner Übersicht steht jetzt ein Ansprechpartner von oalab als Avatar. Nach der Anmeldung sagt er dir in einer Sprechblase Hallo; über den Lautsprecher in der Blase hörst du ihn mit Ton. Mit „Bewegung reduzieren“ steht er still da.", customers: true },
      { kind: "improved", title: "Ladeanimation mit dem oalab-Logo", text: "Lädt eine Seite, dreht sich in der Mitte das oalab-Logo statt grauer Platzhalter-Karten. Bei schnellen Seiten erscheint es gar nicht erst.", customers: true },
      { kind: "improved", title: "Kleines Logo in Knöpfen", text: "Wo beim Speichern, Senden oder Hochladen bisher ein kleiner Kreis drehte, wendet sich jetzt ein kleines oalab-Logo. Mit „Bewegung reduzieren“ in deinem Profil steht das Logo still.", customers: true },
      { kind: "improved", title: "Hochladen mit einer Ladeanzeige", text: "Beim Hochladen im Asset Management zeigt jede Datei nur noch das kleine Logo am Ende ihrer Zeile. Der zusätzliche Balken neben dem Schritt fällt weg." },
      { kind: "new", title: "Hochladen in der Seitenleiste", text: "„Hochladen“ öffnet sich rechts neben den Dateien, mit Kunde und Ordner schon ausgefüllt. Die Kategorie wählst du für jede Datei einzeln; der Hub schlägt sie nach dem Dateinamen vor." },
      { kind: "new", title: "Dateien hineinziehen", text: "Dateien lassen sich vom Computer direkt auf die Liste eines Kunden ziehen. Der Ordner unter der Maus leuchtet auf, und unten steht, wo die Dateien landen; vor dem Hochladen kannst du alles noch prüfen." },
      { kind: "improved", title: "Details neben der Liste", text: "Ein Klick auf eine Datei zeigt ihre Details rechts, bei Bildern mit Vorschau. Dort änderst du, welche Kunden die Datei haben und in welchem Ordner sie liegt, und kopierst ihren Link; ein Klick auf die nächste Datei wechselt die Details." },
      { kind: "new", title: "Logo aus einer Bilddatei", text: "In den Details eines Bildes steht „Als Logo von … verwenden“. Ein Klick genügt, und das Bild ersetzt die Anfangsbuchstaben des Kunden." },
      { kind: "new", title: "Dateien bearbeiten", text: "In den Details einer Datei öffnet der Stift Titel, Kategorie und Beschreibung zum Ändern. Kunden bekommen dafür keine Meldung." },
      { kind: "new", title: "Dateien löschen", text: "Über „…“ in den Details oder „Löschen“ bei ausgewählten Dateien lassen sich Dateien endgültig löschen. Vorher fragt der Hub nach und sagt, bei welchen Kunden sie verschwinden." },
      { kind: "fixed", title: "Auswahl nicht mehr verdeckt", text: "Waren die Details einer Datei offen, lagen sie über „Verschieben nach …“ und „Löschen“ in der Leiste über der Liste. Jetzt schließt ein Häkchen die Details, und ein Klick auf eine Datei hebt gesetzte Häkchen auf." },
    ],
  },
  {
    number: 11,
    date: "2026-11-02",
    title: "Gespräche wie im Messenger",
    summary: "Nachrichten werden ein Chat: alle Gespräche mit oalab an einem Ort, wie man es vom Handy kennt. Dazu steht das Logo am Tablet mittig oben, und die Ecke unten links ist aufgeräumt. Für Admins ordnet das Asset Management die Dateien nach Kunden, als Minimal- oder Detailansicht. Und wo bisher eure Anfangsbuchstaben standen, kann jetzt euer Firmenlogo stehen.",
    changes: [
      { kind: "new", title: "Gespräche wie im Messenger", text: "Unter Nachrichten stehen jetzt deine Gespräche mit oalab als Chat: links die Liste mit dem Neuesten oben, rechts das offene Gespräch mit Sprechblasen, Datum und dem Stand deiner Anfrage. Am Smartphone öffnet ein Tipp das Gespräch bildschirmfüllend.", customers: true },
      { kind: "new", title: "Direkt im Hub antworten", text: "Deine Antwort landet in derselben Anfrage wie auf der Serviceplattform, und das oalab-Team erfährt davon wie gewohnt. Neue Antworten erscheinen ohne Neuladen; liest du sie im Hub, kommt dazu keine zusätzliche E-Mail mehr.", customers: true },
      { kind: "improved", title: "Ein Ort für Gespräche", text: "Der Eintrag „Chat“ in der Seitenleiste und unter „Mehr“ entfällt, die Gespräche stehen unter Nachrichten. Ein neues Gespräch startest du über das Stift-Symbol; es öffnet die neue Anfrage auf der Serviceplattform.", customers: true },
      { kind: "new", title: "Gespräche mitlesen", text: "Admins sehen unter Nachrichten die Gespräche aller Kunden mit Firmenname, nur zum Lesen. Antworten und interne Notizen entstehen weiter in NoteTree Business." },
      { kind: "improved", title: "Nachrichten in der Tab-Leiste", text: "Am Smartphone und Tablet stehen die Nachrichten jetzt direkt in der Tab-Leiste, mit der Zahl ungelesener Gespräche. Projekte findest du dort unter „Mehr“.", customers: true },
      { kind: "improved", title: "Logo in der Mitte", text: "Am Tablet steht das oalab-Logo jetzt allein mittig oben, der Schriftzug „oalab Client Hub“ bleibt links. Am Smartphone bleibt die obere Zeile, wie sie war.", customers: true },
      { kind: "improved", title: "Aufgeräumte Ecke unten links", text: "Unten links stehen jetzt dein Name und darunter dein Servicepaket. Das Zahnrad daneben öffnet ein kleines Menü mit Profil, Darstellung und Abmelden.", customers: true },
      { kind: "new", title: "Asset Management: Kunden zuerst", text: "Links stehen alle Kunden mit Suche, oben „Alle Dateien“ und die „Ablage“ für Dateien ohne Kunde. Rechts siehst du die Dateien des gewählten Kunden in seinen Ordnern; Hochladen öffnet sich mit Kunde und Ordner schon ausgewählt." },
      { kind: "new", title: "Minimal oder Detail", text: "Jede Liste im Asset Management gibt es als ruhige Minimalansicht mit Symbol, Titel und Tag oder als Tabelle mit allen Spalten. Umschalten geht oben rechts in der Liste oder unter Profil › Darstellung › Listen." },
      { kind: "new", title: "Logos für Kunden", text: "Ein Klick auf das Zeichen eines Kunden im Asset Management öffnet sein Logo: ein Bild aus seinen Dateien wählen oder ein anderes hochladen, dazu ein heller, dunkler oder farbiger Hintergrund. Das Logo steht dann überall dort, wo bisher die Anfangsbuchstaben standen." },
      { kind: "new", title: "Euer Logo im Hub", text: "Hat oalab euer Firmenlogo hinterlegt, steht es unten links neben deinem Namen, in der Begrüßung der Übersicht und am Handy oben rechts. Ohne Logo bleiben die Anfangsbuchstaben; andere Kunden sehen euer Logo nicht.", customers: true },
      { kind: "fixed", title: "Gespräch auf der Serviceplattform öffnen", text: "Der Pfeil oben rechts in einem Gespräch öffnet es jetzt auf der Serviceplattform, mit Freigaben und Testseite. Vorher führte er zurück in den Hub.", customers: true },
      { kind: "fixed", title: "Richtige Zahl bei den Dateien", text: "In der Seitenleiste stand neben „Dateien“ bisher immer eine 0. Jetzt steht dort, wie viele Dateien du siehst.", customers: true },
    ],
  },
  {
    number: 10,
    date: "2026-11-01",
    title: "Ein einheitlicher Look",
    summary: "Das Redesign des Hubs: gemeinsame Farben und Bausteine wie in den E-Mails des Hubs, einheitliche Seitenköpfe und Begriffe, klare Tabellen mit Suche, Filter und Gruppen, ein dunkler Modus, eine aufgeräumte Navigation am Smartphone und mehrere kleine Korrekturen.",
    changes: [
      { kind: "new", title: "Dunkler Modus", text: "Der Hub kann jetzt auch dunkel. Unter Profil › Darstellung wählst du beim Erscheinungsbild Automatisch, Hell oder Dunkel; Automatisch folgt deinem Gerät und wechselt mit ihm, auch auf der Anmeldeseite.", customers: true },
      { kind: "improved", title: "Navigation am Smartphone", text: "Die Tab-Leiste zeigt jetzt fünf Einträge mit größerer Schrift: Übersicht, Projekte, Dateien, Kalender und Mehr. Unter „Mehr“ findest du Insights, Nachrichten, den Chat, die Patch Notes, dein Profil und die Darstellung, und Glocke und Assistent stehen oben neben dem Logo, damit Seitentitel ganz lesbar bleiben.", customers: true },
      { kind: "improved", title: "Klare Tabellen", text: "Projekte und Dateien stehen jetzt in ruhigen Tabellen mit feinen Linien statt Kacheln. Oben bündelt eine Leiste Suche, Filter, Sortierung und Gruppierung, und Gruppen wie „Dein Feedback“ lassen sich einklappen.", customers: true },
      { kind: "improved", title: "Projekte auf einen Blick", text: "Ein Symbol vor dem Projekttitel zeigt den Status, der Meilenstein steht nur mit seinem Titel in der Zeile; seine Beschreibung erscheint beim Darüberfahren und im Projekt. Auf kleineren Bildschirmen tritt das Startdatum zurück, damit nächster Termin und Fortschritt ohne Scrollen sichtbar bleiben.", customers: true },
      { kind: "improved", title: "Projekte am Tablet", text: "Am Tablet und in schmalen Fenstern musste die Projekttabelle seitlich gescrollt werden. Jetzt passt sie ganz hinein: Zuerst entfällt die Spalte „Status“, weil das Symbol vor dem Projekttitel ihn schon zeigt, am Tablet hochkant auch „Bereich“. Beides steht weiter in den Projektdetails.", customers: true },
      { kind: "improved", title: "Ordner als Gruppen", text: "Bei den Dateien stehen Ordner jetzt als Gruppen direkt in der Tabelle, auch leere, und Dateien ohne Ordner sammeln sich unter „Ohne Ordner“. Umbenennen und Löschen findest du in der Zeile des Ordners, einen neuen Ordner legst du in der letzten Zeile an.", customers: true },
      { kind: "improved", title: "User Management in einer Tabelle", text: "Konten und Kunden liegen in einer Tabelle mit Umschalter. Offene Registrierungen stehen als erste Gruppe „Wartet auf Freigabe“ mit „Prüfen“ direkt in der Zeile, eine noch nicht bestätigte E-Mail-Adresse ist markiert." },
      { kind: "fixed", title: "User Management passt in die Breite", text: "Im User Management ließ sich die ganze Seite seitlich verschieben, sobald die Tabelle breiter war als ihre Fläche. Jetzt passt die Tabelle der Konten ab 1280 Pixel Fensterbreite ganz hinein, auch mit offenen Registrierungen. Dafür werden lange Namen, E-Mail-Adressen und Firmennamen etwas früher gekürzt, und in schmaleren Fenstern entfallen „Kunden-Nr.“ und „Letzter Login“; beides steht weiter im Dialog des Kontos." },
      { kind: "improved", title: "KI-Protokoll mit Werkzeugleiste", text: "Das KI-Protokoll hat dieselbe Leiste mit Suche, Filter und Sortierung wie die übrigen Tabellen. Findet die Suche nichts, setzt ein Klick Suche und Filter zurück." },
      { kind: "improved", title: "Ein Look für Hub und E-Mails", text: "Buttons, Statusanzeigen und Hinweise sehen jetzt überall gleich aus und nutzen dieselben Farben wie die E-Mails des Hubs. Schalter, Häkchen und der heutige Tag im Kalender sind in Bordeaux statt in Grün und Rot.", customers: true },
      { kind: "improved", title: "Jede Seite mit Symbol im Titel", text: "Übersicht, Insights, Profil, Mehr und Patch Notes tragen wie die übrigen Seiten ein Symbol neben dem Titel, und Glocke und Assistent stehen auf jeder Hauptseite oben rechts. Der Assistent hat ein eigenes Symbol, eine Sprechblase mit Fragezeichen.", customers: true },
      { kind: "improved", title: "Klarere Begriffe", text: "Der Bereich mit deinen Angaben heißt überall „Profil“, Projekte, Dateien, Nachrichten und Kalender stehen unter „Bereiche“, und die Ziele von Projekten heißen im Kalender einheitlich „Zieltermin“.", customers: true },
      { kind: "improved", title: "Favoriten in einer Reihe", text: "Vier Favoriten passen am Rechner nebeneinander. In schmalen Karten tritt das Datum zurück, damit der Titel ganz lesbar bleibt.", customers: true },
      { kind: "fixed", title: "Hinweise und Fehlermeldungen", text: "Hinweise im Kalender und bei den Dateien zeigen Symbol und Text wieder nebeneinander. Fehlermeldungen in den Karten des Profils sind deutlich als Fehler zu erkennen, und ein Fehler beim Abmelden erscheint jetzt auch auf dem Smartphone.", customers: true },
      { kind: "improved", title: "Patch Notes nach Datum", text: "Die Pakete der Patch Notes tragen für Kunden nur noch ihr Datum. So entstehen keine Lücken in der Nummerierung, wenn ein Paket nur interne Änderungen enthält.", customers: true },
      { kind: "fixed", title: "KI-Protokoll auf dem Smartphone", text: "Admins erreichen das KI-Protokoll jetzt auch auf dem Smartphone über „Mehr“ unter „Verwaltung“. Die Zeitspalte trägt dort nicht mehr fälschlich den Vorsatz „Letzter Login“." },
      { kind: "improved", title: "Konto anlegen", text: "Im User Management heißt der Button jetzt „Konto anlegen“, wie der Dialog, den er öffnet." },
    ],
  },
  {
    number: 9,
    date: "2026-10-31",
    title: "Kalender-Logos und ein gemeinsamer Kundenstamm",
    summary: "Die Kalender-Buttons in Termin-Mails zeigen jetzt die Logos von Apple, Google und Microsoft statt eines gemeinsamen Kalender-Symbols. Hub und Serviceplattform haben einen gemeinsamen Kundenstamm: Neue Kunden entstehen auf beiden Seiten, ihre Logins kommen mit demselben Zugang auf die Serviceplattform, und Unternehmen, Kundennummer und Kontaktdaten gelten überall.",
    changes: [
      { kind: "improved", title: "Kalender-Buttons mit Logos", text: "In E-Mails zu einem neuen, bestätigten oder verschobenen Termin trägt jeder Kalender-Button jetzt das Logo seines Kalenders: Apple, Google und Microsoft für Outlook, einfarbig im Design des Hubs. So findest du den passenden Button auf einen Blick.", customers: true },
      { kind: "improved", title: "Deine Firmendaten überall gleich", text: "Unternehmen, Kontakt-E-Mail, Telefon, Website und Anschrift sind im Client Hub und auf der Serviceplattform jetzt dieselben. Was du auf der Serviceplattform unter „Profil und Firma“ änderst, siehst du auch im Hub.", customers: true },
      { kind: "new", title: "Ein Kundenstamm für Hub und Serviceplattform", text: "Neue Kunden aus dem User Management entstehen jetzt auch auf der Serviceplattform, und ihre Logins kommen mit demselben Zugang dorthin. Unternehmen, Kundennummer und Kontaktdaten gelten auf beiden Seiten; Kundennummern haben dafür die Form OA- mit einer freien Zahl." },
    ],
  },
  {
    number: 8,
    date: "2026-10-30",
    title: "Benachrichtigungen, neue E-Mails und ein bequemerer Assistent",
    summary: "Kunden erfahren jetzt in der Glocke und per E-Mail, was für sie neu ist: Aufgaben, bei denen sie am Zug sind, Änderungen an Status oder Zieltermin aus dem Studio, neue Dateien und Termine. Termine lassen sich aus der E-Mail mit einem Tipp in den eigenen Kalender übernehmen. Alle E-Mails des Hubs haben ein neues Design, und Links führen direkt zum Termin oder zur Datei. Admins bekommen noch keine Benachrichtigungen. Der Assistent behält seinen Verlauf im Browser, lässt sich rechts andocken, zeigt Vorschauen übersichtlicher, und das neue KI-Protokoll listet alle seine Vorschläge.",
    changes: [
      { kind: "improved", title: "Assistent behält den Verlauf", text: "Der Chat mit dem Assistenten bleibt nach dem Neuladen und sogar nach einem Neustart des Browsers erhalten, bis du „Neu starten“ klickst oder dich abmeldest. Er liegt nur in deinem Browser.", customers: true },
      { kind: "new", title: "Assistent als Seitenleiste", text: "Ein Knopf im Chat dockt den Assistenten rechts an. Die Seite daneben bleibt bedienbar, und der Chat bleibt beim Wechseln der Seiten offen. Auf dem Handy öffnet er weiter als Fenster.", customers: true },
      { kind: "improved", title: "Übersichtlichere Vorschauen", text: "Jede Vorschau des Assistenten zeigt oben, worum es geht und wie der Stand ist, etwa „Offen · bis 18:13“ oder „Gespeichert“. Entschiedene Vorschauen klappen auf eine Zeile zusammen, lange Listen zeigen erst fünf Einträge." },
      { kind: "new", title: "KI-Protokoll", text: "Unter Verwaltung listet das KI-Protokoll alle Vorschläge des Assistenten mit Zeit, Admin, Art, Kunde oder Projekt, Inhalt und Ergebnis. Suche, Filter und Sortierung funktionieren wie in den anderen Tabellen." },
      { kind: "new", title: "Benachrichtigungen in der Glocke", text: "Die Glocke oben rechts zeigt jetzt, was für dich neu ist: eine Aufgabe, bei der du am Zug bist, ein geänderter Projektstatus oder Zieltermin, eine neue Datei oder ein neuer, bestätigter, verschobener oder abgesagter Termin. Ein Klick führt direkt dorthin.", customers: true },
      { kind: "new", title: "Neuigkeiten per E-Mail", text: "Zusätzlich bekommst du eine E-Mail, die alles Neue einer Viertelstunde bündelt, statt für jede Kleinigkeit eine eigene. Im Profil unter „Benachrichtigungen“ lässt sich die E-Mail abschalten.", customers: true },
      { kind: "new", title: "Termine in den eigenen Kalender", text: "Bei neuen, bestätigten und verschobenen Terminen stehen in der E-Mail jetzt Buttons für Apple Kalender, Google Kalender, Outlook und eine Kalender-Datei für alle anderen Apps. Ein Tipp genügt, und der Termin landet mit Uhrzeit und Teams-Link in deinem Kalender, am Handy wie am Rechner.", customers: true },
      { kind: "improved", title: "Neues Design für alle E-Mails", text: "Alle E-Mails aus dem Client Hub haben ein neues, einheitliches Design: oben Logo und Bereich, darunter klar, was passiert ist und was zu tun ist, und ein großer Button direkt an die richtige Stelle. Sie passen sich hellem und dunklem Modus an und sind auch auf dem Handy gut lesbar.", customers: true },
      { kind: "improved", title: "Eine Neuigkeit, eine klare E-Mail", text: "Gibt es nur eine Neuigkeit, kommt sie als eigene E-Mail mit passender Überschrift, etwa „Du bist am Zug“ oder „Dein Termin wurde verschoben“. Mehrere Neuigkeiten stehen als Liste mit einem eigenen Link für jede. Bei Terminen stehen die Kalender-Buttons jetzt in einem eigenen Bereich.", customers: true },
      { kind: "improved", title: "Links direkt zum Termin und zur Datei", text: "Ein Link zu einem Termin öffnet den Kalender an diesem Tag mit dem Termin, ein Link zu einer neuen Datei öffnet die Datei. Das gilt in den E-Mails und in der Glocke.", customers: true },
      { kind: "improved", title: "Neue Registrierung als Kontaktkarte", text: "Die E-Mail an das oalab-Team zu einer neuen Registrierung zeigt die Person jetzt als Kontaktkarte: Name und Unternehmen groß, darunter Position, E-Mail-Adresse, Telefon, Website und Kundennummer zum Antippen." },
    ],
  },
  {
    number: 7,
    date: "2026-10-29",
    title: "Projekte, Aufgaben und Kunden per Assistent",
    summary: "Der Assistent schlägt jetzt auch Änderungen an Projekten und bestehenden Aufgaben sowie neue Kunden vor. Gespeichert wird nur, was der Admin in der Vorschau bestätigt, und nie über eine neuere Änderung im Studio hinweg.",
    changes: [
      { kind: "new", title: "Kunden anlegen", text: "Admins können den Assistenten bitten, einen neuen Kunden anzulegen. Er prüft vorher, ob es das Unternehmen schon gibt, und zeigt eine Vorschau mit Kontaktdaten und Service-Paket. Erst „Kunde anlegen“ legt ihn an, mit einer neuen Kundennummer aus OA- und einer fünfstelligen Zahl." },
      { kind: "new", title: "Login für den Ansprechpartner", text: "Nennt der Admin einen Ansprechpartner mit E-Mail-Adresse, bietet die Vorschau gleich einen Login für ihn an. Die Einladungs-Mail geht nur raus, wenn sie dort eigens angehakt ist; sonst gibt es den Aktivierungslink im User Management." },
      { kind: "new", title: "Projekte ändern", text: "Admins können den Assistenten bitten, Zieltermin, Start oder Status eines Projekts zu ändern oder eine Notiz an die Beschreibung anzuhängen, etwa „Wir warten auf Kundenfeedback“. Die Vorschau zeigt alt → neu, erst „Speichern“ übernimmt es ins Studio." },
      { kind: "new", title: "Aufgaben ändern", text: "Bestehende Aufgaben lassen sich über den Assistenten umstellen: Titel, Stand, Fälligkeit, ob oalab oder der Kunde dran ist und die Freigabe für den Kunden. Jede Aufgabe lässt sich in der Vorschau einzeln abwählen." },
      { kind: "improved", title: "Schutz vor Überschreiben", text: "Wurde ein Projekt oder eine Aufgabe zwischen Vorschlag und Speichern im Studio geändert, speichert der Hub diese Änderung nicht und sagt das. Andere Labels einer Aufgabe bleiben beim Umstellen auf „Kunde“ erhalten." },
      { kind: "fixed", title: "Kunden-Logins löschen", text: "Logins, die einem Kunden zugeordnet waren, ließen sich im User Management nicht löschen. Jetzt verschwinden sie samt Zugang zur Serviceplattform. Gibt es dort noch Anfragen oder Nachrichten der Person, sagt der Hub, dass sich das Konto nur deaktivieren lässt." },
    ],
  },
  {
    number: 6,
    date: "2026-10-28",
    title: "Patch Notes und echte Projekte",
    summary: "Der neue Reiter „Patch Notes“ hält jede Änderung am Hub fest. Projekte und Aufgaben kommen jetzt aus OALab Studio statt aus Beispieldaten. Der Assistent liest sie für Admins und schlägt neue Aufgaben vor, die erst nach Bestätigung gespeichert werden.",
    changes: [
      { kind: "new", title: "Echte Projekte aus OALab Studio", text: "Projekte, Fortschritt und Zieltermine im Hub kommen jetzt aus OALab Studio, wo das oalab-Team sie pflegt. Kunden sehen nur, was für sie freigegeben ist. Der Fortschritt ist der Anteil erledigter Aufgaben, genau wie im Studio.", customers: true },
      { kind: "new", title: "Aufgaben im Projekt und „Du bist am Zug“", text: "Die Projektdetails zeigen die Aufgaben mit Stand, Fälligkeit und ob oalab oder du dran bist. Aufgaben, die bei dir liegen, stehen in der Übersicht unter „Du bist am Zug“ und setzen das Projekt auf „Dein Feedback“.", customers: true },
      { kind: "new", title: "Assistent liest Projektdaten", text: "Admins können den Assistenten nach Kunden, Projekten und Aufgaben fragen, etwa „Welche Aufgaben liegen gerade bei Kunden?“. Er liest nur, was der Admin im Hub ohnehin sieht, ändert selbst nichts und braucht den aktiven Zwei-Faktor-Schutz. Über „Assistent zu diesem Projekt fragen“ im Projektdialog versteht er „dieses Projekt“." },
      { kind: "new", title: "Aufgaben per Assistent anlegen", text: "Admins können den Assistenten bitten, Aufgaben für ein Projekt anzulegen. Er zeigt sie zuerst als Vorschau im Chat; dort lassen sie sich abwählen, zwischen oalab und Kunde umstellen und für den Kunden freigeben. Erst „Speichern“ legt sie im Studio an, unter dem Namen des Admins." },
      { kind: "new", title: "Meetingtranskripte auswerten", text: "Admins können ein Meeting-Transkript in den Chat einfügen. Der Assistent fasst es zusammen, nennt Beschlüsse und offene Fragen und schlägt die Aufgaben daraus vor, jede mit einem Zitat als Beleg. Termine und Zuständigkeiten übernimmt er nur, wenn sie eindeutig genannt sind; der Hub speichert Transkripte nicht." },
      { kind: "improved", title: "Protokoll der KI-Aktionen", text: "Jeder Vorschlag des Assistenten wird mit seinem Ausgang festgehalten: gespeichert, verworfen oder fehlgeschlagen. Ein doppelter Klick legt nichts doppelt an, und ein Vorschlag gilt 30 Minuten." },
      { kind: "improved", title: "Kundenaufgaben im Studio", text: "Aufgaben mit dem Label „Kunde“ gelten im Hub als Aufgaben des Kunden. Sichtbar werden sie für den Kunden erst, wenn sie im Studio freigegeben sind. Admins sehen in der Übersicht, was gerade bei Kunden liegt." },
      { kind: "new", title: "Patch Notes", text: "Hier steht, was sich am Hub geändert hat: ein Paket pro Livegang, gegliedert in Neu, Verbessert, Behoben und Sicherheit. Admins finden den Reiter unter „Verwaltung“ und sehen alle Einträge, Kunden finden ihn unter „Neuigkeiten“ und sehen die Einträge, die sie betreffen.", customers: true },
    ],
  },
  {
    number: 5,
    date: "2026-10-26",
    title: "Zweiter Faktor nach Wahl",
    summary: "Jede Person wählt im Profil, wie sie ihren Login zusätzlich absichert: Code per E-Mail oder Authenticator-App.",
    changes: [
      { kind: "new", title: "Code per E-Mail", text: "Nach dem Passwort kommt ein sechsstelliger Code an die Login-Adresse. Er gilt zehn Minuten, „Neuen Code senden“ schickt einen frischen. Eine zusätzliche App ist dafür nicht nötig.", customers: true },
      { kind: "new", title: "Zwei-Faktor-Schutz im Profil", text: "Unter Profil › „Zwei-Faktor-Schutz“ wählt jede Person selbst: Aus, Code per E-Mail oder Authenticator-App. Die Wahl gilt auch für die Serviceplattform.", customers: true },
      { kind: "new", title: "Zurücksetzen durch Admins", text: "Admins können den zweiten Faktor einer Person im User Management auf „Code per E-Mail“ oder „Aus“ zurücksetzen, etwa nach einem verlorenen Handy." },
    ],
  },
  {
    number: 4,
    date: "2026-10-25",
    title: "Ein Login für Hub und Serviceplattform",
    summary: "Hub und Serviceplattform teilen sich Konto und Datenbank. Dazu ein schnellerer Start und eine Code-Abfrage beim Login.",
    changes: [
      { kind: "new", title: "Ein Konto für Hub und Serviceplattform", text: "Wer im Hub angemeldet ist, ist es auch auf der Serviceplattform. Abmelden in einer der beiden meldet in beiden ab.", customers: true },
      { kind: "new", title: "Chat in der Navigation", text: "Der Eintrag „Chat“ in Sidebar und Tab-Leiste öffnet die Serviceplattform in einem neuen Tab. Der Hub bleibt im ersten Tab offen.", customers: true },
      { kind: "new", title: "Code-Abfrage beim Login", text: "Konten mit eingerichteter Authenticator-App geben nach dem Passwort den Code aus der App ein.", customers: true },
      { kind: "improved", title: "Schnellerer Start", text: "Der Rahmen des Hubs erscheint sofort, die Inhalte laden danach. Die Server laufen in Frankfurt, nah an der Datenbank.", customers: true },
      { kind: "improved", title: "Eine gemeinsame Datenbank", text: "Hub und Serviceplattform arbeiten auf derselben Datenbank. Kunden der Serviceplattform erscheinen dadurch automatisch im Hub, samt Unternehmen und Kundennummer." },
      { kind: "fixed", title: "Angemeldet direkt in den Hub", text: "Wer schon angemeldet ist, sieht beim Öffnen nicht mehr die Login-Seite, sondern gleich den Hub.", customers: true },
      { kind: "fixed", title: "Begrüßung mit dem richtigen Unternehmen", text: "Kunden der Serviceplattform werden im Hub mit ihrem Unternehmen begrüßt statt mit „Noch nicht zugeordnet“.", customers: true },
      { kind: "fixed", title: "Klare Meldung bei Ladefehlern", text: "Kann der Hub ein Konto kurz nicht lesen, erscheint ein Hinweis zum Neuladen statt einer falschen Meldung wie „wartet auf Freigabe“.", customers: true },
    ],
  },
  {
    number: 3,
    date: "2026-10-23",
    title: "Kalender, User Management und KI-Assistent",
    summary: "Der bisher größte Livegang: Kalender mit Terminanfragen, Verwaltung von Konten und Kunden, E-Mails, KI-Assistent, Ordner für Dateien und überarbeitete Tabellen.",
    changes: [
      { kind: "security", title: "Sicherheitsupdate", text: "Das Framework Next.js wurde wegen bekannter kritischer Sicherheitslücken auf Version 16.4.2 aktualisiert." },
      { kind: "new", title: "Kalender", text: "Kunden sehen, wie ausgelastet oalab an jedem Tag ist, und fragen Termine in freien Zeiten an (Montag bis Freitag, 9 bis 17 Uhr, 30 bis 90 Minuten). Das oalab-Team bestätigt mit einem Microsoft-Teams-Link oder lehnt mit Begründung ab. Projektziele erscheinen als ganztägige Einträge.", customers: true },
      { kind: "new", title: "Registrierung mit Freigabe", text: "Wer sich registriert, kommt erst nach der Prüfung durch das oalab-Team in den Hub und sieht bis dahin den Stand seiner Anmeldung.", customers: true },
      { kind: "new", title: "User Management", text: "Admins prüfen Registrierungen und geben sie frei oder lehnen sie ab. Sie legen Logins und Kunden an, verschicken Aktivierungs- und Passwort-Links, sperren oder löschen Konten. Jede Aktion steht im Verlauf." },
      { kind: "new", title: "E-Mails vom Hub", text: "Bestätigung der Adresse, Eingangsbestätigung, Freigabe, Ablehnung sowie Aktivierungs- und Passwort-Links kommen als E-Mail im oalab-Design.", customers: true },
      { kind: "new", title: "KI-Assistent", text: "Die Sprechblase „Assistent & Hilfe“ oben rechts beantwortet Fragen zu den Funktionen des Hubs. Sie sieht keine Projekt- oder Kundendaten und ändert nichts.", customers: true },
      { kind: "new", title: "WhatsApp-Anbindung vorbereitet", text: "Der Assistent kann auch per WhatsApp antworten, sobald eine Nummer im Profil verbunden ist. Aktiv wird das, wenn der Zugang bei Meta eingerichtet ist." },
      { kind: "new", title: "Ordner, Mehrfach-Upload und ZIP-Download", text: "Dateien liegen in Ordnern pro Kunde. Admins laden bis zu 20 Dateien auf einmal hoch, und mehrere Dateien lassen sich zusammen als ZIP herunterladen.", customers: true },
      { kind: "improved", title: "Projekte als Tabelle", text: "Projekte stehen in einer Tabelle mit Bereich, aktuellem Meilenstein, Status, Start, nächstem Termin und Fortschritt. Ein Klick aufs Datum öffnet den Kalender an diesem Tag.", customers: true },
      { kind: "improved", title: "Suchen, Filtern, Sortieren", text: "Jede Tabelle hat ein Suchfeld und eine erweiterte Suche mit Filtern und Sortierung. Umlaute sowie Groß- und Kleinschreibung spielen keine Rolle.", customers: true },
      { kind: "improved", title: "Asset Management", text: "Für Admins heißt der Bereich „Dateien“ jetzt „Asset Management“. Kunden sehen weiterhin „Dateien“." },
      { kind: "improved", title: "Sanftes Einblenden und „Bewegung reduzieren“", text: "Inhalte blenden beim Seitenwechsel nacheinander ein. Unter Profil › Darstellung lässt sich jede Animation abschalten.", customers: true },
    ],
  },
  {
    number: 2,
    date: "2026-10-20",
    title: "Neues Design und Dateiaustausch",
    summary: "Der Hub bekommt den Liquid-Glass-Look, eine Tab-Leiste für Smartphones und mit den Dateien den ersten echten Datenaustausch.",
    changes: [
      { kind: "new", title: "Neues Design", text: "Glasflächen über einem kräftigen Farbhintergrund. Hintergrund, Deckkraft und Unschärfe lassen sich unter Profil › Darstellung einstellen.", customers: true },
      { kind: "new", title: "Tab-Leiste auf Smartphone und Tablet", text: "Unter 1024 Pixel Breite ersetzt eine Leiste am unteren Bildschirmrand die Sidebar.", customers: true },
      { kind: "new", title: "Begrüßung mit Unternehmen und Servicepaket", text: "Die Übersicht nennt Unternehmen, Kundennummer und das aktive Servicepaket. Ein Knopf führt direkt zur Serviceplattform.", customers: true },
      { kind: "new", title: "Dateiaustausch", text: "Das oalab-Team lädt Dateien mit Kategorie und Beschreibung hoch und ordnet sie Kunden zu. Kunden laden sie genau so herunter, wie sie hochgeladen wurden; eine Prüfsumme belegt das.", customers: true },
      { kind: "improved", title: "Login im neuen Design", text: "Anmeldung, Registrierung und Passwortseiten nutzen denselben Glas-Stil.", customers: true },
      { kind: "improved", title: "Kein Demo-Banner mehr", text: "Die Testkonten zeigen keinen Hinweisbalken mehr. Rolle und Art der Demo stehen im Tooltip des Abmelde-Knopfs." },
    ],
  },
  {
    number: 1,
    date: "2026-10-15",
    title: "Der Client Hub geht an den Start",
    summary: "Erste Fassung des Hubs: Login, persönlicher Bereich und Testkonten mit Beispieldaten.",
    changes: [
      { kind: "new", title: "Login und persönlicher Bereich", text: "Kunden und das oalab-Team melden sich mit E-Mail-Adresse und Passwort an und landen in ihrem Bereich mit Übersicht, Projekten, Dateien und Nachrichten.", customers: true },
      { kind: "new", title: "Testkonten", text: "Vier Testkonten, ein Admin und drei Kunden, zeigen den Hub mit erfundenen Beispieldaten. Jedes Kundenkonto sieht nur sein eigenes Unternehmen." },
      { kind: "new", title: "Öffentliche Demo", text: "Die Testansichten sind online ohne Passwort erreichbar. Sie sind strikt von echten Konten getrennt und können keine echten Daten lesen oder ändern." },
    ],
  },
];

/** The packages one audience sees: everything for admins, the entries marked for customers otherwise. */
export function patchPackagesFor(fullView: boolean): PatchPackage[] {
  if (fullView) return patchPackages;
  return patchPackages
    .map((item) => ({ ...item, changes: item.changes.filter((change) => change.customers) }))
    .filter((item) => item.changes.length > 0);
}

const patchDate = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

/** "26. Oktober 2026" */
export const formatPatchDate = (day: string) => patchDate.format(Date.parse(`${day}T00:00:00Z`));
