import { LegalCard, LegalContents, LegalSection } from "@/components/legal/legal-page";
import { OPERATOR } from "@/lib/legal-details";

/**
 * Checked on 8.11.2026 against what the hub really uses: its own server at netcup (Coolify on server 2: PostgreSQL,
 * Better Auth login with the session cookie of lib/platform/config.ts, Garage file store; netcup also sends the mail),
 * Cloudflare in front of every public host, Anthropic (assistant), Telegram (since 12.11.2026 every customer message
 * with company, name and text, since 24.11.2026 also requests for appointments with company, name, title and time; at
 * the user's wish the text below says only that the team hears of new messages and requests there and makes no claim
 * about their content), cards for changes in the private chat (24.11.2026, only the hub, nothing of the service
 * platform), the info mails of the start series with „Infomails abbestellen“ in each (26.11.2026, § 7 Abs. 3 UWG,
 * lib/hub-mail/opt-out.ts), freelancers
 * who see the customers assigned to them, customer master data taken over from the accounting (Sevdesk import). Vercel
 * and Supabase only keep the frozen copy from before the move (8.11.2026) until they are deleted. Only necessary
 * cookies (session, reduce motion, the proxy's sticky cookie oalab_srv of service-oalab docs/operations/eigener-server.md) and browser storage, no trackers, fonts served by the hub itself. Change this text whenever one of these
 * changes, and move PRIVACY_POLICY_DATE (lib/legal-details.ts) with it.
 */
export const PRIVACY_SECTIONS = [
  { id: "verantwortlicher", title: "Verantwortlicher" },
  { id: "ueberblick", title: "Das Wichtigste in Kürze" },
  { id: "dienstleister", title: "Hosting und Dienstleister" },
  { id: "aufruf", title: "Aufruf des Hubs, Cookies und Browser-Speicher" },
  { id: "konto", title: "Registrierung, Anmeldung und Konto" },
  { id: "inhalte", title: "Projekte, Dateien und Termine" },
  { id: "nachrichten", title: "Nachrichten und Meldung an Telegram" },
  { id: "assistent", title: "KI-Assistent „Assistent & Hilfe“" },
  { id: "e-mails", title: "E-Mails, Benachrichtigungen und Infomails" },
  { id: "speicherdauer", title: "Speicherdauer" },
  { id: "rechte", title: "Deine Rechte" },
  { id: "sicherheit", title: "Sicherheit" },
  { id: "aenderungen", title: "Änderungen" },
] as const;

const title = (id: (typeof PRIVACY_SECTIONS)[number]["id"]) => {
  const index = PRIVACY_SECTIONS.findIndex((section) => section.id === id);
  return `${index + 1}. ${PRIVACY_SECTIONS[index].title}`;
};

