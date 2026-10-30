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
    number: 9,
    date: "2026-10-31",
    title: "Kalender-Buttons mit Logos",
    summary: "Die Kalender-Buttons in Termin-Mails zeigen jetzt die Logos von Apple, Google und Microsoft statt eines gemeinsamen Kalender-Symbols.",
    changes: [
      { kind: "improved", title: "Kalender-Buttons mit Logos", text: "In E-Mails zu einem neuen, bestätigten oder verschobenen Termin trägt jeder Kalender-Button jetzt das Logo seines Kalenders: Apple, Google und Microsoft für Outlook, einfarbig im Design des Hubs. So findest du den passenden Button auf einen Blick.", customers: true },
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
      { kind: "new", title: "Aufgaben ändern", text: "Bestehende Aufgaben lassen sich über den Assistenten umstellen: Titel, Stand, Fälligkeit, ob OALAB oder der Kunde dran ist und die Freigabe für den Kunden. Jede Aufgabe lässt sich in der Vorschau einzeln abwählen." },
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
      { kind: "new", title: "Echte Projekte aus OALab Studio", text: "Projekte, Fortschritt und Zieltermine im Hub kommen jetzt aus OALab Studio, wo das OALAB-Team sie pflegt. Kunden sehen nur, was für sie freigegeben ist. Der Fortschritt ist der Anteil erledigter Aufgaben, genau wie im Studio.", customers: true },
      { kind: "new", title: "Aufgaben im Projekt und „Du bist am Zug“", text: "Die Projektdetails zeigen die Aufgaben mit Stand, Fälligkeit und ob OALAB oder du dran bist. Aufgaben, die bei dir liegen, stehen in der Übersicht unter „Du bist am Zug“ und setzen das Projekt auf „Dein Feedback“.", customers: true },
      { kind: "new", title: "Assistent liest Projektdaten", text: "Admins können den Assistenten nach Kunden, Projekten und Aufgaben fragen, etwa „Welche Aufgaben liegen gerade bei Kunden?“. Er liest nur, was der Admin im Hub ohnehin sieht, ändert selbst nichts und braucht den aktiven Zwei-Faktor-Schutz. Über „Assistent zu diesem Projekt fragen“ im Projektdialog versteht er „dieses Projekt“." },
      { kind: "new", title: "Aufgaben per Assistent anlegen", text: "Admins können den Assistenten bitten, Aufgaben für ein Projekt anzulegen. Er zeigt sie zuerst als Vorschau im Chat; dort lassen sie sich abwählen, zwischen OALAB und Kunde umstellen und für den Kunden freigeben. Erst „Speichern“ legt sie im Studio an, unter dem Namen des Admins." },
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
      { kind: "new", title: "Kalender", text: "Kunden sehen, wie ausgelastet OALAB an jedem Tag ist, und fragen Termine in freien Zeiten an (Montag bis Freitag, 9 bis 17 Uhr, 30 bis 90 Minuten). Das OALAB-Team bestätigt mit einem Microsoft-Teams-Link oder lehnt mit Begründung ab. Projektziele erscheinen als ganztägige Einträge.", customers: true },
      { kind: "new", title: "Registrierung mit Freigabe", text: "Wer sich registriert, kommt erst nach der Prüfung durch das OALAB-Team in den Hub und sieht bis dahin den Stand seiner Anmeldung.", customers: true },
      { kind: "new", title: "User Management", text: "Admins prüfen Registrierungen und geben sie frei oder lehnen sie ab. Sie legen Logins und Kunden an, verschicken Aktivierungs- und Passwort-Links, sperren oder löschen Konten. Jede Aktion steht im Verlauf." },
      { kind: "new", title: "E-Mails vom Hub", text: "Bestätigung der Adresse, Eingangsbestätigung, Freigabe, Ablehnung sowie Aktivierungs- und Passwort-Links kommen als E-Mail im OALAB-Design.", customers: true },
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
      { kind: "new", title: "Dateiaustausch", text: "Das OALAB-Team lädt Dateien mit Kategorie und Beschreibung hoch und ordnet sie Kunden zu. Kunden laden sie genau so herunter, wie sie hochgeladen wurden; eine Prüfsumme belegt das.", customers: true },
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
      { kind: "new", title: "Login und persönlicher Bereich", text: "Kunden und das OALAB-Team melden sich mit E-Mail-Adresse und Passwort an und landen in ihrem Bereich mit Übersicht, Projekten, Dateien und Nachrichten.", customers: true },
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