/** The privacy policy of the hub (Art. 13 DSGVO), checked against the services the code really uses. */
export function PrivacyPolicy() {
  return (
    <>
      <LegalContents sections={PRIVACY_SECTIONS.map((section, index) => ({ id: section.id, title: `${index + 1}. ${section.title}` }))} />

      <LegalSection id="verantwortlicher" title={title("verantwortlicher")}>
        <p>Verantwortlich für die Datenverarbeitung im Hub ist:</p>
        <LegalCard>
          <strong>{OPERATOR.name}</strong><br />
          vertreten durch {OPERATOR.partners.join(" und ")}<br />
          {OPERATOR.street}, {OPERATOR.city}, {OPERATOR.country}<br />
          Telefon <a href={OPERATOR.phoneHref}>{OPERATOR.phone}</a> · E-Mail <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        </LegalCard>
        <p>Einen Datenschutzbeauftragten müssen wir nicht benennen. Fragen zum Datenschutz beantworten wir unter <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>.</p>
      </LegalSection>

      <LegalSection id="ueberblick" title={title("ueberblick")}>
        <ul>
          <li>Der Hub ist das Kundenportal von oalab. Wir verarbeiten deine Daten, um dir Zugang zu geben und mit dir an Projekten zu arbeiten.</li>
          <li>Der Hub läuft auf unserem eigenen Server bei netcup in der EU. Davor steht Cloudflare, das die Verbindungen weiterleitet und vor Angriffen schützt (Abschnitt 3).</li>
          <li>Im Hub gibt es keine Werbung, kein Tracking, keine Analyse-Werkzeuge und keine eingebetteten Inhalte fremder Anbieter; auch die Schrift liefert der Hub selbst aus. Cookies und Browser-Speicher nutzt der Hub nur, soweit er sie zum Funktionieren braucht.</li>
          <li>Kunden bekommen von uns gelegentlich Infomails zum Hub, zur Serviceplattform und zu unseren Leistungen. Die kannst du jederzeit mit einem Klick abbestellen (Abschnitt 9).</li>
          <li>Wir verkaufen keine Daten. Dienstleister bekommen Daten nur, soweit es für den Hub nötig ist; du findest sie unten mit Namen.</li>
          <li>Zwei Punkte solltest du kennen: Schreibt dein Unternehmen uns im Chat oder fragt einen Termin an, meldet der Hub das unserem Team auch über Telegram (Abschnitt 7). Fragen an den KI-Assistenten verarbeitet Anthropic (Abschnitt 8).</li>
        </ul>
      </LegalSection>

      <LegalSection id="dienstleister" title={title("dienstleister")}>
        <p>Für den Betrieb setzen wir diese Dienstleister ein. Rechtsgrundlage ist die Erfüllung unseres Vertrags mit dir bzw. deinem Unternehmen (Art. 6 Abs. 1 lit. b DSGVO), im Übrigen unser berechtigtes Interesse an einem sicheren und zuverlässigen Betrieb (Art. 6 Abs. 1 lit. f DSGVO).</p>
        <h3>netcup: Server, Datenbank, Anmeldung, Dateiablage und E-Mail</h3>
        <LegalCard><strong>netcup GmbH</strong><br />Daimlerstraße 25, 76185 Karlsruhe, Deutschland</LegalCard>
        <p>Der Hub läuft auf einem eigenen Server, den wir bei netcup in einem Rechenzentrum in der EU mieten und selbst betreiben. Dort liegen alle Inhalte des Hubs: Konten und Anmeldung, Kundendaten, Projekte, Aufgaben, Dateien, Termine, Nachrichten und Protokolle. Hub und Serviceplattform (service.oalab.de) laufen auf demselben Server und nutzen dieselbe Datenbank und dieselbe Anmeldung. Die E-Mails des Hubs verschicken wir über unser Postfach hub@oalab.de, ebenfalls bei netcup in Deutschland (Abschnitt 9). netcup stellt Rechenzentrum, Server und Postfach bereit und verarbeitet die Daten dabei in unserem Auftrag auf Grundlage eines Vertrags über Auftragsverarbeitung (Art. 28 DSGVO).</p>
        <h3>Cloudflare: Weiterleitung und Schutz vor Angriffen</h3>
        <LegalCard><strong>Cloudflare, Inc.</strong><br />101 Townsend St., San Francisco, CA 94107, USA</LegalCard>
        <p>Jeder Aufruf des Hubs und jeder Download aus der Dateiablage läuft über das Netz von Cloudflare, bevor er unseren Server erreicht. Unser Server nimmt Verbindungen nur von Cloudflare an. Cloudflare wehrt Angriffe ab und leitet die Verbindung weiter, in der Regel über das nächstgelegene Rechenzentrum. Dazu entschlüsselt Cloudflare die Verbindung dort kurz und verarbeitet die Daten des Aufrufs: deine IP-Adresse, technische Angaben deines Browsers und die übertragenen Inhalte. Cloudflare verarbeitet sie in unserem Auftrag auf Grundlage eines Vertrags über Auftragsverarbeitung (Art. 28 DSGVO). Cloudflare hat seinen Sitz in den USA und ist nach dem EU-US Data Privacy Framework zertifiziert; für Übermittlungen dorthin gilt der Angemessenheitsbeschluss der EU-Kommission (Art. 45 DSGVO).</p>
        <h3>Vercel und Supabase: frühere Plattform</h3>
        <p>Bis zum 8. November 2026 lief der Hub bei <strong>Vercel Inc.</strong> (440 N Barranca Ave #4133, Covina, CA 91723, USA; Server in Frankfurt am Main) mit Datenbank, Anmeldung und Dateiablage bei <strong>Supabase Pte. Ltd.</strong> (65 Chulia Street #38-02/03, OCBC Centre, Singapur 049513; Rechenzentrum in Frankfurt am Main). Eine ruhende Kopie der Daten bis zu diesem Tag bewahren wir dort noch kurz als Rückweg auf; neue Daten kommen nicht hinzu. Danach löschen wir sie. Supabase verarbeitet die Kopie in unserem Auftrag auf Grundlage eines Vertrags über Auftragsverarbeitung (Art. 28 DSGVO); greift Supabase von außerhalb der EU darauf zu, etwa im Support, gelten die EU-Standardvertragsklauseln. Vercel ist nach dem EU-US Data Privacy Framework zertifiziert.</p>
        <p>Anthropic, den Anbieter des KI-Assistenten, beschreiben wir in Abschnitt 8.</p>
      </LegalSection>

      <LegalSection id="aufruf" title={title("aufruf")}>
        <h3>Server-Protokolle</h3>
        <p>Bei jedem Aufruf verarbeiten Cloudflare und unser Server technische Daten: IP-Adresse, Datum und Uhrzeit, die aufgerufene Adresse, Browser und Betriebssystem, die zuvor besuchte Seite und das Ergebnis der Anfrage. Wir brauchen sie, um den Hub auszuliefern, Fehler zu finden und Angriffe abzuwehren (Art. 6 Abs. 1 lit. f DSGVO). Die Protokolle bleiben nur kurz gespeichert und werden nicht mit anderen Daten zusammengeführt.</p>
        <h3>Cookies</h3>
        <p>Der Hub setzt nur Cookies, die für die Anmeldung, eine von dir gewählte Einstellung oder das vollständige Laden der Seiten unbedingt nötig sind:</p>
        <ul>
          <li><strong>__Secure-oalab.session_token</strong> hält dich angemeldet, auf hub.oalab.de und service.oalab.de zugleich. Er enthält nur eine zufällige, signierte Kennung deiner Sitzung; Skripte können ihn nicht lesen. Er wird beim Abmelden gelöscht und läuft sonst 30 Tage nach deiner letzten Nutzung ab.</li>
          <li><strong>oalab_reduce_motion</strong> gibt es nur, wenn du unter Darstellung „Bewegung reduzieren“ einschaltest. Er enthält nur diese Wahl, damit sie auch auf service.oalab.de gilt. Er wird gelöscht, wenn du die Einstellung wieder ausschaltest, sonst nach einem Jahr.</li>
          <li><strong>oalab_srv</strong> setzt unser Server auf hub.oalab.de und service.oalab.de. Geht gerade eine neue Version live, laufen für einige Sekunden zwei Server nebeneinander; das Cookie sorgt dafür, dass dein Browser alle Teile einer Seite vom selben Server holt und die Seite vollständig lädt. Er enthält nur eine Kennung dieses Servers, nichts über dich; Skripte können ihn nicht lesen. Er wird gelöscht, wenn du den Browser schließt.</li>
        </ul>
        <p>Rechtsgrundlage ist § 25 Abs. 2 Nr. 2 TDDDG, weil der Hub ohne diese Cookies die Anmeldung, deine gewählte Einstellung und das vollständige Laden der Seiten nicht umsetzen kann, für die Anmeldedaten selbst Art. 6 Abs. 1 lit. b DSGVO.</p>
        <h3>Speicher im Browser</h3>
        <p>Einige Einstellungen merkt sich der Hub nur auf deinem Gerät (Local Storage und Session Storage):</p>
        <ul>
          <li>deine Darstellung (hell oder dunkel, Hintergrund, Glas, Bewegung, Listenansicht) und deine Favoriten,</li>
          <li>den Verlauf des KI-Assistenten für deinen Login, bis du „Neu starten“ klickst oder dich abmeldest, und ob er als Fenster oder als Leiste erscheint,</li>
          <li>für die Begrüßung direkt nach der Anmeldung kurz deinen Vornamen.</li>
        </ul>
        <p>Diese Daten bleiben auf deinem Gerät. Nur den Verlauf des Assistenten schickt der Hub mit jeder neuen Frage mit (Abschnitt 8). Rechtsgrundlage ist § 25 Abs. 2 Nr. 2 TDDDG. Du kannst alles jederzeit löschen, indem du die Website-Daten in deinem Browser löschst.</p>
      </LegalSection>

      <LegalSection id="konto" title={title("konto")}>
        <h3>Registrierung</h3>
        <p>Für ein Konto fragen wir Vorname, Nachname, Unternehmen, Telefon, E-Mail-Adresse und ein Passwort ab; Position, Website, Kundennummer und eine Nachricht sind freiwillig. Sobald du deine E-Mail-Adresse bestätigt hast, bekommt unser Team deine Angaben per E-Mail und prüft sie. Danach schalten wir deinen Zugang frei oder lehnen ihn mit einer Begründung ab. Rechtsgrundlage ist die Anbahnung eines Vertrags (Art. 6 Abs. 1 lit. b DSGVO). Ohne die Pflichtangaben können wir keinen Zugang einrichten.</p>
        <h3>Anmeldung</h3>
        <p>Du meldest dich mit E-Mail-Adresse und Passwort an; das Passwort speichern wir nur als Hash, nie im Klartext. Auf Wunsch fragt der Hub zusätzlich einen Code ab, per E-Mail oder aus einer Authenticator-App. Wir speichern, wann du dich zuletzt angemeldet hast.</p>
        <h3>Daten deines Unternehmens</h3>
        <p>Ist dein Unternehmen schon Kunde von oalab, legen wir es im Hub mit den Angaben aus unserer Buchhaltung an: Name des Unternehmens, Kundennummer, E-Mail-Adresse, Telefon, Website und Anschrift. Dazu können die E-Mail-Adresse und die Telefonnummer einer Ansprechperson gehören. Steuer- und Bankdaten übernehmen wir nicht in den Hub. Diese Angaben sehen die Logins deines Unternehmens in ihrem Profil; ändern kannst du sie auf der Serviceplattform unter „Profil und Firma“ oder über uns. Rechtsgrundlage ist die Erfüllung unseres Vertrags mit deinem Unternehmen (Art. 6 Abs. 1 lit. b DSGVO).</p>
        <h3>Konto und Protokolle</h3>
        <p>Zu deinem Konto gehören Name, Unternehmen, Kontaktdaten, Rolle und Status. Das oalab-Team sieht sie in der Verwaltung des Hubs. Freigaben, Sperren und Rollenwechsel halten wir in einem Protokoll fest, ebenso, welche E-Mail der Hub wann verschickt hat (ohne Adressen und Inhalte). Das dient der Nachvollziehbarkeit und Sicherheit (Art. 6 Abs. 1 lit. f DSGVO).</p>
      </LegalSection>

      <LegalSection id="inhalte" title={title("inhalte")}>
        <p>Im Hub teilen wir mit dir, woran wir gemeinsam arbeiten: Projekte und Aufgaben, Dateien, das Logo deines Unternehmens und Termine, jeweils mit Namen und Zeitpunkten. Diese Inhalte sehen nur die Logins deines Unternehmens, das oalab-Team und, wenn einer dein Unternehmen mitbetreut, ein Freelancer im Umfang unten. Dateien liegen in einer nicht öffentlichen Ablage auf unserem Server; Downloads laufen über Links, die nach kurzer Zeit ablaufen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>
        <p>Für Online-Termine speichert der Hub den Link zur Besprechung bei Microsoft Teams, Zoom oder Google Meet. Erst wenn du auf „Beitreten“ tippst, öffnet sich die Besprechung beim jeweiligen Anbieter; dort gelten dessen Datenschutzhinweise. In E-Mails zu Terminen bietet er „In deinen Kalender eintragen“ an: Wählst du Google Kalender oder Outlook, leitet der Hub Titel, Zeit, Beschreibung und Besprechungslink an Google bzw. Microsoft weiter, und dort gelten deren Datenschutzhinweise. Die Kalenderdatei (.ics) bleibt auf deinem Gerät.</p>
        <h3>Kalender-Abo</h3>
        <p>Im Kalender und im Profil kannst du deine Termine bei oalab als Kalender abonnieren, etwa in Apple Kalender, Google Kalender oder Outlook. Darin stehen deine bestätigten Termine mit Zeit, Titel, Beschreibung und Besprechungslink und, wenn du sie zuschaltest, offene Anfragen, Projektziele und Aufgaben. Der Hub erzeugt dafür einen geheimen Link, der ohne Anmeldung funktioniert; behandle ihn wie ein Passwort und gib ihn nicht weiter. Wir speichern davon nur eine Prüfsumme, was im Abo stehen soll und wann und mit welcher Art von Programm (Apple, Google, Microsoft oder anderes) der Kalender zuletzt abgerufen wurde. Abgerufen wird der Kalender von dem Dienst, den du dafür wählst, etwa Apple (iCloud), Google oder Microsoft, auf deinen Wunsch; dort gelten deren Datenschutzhinweise. Auch unser Team kann seine Termine so abonnieren; dann stehen Titel, Zeit und Besprechungslink deiner Termine auch im Kalender unseres Teams bei Apple (iCloud) oder Microsoft 365. Du beendest das Abo im Kalender oder im Profil mit „Abo beenden“, der Link geht dann sofort nicht mehr. Es endet außerdem von selbst, wenn dein Zugang deaktiviert wird oder 180 Tage lang niemand abruft. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>
        <h3>Freelancer</h3>
        <p>Manche Kunden betreuen wir gemeinsam mit Freelancern, die in unserem Auftrag und nach unseren Weisungen arbeiten. Betreut ein Freelancer dein Unternehmen, sieht er im Hub den Namen, das Logo und die Kontaktdaten deines Unternehmens und die Dateien, die wir für ihn freigeben; Verträge, Angebote und Rechnungen nur, wenn wir sie eigens für ihn freigeben. Chats, Termine und die Logins deines Unternehmens sieht er nicht, und auf die Serviceplattform hat er keinen Zugang. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>
      </LegalSection>

      <LegalSection id="nachrichten" title={title("nachrichten")}>
        <h3>Privater Chat</h3>
        <p>Unter „Nachrichten“ schreibst du direkt mit dem oalab-Team. Gespeichert werden Text, Name, Zeitpunkt und wer welche Nachricht gelesen hat. Den Chat sehen alle Logins deines Unternehmens und das oalab-Team. Über neue Nachrichten informiert der Hub in der Glocke und per E-Mail (Abschnitt 9). Was wir für dein Unternehmen ändern, etwa ein neuer Termin oder eine neue Datei, und deine Terminanfragen kann der Hub zusätzlich als Karte in den Chat stellen; welche Bereiche, stellt ihr unter „Abos“ ein, und wer ein Abo ändert, steht mit Namen im Chat. Eine Karte nennt nur, was du auch in der Glocke liest, nie den Inhalt einer Datei oder Notiz und nie Passwörter. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Service-Anfragen stellst du auf der Serviceplattform; deren Gespräche sieht das oalab-Team auch im Hub, sie kommen aber nicht in den Chat.</p>
        <h3>Meldung an Telegram</h3>
        <p>Damit wir neue Nachrichten und Terminanfragen schnell sehen, meldet der Hub sie zusätzlich in einer geschlossenen Telegram-Gruppe unseres Teams. Beantwortet wird im Hub.</p>
        <LegalCard>
          <strong>Telegram Messenger Inc.</strong><br />
          Commerce House, Wickhams Cay 1, PO Box 3140, Road Town, Tortola, VG1110, Britische Jungferninseln<br />
          Vertreter in der EU (Art. 27 DSGVO): European Data Protection Office (EDPO), Avenue Huart Hamoir 71, 1030 Brüssel, Belgien
        </LegalCard>
        <ul>
          <li>Telegram ist kein Auftragsverarbeiter mit Vertrag. Telegram verarbeitet die Meldungen als eigener Verantwortlicher nach seiner Datenschutzerklärung unter telegram.org/privacy.</li>
          <li>Meldungen in Gruppen sind nicht Ende-zu-Ende-verschlüsselt. Telegram speichert sie auf seinen Servern, für Konten aus dem Europäischen Wirtschaftsraum nach eigenen Angaben in Rechenzentren in den Niederlanden.</li>
          <li>Telegram hat seinen Sitz außerhalb der EU, auf den Britischen Jungferninseln. Dafür gibt es keinen Angemessenheitsbeschluss der EU-Kommission, und mit Telegram bestehen keine Standardvertragsklauseln.</li>
        </ul>
        <p>Rechtsgrundlage ist unser berechtigtes Interesse, Kundennachrichten und Terminanfragen schnell zu sehen (Art. 6 Abs. 1 lit. f DSGVO). Du kannst dem widersprechen (Abschnitt 11).</p>
      </LegalSection>

      <LegalSection id="assistent" title={title("assistent")}>
        <p>Im Hub beantwortet ein KI-Assistent Fragen zur Bedienung. Die Antworten erzeugt das Sprachmodell Claude des Anbieters Anthropic. Der Assistent steht nur angemeldeten, freigeschalteten Konten zur Verfügung, und der Chat sagt dir, dass eine KI antwortet.</p>
        <LegalCard><strong>Anthropic Ireland, Limited</strong><br />6th Floor, South Bank House, Barrow Street, Dublin 4, D04 TR29, Irland</LegalCard>
        <p>Was an Anthropic geht:</p>
        <ul>
          <li>Als Kunde: deine Frage (bis 1.000 Zeichen) und der bisherige Verlauf, höchstens die letzten 20 Nachrichten. Der Assistent sieht dabei keine Daten aus dem Hub. Bitte gib keine persönlichen Daten ein.</li>
          <li>Als Admin von oalab zusätzlich: Daten aus dem Hub, die der Assistent für eine Antwort nachschlägt (Kunden, Ansprechpartner, Projekte und Aufgaben), und Texte, die ein Admin einfügt, etwa Protokolle von Besprechungen. Darin können Namen und Inhalte von Kunden stehen.</li>
        </ul>
        <p>Der Hub speichert die Gespräche nicht auf seinem Server; der Verlauf bleibt in deinem Browser, bis du „Neu starten“ klickst oder dich abmeldest. Anthropic verarbeitet die Daten in unserem Auftrag auf Grundlage eines Auftragsverarbeitungsvertrags, nutzt sie nicht zum Training und löscht Eingaben und Antworten nach eigenen Angaben innerhalb von 30 Tagen, außer etwa bei Verstößen gegen seine Nutzungsrichtlinien. Die Verarbeitung kann in den USA stattfinden; dafür gelten die EU-Standardvertragsklauseln.</p>
        <p>Schlägt der Assistent einem Admin vor, Aufgaben, Projekte oder Kunden anzulegen oder zu ändern, speichert der Hub nur diesen Vorschlag und sein Ergebnis im KI-Protokoll, nicht den Chat. Gespeichert wird erst, wenn der Admin bestätigt: Es entscheidet immer ein Mensch, automatisierte Entscheidungen nach Art. 22 DSGVO gibt es nicht.</p>
        <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO für die Hilfe im Hub, im Übrigen unser berechtigtes Interesse an einer effizienten Projektarbeit (Art. 6 Abs. 1 lit. f DSGVO).</p>
      </LegalSection>

      <LegalSection id="e-mails" title={title("e-mails")}>
        <p>Der Hub schickt E-Mails von hub@oalab.de über netcup: zur Registrierung (Eingang, Freigabe oder Ablehnung), Links zum Aktivieren des Kontos oder Zurücksetzen des Passworts, Anmeldecodes und Benachrichtigungen. Kunden bekommen zu Aufgaben, Projektstatus, neuen Dateien, Terminen und Antworten im Chat eine E-Mail, mehrere Meldungen gesammelt; dieselben Meldungen stehen in der Glocke. Benachrichtigungs-E-Mails schaltest du im Profil unter „Benachrichtigungen“ ab; E-Mails zu Konto und Sicherheit kommen immer. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>
        <p>Bilder stecken direkt in der E-Mail. Beim Öffnen wird nichts nachgeladen, und wir messen nicht, ob du eine E-Mail öffnest.</p>
        <h3>Infomails</h3>
        <p>Kunden-Zugänge bekommen von uns gelegentlich Infomails von hub@oalab.de: zum Start des Hubs und der Serviceplattform, Anleitungen zu ihren Funktionen und Neuigkeiten zu unseren Leistungen. Dafür nutzen wir die E-Mail-Adresse deines Zugangs und merken uns, welche Infomail du wann bekommen hast. Rechtsgrundlage ist unser berechtigtes Interesse, unsere Kunden über ihre Werkzeuge und über ähnliche eigene Leistungen zu informieren (Art. 6 Abs. 1 lit. f DSGVO in Verbindung mit § 7 Abs. 3 UWG).</p>
        <p>Du kannst der Nutzung deiner E-Mail-Adresse für Infomails jederzeit widersprechen, ohne dass dir dafür andere als die Übermittlungskosten nach den Basistarifen entstehen: über „Infomails abbestellen“ unten in jeder Infomail, über die Abmelden-Funktion deines Mailprogramms oder per E-Mail an <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>. Danach bekommst du keine Infomails mehr; dass du abbestellt hast, merken wir uns an deinem Zugang, und du kannst sie auf derselben Seite wieder bestellen. Benachrichtigungen und E-Mails zu Konto und Sicherheit kommen weiter.</p>
      </LegalSection>

      <LegalSection id="speicherdauer" title={title("speicherdauer")}>
        <p>Wir speichern Daten, solange du ein Konto hast oder wir mit deinem Unternehmen zusammenarbeiten. Danach löschen wir sie, soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen, etwa aus Handels- und Steuerrecht. Im Einzelnen:</p>
        <ul>
          <li>Abgelehnte Registrierungen bewahren wir auf, damit wir sie später doch freigeben können, und löschen sie auf Wunsch sofort.</li>
          <li>Server-Protokolle: nur kurze Zeit (Abschnitt 4).</li>
          <li>Assistent: im Browser bis „Neu starten“ oder Abmelden, bei Anthropic bis zu 30 Tage; Einträge im KI-Protokoll, solange sie für die Nachvollziehbarkeit nötig sind.</li>
        </ul>
      </LegalSection>

      <LegalSection id="rechte" title={title("rechte")}>
        <p>Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20). Schreib uns dazu an <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>.</p>
        <div className="legal-highlight">
          <p><strong>Widerspruchsrecht nach Art. 21 DSGVO:</strong> Verarbeiten wir Daten auf Grundlage unseres berechtigten Interesses (Art. 6 Abs. 1 lit. f DSGVO), kannst du jederzeit aus Gründen, die sich aus deiner besonderen Situation ergeben, widersprechen. Wir verarbeiten die Daten dann nicht mehr, es sei denn, wir können zwingende schutzwürdige Gründe nachweisen, die deine Interessen überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.</p>
          <p>Der Nutzung deiner Daten für Direktwerbung, etwa für unsere Infomails, kannst du jederzeit ohne Angabe von Gründen widersprechen (Art. 21 Abs. 2 und 3 DSGVO); danach nutzen wir sie dafür nicht mehr.</p>
        </div>
        <p>Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), zum Beispiel bei der für uns zuständigen:</p>
        <LegalCard><strong>Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen</strong><br />Kavalleriestraße 2–4, 40213 Düsseldorf</LegalCard>
      </LegalSection>

      <LegalSection id="sicherheit" title={title("sicherheit")}>
        <p>Der Hub ist nur verschlüsselt erreichbar (HTTPS). Jedes Unternehmen sieht nur seine eigenen Daten; das prüfen Hub und Datenbank bei jedem Zugriff. Die Datenbank ist von außen nicht erreichbar, Dateien nur über die zeitlich begrenzten Links. Von Datenbank und Dateien legen wir jede Nacht eine Sicherung an. Deine Anmeldung kannst du im Profil mit einem zweiten Faktor schützen.</p>
      </LegalSection>

      <LegalSection id="aenderungen" title={title("aenderungen")}>
        <p>Wir passen diese Erklärung an, wenn sich der Hub oder die Rechtslage ändert. Es gilt die hier veröffentlichte Fassung.</p>
      </LegalSection>
    </>
  );
}
