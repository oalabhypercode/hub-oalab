# OALAB Projects – Client Hub

> Zentrale Projektübersicht, Entscheidungsgrundlage und Sammlung offener Fragen.
> Dieses Dokument soll bei jeder fachlichen oder technischen Entscheidung aktualisiert werden.

**Stand:** 6. November 2026
**Projektphase:** Schritt 1 – Frontend und vier rollenbasierte Demo-Konten umgesetzt; persistentes Datenmodell folgt

### Vorgabe vom 6. November 2026: Vertrag & Domain, Etappe 3 (Servicepakete begrenzen neue Anfragen)

- Freigabe des Nutzers nach dem Plan („Ja, so bauen“), mit allen Empfehlungen: jetzt bauen, aber ausgeschaltet; scharf erst, wenn die Preise stehen, alle echten Kunden ein Servicepaket haben und der Nutzer die Sperrliste freigegeben hat. Begrenzt werden nur neue Anfragen: OALAB Service Lite 5, OALAB Service Max 20 je Kalendermonat nach deutscher Zeit, ohne Servicepaket keine. Minuten und Antwortzeiten aus dem Preisentwurf bleiben Vertragstext (die Serviceplattform misst keine Zeit). Jede abgeschickte neue Anfrage zählt, Antworten nie; Admins nehmen einzelne Anfragen aus. Am Limit gibt es bis zum Monatswechsel keine neue Anfrage, mit einem Hinweis auf Stand, Reset-Tag und den Weg zu oalab über „Nachrichten“; ab 80 % eine Vorwarnung. Der Schalter sitzt im Hub (Entscheidung des Nutzers), Kunden sehen vom Kontingent erst etwas, wenn er an ist.
- Datenbank: Migration `202611060001_hub_service_quota.sql` in `service-oalab`.
  - `hub_service_quota_switch`: eine Zeile, `enforced` zu Beginn aus; schreiben nur der Hub-Server mit der Service-Rolle.
  - `hub_service_request_exemptions`: ausgenommene Anfragen mit kurzem internem Grund (3 bis 300 Zeichen), Autor und Zeit; Fremdschlüssel auf `(request_id, organization_id)` der Anfrage, verschwindet mit ihr. Keine Leseregel für Logins.
  - `app.hub_service_quota(org)`: Servicepaket des Hub-Kunden der Organisation am heutigen Tag (vom Tag „seit“ bis einschließlich „gekündigt zum“, deutsche Zeit), Grenze aus `hub_service_request_limit` (5, 20, sonst 0), Zählung aus `usage_ledger` (`request_submission`) im Monat nach deutscher Zeit, ohne Ausnahmen. Ein Paketwechsel im Monat gilt für den ganzen Monat.
  - `app.assert_client_request_quota_v1` an drei Ankern ergänzt (wie 202610190002): Mit eingeschaltetem Schalter sperrt die Prüfung ohne Servicepaket (`service_package_missing`) und am Limit (`monthly_request_limit` mit Stand und Reset um Mitternacht deutscher Zeit); der Monatswert des Plans „Starter“ gilt dann nicht mehr, die Grenze für gleichzeitig offene Anfragen (20) bleibt. Schalter aus: alles wie vorher.
  - `app.client_package_usage` (Studio, NoteTree Business) zählt wie die Prüfung; die Felder bleiben, `packageId` bleibt der Plan, neu sind `servicePackage` und `exempted`.
  - Für den Hub: `hub_service_quota_overview()` und `hub_service_quota_requests(customer)` nur für die Service-Rolle, `hub_member_service_quota()` für Kunden-Logins mit aktivem Profil, nur bei eingeschaltetem Schalter und ohne die Zahl der Ausnahmen.
  - Geprüft mit einem Source-Test (`scripts/hub-service-quota.test.mjs`) und in PGlite mit der echten Prüfung (Monatswechsel um Mitternacht deutscher Zeit, Lite, Max, ohne Paket, gekündigt, Ausnahmen, Antworten, Schalter aus, offene Anfragen, Rechte). Die Migration enthält kein `delete from`.
- Serviceplattform: „Neue Anfrage“ zeigt mit eingeschaltetem Schalter ab 80 % eine Vorwarnung, am Limit und ohne Servicepaket einen Hinweis statt des Absendens (Entwurf bleibt, Link zu `hub.oalab.de/dashboard/messages` in neuem Tab). Die Kundenübersicht liefert das Kontingent nur bei eingeschaltetem Schalter. Der Beispieltext bei `QUOTA_EXCEEDED` („10 von 10 … 1. September 2026“) ist ersetzt; die Fehlermeldung nennt echte Zahlen, „kein Servicepaket“ hat eine eigene. Die Studio-Kundenkarte zeigt Hub-Paket, Zählung und „Sperre aus“.
- Hub (`lib/hub-service-quota/`, `components/hub/screens/contracts-quota.tsx`):
  - Überblick im Contract & Domain Management: Karte „Service-Kontingente“ mit Schalter („Sperre einschalten“ mit Rückfrage, die die sofort Gesperrten nennt), Sperrliste (ohne Servicepaket oder am Limit, nur Kunden mit aktivem Login auf der Serviceplattform) und „Ab 80 %“; in „Alle Kunden“ die Spalte „Anfragen im …“.
  - Kunde → Vertrag: „Service-Anfragen im …“ mit Balken, Status und den gezählten Anfragen des Monats; „Nicht mitzählen“ (Grund) und „Wieder mitzählen“. Jede Änderung und jedes Umschalten steht im Admin-Protokoll, ohne Grund und Titel.
  - Kunden: unter „Deine Pakete“ der Stand des Monats und der Reset-Tag, nur bei eingeschaltetem Schalter.
  - ⓘ an allen drei Stellen. Ohne Migration liest der Hub fehlertolerant und zeigt keine Kontingente.
- Vor dem Einschalten: Preise freigeben, allen echten Kunden ein Servicepaket geben (Filter „Ohne Servicepaket“), klären, ob „Ali der Kunde“ und „Al Firdaus“ echte Kunden sind, die Sperrliste im Überblick mit dem Nutzer durchgehen. Erst auf sein „einschalten“ wird umgeschaltet. Grenzen: Eine im Papierkorb endgültig gelöschte Anfrage zählt nicht mehr (ihr Eintrag im Nutzungsbuch geht mit); Anfragen, die oalab selbst aus Mail oder WhatsApp anlegt, zählen nie; die Planwahl in NoteTree Business regelt nur noch die gleichzeitig offenen Anfragen.

### Vorgabe vom 5. November 2026: Vertrag & Domain, Etappe 2 (Domain, Mail und Zugänge)

- Freigabe des Nutzers nach dem Plan („Ja, so bauen“), mit allen Empfehlungen. Etappe 1 (Pakete und Verlauf) ist seit dem 5. November 2026 live (hub#60, service#18); Etappe 3 (Service Lite 5 und Max 20 Anfragen im Monat) folgt erst, wenn alle echten Kunden ein Paket haben.
- Datenbank: Migration `202611050002_hub_customer_domains.sql` in `service-oalab`. Alles gehört nur zu Kunden, nie zu Freelancern (Fremdschlüssel auf `(id, kind)`), und verschwindet mit dem Kunden; schreiben darf nur der Hub-Server mit der Service-Rolle nach der Admin-Prüfung.
  - `hub_customer_domains`: mehrere Domains je Kunde (klein geschrieben, Umlaute als `xn--…`, jede Domain bei genau einem Kunden), registriert bei, DNS bei, Website läuft bei, Inhaber (oalab oder Kunde), Verlängerung, Status (In Einrichtung, Aktiv, Umzug läuft, Gekündigt, Beendet), sechs Häkchen (Website-Eintrag, SSL, MX, SPF, DKIM, DMARC), interne Notiz. Kunden lesen nur `id, customer_id, domain`, und nur solange die Domain nicht beendet ist.
  - `hub_customer_mail_servers`: ein Mail-Server je Kunde mit Anbieter (intern), IMAP und SMTP (Server, Port, SSL/TLS oder STARTTLS; ein Server immer mit Port) und Webmail über https. Kunden lesen die Serverdaten nur, solange sie OALAB Domain & Mail haben; der Hub speichert ihn auch nur mit diesem Paket.
  - `hub_customer_mailboxes`: Postfach, Weiterleitung (Ziele mit „, “ getrennt) oder Alias, mit Person. Kunden lesen Adresse, Person, Art und Ziel.
  - `hub_customer_logins`: Anbieter-Logins (Domain-Anbieter, DNS, Hosting, Sonstiges) mit Login-Adresse (nur http/https) und Benutzername, ohne Passwort und ohne jede Leseregel.
  - `hub_vault_secrets`: nur Geheimtext (Schlüsselversion, IV, Prüfwert, Geheimtext in Base64), genau einer je Postfach oder Login, ohne Leseregel und ohne Rechte für Logins. Ein Passwort gehört nur zu einem Postfach (keiner Weiterleitung, keinem Alias); ein Postfach mit Passwort wird erst nach dem Entfernen des Passworts zur Weiterleitung oder zum Alias. Die Migration enthält kein `delete from`, damit der SQL-Editor nicht warnt.
  - In PGlite mit den echten Hub-Migrationen geprüft (Formate, Kundengrenzen, Spaltenrechte, keine Leserechte auf Logins und Geheimtext, auch nicht für Admins mit ihrer Sitzung).
- Verschlüsselung: AES-256-GCM im Hub-Server (`lib/hub-vault/crypto.ts`), Schlüssel `HUB_VAULT_KEY` (32 Byte, Base64) nur in Vercel (Production) und in `.env.local`, gelesen nur in `lib/hub-vault/key.ts`. Die Zusatzdaten binden jeden Geheimtext an sein Postfach oder seinen Login. Geht der Schlüssel verloren, sind alle Passwörter unlesbar; er muss in Vercel und lokal derselbe sein.
- Zugänge (`lib/hub-vault/actions.ts`): Jede Aktion prüft zuerst `aal2` im Token, dann `verifyHubAdmin` (das allein auch Admins ohne zweiten Faktor durchlässt). Anzeigen und Kopieren schreiben vorher `vault.revealed` bzw. `vault.copied` in `hub_admin_events` (mit Postfach oder Login, nie dem Passwort), höchstens 30 Blicke je Admin in 10 Minuten. Keine Wege zu Mail, Telegram, Glocke, Server-Log oder Assistent; die Seite erfährt nur, ob ein Passwort hinterlegt ist. Angezeigt bleibt ein Passwort 30 Sekunden (auch beim Tab-Wechsel verdeckt). Eingabefelder sind keine Passwortfelder in einem Formular, damit Browser Kundenpasswörter nicht als Hub-Passwort speichern; die Punkte kommen per CSS.
- Hub: Reiter „Domain & Mail“ und „Zugänge“ zwischen „Vertrag“ und „Verlauf“ (`components/hub/screens/contracts-domains.tsx`, `contracts-access.tsx`), Server-Actions für Domains, Mail-Server und Adressen in `lib/hub-domains/actions.ts`, Laden in `lib/hub-domains/server.ts`. Der Überblick zeigt unter „Demnächst“ auch Domain-Verlängerungen der nächsten 60 Tage, die Suche findet Kunden über ihre Domains. Kunden sehen die Karte „Domain & E-Mail“ (Domains, Adressen, mit Domain & Mail die Daten fürs Mailprogramm mit Kopieren-Knopf und Webmail), nie Passwörter oder interne Felder. Alles liest fehlertolerant: Ohne Migration bleibt der Bereich wie in Etappe 1.
- Ergänzt beim Test: Ein gespeicherter Mail-Server lässt sich mit „Entfernen“ wieder löschen (auch nach einem Paketwechsel). Unter „Zugänge“ steht die Kennung des Schlüssels auf dem Server (die ersten vier Byte seines SHA-256, zum Beispiel „A167-F53D“), auch ohne zweiten Faktor: Lokal und in Vercel muss dieselbe stehen. Adressen mit Umlaut-Domain zeigt der Hub lesbar, gespeichert bleibt `xn--…`. Ein Kopieren wird als „Passwort zum Kopieren abgerufen“ protokolliert, weil der Server die Zwischenablage nicht sieht.
- Migration am 5. November 2026 auf „Ja, einspielen“ des Nutzers live eingespielt (Text wie im PR plus `schema_migrations`-Eintrag und `notify pgrst`, ohne Warndialog) und lesend geprüft. `HUB_VAULT_KEY` hat der Hub auf „Richte du den Schlüssel ein“ lokal erzeugt, ohne ihn anzuzeigen; der Nutzer hat ihn in Vercel (Production, Secret) und seinen Passwort-Manager übernommen.
- Lokal gegen die Live-Datenbank geprüft (Testkunde OA-56215, danach aufgeräumt): Paket, Domain mit Umlaut, Mail-Server (STARTTLS setzt Port 587), Postfach und Weiterleitung, die Prüfungen (Domain ohne Endung, Weiterleitung an sich selbst). Zugänge mit einer nur lokal und vorübergehend aufgehobenen aal2-Sperre: Hinterlegen, Anzeigen (30 Sekunden, dann verdeckt), Ändern, Entfernen, Anbieter-Login mit Passwort, Postfach mit Passwort lässt sich nicht zur Weiterleitung machen, Löschen nimmt das Passwort mit. In der Datenbank nur Geheimtext, im Protokoll jeder Schritt ohne Passwort. Die Kundensicht als Testzugang von OA-99643 (Leseabfrage mit dessen Rolle): nur eigene Domains und Adressen, kein Mail-Server ohne Domain & Mail, keine internen Spalten, kein Zugriff auf Logins und Geheimtext. Das Kopieren blockiert nur das Browser-Fenster der Desktop-App (`clipboard-write` verweigert); in einem normalen Browser noch einmal prüfen.
- Entscheidung des Nutzers vom 5. November 2026: Den Zwei-Faktor-Schutz für seinen Admin-Login schaltet er erst ein, wenn echte Kundendaten in den Hub kommen; bis dahin ist „Zugänge“ live für ihn gesperrt. Vor echten Zugangsdaten: Zwei-Faktor-Schutz für jeden Admin einschalten, der „Zugänge“ nutzt.
- Offen: Die Datenschutzerklärung muss die Zugangsdaten der Hosting-Kunden (Postfach-Passwörter, Anbieter-Logins) nennen, bevor echte Zugangsdaten in den Hub kommen. Ein kopiertes Passwort bleibt in der Zwischenablage; der Hub leert sie nicht. Strenger als `aal2` wäre eine frische Code-Bestätigung vor jedem Blick (spätere Stufe).

### Vorgabe vom 4. November 2026: Freelancer als dritte Rolle, nur im Hub

- Wunsch des Nutzers: Viele Kunden betreut neben oalab ein Freelancer. Er soll wie ein Sub-Admin seine Kunden zugeordnet bekommen (anlegen kann er keine), wie ein Kunde eigene Dateien bekommen und in seinem Asset Management die Dateien seiner Kunden sehen. oalab gibt ihm so ein Rundum-Sorglos-Paket. Freigabe nach der Planung („Ansonsten hast du es richtig verstanden“) mit allen Empfehlungen, dazu: „diese Rolle gilt wirklich nur für den Hub, der Freelancer soll nichts auf der Serviceseite machen können“.
- Entscheidungen (Empfehlungen der Planung): Je Datei und Kunde „Sichtbar für“ (Kunde und Freelancer, Nur Kunde, Nur Freelancer), Verträge, Angebote und Rechnungen von selbst „Nur Kunde“. Freelancer nur lesend (Hochladen durch Freelancer später als eigener Schritt). Der Kunde sieht nicht, wer ihn betreut. Chat mit oalab und Termine bekommt der Freelancer wie ein Kunde, Projekte und Serviceplattform nicht. Zwei-Faktor-Schutz ist für Freelancer Pflicht. Mehrere Freelancer je Kunde möglich; Nummern „FL-“ plus Zufallszahl.
- Datenbank: Migration `202611040002_hub_freelancers.sql` in `service-oalab` (PR #13).
  - `hub_customers.kind` (customer/freelancer, nach dem Anlegen fest; Freelancer nie mit Service-Organisation).
  - `hub_freelancer_customers` (Fremdschlüssel auf `(id, kind)`, schreiben nur Admins).
  - `hub_file_assignments.audience` mit Vorbelegung nach Kategorie per Trigger; die Kundenregeln blenden „Nur Freelancer“ aus.
  - `hub_freelancer_sees()` verlangt aktives Profil und `aal2`: Ohne bestätigten Code sieht ein Freelancer nur sich selbst.
  - Leserechte für Kunden, Zuordnungen, Dateien, Ordner, Dateiobjekte und Logos seiner Kunden; private Chats, Termine und Logins der Kunden bleiben zu.
  - Schutz: Freelancer-Logins nur an Freelancern, andere Logins nur an Kunden; nie eine aktive Mitgliedschaft auf der Serviceplattform (auch nicht über eine Einladung dort); `hub_handle_new_user` kennt `oalab_freelancer`.
  - In PGlite mit den echten Hub-Migrationen geprüft.
- Hub:
  - Rolle `oalab_freelancer` (`lib/hub-users/rules.ts`), Zwei-Faktor fest auf Code (`secondFactorMethod`, Profil und User Management bieten kein „Aus“).
  - User Management mit Reiter „Freelancer“, „Freelancer anlegen“, drei Rollen bei „Konto anlegen“ und „Prüfen“, „Betreut von“ im Kundendialog.
  - Asset Management: bei Admins die Freelancer als eigene Gruppe, im Kopf des Kunden der Knopf „Betreut von“, in den Details „Sichtbar für“ (Server-Aktion mit Service-Rolle). Für Freelancer dieselbe Ansicht nur lesend, mit „Meine Dateien“, „Alle Dateien“ und „Meine Kunden“; Ordner nur in den eigenen Dateien.
  - Meldungen über neue Dateien gehen nach „Sichtbar für“ auch an die Freelancer (`notifyFileShared`).
  - Für Freelancer: kein Bereich Projekte, kein Knopf zur Serviceplattform, in der Übersicht „Deine Kunden“ und „Neue Dateien“.
  - Alles liest die neuen Spalten fehlertolerant: Ohne Migration bleibt der Hub wie vorher.
- Grenzen: Freelancer sehen auch die Kontaktdaten ihrer Kunden (Rechte gelten pro Zeile). Rechtlich braucht es mit jedem Freelancer eine Vereinbarung zu Vertraulichkeit und Auftragsverarbeitung, und die Datenschutzerklärung muss Freelancer als Empfänger nennen (vor echten Kundendaten).

### Vorgabe vom 4. November 2026: Impressum und Datenschutz im Hub

- Befund: Live zeigte der Hub keine Rechtslinks, weil `NEXT_PUBLIC_IMPRINT_URL` und `NEXT_PUBLIC_PRIVACY_URL` in Vercel fehlten. Auf oalab.de öffnen „Impressum“ und „Datenschutzerklärung“ nur ein Fenster ohne eigene Adresse; der Text dort ist veraltet (§ 5 TMG, § 55 RStV, Link zur abgeschalteten OS-Plattform) und beschreibt nur die Website.
- Freigabe des Nutzers nach einer Vorschau aus dem echten Hub-Code („Ja, so umsetzen“): eigene, öffentliche Seiten im Hub, `/impressum` und `/datenschutz` (`lib/legal-links.ts`, `lib/legal-details.ts`, `components/legal/`). Im Proxy öffentlich, auch für Logins, die ihren Code noch eingeben müssen.
- Erreichbar in höchstens zwei Klicks: Fußzeilen von Login, Registrierung, 404 und den Rechtsseiten, das Menü am Zahnrad (ganz unten), „Mehr“ → „Rechtliches“ am Handy und Tablet, unten im Profil, jede Hub-Mail (absolute Links über `NEXT_PUBLIC_SITE_URL`, sonst hub.oalab.de) und die Supabase-Vorlagen für Bestätigung und Passwort (`{{ .SiteURL }}/impressum`). Der Hinweis an der Registrierung öffnet die Datenschutzerklärung in einem neuen Tab, damit die Eingaben bleiben.
- Inhalt, abgeglichen mit dem Code: Vercel (fra1), Supabase (eu-central-1), netcup (Mail, AV-Vertrag liegt vor), Anthropic (KI-Assistent, Anthropic Ireland laut Commercial Terms, Standardvertragsklauseln, Löschung nach 30 Tagen), Telegram, nur nötige Cookies (`sb-oalab-auth-token`, `__Host-oalab-demo`) und Browser-Speicher, keine Tracker, Schrift vom Hub selbst. Anrede „du“ wie im Hub. WhatsApp steht nicht drin, solange es nicht eingerichtet ist (keine Variablen in Vercel); wird es live, braucht die Erklärung einen Abschnitt zu Meta.
- Entscheidungen des Nutzers: Die Datenschutzerklärung und der Hinweis oben im Chat („Mehr dazu“) beschreiben Telegram bewusst schon für den Betrieb mit echten Kunden: nur Firmenname und Knopf, einmal pro Chat bis zum Lesen. Die Funktion macht das seit dem 8. November 2026 auch so; in der internen Testphase davor gingen Firma, Name und Text an die Gruppe (hub#51, Commit f2ec6a9 zurückgenommen). Vercel bleibt vorerst im Hobby-Tarif: Der Auftragsverarbeitungsvertrag gilt dort nicht (nur Pro und Enterprise), die Erklärung nennt deshalb keinen; die Übermittlung in die USA deckt die DPF-Zertifizierung von Vercel. Keine eGbR, kein Datenschutzbeauftragter nötig.
- Offen: anwaltliche Prüfung vor dem Livegang; Vercel Pro für den AV-Vertrag; Löschfristen für abgelehnte Registrierungen, das KI-Protokoll und den Chat (die Erklärung nennt bis dahin Kriterien); das Impressum auf oalab.de aktualisieren (liegt nicht in diesem Repo).

### Vorgabe vom 4. November 2026: Privater Chat statt Service-Gespräche
- Wunsch des Nutzers: Schreibt ein Kunde im Hub unter „Nachrichten“, landete das bisher im Service-Chat seiner Anfrage. Das verwirrte. Jetzt schreibt ein Kunde dort privat mit oalab; Admins antworten direkt im Hub. Service-Anfragen stellen Kunden nur noch auf der Serviceplattform. Freigabe nach einer Vorschau aus dem echten Hub-CSS („Ok setz das so um“), mit allen Empfehlungen:
  - Der bisherige Verlauf bleibt in Service; der private Chat beginnt leer.
  - Ein privater Chat pro Firma (Hub-Kunde): alle Logins der Firma sehen ihn, jede Nachricht steht mit Namen.
  - Admins: Glocke sofort, dazu eine Mail einige Minuten nach der ersten Nachricht, nur solange niemand aus dem Team den Chat gelesen hat.
  - Signal wird nicht angebunden: kostenlos wäre es nur mit einem vorhandenen Dauer-Server und einer freien Nummer, Signals Nutzungsbedingungen verbieten automatische Nachrichten, und das Werkzeug (signal-cli) ist inoffiziell.
  - Stattdessen Telegram (Entscheidung des Nutzers nach dem Vergleich mit Teams, „lass uns erstmal Telegram verwenden“): Bei einer Kundennachricht bekommt die Telegram-Gruppe der Admins eine Meldung mit Firmenname und „Im Hub öffnen“, nie mit dem Text, einmal pro Chat bis zum Lesen im Hub. Offizielle Bot API, kostenlos, ohne Server und Webhook (`lib/hub-telegram/`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`); im Profil „Testmeldung senden“. Teams (Business vorhanden) wäre die Alternative mit Daten im eigenen Microsoft 365.
  - Zusatzwunsch: Kunden erscheinen in den Chats der Admins mit dem im Asset Management hinterlegten Logo (sonst die Anfangsbuchstaben), in beiden Reitern.
- Kunden: links der Chat „oalab-Team“ mit „Privat“, darunter „Service-Anfragen“ mit „Anfrage stellen“ und „Meine Anfragen“ (Serviceplattform, neuer Tab), unten Ali („Hmm … was liegt dir auf dem Herzen?“). Rechts der Verlauf; oalab schreibt als „Vorname von oalab“, Kollegen mit Namen, zwei Häkchen heißen gelesen. Auf breiten Flächen ist der Chat gleich offen, am Handy öffnet ihn ein Tipp.
- Admins: Reiter „Privat“ (Zahl ungelesener Chats, Suche, Alle/Ungelesen, Stift „Kunden anschreiben“ mit allen Kunden) und „Service“ (Gespräche der Serviceplattform nur zum Mitlesen, `?tab=service`). Ungelesen heißt: Die andere Seite schrieb nach dem eigenen Lesen und nach der letzten Nachricht der eigenen Seite; eine Antwort von Kollegen erledigt den Chat für alle.
- Benachrichtigungen (`lib/hub-notify`): `chat.message` an alle aktiven Admins (ohne Demo-Logins), `chat.reply` an die aktiven Logins der Firma, nie an den Schreiber. Eine ungelesene Meldung desselben Chats wird aktualisiert („Neue Nachrichten von …“) statt eine zweite anzulegen. Admin-Mails warten 5 Minuten (sonst 15); gelesene Chat-Meldungen fallen aus der Mail. Öffnet ein Admin den Chat, gelten die Meldungen aller Admins als gelesen. Admins schalten die Mail im Profil ab („Benachrichtigungen“).
- Technik: Migration `202611040001_hub_private_chat.sql` in `service-oalab` mit `hub_private_messages` (Seite, Text bis 5000 Zeichen, `client_id` gegen doppeltes Senden, Schreiber und Zeit setzt die Datenbank; Lesen und Schreiben mit der eigenen Sitzung über RLS) und `hub_private_reads` (Lesestand je Login, schreibt nur der Hub-Server mit der Service-Rolle). `hub_inbox` kennt `chat.message` und `chat.reply`. Hub: `lib/hub-private-chat/` (Regeln, Laden, Aktionen, Beispiele), `components/hub/screens/private-chat.tsx`; `conversations.tsx` hält die Reiter und die Service-Gespräche. Die Antwort-Strecke zur Serviceplattform (`sendConversationMessage`, `POST /api/hub/requests/{OA-n}/messages`) ist entfernt.
- Grenzen: Abfrage alle 15 Sekunden statt Echtzeit; Mails über den 5-Minuten-Zeitplan; keine Anhänge; der Chat bleibt gespeichert, eine Löschfrist steht noch aus (die Datenschutzerklärung beschreibt Chat und Telegram seit dem 4. November 2026).

### Vorgabe vom 3. November 2026: Asset Management, Schritt 4 (Bearbeiten und Löschen)

- Freigabe des Nutzers am 3. November 2026 („Ja, so bauen“) nach der Vorschau „Asset Management V5“, Entscheidung 9, mit den Empfehlungen: endgültig löschen mit deutlicher Rückfrage (kein Papierkorb), keine Meldung an Kunden beim Bearbeiten, „Neue Fassung hochladen“ später als eigener Schritt.
- Keine Datenbankänderung: Die Regeln „Hub admins manage files“ und „Hub admins manage file objects“ erlauben Admins Ändern und Löschen schon. `hub_file_assignments` hängt mit `on delete cascade` an `hub_files`. Ein Kundenlogo ist eine eigene Kopie im Bucket `hub-logos` und bleibt.
- Server Actions in `lib/hub-files/actions.ts` (beide zuerst `adminClient()`):
  - `updateFileDetails` ändert Titel (bis 200 Zeichen), Kategorie und Beschreibung (bis 2000 Zeichen), ohne Meldung.
  - `deleteFiles` löscht erst die Einträge und holt dabei die Speicherpfade, dann die gespeicherten Dateien. Ohne Eintrag erreicht niemand mehr die Datei; scheitert das Entfernen, bleibt nur ungenutzter Speicher.
- Oberfläche:
  - Der Stift im Kopf der Details öffnet `FileEditForm`; Bearbeiten endet beim Wechsel auf eine andere Datei.
  - „…“ neben dem Download (`MoreMenu`) enthält „Datei löschen“; „Löschen“ steht in der Auswahl-Leiste.
  - Beide fragen über `DeleteFilesDialog` (`files-dialogs.tsx`) nach. Der Dialog nennt die Kunden, bei denen die Dateien verschwinden, und verweist bei mehreren Kunden auf „Zuordnung ändern“.
  - Alles nur mit echtem Admin-Login; Demo und Kunden sehen nichts davon.
- Am 3. November 2026 auf „Ja, live testen“ des Nutzers lokal gegen die Live-Datenbank geprüft, mit der „Testdatei Schritt 3“ des Testkunden OA-56215 (ohne Logins):
  - Mit dem Stift Titel „Testdatei Schritt 4“, Kategorie „Dokumentation“ und eine neue Beschreibung gespeichert; Originalname und gespeicherte Datei blieben.
  - Danach über „…“ gelöscht: Eintrag, Zuordnung und gespeicherte Datei sind weg. Danach gab es 6 Dateien, 6 Zuordnungen und 6 Objekte, wie vor Schritt 3.
- Live seit 3. November 2026 (hub #42). Im Live-Check (nur geöffnet und abgebrochen) zeigte sich: Die offene Detail-Leiste lag über dem rechten Teil der Auswahl-Leiste („Verschieben nach …“, „Löschen“, „Auswahl aufheben“), weil `AssetPanel` über `.am-pane` liegt.
- Behoben am selben Tag auf „Ja, beheben“ des Nutzers: Häkchen und Details schließen sich gegenseitig aus.
  - `toggle` und `toggleAll` rufen `closeDetails()`, `open` leert die Auswahl, wie ein Klick auf eine Datei im Dateimanager. Eine Upload-Leiste bleibt offen.
  - `AssetPanel` gibt den Fokus beim Schließen nur zurück, wenn er in der Leiste war oder mit ihr verloren ging. So bleibt er nach einem Häkchen auf der Checkbox.

### Vorgabe vom 2. November 2026: Asset Management, Schritt 3 (Seitenleisten)

- Freigabe des Nutzers am 2. November 2026 („Ja, Schritt 3“) nach der Vorschau „Asset Management V5“, Entscheidungen 6 (Hochladen per Knopf und Ziehen in einer Seitenleiste) und 7 (Details als Seitenleiste rechts). Keine Datenbankänderung: Hochladen, Zuordnen, Verschieben und „Logo aus Datei“ nutzen die vorhandenen Server Actions.
- Rahmen: `AssetPanel` (`components/hub/screens/asset-panel.tsx`) liegt absolut über den Dateien in `.am-pane` (420 px), die Kundenliste bleibt sichtbar; kein Dialog, also bleibt die Liste bedienbar. Escape oder das Kreuz schließt, der Fokus geht beim Öffnen hinein und beim Schließen zurück. Am Handy (unter 768 px) füllt die Leiste den Bildschirm, die Tab-Leiste tritt zur Seite. Ein anderer Kunde schließt die Details; ein Upload behält Dateien und Ziel.
- Hochladen: `useUploadQueue` und `UploadPanel` (`asset-upload.tsx`). Der Zustand lebt im Asset Management, damit hineingezogene Dateien in einen offenen Upload kommen. Kunde und Ordner kommen vom Ort, an dem man startet; unter „Für“ Kunden als Chips mit `CustomerPicker`. Je Datei Titel und Kategorie, vorgeschlagen von `guessFileCategory` (`lib/hub-files/catalog.ts`); „Kategorie für alle“, optionale Beschreibung. Dateien, die `checkUpload` ablehnt, sind rot markiert und werden übersprungen. Gesendet wird mit `sendUpload` aus `files-upload.tsx`, derselben Folge wie bei der alten Upload-Karte. Nach Erfolg schließt die Leiste und oben steht die Meldung.
- Ziehen: nur Dateien vom Computer (`isFileDrag`), nur mit echtem Admin-Login und nicht während eines Uploads. Der Ordner unter der Maus kommt aus `data-drop-folder` (Minimal-Gruppen, `TableGroup dropKey`), er leuchtet auf, und eine Pille unten sagt, wohin die Dateien gehen. Beim Loslassen öffnet sich die Leiste mit diesem Ordner. Auf dem Rest der Fläche bewirkt Loslassen nichts, statt die Datei im Browser zu öffnen.
- Details: `FilePanel` (`asset-details.tsx`). Bilder bis 8 MB zeigen eine Vorschau über einen 60-Sekunden-Link (`createDownloadUrls`); dazu „Herunterladen“ und „Link kopieren“ (`/dashboard/files?file=<id>`). „Als Logo von … verwenden“ erscheint bei Bildern des geöffneten Kunden (`saveCustomerLogo` mit Quelle Datei, der bisherige Hintergrund bleibt). Unter „Freigegeben für“ stehen die Kunden mit einer Ordnerwahl je Kunde (`moveFiles` über `store.move`) und „Zuordnung ändern“ (`setFileAssignments`; neue Kunden bekommen eine Meldung); darunter die Fakten.
- Kunden behalten ihre Dateien-Ansicht mit dem Dialog `FileDetailDialog`; Bearbeiten und Löschen von Dateien kommen mit Schritt 4.
- Am 3. November 2026 auf „Ja, live testen“ des Nutzers lokal gegen die Live-Datenbank geprüft, nach jedem Schritt mit einer Leseabfrage:
  - „Als Logo von Nordlicht Studio verwenden“ aus den Details der „Logo-Datei“: Das Logo steht im Kopf, in der Liste und in der Leiste, als Kopie im Logo-Ordner; danach mit „Buchstaben verwenden“ wieder entfernt.
  - Die „Logo-Datei“ in den Details nach „Verträge“ und zurück nach „Ohne Ordner“ verschoben.
  - Eine Textdatei per Ziehen auf den Testkunden OA-56215 hochgeladen: mit Kategorie, Beschreibung, Prüfsumme, Objekt und Zuordnung. Keine Meldung, weil der Testkunde keine Logins hat.
  - Nordlicht Studio ist danach wie vorher. Die Testdatei „Testdatei Schritt 3“ bleibt beim Testkunden, bis Schritt 4 Löschen bringt oder OA-56215 aufgeräumt wird.

### Vorgabe vom 2. November 2026: Asset Management, Schritt 2 (Kundenlogos)

- Freigabe des Nutzers am 2. November 2026 („Ja, Schritt 2 starten“) nach der Vorschau „Asset Management V5“, Entscheidung 4: Logos liegen privat wie die Dateien, Links werden gesammelt und kurzlebig erzeugt, ein Kunde bekommt nur einen Link für sein eigenes Logo.
- Datenbank: Migration `202611020001_hub_customer_logos.sql` in `service-oalab` (PR #8), am 2. November 2026 auf ausdrückliches „Klick du auf Run“ des Nutzers im SQL-Editor angewendet und in `supabase_migrations.schema_migrations` eingetragen. `hub_customers` hat `logo_path` (Prüfregel: `logos/<Kunden-ID>/<UUID>.svg|png|jpg|webp`), `logo_background` (`light`, `dark`, `brand`) und `logo_color` (`#rrggbb`). Privater Bucket `hub-logos` (2 MB, SVG, PNG, JPG, WebP); Speicherregeln „Hub admins manage logo objects“ und „Members read their customer logo“ (über `hub_customer_members`, also nur mit aktivem Profil). Der Abgleich mit Service reagiert nicht auf die neuen Felder.
- Hub: `lib/hub-logos/` (Regeln, Laden mit gesammelt signierten Links für eine Stunde, Server Actions mit `verifyHubAdmin`). Die Felder werden getrennt und fehlertolerant gelesen, nie in `CUSTOMER_COLUMNS`: Ohne Migration oder bei einem Fehler bleiben die Buchstaben. Admins bekommen die Logos aller Kunden in `loadHubFiles`, ein Kunden-Login nur das eigene (`loadAccountLogo` im Dashboard-Layout, mit seiner eigenen Sitzung); Admins und Demo-Logins behalten ihre Initialen.
- Anzeige: `LogoMark` (`components/hub/logo-mark.tsx`) zeigt das Bild auf einer Kachel (`--logo-bg`: Weiß, Fast-Schwarz oder Markenfarbe) und fällt bei einem Ladefehler auf die Buchstaben zurück. Beim Kunden unten links, in der Begrüßungskarte vor dem Unternehmen und am Handy oben rechts; im Asset Management in der Kundenliste, im Kopf des Kunden und bei „Alle Dateien“.
- Pflege: Klick auf das Zeichen im Kopf des Kunden öffnet „Logo von …“ (`asset-logo.tsx`): Vorschau groß, in einer hellen und einer dunklen Listenzeile und klein; Bild aus den Dateien des Kunden (Kopie in den Logo-Ordner, Typ aus der Datei) oder neu hochladen (signierte Upload-URL); Hintergrund Hell, Dunkel oder Markenfarbe; „Buchstaben verwenden“ entfernt Logo und Bild. Das vorige Bild wird beim Ersetzen gelöscht.
- Behoben: Die Zahl neben „Asset Management“ bzw. „Dateien“ in der Seitenleiste kam für echte Logins aus den Beispieldaten (immer 0); jetzt zählt `countFilesForIdentity` die sichtbaren Dateien.
- Am 2. November 2026 auf „Ja, live testen“ des Nutzers lokal gegen die Live-Datenbank geprüft, beim Demo-Kunden Nordlicht Studio: „Logo-Datei“ als Logo (Hell), dann Dunkel, dann ein hochgeladenes SVG mit Markenfarbe, zuletzt „Buchstaben verwenden“. Nach jedem Schritt lag genau ein Bild im Bucket, beim Ersetzen verschwand das alte, am Ende war alles wie vorher (kein Logo, Bucket leer). Ein Link auf ein gelöschtes Bild liefert „Object not found“; nur ein Browser, der das Bild schon geladen hat, zeigt es noch aus seinem eigenen Zwischenspeicher.
- Später: Logos auch in User Management, Projekten, Gesprächen und Kalender; „Als Logo verwenden“ in den Details einer Bilddatei kommt mit Schritt 3.

### Vorgabe vom 2. November 2026: Asset Management, Schritt 1

- Freigabe des Nutzers am 2. November 2026 („Ja, so umsetzen“) nach den Vorschauen „Asset Management V1–V5“, mit allen Empfehlungen: Kundenliste links und Kunde rechts, Hochladen per Knopf und Ziehen mit Seitenleiste, Details als Seitenleiste, keine Kennzahl-Karten für Admins, Bearbeiten und Löschen als eigener Schritt, Standardansicht Minimal, die Wahl im Browser gespeichert, Logos privat wie die Dateien, „Abmelden“ ins Menü am Zahnrad.
- Reihenfolge: zuerst die Ecke unten links; Schritt 1 Aufbau mit Minimal und Detail und der Karte „Listen“ (ohne Datenbank-Änderung); Schritt 2 Kundenlogos (neues Feld am Kunden und Speicherordner, auch im Login des Kunden: unten links, in der Begrüßung, am Handy oben rechts); Schritt 3 Hochladen in einer Seitenleiste mit Ziehen und Kategorie je Datei, Details als Seitenleiste; Schritt 4 Bearbeiten und Löschen. Später übernehmen die Dateien der Kunden, die Projekte und die Freelancer-Ansichten die Listeneinstellung.
- Umsetzung Schritt 1: `components/hub/screens/asset-management.tsx` für Admins, `FilesScreen` in `files.tsx` verzweigt (Kunden behalten ihre Tabelle). Gemeinsame Dialoge in `files-dialogs.tsx`. Die Kundenliste nutzt die Bausteine der Gespräche (`.chat-list`, `.chat-conv`), Kunden haben ein Zeichen aus den Initialen der Firma in einer von acht Farben. Ansichten: Kunde mit Ordnern, „Alle Dateien“ (Minimal nach Heute, Gestern, Diese Woche, Früher; Detail mit Spalte Kunde) und „Ablage“ mit „Zuordnen“. Minimal: Symbol in der Farbe der Kategorie (`.am-cat-*`), Titel und Tag (`formatFileDay`, `fileDayGroup` in `lib/hub-files/catalog.ts`); Häkchen und Download beim Darüberfahren, Ordner-Aktionen auf Touch-Geräten immer sichtbar. Die Wahl `listView` steht in `lib/appearance.ts` (Standard „minimal“); die Karte „Listen“ unter Darstellung sehen vorerst nur Admins. Hochladen öffnet bis Schritt 3 das bisherige Formular in einem Dialog, mit Kunde und Ordner vorbelegt.

### Vorgabe vom 2. November 2026: Ecke unten links

- Wunsch des Nutzers nach der Vorschau „Asset Management V5“ (Freigabe „Ja, so umsetzen“): Zahnrad und Abmelden schwebten als zwei runde Knöpfe über der Namenszeile und wirkten unruhig.
- Jetzt: Zeichen (Initialen, später das Kundenlogo), Name und darunter nach einem kleinen Punkt das aktive Servicepaket, bei Admins „oalab-Team“. Rechts, durch eine feine Linie abgetrennt, nur ein Zahnrad. Es öffnet ein Menü mit der E-Mail-Adresse des Logins (bei Demo und Vorschau deren Art), „Profil“, „Darstellung“ und rot „Abmelden“ (in der Vorschau „Vorschau verlassen“).
- Name, Punkt und Paket in einer Zeile passen in die 272 px breite Seitenleiste nicht, deshalb zwei Zeilen. „Abmelden“ oben neben Glocke und Hilfe war die Alternative, gewählt wurde das Menü.
- Wunsch des Nutzers am 5. November 2026: Auf dem Tablet (768–1023 px) fehlen Seitenleiste und Zahnrad, Abmelden ging dort nur über Profil. Seitdem sitzt rechts oben neben dem Profil ein runder Knopf zum Abmelden (`.topbar-signout`, in der Vorschau „Vorschau verlassen“). Handy und Computer bleiben wie gehabt.
- Code: `components/hub/glass-sidebar.tsx` (`.sidebar-account*` in `app/glass.css`); Escape und Klick daneben schließen das Menü, Pfeiltasten wandern durch die Einträge.

### Vorgabe vom 2. November 2026: Logo mittig in der Tablet-Ansicht

- Wunsch des Nutzers: In der Tablet-Ansicht (768 bis 1023 px, mit Tab-Leiste) steht das oalab-Logo allein mittig oben. Der Schriftzug „oalab Client Hub“ bleibt links, Glocke, Assistent und Initialen bleiben rechts.
- Am Handy (unter 768 px) bleibt die obere Zeile wie vorher: Logo und Schriftzug zusammen links. Eine erste Fassung mit dem Logo auch am Handy in der Mitte hat der Nutzer verworfen.
- Umsetzung: Die Logo-Kachel bleibt Teil des Links zur Übersicht. Am Tablet setzt `app/glass.css` sie absolut in die Mitte der 44 px hohen oberen Zeile (`.topbar-brand .brand-tile`), egal wie breit Schriftzug und Knöpfe sind. Der Vorschau-Hinweis steht dort in einer eigenen Zeile.
- Am Rechner (ab 1024 px, mit Seitenleiste) bleiben Logo und Schriftzug oben in der Seitenleiste.

### Vorgabe vom 2. November 2026: Nachrichten als Chat „Gespräche“

- Wunsch des Nutzers: „Nachrichten“ wird ein sauberer Chat unter der Überschrift „Gespräche“, wie man ihn von WhatsApp kennt. Vorschau „Gespräche V1“ (Liste links, offenes Gespräch rechts; am Handy Liste, dann Gespräch bildschirmfüllend; hell und dunkel; Admin-Sicht mit internen Notizen).
- Entscheidungen des Nutzers: echte Gespräche statt Beispieldaten, nämlich die Anfragen der Serviceplattform mit ihren Nachrichten (dieselben Unterhaltungen an beiden Orten); ein neues Gespräch lässt sich im zweiten Schritt direkt im Hub starten; „Chat“ in der Seitenleiste entfällt, sobald die Gespräche im Hub echt sind; eigene Nachrichten in Bordeaux (dunkel in Rosé), wie im Assistenten.
- Tab-Leiste am Handy: Übersicht, Dateien (bei Admins „Assets“), Nachrichten mit der Zahl ungelesener Gespräche, Kalender und Mehr. „Projekte“ steht dafür überall unter „Mehr“ (Wunsch des Nutzers; ersetzt die Tab-Leiste vom 1. November mit Projekte statt Nachrichten).
- Weitere Entscheidungen des Nutzers nach der Prüfung der Serviceplattform: Kunden antworten über eine kleine interne Strecke der Serviceplattform (keine Datenbank-Änderung); Admins lesen im Hub nur mit, Antworten und interne Notizen bleiben in NoteTree Business.
- Umsetzung: `lib/hub-conversations/` (Regeln, Server, Aktionen, Beispiele) und `components/hub/screens/conversations.tsx`.
  - Lesen: Der Hub liest `service_requests` (ohne Papierkorb), die für Kunden sichtbaren `request_messages` und `request_seen` mit dem Server-Schlüssel, nachdem `conversationViewer()` geprüft hat, wer liest. Kunden sehen die Organisationen ihrer Firma (`hub_customer_members` → `hub_customers.organization_id`, mit eigener Sitzung), Admins alles nach `verifyHubAdmin()`.
  - Ungelesen: Die neueste Antwort von oalab oder dem Assistenten ist jünger als `request_seen`. Öffnen schreibt `request_seen`; dann entfällt die Antwort-Mail der Serviceplattform.
  - Antworten: `sendConversationMessage` schickt das Zugangstoken der Person an `POST service.oalab.de/api/hub/requests/{OA-n}/messages` (service-oalab, `addClientFollowUp` wie im Service-Chat). Bei `STALE_VERSION` ohne neue sichtbare Nachricht geht die Antwort einmal mit der aktuellen Version neu.
  - Der Bildschirm schaut alle 15 Sekunden nach Neuem, solange die Seite sichtbar ist. Zähler für Seitenleiste und Tab-Leiste kommen aus dem Layout (`countUnreadConversations`).
  - Die Beschriftungen der Stände übernimmt der Hub von der Serviceplattform („Du bist dran“, „In Bearbeitung“, „Gelöst“ …). Abgeschlossene Anfragen (Live, Abgeschlossen) nehmen keine Nachricht mehr an.
  - Der Eintrag „Chat“ (Link zur Serviceplattform) entfällt in Seitenleiste und „Mehr“. „Neues Gespräch“ öffnet bis zu einem späteren Schritt die neue Anfrage auf der Serviceplattform.
  - Noch nicht im Hub: Anhänge, „Gefällt mir“-Freigaben und Testseiten (dafür der Pfeil zum Gespräch auf der Serviceplattform), ein neues Gespräch direkt im Hub, ein Lesestand für Nachrichten an oalab (es gibt nur „gesendet“).
- Seit 4. November 2026 abgelöst: Kunden schreiben im privaten Chat mit oalab; die Service-Gespräche lesen nur noch Admins im Reiter „Service“ (siehe „Privater Chat statt Service-Gespräche“ oben).

### Vorgabe vom 1. November 2026: Redesign „Ein Hub, eine Sprache“

- Freigabe des Nutzers am 1. November 2026 („Ja, so umsetzen“) nach drei Vorschau-Runden: V1 Bestandsaufnahme und Konzept, V2 „Glas außen, Tabellen innen“, V3 Tabellen wie in OALab Studio („Tabellen passen“). Vorbild für die Tabellen ist der tabellarische, Notion-artige Aufbau von OALab Studio auf der Serviceplattform.
- Entscheidungen des Nutzers (jeweils die Empfehlung): Farben und Töne wie in den Hub-Mails (Zu tun, Zur Info, Erledigt, Aus, Problem) und der Button-Verlauf der Mails; Schalter, Häkchen und „Heute“ in Bordeaux statt Apple-Grün und -Rot; ein Name „Profil“ für `/dashboard/settings` (auch im Fußtext der Mails); „Bereiche“ statt „Kategorien“; „Zieltermin“ im Kalender, die Tabellenspalte bleibt „Nächster Termin“; „Konto anlegen“; „oalab“ immer klein; ein Seitenkopf mit Symbol auf jeder Seite.
- Tabellen: Studio-Aufbau auf einer deckenden Fläche, das Glas bleibt außen (Hintergrund, Seitenleiste, Karten der Übersicht). Werkzeugleiste mit Suche, Filter, Sortierung und Gruppe statt des Panels „Erweiterte Suche“, Ordner als Gruppen statt Chips, Meilenstein und Datei in der Tabelle nur mit Titel (Beschreibung und Dateiname im Dialog). Diese drei Punkte ersetzen Vorgaben vom 22. Oktober 2026.
- Tabellen im Code (PR 2): Bausteine in `components/hub/sheet.tsx` (Werkzeugleiste, Menüs, Gruppen, Statussymbole, Fußzeile). Projekte sind nach Status gruppiert, Spalten: Kunde (nur Admins), Projekt mit Statussymbol, Bereich, Meilenstein, Status, Start, Nächster Termin, Fortschritt. Dateien sind nach Ordner gruppiert (auch leere, dazu „Ohne Ordner“), Umbenennen und Löschen stehen in der Gruppenzeile, „Neuer Ordner“ als letzte Zeile. Das User Management ist eine Tabelle mit Umschalter Konten/Kunden; offene Registrierungen sind die erste Gruppe „Wartet auf Freigabe“ mit „Prüfen“ in der Zeile (die Kartenliste entfällt), eine unbestätigte E-Mail-Adresse trägt „unbestätigt“. Ist die Tabellenfläche schmaler als 1040 px, entfällt „Start“ und die Dateibeschreibung wird kürzer, unter 900 px auch die Beschreibung und der Hinweis „in N Tagen“; so passen Projekte und Dateien ab 1280 px Fensterbreite ohne seitliches Scrollen. Unter 900 px Fläche entfällt bei Projekten außerdem „Status“ (Symbol und Gruppen zeigen ihn), unter 760 px auch „Bereich“ (beides in den Projektdetails); so passen sie auch am Tablet hochkant und in Fenstern ab 1024 px mit Seitenleiste. Die Konten im User Management brauchen mit offenen Registrierungen („Seit …“, „Prüfen“) am meisten Platz: Unter 1200 px Fläche entfällt ihre Kunden-Nr., unter 1040 px auch „Letzter Login“ (beides steht im Dialog des Kontos), E-Mail-Adressen werden früher gekürzt; so passen auch sie ab 1280 px. `.sheet-scroll` ist positioniert, damit für Screenreader versteckte Beschriftungen (`position: absolute`) mit einer breiten Tabelle scrollen, statt die ganze Seite zu verbreitern. Am Handy wird jede Zeile zur Karte.
- Dunkelmodus mit Automatisch, Hell und Dunkel (Standard Automatisch). Umsetzung (PR 3): Wahl unter Profil › Darstellung › Erscheinungsbild, gespeichert wie die übrige Darstellung im Browser (`lib/appearance.ts`, `colorScheme`); das Skript vor dem ersten Zeichnen setzt `data-theme` und `color-scheme` auf `<html>`, Automatisch folgt `prefers-color-scheme` auch im laufenden Betrieb. Farben als Tokens in `app/glass.css` (heller Block zuerst, `:root[data-theme="dark"]` tauscht nur Werte), Werte aus der Vorschau V3 und dem Dunkelmodus der Mails. Der Hintergrund wird dunkler gezeigt (62 %, bei hellen eigenen Farben weniger, `--bg-shade`), damit heller Text auf dunklem Glas bei 70 % Deckkraft 4,5:1 hält; `tests/appearance.test.mjs` prüft das für alle Hintergründe, dazu Töne, Tabellenflächen und Text auf Akzentflächen in beiden Modi.
- Am Handy eine Tab-Leiste mit fünf Einträgen, der letzte ist „Mehr“; das ersetzt die Entscheidungen vom 25. Oktober (Chat an dritter Stelle der Tab-Leiste) und 27. Oktober 2026 (sieben Einträge). Umsetzung (PR 4): Übersicht, Projekte, Dateien (bei Admins „Assets“), Kalender und Mehr (`tabNavigation` in `components/hub/navigation.ts`), 11 px Schrift, ohne die runde Such-Taste. „Mehr“ ist die frühere Seite „Entdecken“ (Route `discover`) mit Suche, Insights, Chat, Bereichen, Neuigkeiten bzw. Verwaltung und Konto; der Tab bleibt markiert, solange eine Seite daraus offen ist. Unter 1024 px stehen Glocke, Assistent und Initialen in der oberen Zeile neben dem Logo (am Tablet steht das Logo seit dem 2. November allein in der Mitte; der Vorschau-Hinweis steht in einer eigenen Zeile), damit Seitentitel die volle Breite haben.
- Umsetzung in vier gestapelten PRs: Fundament (Töne, Bausteine, Begriffe, Fehler), Tabellen, Dunkelmodus, Navigation am Handy. Keine Datenbank-Änderungen.

### Designentscheidung vom 19. Oktober 2026: Client Hub im Liquid-Glass-Stil

- Das Frontend des Hubs folgt der Struktur von Apple Health (Übersicht mit Insights, Favoriten, Highlights und Listen; Detailseiten mit Zeitraum-Umschalter T/W/M/6M/J; farbcodierte Kategorien) in der Designsprache Liquid Glass. Übernommen wird nur die Designsprache, keine Apple-Markenelemente.
- Unter allen Inhalten liegt ein kräftiger, wählbarer Hintergrund. Karten, Listen, Sidebar, Tab-Bar und Buttons sind mattes Glas (Standard 80 % Deckkraft, 24 px Unschärfe).
- **Inter bleibt** die Schrift. Große Kennzahlen nutzen `ui-rounded` (SF Pro Rounded auf Apple-Geräten, sonst Inter).
- **Standard-Hintergrund ist das Preset „oalab“** (Bordeaux, Rot und Orange, für weiße Schrift abgedunkelt). Ozean, Aubergine, Smaragd, Glut, Graphit und eine eigene Farbe sind wählbar. Links, aktive Navigation und Fokus bleiben Bordeaux.
- Kategorien: Projekte (Orange), Dateien (Indigo), Nachrichten (Blau), seit 22. Oktober 2026 Kalender (Rot). Rechnungen, Analytics und Hosting entfallen, bis es diese Module gibt.
- Die Beispieldaten (Vorschau und vier Demo-Identitäten) enthalten einen ausdrücklich fiktiven, datierten Verlauf: Projektstart, Zieltermine, Meilensteine, Dateidaten. Referenztag ist der 15. Oktober 2026 (`DEMO_AS_OF`). Echte Konten sehen weiterhin leere Zustände.
- Die Insights sind regelbasiert aus den vorhandenen Daten erzeugt und können später durch eine KI-Zusammenfassung ersetzt werden.
- Darstellung (Preset, eigene Farbe, Deckkraft 70–95 %, Unschärfe 8–40 px, „Transparenz reduzieren“, seit 22. Oktober 2026 „Bewegung reduzieren“) und Favoriten werden im Browser gespeichert, Favoriten pro Nutzer. Für Nutzereinstellungen gibt es noch keinen Speicher im Backend. Ein Inline-Script setzt die Darstellung vor dem ersten Paint.
- Die Übersicht begrüßt mit Namen und zeigt Unternehmen und Kundennummer (Admins: Organisation und Zahl der betreuten Kunden). Kundennummern existieren bisher nur als fiktive Demo-Werte (`KD-24017`, `KD-24023`, `KD-24031`); echte Konten zeigen „Noch nicht zugeordnet“.
- Rechts neben der Begrüßung stehen die aktiven Pakete und der Button „Ab zur Serviceplattform“ (https://service.oalab.de, neuer Tab). Pakete gibt es in zwei Gruppen, je Kunde höchstens eins pro Gruppe: Domain (OALAB Domain oder OALAB Domain & Mail) und Service (OALAB Service Lite oder OALAB Service Max), zentral in `lib/service-packages.ts`, gespeichert in `hub_customer_packages` (Migration 202611050001 in service-oalab). Die Demo-Zuordnungen sind fiktiv.
- „Vertrag & Domain“ (`/dashboard/contracts`, unter dem Asset Management): Admins pflegen dort im „Contract & Domain Management“ je Kunde die Pakete mit „seit“ und „gekündigt zum“ und einen Verlauf (`hub_customer_timeline`: Zeitpunkte wie gestellte oder bezahlte Rechnungen, mit Betrag, Datei, interner Notiz und Freigabe für den Kunden; Paketwechsel trägt die Datenbank selbst ein). Kunden sehen ihre Pakete, ihre Verträge und Rechnungen und die freigegebenen Zeitpunkte, nie die Notiz. Freelancer haben keinen Zugang. Im User Management stehen die Pakete nur noch zum Ansehen. Domains, Mail und verschlüsselte Zugänge kamen als Etappe 2 dazu (siehe „Vertrag & Domain, Etappe 2“ oben); seit Etappe 3 bestimmt das Servicepaket, wie viele neue Anfragen ein Kunde im Monat auf der Serviceplattform stellen darf, sobald die Sperre eingeschaltet ist (siehe „Vertrag & Domain, Etappe 3“ oben).
- Seit 25. Oktober 2026 steht in der Navigation (Sidebar nach Insights, Tab-Leiste an dritter Stelle) der Eintrag „Chat“. Er öffnet Service OALab (`SERVICE_PLATFORM_URL`, https://service.oalab.de) in einem neuen Tab; Service ist die reine Chat-App, der Hub bleibt das Dashboard. Sidebar-Eintrag mit Pfeil nach außen, Screenreader hören „öffnet in neuem Tab“. Bis zum gemeinsamen Login meldet man sich dort noch getrennt an. Mit sieben Tabs werden die Tab-Beschriftungen unter 400 px etwas enger gesetzt, damit alle lesbar bleiben.
- Login, Registrierung, Passwortseiten, Auth-Fehler und 404 stehen ebenfalls im Glas-Stil auf dem wählbaren Hintergrund; das Formular liegt auf einer Glaskarte. Das Original-Logo erscheint nur transparent als Wasserzeichen links (auf dem Smartphone klein oben rechts), nie umgefärbt.
- Auf der Login-Seite stehen die Demo-Konten in einem Dropdown „Testkonto wählen“; ein Klick auf ein Konto meldet direkt an. Die Links „Ein erster Einblick“ und „Dashboard-Vorschau entdecken“ entfallen, weil die Demo-Konten den Einblick bereits bieten. `/preview` bleibt per direkter Adresse erreichbar.
- Das Dashboard der Demo-Konten (Kunden und Admin) zeigt keinen Demo-Banner mehr. Rolle und Art der Demo stehen im Tooltip des Abmelde-Buttons, das Profil nennt die öffentliche Demo weiterhin ausdrücklich. Nur `/preview` behält den Hinweis „Designvorschau“.
- Kontrast: Alle Texte auf Glas erreichen mindestens 4,5:1 bei 70 % Deckkraft über jedem Hintergrund, auch über Schwarz. Dafür sind die Kategorie-Textfarben gegenüber der Vorlage abgedunkelt. `tests/appearance.test.mjs` prüft das.

### Markenentscheidung vom 15. Oktober 2026

- Plattformname: **oalab**, Produktbezeichnung: **oalab Client Hub**.
- Hauptlogo und Iconvariante sind als gelieferte Originaldateien eingebunden.
- Der Bordeaux-Rot-Orange-Verlauf des Icons bildet die gemeinsame Corporate-Farbwelt. Inter ist die einheitliche Schrift aller Oberflächen.
- Verbindliche Anwendungsregeln und Farbwerte stehen in [CI_GUIDELINES.md](./CI_GUIDELINES.md); zentrale CSS-Tokens in `app/brand.css`.

### Plan vom 26./27. Oktober 2026: KI-Aktionen im Hub-Assistenten (Gesamtplan und Entscheidungen)

- **Ziel des Nutzers:** keine neue Plattform, sondern wenige feste Arbeitsabläufe direkt im bestehenden Chat „Assistent & Hilfe“ auf den Daten der Plattform, statt Inhalte nach claude.ai zu kopieren: Kunden anlegen, Aufgaben aus Meetingtranskripten, Projektdaten ändern, Stand abfragen.
- **Rahmen:** kein MCP-Server, keine CLI-Schnittstelle, keine anderen Modelle, kein Agenten-Framework, kein zweiter Chat. Nur Claude API mit Tool Use im bestehenden Chat.
- **Freigaberegel:** Umsetzung jeweils erst nach ausdrücklicher Freigabe des Nutzers („UMSETZUNG FREIGEGEBEN“ oder gleichwertig). Schritt 1 und 2 sind am 27. Oktober 2026 freigegeben und gebaut; ab Schritt 3 neue Freigabe abwarten.
- **Entscheidungen des Nutzers:**
  - Projekte und Aufgaben kommen aus den vorhandenen Studio-Tabellen der gemeinsamen Datenbank (Studio wird produktiv genutzt). Keine eigenen Hub-Tabellen dafür.
  - Neue Kunden entstehen als Service-Organisation (`organizations`; der vorhandene Trigger legt den Hub-Kunden an).
  - Die Struktur bestehender Tabellen wird nicht verändert. Erlaubt ist genau eine neue Tabelle für Vorschläge und KI-Protokoll.
  - Standardwerte: Fortschritt = Anteil erledigter Aufgaben; „Dein Feedback“ = offene, freigegebene Aufgabe mit Label „Kunde“; Kundenaufgaben per Label „Kunde“; neue Aufgaben zunächst intern; KI-Aktionen nur für Admins mit bestätigtem zweiten Faktor; Aufwand `medium` nur für Aktionen, sonst `low`.
  - Auftragsverarbeitungsvertrag (DPA) mit Anthropic klärt der Nutzer noch; davon hängt Schritt 4 ab.
- **Grundsatz:** Claude liest selbst, schreibt aber nie selbst. Lese-Werkzeuge laufen automatisch; Schreib-Werkzeuge erzeugen nur einen Vorschlag, gespeichert wird erst nach Klick und genau der gespeicherte Vorschlag. Erfolg oder Fehler zeigt die Oberfläche aus dem Serverergebnis, nicht aus Claudes Text.
- **Schritte:**
  1. Hub zeigt echte Studio-Projekte und -Aufgaben (erledigt, PR #16).
  2. Assistent liest Kunden, Projekte, Aufgaben mit vier Werkzeugen (erledigt, PR #17).
  3. Aufgaben anlegen mit Bestätigung: neue Tabelle `hub_assistant_actions` (Akteur, Art, Status vorgeschlagen/läuft/erledigt/fehlgeschlagen/verworfen/abgelaufen, geprüfte Nutzdaten, Ziel, Ergebnis-IDs, Fehlercode, Zeitstempel, Ablauf nach 30 Minuten; keine Chat-Texte oder Transkripte) als Migration in `service-oalab`, Anwendung auf die Live-Datenbank nur mit OK des Nutzers. Werkzeug `propose_tasks`, Vorschaukarte im Chat (abwählen, OALAB/Kunde, intern/sichtbar), Bestätigen per Server Action mit Statuswechsel in einem UPDATE gegen Doppelklick. Aufgaben schreibt der Hub mit der Sitzung des Admins direkt in `studio_tasks` (Studio-RLS und -Trigger prüfen, versionieren und protokollieren), keine neue Datenbankfunktion. Abnahme: vor dem Klick nichts in der Datenbank, Doppelklick legt einmal an, Fehler nie als „gespeichert“.
  4. Meetingtranskripte (erst nach Klärung des DPA): höheres Eingabelimit nur für Admins, Belegzitat pro Aufgabe mit Serverprüfung, Termine und Zuständigkeiten nur mit Beleg, Hinweistext und Datenschutzerklärung anpassen. Abnahme mit 3–5 erfundenen Testtranskripten inklusive Prompt-Injection-Falle.
  5. Projekte und Aufgaben ändern: `propose_project_update`, `propose_task_update` mit erwarteter Version; „wir warten auf Kundenfeedback“ als Kundenaufgabe.
  6. Kunden anlegen: `propose_customer` mit Dublettenprüfung, Service-Organisation per Server-Schlüssel nach Admin-Prüfung, Protokolleintrag in `audit_events` (gebaut am 29. Oktober 2026, siehe unten).
- **Offene Punkte:** (Nummernregel, Tarif und Login beim Kundenanlegen am 29. Oktober 2026 entschieden, siehe Schritt 6.) Optional das Label „Kunde“ fest in die Studio-Auswahlliste (`apps/web/features/workspace/vocabulary.ts` in `service-oalab`; ohne das erscheint es dort, sobald eine Aufgabe es trägt); Tageslimit für KI-Anfragen pro Admin.
- **Stand der PRs (27. Oktober 2026):** gestapelt #15 Patch Notes → #16 Schritt 1 → #17 Schritt 2. Reihenfolge beim Mergen: #15, dann Basis von #16 auf `main`, dann dasselbe bei #17. Mit echten Daten ist noch nichts geprüft; am einfachsten über die Vercel-Vorschau von #17 mit einem Admin-Login.

### Vorgabe vom 30. Oktober 2026: Assistent im Frontend

- Freigabe des Nutzers am 30. Oktober 2026 („So umsetzen“). Entscheidungen: Chatverlauf dauerhaft im Browser (localStorage je Login, bis „Neu starten“ oder Abmelden), eingefügte Transkripte komplett mit; großer Modus als Leiste rechts (Umschalter Fenster/Leiste, ab 1024 px); KI-Protokoll als eigene Admin-Seite unter Verwaltung.
- Folge für den Datenschutz: Der Hinweis im Chat lautet jetzt „Der Hub speichert sie nicht auf seinem Server; der Chatverlauf bleibt in diesem Browser …“. Der geplante Datenschutz-Absatz muss das ebenso sagen.
- Code: `lib/hub-assistant/chat-storage.ts` (eigenständig, getestet: höchstens 50 Nachrichten und 2 Mio. Zeichen, nichts Halbfertiges, Abgleich alter Vorschläge), `proposalStatuses` in `lib/hub-assistant/actions.ts` (Stand eigener Vorschläge), Laden/Speichern/Löschen in `components/hub/app-shell.tsx`, Leiste und einheitlicher Kartenrahmen (`CardFrame`, Status-Chip, Zusammenklappen, „Alle zeigen“ ab sechs Einträgen) in `components/hub/assistant-panel.tsx`. Aus dem Projektdialog bleibt das Projekt als „Bezug“ im Chat; angedockt schließt der Dialog, weil ein Dialog die Leiste blockieren würde.
- KI-Protokoll: Bereich `ai-log` (nur Admins), Regeln in `lib/hub-assistant/log-rules.ts`, Laden in `lib/hub-assistant/log.ts` (Admin-Prüfung, dann Server-Schlüssel, die letzten 500 Vorschläge), Seite `components/hub/screens/assistant-log.tsx`. Keine Datenbankänderung.
- Am 1. November 2026 live im Browser geprüft: Beim Abmelden verschwindet der gespeicherte Chatverlauf; ein offener Vorschlag zeigt nach 30 Minuten und Neuladen „Abgelaufen“, eingeklappt und ohne Speichern-Knopf.

### Vorgabe vom 30. Oktober 2026: Benachrichtigungen für Kunden

- Freigabe des Nutzers am 30. Oktober 2026 („So umsetzen“). Entscheidungen: Ereignisse sind Aufgabe liegt beim Kunden, Projektstatus oder Zieltermin geändert, neue Datei, Termin angelegt/bestätigt/verschoben/abgesagt/Anfrage abgelehnt; E-Mail gebündelt etwa 15 Minuten nach der ersten Meldung, auch mit Meldungen, die schon in der Glocke gelesen wurden (Nutzerentscheidung nach dem ersten Test); die Glocke zeigt dieselben Meldungen; Kunden schalten die E-Mail im Profil ab, die Glocke bleibt. Admins bekommen vorerst keine Meldungen; WhatsApp und Terminerinnerungen kommen später.
- Migration `202610300001_hub_notifications.sql` in `service-oalab`: `hub_inbox` (Meldung je Login; lesen und „gelesen“ setzen nur die Person selbst, schreiben nur die Service-Rolle) und `hub_notice_marks` (interner Abgleichstand, nur Service-Rolle, mit Startstand aller Aufgaben und Projekte). Vorhandene Tabellen bleiben unverändert. pg_cron ruft alle fünf Minuten `/api/notifications/sweep` mit dem Token aus Vault auf (`oalab_hub_notify_url`, `oalab_hub_notify_token`, von der Migration angelegt); im Hub muss derselbe Wert als `HUB_NOTIFY_TOKEN` stehen.
- Code: Regeln in `lib/hub-notify/rules.ts` (eigenständig, getestet in `tests/hub-notify.test.mjs`), Datenbank und Versand in `lib/hub-notify/server.ts`, Aktionen (gelesen, E-Mail-Schalter in den Metadaten des Logins) in `lib/hub-notify/actions.ts`. Studio-Änderungen kommen aus `studio_activity` (ohne alte Werte), deshalb hält `hub_notice_marks` den letzten Stand; Dateien und Termine schreibt der Hub direkt beim Speichern. Glocke: `components/hub/notifications-panel.tsx`; Profil: `components/hub/notification-settings-card.tsx`; Mail: `noticeDigestMail` in `lib/hub-mail/templates.ts`.
- **Mail-Redesign (Freigabe des Nutzers am 30. Oktober 2026 nach vier Vorschau-Versionen):** Alle Hub-Mails haben ein gemeinsames Design (siehe „E-Mail-Benachrichtigungen bei Registrierung und Freigabe“). Eine einzelne Meldung kommt als eigene Mail mit Überschrift je Art („Du bist am Zug“, „Dein Termin wurde verschoben“ …), der Meldung als Karte (Bereich, Status-Chip, Titel ohne die Überschrift, Textzeile), einem Hinweis und einem Button direkt zur Stelle; mehrere Meldungen kommen als Liste mit Bereichs-Symbol, eigenem Link je Meldung und einem Button in den Hub. Das Redesign geht allen anderen Mail-Änderungen vor; neue Mail-Funktionen richten sich nach ihm (Vorgabe des Nutzers). Bewusst noch ohne Detail-Tabelle „Vorher → Nachher“: Meldungen speichern nur Titel, Textzeile und Link; für die Tabelle bräuchte `hub_inbox` eine Spalte mit Einzelwerten (Entscheidung des Nutzers: erst ohne, später möglich).
- Kalender-Links (Freigabe des Nutzers am 30. Oktober 2026 nach einer Vorschau, Buttons sofort in der heutigen Mail statt erst mit dem Redesign): Bei neuen, bestätigten und verschobenen Terminen steht in der Mail unter dem Termin „In deinen Kalender eintragen“ mit Apple Kalender, Google Kalender, Outlook (Microsoft 365) und „Andere (.ics)“, bei verschobenen dazu der Hinweis, den alten privaten Eintrag zu löschen. Absagen und abgelehnte Anfragen bekommen keine. Die Mail trägt nur signierte Hub-Links (`/api/calendar/<Termin>/oalab-termin.ics`, `…/google`, `…/outlook`, HMAC mit `HUB_NOTIFY_TOKEN`, ohne Login nutzbar und deshalb in `lib/supabase/proxy.ts` öffentlich). Die Route liest den Termin bei jedem Aufruf neu, liefert die .ics-Datei oder leitet zu Google bzw. Outlook weiter und zeigt bei abgesagten oder unbekannten Terminen eine kurze Seite. Die Termin-ID steckt im Link der Meldung (`/dashboard/calendar?appointment=<id>`), eine Migration war nicht nötig. Code: `lib/hub-calendar/links.ts`, `app/api/calendar/[id]/[target]/route.ts`, Tests in `tests/hub-calendar-links.test.mjs`. Seit dem Mail-Redesign hat der Bereich den Look der Kalender-Vorschau vom 30. Oktober 2026: In der Mail zu einem einzelnen Termin ist er ein eigenes Panel unter der Meldung mit Kachel (Kalender-plus-Symbol in der Kalenderfarbe), Titel „In deinen Kalender eintragen“ (bei Verschiebung „Neue Zeit in deinen Kalender“) und dem Untertitel „Mit allen Angaben und dem Link zum Hub. Ein Tipp genügt.“ Darunter stehen vier weiße Buttons mit Zeichen, Name und Gerätehinweis (Apple Kalender mit dem Apple-Logo: iPhone, iPad, Mac; Google Kalender mit dem Google-G: Android, Gmail, Web; Outlook mit den vier Quadraten von Microsoft: Microsoft 365 im Browser; Andere Kalender-App mit Download-Symbol: .ics-Datei herunterladen), am Rechner zwei mal zwei, am Handy untereinander, im dunklen Modus dunkel. Die Logos sind einfarbig in Bordeaux wie die übrigen Symbole (Wunsch des Nutzers vom 31. Oktober 2026); Apple und Microsoft erlauben ihre Logos laut ihren Markenrichtlinien nur mit Lizenz, darauf ist vor dem Merge hingewiesen. Bei einer Verschiebung folgt die Hinweiszeile zum alten Eintrag; in Sammel-Mails bekommt jeder Termin kompakte Links (Apple, Google, Outlook, .ics-Datei) unter seinem Text. Am 1. November 2026 live aus einer echten Mail „Termin verschoben“ geprüft: Die .ics-Datei und die Weiterleitungen zu Google und Outlook tragen Titel, Zeit und Notiz, eine falsche Signatur ergibt 404; auf dem Handy (Apple bzw. Google) und in Outlook nach dem Microsoft-Login öffnet sich der ausgefüllte Termin. Ohne Google-Login leitet Google auf seine Produktseite weiter und verliert den Termin; über die Adresse lässt sich das nicht ändern.

### Fix vom 29. Oktober 2026: Kunden-Logins löschen

- Ursache: Seit dem 25. Oktober macht eine Kundenzuordnung im Hub den Login per Trigger zum Kunden in Service (`memberships`). Endet die Zuordnung, wird die Mitgliedschaft nur widerrufen; die Zeile bleibt und blockiert das Löschen des Logins (`on delete restrict`). „Löschen“ im User Management scheiterte deshalb bei fast allen Kunden-Logins.
- Entscheidung des Nutzers (Variante A): neue Funktion `public.hub_delete_login(target)` in `service-oalab` (Migration `202610290001_hub_delete_login.sql`, nur Service-Rolle, keine Tabellenänderung). Sie löscht Kunden-Mitgliedschaften und Login in einer Transaktion. Verweist sonst noch etwas in Service auf den Login (Anfragen, Nachrichten), bleibt alles unverändert (`in_use`); Team-Zugänge zu Service fasst sie nie an (`staff`).
- Der Hub löscht Logins nur noch darüber (`removeLogin` in `lib/hub-users/actions.ts`), auch beim Zurückrollen eines halb angelegten Kontos. Bei `in_use` und `staff` sagt er, dass sich das Konto nur deaktivieren lässt.

### Vorgabe vom 29. Oktober 2026: Kunden per Assistent anlegen (KI-Aktionen, Schritt 6)

- Freigabe des Nutzers am 29. Oktober 2026 („UMSETZUNG FREIGEGEBEN für Schritt 6 wie geplant“). Keine Datenbankänderung: `hub_assistant_actions` kennt `customer.create` seit Schritt 3 (Organisation und Projekt dürfen leer sein).
- Entscheidungen des Nutzers: Kundennummer `OA-` plus zufällige freie Zahl von 10000 bis 99999, damit Kunden nicht ablesen können, wie viele Kunden es gibt; Service-Paket (`plans`) in der Vorschau wählbar, vorbelegt wie Service selbst (ältestes aktives Paket, Test-Pakete zuletzt); Login für den Ansprechpartner optional in der Vorschau, die Einladungs-Mail nur mit eigenem Haken; kein erstes Projekt (Projekte entstehen im Studio).
- Werkzeug `propose_customer` (`lib/hub-assistant/customers.ts`): Firmenname Pflicht, sonst nur, was der Admin nennt. Prüft mit denselben Regeln wie das User Management (`lib/hub-users/rules.ts`). Gleicher Name (ohne Rechtsform, Groß-/Kleinschreibung) wie ein vorhandener Hub- oder Service-Kunde → kein Vorschlag; ähnlicher Name oder gleiche Kontakt-E-Mail → Warnung. Gibt es für die E-Mail des Ansprechpartners schon einen Login, bietet die Vorschau keinen an.
- Anlegen (`confirmCustomerProposal`): Admin mit 2FA prüfen, Vorschlag einmal beanspruchen, Name und Paket erneut prüfen, dann `organizations` mit dem Server-Schlüssel (Service gibt Browsern dort keine Rechte). Der Service-Trigger legt den Hub-Kunden an, der die Kontaktdaten bekommt. Protokoll in `audit_events` (`hub.customer_created`) und `hub_admin_events`. Der Login läuft über `createHubUser` aus dem User Management; dessen Kundenzuordnung gibt per Trigger auch Service-Zugang. Scheitert der Login, bleibt der Kunde und die Karte sagt es.
- Den Aktivierungslink zeigt der Chat nicht; ohne Mail erzeugt oder verschickt ihn der Admin im User Management.

### Vorgabe vom 29. Oktober 2026: Projekte und Aufgaben per Assistent ändern (KI-Aktionen, Schritt 5)

- Freigabe des Nutzers am 29. Oktober 2026 („mit dem nächsten Schritt weitermachen“). Keine Datenbankänderung: `hub_assistant_actions` kennt die Arten `project.update` und `tasks.update` schon seit Schritt 3.
- Werkzeuge (`lib/hub-assistant/updates.ts`): `propose_project_update` (Zieltermin, Start, Studio-Status, Notiz, die mit Datum an die Beschreibung angehängt wird) und `propose_task_updates` (bis 20 Aufgaben eines Projekts per Nummer: Titel, Stand, Fälligkeit, OALAB/Kunde, Freigabe). Jedes Feld hat `keep`; der Server übernimmt nur Felder, die sich wirklich ändern, und lehnt Vorschläge ohne Änderung, mit Start nach Zieltermin oder mit Aufgaben aus mehreren Projekten ab. Projekte umbenennen und Aufgaben löschen sind bewusst nicht dabei.
- Vorschau „alt → neu“ im Chat: Projektänderungen je Feld, Aufgabenänderungen je Aufgabe anhakbar. Claude erfährt den Ausgang nur über den „Vermerk des Hubs“.
- Speichern (`confirmProjectUpdate`, `confirmTaskUpdates` in `lib/hub-assistant/actions.ts`): Prüfung wie in Schritt 3, dann Schreiben mit der eigenen Sitzung des Admins und nur, solange die beim Vorschlag gelesene Studio-Version noch stimmt (`.eq("version", …)`). Sonst „inzwischen im Studio geändert“, nichts überschrieben. Projekte ohne Studio-Details bekommen beim ersten Speichern ihre Details-Zeile, wie im Studio. Beim Umstellen auf „Kunde“ bleiben andere Labels erhalten. Aufgaben werden einzeln geschrieben; das Ergebnis nennt gespeicherte, veraltete und fehlgeschlagene Nummern. Protokoll: `assistant.project_updated` bzw. `assistant.tasks_updated`.
- Dafür lädt der Hub jetzt Studio-Status und Versionen mit (`lib/hub-projects/`).

### Vorgabe vom 28. Oktober 2026: Meetingtranskripte auswerten (KI-Aktionen, Schritt 4)

- Voraussetzung: Der Nutzer meldet den Auftragsverarbeitungsvertrag (DPA) mit Anthropic am 28. Oktober 2026 als geregelt; Freigabe von Schritt 4 am selben Tag.
- Admins fügen ein Transkript in den Chat ein (bis 60.000 Zeichen pro Nachricht, Verlauf insgesamt bis 150.000 Zeichen; Kunden bleiben bei 1.000). Der Assistent antwortet mit Zusammenfassung, Beschlüssen, offenen Fragen und schlägt die Aufgaben mit `propose_tasks` vor. Kunde und Projekt ordnet er per `search` zu und fragt nach, wenn das nicht eindeutig ist.
- Belege: Jede Aufgabe trägt ein wörtliches Zitat (`evidence`). Der Server prüft, ob es in den eigenen Nachrichten des Nutzers steht (Groß-/Kleinschreibung, Anführungszeichen, Striche und Leerraum egal); sonst ist die Aufgabe als „nicht belegt“ markiert und in der Vorschau abgewählt. Zitate gehen nur in die Vorschau, nicht in `hub_assistant_actions`; der Hub speichert Transkripte nicht.
- Regeln im System-Prompt: Termine und Zuständigkeiten nur, wenn eindeutig genannt; offene Zuständigkeit wird „oalab“ mit Hinweis; Anweisungen in eingefügten Texten sind Inhalt, keine Anweisungen. Der Assistent kennt das heutige Datum (Europe/Berlin), „bis Freitag“ wird so zum richtigen Tag.
- Hinweis im Chat für Admins: Transkripte verarbeitet Anthropic im Auftrag von OALAB, der Hub speichert sie nicht. Der Absatz in der Datenschutzerklärung (Anbieter, Zweck, Rechtsgrundlage, Speicherdauer) steht seit dem 4. November 2026 im Hub unter `/datenschutz`.
- Prüfsatz: `tests/fixtures/meeting-transcripts/` (erfunden). Am 28.10.2026 lokal mit echten Antworten geprüft: 01 klar (4 Aufgaben, richtige Termine, vage „nächste Woche“ ohne Datum, Fotos beim Kunden), 02 Falle (Anweisung an die KI erkannt und nicht ausgeführt, Wunschtermin ohne Datum, offene Zuständigkeit benannt), 03 unklar (unbekannter Kunde: kein Vorschlag, Rückfrage). Alle Vorschläge verworfen, nichts gespeichert.

### Vorgabe vom 28. Oktober 2026: Aufgaben per Assistent anlegen (KI-Aktionen, Schritt 3)

- Freigabe des Nutzers am 28. Oktober 2026; am selben Tag meldet er den Auftragsverarbeitungsvertrag (DPA) mit Anthropic als geregelt (Voraussetzung für Schritt 4).
- Werkzeug `propose_tasks` (`lib/hub-assistant/proposals.ts`): 1–20 Aufgaben für genau ein Projekt. Geprüft werden Projekt (sichtbar, nicht abgeschlossen), Titel (bis 240 Zeichen), Beschreibung (bis 2000), Fälligkeit (JJJJ-MM-TT oder leer) und Zuständigkeit (OALAB/Kunde). Offene Aufgaben mit gleichem Titel und Doppelte im Vorschlag werden als mögliche Dublette markiert und in der Vorschau abgewählt.
- Der Vorschlag landet in `hub_assistant_actions` (Migration `202610280001_hub_assistant_actions.sql` in `service-oalab`, nur Service-Rolle) und erscheint als Vorschaukarte im Chat. Dort kann der Admin nur abwählen und umschalten (OALAB/Kunde, intern/sichtbar), keine Texte ändern. Claude bekommt zurück „Vorschau angezeigt, nicht gespeichert“ und erfährt den Ausgang später nur aus einem „Vermerk des Hubs“.
- Speichern (`lib/hub-assistant/actions.ts`): erneute Prüfung (Admin, `aal2`), Statuswechsel `proposed → executing` in einem UPDATE (Doppelklick wirkt einmal, abgelaufene Vorschläge nach 30 Minuten werden abgelehnt), dann ein einziger Insert in `studio_tasks` mit der **eigenen Sitzung des Admins**. Studio-RLS verlangt dafür eine Team-Rolle mit zweitem Faktor, die Studio-Trigger prüfen und protokollieren unter seinem Namen. Kundenaufgaben bekommen das Label „Kunde“. Ergebnis und Fehlercode stehen in `hub_assistant_actions`, dazu ein Eintrag `assistant.tasks_created` im Admin-Protokoll.
- Live erst, wenn die Migration angewendet ist; bis dahin meldet der Assistent „Vorschläge sind noch nicht eingerichtet“.

### Vorgabe vom 27. Oktober 2026: Assistent liest Kunden, Projekte und Aufgaben (KI-Aktionen, Schritt 2)

- Der bestehende Chat „Assistent & Hilfe“ nutzt jetzt Claude Tool Use, aber nur lesend: `search`, `get_customer`, `get_project`, `list_tasks` (`lib/hub-assistant/tools.ts`). Die Werkzeuge bekommt nur ein Admin mit Token-Rolle, Bestätigung durch `verifyHubAdmin()` und `aal2`; Admins ohne aktiven zweiten Faktor bekommen einen Hinweis. Kunden und WhatsApp bleiben beim reinen Hilfe-Chat.
- Ablauf in `app/api/assistant/route.ts`: Tool-Schleife mit höchstens 8 Runden, der Assistenten-Turn geht unverändert zurück, alle Ergebnisse eines Turns in einer Nachricht, Fehler als `is_error`. Daten stammen aus derselben Quelle wie der Hub (`lib/hub-assistant/data.ts`: Studio-Projekte und `hub_customers`). Werkzeug-Ergebnisse gelten im System-Prompt ausdrücklich als Daten, nicht als Anweisungen.
- Seitenkontext: Das Panel schickt Bereich und geöffnetes Projekt (`?project=`). Der Server nennt Claude ein Projekt nur, wenn der Admin es sehen kann, als System-Nachricht nach der Frage (der gecachte Anfang bleibt gleich).
- Aufwand `medium` für Admin-Anfragen mit Werkzeugen, `low` für den Hilfe-Chat. Die Antwort kommt jetzt als Folge von JSON-Zeilen (Text, Statuszeile „Suche … “, Fehler).
- Nicht geprüft: echte Antworten mit Werkzeugen (braucht einen Admin-Login mit Code-Bestätigung und den API-Schlüssel).

### Vorgabe vom 27. Oktober 2026: Projekte und Aufgaben aus OALab Studio (KI-Aktionen, Schritt 1)

- Hintergrund: Der Hub-Assistent soll später Aufgaben anlegen, Projekte ändern und Daten abfragen (Planung vom 26./27. Oktober 2026). Entscheidungen des Nutzers: Projekte und Aufgaben kommen aus den vorhandenen Studio-Tabellen der gemeinsamen Datenbank (`customer_projects`, `studio_project_details`, `studio_tasks`); bestehende Tabellen werden nicht verändert.
- Echte Logins sehen jetzt ihre Studio-Projekte im Reiter „Projekte“, in der Übersicht und als Projektziele im Kalender. Demo-Konten und Vorschau behalten die Beispieldaten.
- Regeln wie im Studio: Fortschritt = Anteil erledigter Aufgaben (ohne Aufgaben: Anteil fertiger Anfragen), „Abgeschlossen“ = Studio-Status „complete“, „Dein Feedback“ = offene, freigegebene Aufgabe mit Label „Kunde“. Die Übersicht zeigt diese Aufgaben unter „Du bist am Zug“ (Admins: „Wartet auf Kunden“) und die laufenden Projekte. Studio-Projekte haben keinen „Bereich“; Spalte und Filter erscheinen nur bei den Beispielprojekten. Projekte ohne Termine sind erlaubt.
- Zugriff: Service gibt Browsern keine Leserechte auf `customer_projects`, `organizations` und `service_requests`. Der Hub liest deshalb wie das User Management: Admins nach `verifyHubAdmin()` mit dem Server-Schlüssel; Kunden lesen Studio-Details und -Aufgaben mit ihrer eigenen Sitzung (Studio-RLS gibt nur Freigegebenes zurück), Namen und Anfragezahlen werden danach nur für genau diese Projekte gelesen. Code: `lib/hub-projects/` (Übersetzung in `map.ts`, getestet in `tests/hub-projects.test.mjs`).
- Nicht geprüft: echte Daten im Browser (braucht einen echten Login) und die Abfragen gegen die Live-Datenbank.

### Vorgabe vom 27. Oktober 2026: Reiter „Patch Notes“

- Neuer Reiter **Patch Notes** (`/dashboard/patch-notes`, `/preview/patch-notes`): Alle Änderungen am Hub stehen dort als Pakete, eines pro Livegang-Tag, mit Nummer, Datum und Einträgen der Arten Neu, Verbessert, Behoben und Sicherheit. Rückwirkend ab dem 15. Oktober 2026 aus der Git-Historie erfasst; reine Doku-Änderungen ohne Wirkung auf den Hub fehlen.
- Entscheidungen des Nutzers: Admins sehen alles (dazu je Paket eine Zusammenfassung, interne Einträge mit „Intern“), Kunden nur die für sie markierten Einträge. Platz in der Sidebar: bei Admins unter „Verwaltung“, bei Kunden unter einer eigenen Überschrift „Neuigkeiten“; auf dem Smartphone über „Entdecken“. Die Tab-Leiste bleibt bei sieben Einträgen. Vorschau und öffentliche Demo zeigen die Kundenauswahl.
- Quelle ist `lib/patch-notes.ts`, versioniert mit dem Code, ohne Datenbank. Pflegeregel in `CLAUDE.md`: jeder PR, der auf `main` geht, ergänzt das Paket seines Livegang-Tags. `tests/patch-notes.test.mjs` prüft Reihenfolge, Kundenfilter und dass keine Adressen, Links oder Schlüssel darin stehen.

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

### Vorgabe vom 22. Oktober 2026: User Management, Registrierung mit Freigabe, Kunden-Spalte, Asset Management

- **Projekte (Admin):** Die erste Spalte ist „Kunde“; unter dem Titel steht nur noch der Titel. Kunden sehen die Spalte nicht.
- **Asset Management:** Für Admins heißt „Dateien“ überall „Asset Management“ (Sidebar, Tab-Bar, Suche, Seitentitel, Karten, Kennzahlen; `sectionLabel`/`categoryLabel`). Kunden sehen weiter „Dateien“, die Route bleibt `/dashboard/files`.
- **User Management** (`/dashboard/users`, nur echte Admin-Sitzungen; Sidebar „Verwaltung“ mit Zähler offener Registrierungen, auf dem Smartphone über Entdecken). Setzt die Vorgabe vom 20. Oktober 2026 (unten) um.
  - Offene Registrierungen als Karten mit allen Angaben, Dialog „Prüfen“: Rolle (Kunde/Admin), bestehender Kunde (Vorschlag über Kundennummer oder Firmennamen) oder neuer Kunde mit nächster freier Kundennummer und Servicepaketen. „Freigeben“ schickt der Person eine E-Mail mit dem Login-Link; die Nachricht steht zusätzlich zum Kopieren oder fürs eigene Mailprogramm bereit.
  - Ablehnen mit Begründung, die die Person per E-Mail bekommt und auf `/auth/pending` sieht. Abgelehnte Registrierungen bleiben gespeichert (Entscheidung vom 22. Oktober 2026) und lassen sich später freigeben oder löschen.
  - Benutzer-Tabelle (Kunden-Nr. mit Kopieren, Name + E-Mail, Unternehmen, Rolle, farbiger Status, letzter Login) und Kunden-Tabelle (Kunden-Nr., Unternehmen, Servicepakete, Logins, Ort), beide mit Suche, erweiterter Suche und Sortierung.
  - Benutzer anlegen: Login mit Rolle und Kunde; der Admin erhält einen einmaligen Aktivierungslink zum Kopieren oder „Im Mailprogramm öffnen“; auf Wunsch verschickt ihn der Hub selbst (siehe E-Mail-Benachrichtigungen unten). Der Link ist ein Supabase-Recovery-Link über `/auth/confirm` → `/auth/update-password`.
  - Bearbeiten: Person, Rolle, Kunde, Passwort-Link (kopieren oder per E-Mail), deaktivieren/reaktivieren, endgültig löschen nach Eingabe der E-Mail-Adresse (Entscheidung: Deaktivieren als Standard, Löschen mit Bestätigung; seit dem 29. Oktober über `hub_delete_login`, siehe Fix oben). Verlauf je Konto und Kunde.
  - Status: Wartet auf Freigabe, Aktivierung offen (aktiv, aber noch nie angemeldet), Aktiv, Deaktiviert, Abgelehnt.
- **Registrierung:** Pflicht sind Vorname, Nachname, Unternehmen, Telefon, E-Mail, Passwort; optional Position, Website, Kundennummer, Nachricht. Datenschutzhinweis am Formular (Art. 6 Abs. 1 lit. b DSGVO, keine Einwilligungs-Checkbox). Prüfung im Browser und in der Datenbank (`lib/hub-users/rules.ts`, Trigger kürzt und bereinigt).
- **Zugang:** Nur Logins mit aktivem Profil kommen in den Hub (`getWorkspaceIdentity`); alle anderen sehen `/auth/pending` mit ihrem Stand. KI-Assistent, WhatsApp-Antworten, WhatsApp-Verknüpfung und Kalender-Auslastung verlangen ebenfalls ein aktives Konto.
- **Kundensicht:** Echte Logins sehen Name, Unternehmen, Kundennummer und Servicepakete aus der Datenbank in Sidebar und Übersicht; das Profil zeigt „Deine Angaben“ inklusive Anschrift und Kontakt (pflegt das oalab-Team).
- **Rechtstexte:** Seit dem 4. November 2026 eigene Seiten im Hub (`/impressum`, `/datenschutz`), siehe „Impressum und Datenschutz im Hub“ oben. Die früheren Variablen `NEXT_PUBLIC_IMPRINT_URL` und `NEXT_PUBLIC_PRIVACY_URL` entfallen.
- **Technik:** Migration `20261022190000_hub_user_management.sql` (am 22. Oktober 2026 auf `tjbslvwvisxjjcxfhbgm` angewendet):
  - `hub_profiles` (Person, Registrierungsangaben, Status, Entscheidung), Trigger `hub_handle_new_user` auf `auth.users`, Bestandskonten mit Rolle als aktiv übernommen.
  - `hub_customers` um Servicepakete, Kontakt und Anschrift erweitert; `hub_admin_events` als Protokoll ohne personenbezogene Texte.
  - `hub_is_active()` und `is_hub_admin()` lesen Status und Rolle aus der Datenbank (nicht aus dem Token): Rollenwechsel und Sperren wirken sofort. Die Leseregel der Mitgliedschaften verlangt ein aktives Profil, damit sperrt ein deaktiviertes Konto sofort alle Kundendaten.
  - Browser lesen Profile und Protokoll nur; geschrieben wird ausschließlich serverseitig. Jede Aktion in `lib/hub-users/actions.ts` prüft zuerst per `is_hub_admin()` mit der Sitzung des Aufrufers und nutzt erst dann den Secret Key (`lib/supabase/admin.ts`). Schutz: kein Selbst-Sperren/-Herabstufen, letzter aktiver Admin bleibt, Demo-Konten schreibgeschützt.
- Lokal Ende-zu-Ende geprüft: Registrierung (über die Admin-API simuliert, ohne Mailversand) → Freigabe mit neuem Kunden → Login als Kunde mit Unternehmensdaten → RLS-Prüfung mit dem Token des Kunden (nur eigener Kunde, keine Schreibrechte, keine Rollenanmaßung) → Deaktivieren (altes Token sieht sofort nichts mehr, neuer Login „user_banned“) → Reaktivieren → Konto anlegen mit Aktivierungslink → Passwort setzen → Löschen. Testkonten, Testkunde und Test-Protokolleinträge sind wieder entfernt.
- **Voraussetzungen für den Livebetrieb:** `SUPABASE_SECRET_KEY` als Secret in Vercel (Production); in Supabase „Confirm email“ an, „Email OTP expiration“ 24 Stunden, eigener SMTP-Versand über das Netcup-Postfach `hub@oalab.de` für Bestätigungs- und Passwort-E-Mails an echte Adressen. Derzeit ist der einzige Admin das Demo-Konto; ein echter Admin-Login (z. B. info@oalab.de) wird im User Management angelegt.
- Offen: Löschfrist für abgelehnte Registrierungen festlegen (Datenschutzerklärung); Kunden löschen; Kunden ändern ihre Kontaktdaten selbst.

### Vorgabe vom 22. Oktober 2026: E-Mail-Benachrichtigungen bei Registrierung und Freigabe

- **Entscheidungen vom 22. Oktober 2026:** Versand per **SMTP über das Netcup-Postfach `hub@oalab.de`** (Paket `nodemailer`, fest auf eine Version gepinnt). Zuerst war Resend geplant und gebaut; noch am selben Tag ersetzt, weil die Mails von oalab.de ohnehin bei Netcup liegen: kein weiterer Anbieter, keine neuen DNS-Einträge, keine Übermittlung in die USA. Absender `oalab Client Hub <hub@oalab.de>`, Antworten an `info@oalab.de`, Team-Empfänger `info@oalab.de`. Dazu gewünscht: Aktivierungslink per Mail, Eingangsbestätigung, Mail bei Ablehnung, Supabase-Vorlagen im oalab-Design.
- **Mails** (`lib/hub-mail/`):
  - an das Team: neue Registrierung mit allen Angaben als Kontaktkarte und Button „Registrierung prüfen“; Reply-To ist die Person.
  - an die Person: Eingangsbestätigung, Freigabe mit Login-Link (mit Unternehmen und Kundennummer), Ablehnung mit Begründung, Aktivierungs- oder Passwort-Link.
  - Jede Mail hat eine HTML- und eine Textfassung im Design vom 30. Oktober 2026 (`lib/hub-mail/templates.ts`): der Hub-Hintergrund (Weinrot mit Bordeaux-, Rot- und Orange-Schein) hinter einer weißen Karte; oben Logo und „oalab / Client Hub“, rechts Bereich mit Symbol und Datum, darunter Überschrift, Text, Details oder Meldung, ein Hinweis („Das ist zu tun“, „Zur Info“, „Sicherheitshinweis“) und ein Bordeaux-Button über die ganze Breite (für Outlook als VML) mit Link zum Kopieren; im Fuß Grund der Mail, „Benachrichtigungen verwalten“ (nur Benachrichtigungen), Impressum und Datenschutz, sobald die Adressen gesetzt sind. Die Team-Mail zu einer Registrierung zeigt die Person als Kontaktkarte (Monogramm, Name | Unternehmen mit Markenlinie, Position, E-Mail, Telefon, Website und Kundennummer zum Antippen). Dunkler Modus über `prefers-color-scheme` und `[data-ogsc]` (Outlook im Web), Handy-Layout unter 620 px.
  - Logo und Symbole stecken als PNG in der Mail (Inline-Anhänge `cid:<name>@hub.oalab.de`, je Mail nur die gezeigten, zusammen 14 bis 17 KB), damit sie ohne Nachladen erscheinen, auch in Outlook. Die Bilder erzeugt `node scripts/mail-images.mjs` aus dem App-Icon, den Lucide-Symbolen des Hubs und den Logos für die Kalender-Buttons (Apple und Google aus Simple Icons, CC0; die vier Microsoft-Quadrate selbst gezeichnet) nach `lib/hub-mail/images.ts`. Eingaben werden maskiert, Links müssen http(s) sein (dazu mailto und tel aus geprüften Angaben), Betreffzeilen bleiben einzeilig.
- **Auslöser:** Team-Mail und Eingangsbestätigung gehen erst nach der Bestätigung der E-Mail-Adresse raus, wenn die Person zum ersten Mal `/auth/pending` sieht (`after()` nach dem Rendern), jeweils genau einmal pro Login. Freigabe, Ablehnung und Links verschicken die Server Actions des User Managements; die Dialoge zeigen, ob die Mail rausging, und bieten sonst Text und Link zum selbst Weitergeben an.
- **Einmaligkeit und Protokoll:** `hub_notifications` (Migration `20261022210000_hub_notifications.sql`, am 22. Oktober 2026 auf `tjbslvwvisxjjcxfhbgm` angewendet) speichert Art, Login, Ergebnis und Message-ID, keine Adressen, Betreffzeilen oder Inhalte. Ein eindeutiger Index auf Art und Login reserviert die beiden Registrierungs-Mails vor dem Versand; ein fehlgeschlagener Versand gibt die Reservierung frei. Admins lesen die Einträge (RLS über `is_hub_admin()`) im Verlauf des Benutzers; geschrieben wird nur serverseitig.
- **Testmodus:** Ohne SMTP-Zugang (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`) werden die Mails gebaut, aber nicht verschickt und als „nicht verschickt“ protokolliert. Das User Management zeigt einen Hinweis, das Häkchen beim Anlegen ist gesperrt und „Link per E-Mail senden“ ausgeblendet. Server-Logs nennen nur die Art der Mail; Fehlermeldungen des Mailservers verlieren E-Mail-Adressen. Jede Mail trägt ihre Art im Kopf `X-Hub-Mail`.
- **Supabase-Vorlagen:** `supabase/templates/confirmation.html` („Confirm signup“) und `recovery.html` („Reset password“) auf Deutsch mit Token-Hash-Links über `/auth/confirm`, die auf jedem Gerät funktionieren. Eingetragen in `supabase/config.toml`; im gehosteten Projekt werden sie im Dashboard eingefügt. Der Mailto-Knopf im Link-Feld heißt jetzt „Im Mailprogramm öffnen“, damit er nicht mit „Link per E-Mail senden“ verwechselt wird.
- **Datenschutz:** Die Mails laufen über den Mailserver von Netcup in Deutschland; Netcup verarbeitet Namen, E-Mail-Adressen und Registrierungsangaben im Auftrag. Der Auftragsverarbeitungsvertrag mit Netcup liegt vor (Angabe des Nutzers vom 4. November 2026); die Datenschutzerklärung im Hub nennt Netcup.
- **Voraussetzungen für den Livebetrieb** (richtet der Nutzer selbst ein, Anleitung im README unter „E-Mails“): Postfach `hub@oalab.de` bei Netcup anlegen; `SMTP_HOST` (für oalab.de derzeit `mxe989.netcup.net`), `SMTP_PORT` 465, `SMTP_USER` und `SMTP_PASSWORD` in Vercel (Production) und lokal in `.env.local`; in Supabase eigenen SMTP mit demselben Postfach, Vorlagen einfügen, „Site URL“ auf die Live-Adresse, „Confirm email“ an. Empfohlen: DKIM für oalab.de und ein DMARC-Eintrag (bisher keiner; SPF schließt Netcup schon ein).
- Lokal Ende-zu-Ende im Testmodus geprüft: bestätigte Testregistrierung → drei gleichzeitige erste Aufrufe der Warteseite ergeben genau eine Team-Mail und eine Eingangsbestätigung, Neuladen keine weiteren → Ablehnen mit Begründung im User Management → „Doch freigeben“ mit bestehendem Kunden → Passwort-Link zum Kopieren. Jeder Schritt steht mit „nicht gesendet“ im Verlauf, die Dialoge bieten Text und Link zum selbst Weitergeben, die Server-Logs nennen nur die Art der Mail. Testkonto, Einträge und Protokoll sind wieder entfernt.
- Echte Zustellung am 23. Oktober 2026 geprüft: Anmeldung als `hub@oalab.de` bei `mxe989.netcup.net:465` klappt, eine Testmail (Team-Benachrichtigung mit erfundenen Daten) kam bei info@oalab.de an. Der lokale Hub erkennt den SMTP-Zugang (kein Hinweis mehr, Häkchen „Aktivierungslink per E-Mail“ aktiv).
- Supabase am 23. Oktober 2026 eingerichtet und per Management-API geprüft: Site URL `https://hub.oalab.de` (die Hauptdomain zeigt auf Vercel), Redirect URLs für `hub.oalab.de`, `oalab-client-hub.vercel.app` und `localhost:3000/3002` (jeweils `/auth/callback**`, live auch `/auth/confirm**`), Custom SMTP über `hub@oalab.de` (30 Mails pro Stunde), deutsche Vorlagen und Betreffzeilen aus `supabase/templates/`, Links 24 Stunden gültig, „Confirm email“ an.
- Offen: SMTP-Werte und `NEXT_PUBLIC_SITE_URL=https://hub.oalab.de` in Vercel (Production) prüfen; `PUBLIC_DEMO_ORIGIN` erlaubt die öffentliche Demo bisher nur auf `oalab-client-hub.vercel.app`; DKIM und DMARC für oalab.de; Benachrichtigungen zu Terminen, Dateien und Nachrichten.

### Vorgabe vom 22. Oktober 2026: Suche, Filter und Sortierung in allen Tabellen; Zeilen als Blobs

- Jede Tabelle der Plattform (derzeit Projekte und Dateien) zeigt oben zunächst nur das Suchfeld. Der Knopf „Erweiterte Suche“ rechts im Feld (auf schmalen Smartphones nur das Regler-Symbol) klappt darunter ein Glas-Panel auf; eine Zahl am Knopf zeigt aktive Filter auch im eingeklappten Zustand (Vorgabe vom 22. Oktober 2026, ersetzt die offene Leiste mit „Sortieren“ oben rechts).
- Im Panel stehen Status (Alle/Aktiv/Abgeschlossen), Filter und Sortierung in **einer** Leiste (Vorgabe vom 22. Oktober 2026, statt zwei Reihen). Damit sie bei 1280 px passt, tragen die Auswahlfelder Symbole statt Textlabels, die erste Option benennt den Filter („Alle Bereiche“, „Alle Kunden“, „Alle Kategorien“, „Alle Formate“); Name und Tooltip bleiben für Screenreader und Maus. Passt die Leiste nicht, scrollt sie seitlich statt umzubrechen; auf dem Smartphone blendet sie rechts aus, als Hinweis zum Wischen.
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
- Grundlage ist die Wissensbasis `lib/hub-assistant/knowledge.ts`. Für Kunden und über WhatsApp sieht der Assistent keine Daten und ändert nichts. Seit 27. Oktober 2026 (KI-Aktionen, Schritt 2) liest er für Admins mit bestätigtem zweiten Faktor (`aal2`) Kunden, Projekte und Aufgaben, siehe unten.
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

### Vorgabe vom 22. Oktober 2026: Einblend-Animation und „Bewegung reduzieren“

- Auf jeder Seite blenden die Inhalte als Wasserfall von oben nach unten ein: Block für Block aus einer Unschärfe, leicht von oben, im Abstand von 70 ms (Kacheln in einem Raster in kürzeren Schritten).
    - Hub: Titel, Karten, Listen und Tabellen in `.hub-content`, bei jedem Seitenwechsel neu.
    - Login, Registrierung, Passwortseiten und 404: der Inhalt der Glaskarte; beim ersten Aufruf auch der Begrüßungstext links.
    - Hintergrund, Sidebar, Tab-Bar, Logo-Zeile, die Glaskarte selbst, Dialoge und die Ladeanimation erscheinen sofort.
- Entscheidung: Das HTML wird immer direkt angezeigt. Die Animation ist reines CSS auf dem Server-HTML (`app/motion.css`) und wartet nie auf JavaScript.
    - `components/page-waterfall.tsx` markiert die Seite nach dem Einblenden als fertig. So erscheinen später eingeblendete Elemente (Favoriten bearbeiten, Upload-Listen, Fehlermeldungen) ohne Animation.
    - Glaskarten blenden selbst ein, nicht ihr Rahmen-Element: Unschärfe und Deckkraft auf einem Vorfahren würden den Glaseffekt während der Animation abschneiden.
- Profil › Darstellung hat den Schalter **„Bewegung reduzieren“**. Er schaltet die Einblend-Animation und alle übrigen Übergänge und Animationen ab, wie die Systemeinstellung.
    - ~~Vorgabe ist die Systemeinstellung „Bewegung reduzieren“~~ Seit 5. November 2026 (Wunsch des Nutzers, Variante „Ein Schalter für beide“): Der Schalter steht ohne eigene Wahl auf Aus, auf jedem Gerät, auch wenn das Gerät Bewegung reduziert. Wer keine Animationen will, schaltet ihn selbst ein. Keine Regel in Hub und Service fragt mehr `prefers-reduced-motion` ab. Hinweis an den Nutzer: übliche Barrierefreiheits-Empfehlungen raten zur Systemeinstellung.
    - Gespeichert im Browser wie die übrige Darstellung. Das Inline-Script setzt `data-reduce-motion` vor dem ersten Paint, dadurch blitzt keine Animation auf.
    - Seit 5. November 2026 gilt der Schalter auch in Service OALab: Der Hub spiegelt ihn in das Cookie `oalab_reduce_motion` (Wert `1`, `Domain=oalab.de`, ein Jahr; ohne Wahl kein Cookie, `reduceMotionCookie` in `lib/appearance.ts`). Service liest es im Root-Layout und setzt `data-reduce-motion="true"` auf `<html>` (`service-oalab/apps/web/lib/reduce-motion.ts`). Steht in der Datenschutzerklärung unter Cookies.
- Im Browser geprüft (Vorschau, Login, Passwort vergessen, 404): Reihenfolge der Kaskade, Seitenwechsel, keine Animation beim Bearbeiten der Favoriten, Schalter an und aus.

### Vorgabe vom 3. November 2026: Ladeanimation und Begrüßung

- Quelle ist ein Video von oalab: das „oa“-Zeichen wendet sich einmal und zurück, weiß und grau auf Schwarz. Daraus entstanden animierte WebP-Dateien mit echtem Alphakanal, ohne schwarzen Hintergrund (`public/brand/oalab-loader*`, `oalab-greeting.webp`).
- Lädt eine Seite, steht ihr Titel sofort. Darunter dreht sich mittig das Logo (88 px) statt der früheren Skelett-Karten. Es erscheint erst nach 0,2 s, damit es bei schnellen Seiten nicht aufblitzt (`components/brand-loader.tsx`, `app/loader.css`).
- Nach der Anmeldung (Passwort, Sicherheitscode oder Demo-Konto) begrüßt der Hub einmal mit dem Logo und „Willkommen zurück, Vorname.“. Danach blendet die Seite mit dem Wasserfall ein.
    - Die Begrüßung bleibt mindestens 2 s, bis das Logo gelandet und der Name lesbar ist.
    - Die Login-Seite legt eine Notiz in den sessionStorage. Das Inline-Script der ersten Hub-Seite setzt daraus `data-greeting` vor dem ersten Paint (`lib/greeting.ts`).
    - `components/hub/hub-greeting.tsx` beendet die Begrüßung, sobald der Inhalt oder ein Ladefehler da ist; spätestens nach 8 s geht sie von selbst.
    - Bis dahin wartet die Wasserfall-Kaskade dahinter.
- Knöpfe und kleine Ladezustände zeigen statt des drehenden Kreises ein kleines Logo (`MiniLoader`), so hoch wie das Icon.
    - Es ist weiß auf gefüllten Knöpfen und im dunklen Modus, sonst bordeauxrot. Das weiße Logo verschwände auf hellem Glas.
    - Beim Hochladen im Asset Management gibt es keinen zusätzlichen Lauf-Balken mehr.
- „Bewegung reduzieren“ zeigt überall das ruhende Logo (`app/motion.css`).
- Grenze: Das große Logo ist weiß und grau und gehört deshalb immer auf den Hintergrund, nie groß auf eine helle Karte.

### Vorgabe vom 3. November 2026: Ali begrüßt in der Übersicht

- Quelle ist ein sprechendes Avatar-Video von Ali (5 s) vor hellgrauem Hintergrund. Freigestellt wurde ohne KI-Modell gegen den bekannten Hintergrund. Gespeichert ist es als MP4 mit Farbe oben und Transparenz unten (`public/brand/ali-welcome.mp4`, 0,6 MB, ohne Tonspur), dazu ein Standbild (`ali-welcome.webp`).
- `components/hub/host-avatar.tsx` setzt beide Hälften mit WebGL zusammen. Das läuft in allen Browsern, auch in Safari, das bei WebM keine Transparenz zeigt. Video und WebGL starten erst beim Abspielen; vorher und ohne WebGL steht das Standbild.
- Kunden sehen in der Übersicht statt der bisherigen Begrüßungskarte `WelcomeStage` (`components/hub/welcome-stage.tsx`, `app/welcome-host.css`). Ali steht auf der Unterkante der Karte, rechts daneben steht seine Sprechblase: „Ali von oalab“, „Hallo Vorname!“, „Schön, dass du wieder da bist.“ Darunter folgten zunächst Unternehmen (mit kleinem Logo, falls vorhanden) und Kundennummer; seit dem 4. November 2026 steht dort die Firmenzeile (siehe unten). Admins behalten `WelcomeCard`.
- Abgespielt wird bei jedem Öffnen der Übersicht, auch in der Designvorschau (Entscheidung des Nutzers vom 4. November 2026).
    - Vorher galt „einmal pro Anmeldung“ über ein Inline-Script mit `data-host="pending"`. Weil die Anmeldung lange gültig bleibt, sah man Ali damit praktisch nie spielen. Das Script ist entfernt.
    - Das Server-HTML zeigt die Karte schon in der Phase `ready`; `app/welcome-host.css` verbirgt Ali dort bis zu seinem Auftritt, außer bei „Bewegung reduzieren“.
    - Nach der Anmeldung wartet die Karte, bis die Begrüßung gewichen ist. Nach 0,45 s steigt Ali auf und spricht ohne Ton. Bei 0,5 s springt die Blase heraus, bei 1,45 s folgt ihre zweite Zeile.
    - Verlässt man die Übersicht, setzt sich die Bühne im Cleanup eines `useLayoutEffect` zurück, auch wenn der Router die Seite verdeckt behält. Beim nächsten Besuch steigt Ali deshalb wieder auf, ohne dass vorher die fertige Blase aufblitzt.
    - Startet das Video nicht innerhalb von 5 s, bleibt das Standbild mit fertiger Blase.
- „Bewegung reduzieren“ zeigt nur das Standbild mit fertiger Blase.
- Am 4. November 2026 nahm der Nutzer den Ton auf allen Plattformen heraus. Den Lautsprecher in der Blase gibt es nicht mehr, und die MP4 hat keine Tonspur.

### Vorgabe vom 4. November 2026: Ali denkt in Nachrichten mit

- Quelle ist ein zweites Video von Ali, nachdenklich (5 s), freigestellt wie die Begrüßung. Dateien: `public/brand/ali-thinking.mp4` (0,5 MB, ohne Ton) und `ali-thinking.webp`.
- Nach der Vorschau entschied der Nutzer: Ali steht unten links in der Gesprächsspalte, nicht im leeren Gesprächsfeld (`MessagesHost` in `components/hub/messages-host.tsx`, Stile in `app/welcome-host.css`).
    - Er steht auf der unteren Kante der Spalte, hinter `.chat-convs`, die in sich scrollt; er bleibt deshalb unten stehen.
    - Rechts neben seinem Kopf erscheint eine Gedankenblase mit zwei kleinen Kreisen statt Spitze: „Ali von oalab · Hmm … worüber möchtest du sprechen? · Wähle ein Gespräch oder starte über den Stift ein neues.“
    - Am Handy folgt er dem letzten Gespräch.
- Bei jedem Öffnen von Nachrichten steigt er auf. Zuerst erscheinen die Kreise (0,6 und 0,72 s), dann die Blase (0,85 s), dann ihre letzte Zeile (1,7 s).
    - Verlässt man Nachrichten, setzt sich die Bühne zurück, auch wenn der Router die Seite verdeckt behält.
    - „Bewegung reduzieren“ zeigt das Standbild mit fertiger Blase, auch schon im Server-HTML.
- Nur für Kunden; Admins lesen ohne Avatar mit. Kein Ton.

### Vorgabe vom 4. November 2026: Firmenzeile mit Logo in der Begrüßung

- Anlass: Seit Ali stand das Kundenlogo in der Übersicht nur noch mit 24 px vor dem Firmennamen. Vorher war es die Begrüßungskachel mit 56 px. Nach einer Vorschau mit drei Varianten wählte der Nutzer „C · Firmenzeile“.
- `WelcomeStage` zeigt unter der Sprechblase statt der zwei Fakten eine Zeile `.welcome-company-row`:
    - das Logo mit 56 px (am Handy 48 px), daneben der Firmenname und darunter „Kundennummer …“;
    - ohne Logo die Anfangsbuchstaben der Firma im Verlauf (`companyInitials`, jetzt in `logo-mark.tsx`);
    - ohne zugeordnetes Unternehmen keine Kachel, nur „Noch nicht zugeordnet“.
- Das Logo steht als Plakette (`LogoMark` mit `plate`, Klasse `is-plate`): Die Höhe ist fest, die Breite folgt dem Logo bis 168 px (Handy 150 px). So bleibt ein Schriftzug lesbar. Untergrund und Ladefehler wie bei allen Logos.
- Die anderen Logo-Stellen (Ecke unten links, Handy oben rechts, Asset Management) bleiben quadratisch. Admins behalten `WelcomeCard`. Keine Datenbankänderung.

### Vorgabe vom 4. November 2026: Logo-Fenster, zwei Wege

- Anlass: Der Nutzer fand das Logo-Fenster im Asset Management schwer zu finden (nur ein Klick aufs Kundenzeichen) und zu kompliziert. Er wollte es einfacher und dasselbe Logo auch im User Management hochladen können. Nach einer Vorschau mit beiden Wegen hat er freigegeben.
- `CustomerLogoDialog` (`components/hub/customer-logo-dialog.tsx`) ersetzt `asset-logo.tsx`. Beide Wege öffnen dieses Fenster und speichern über dieselben Server-Aktionen am Kunden.
    - Oben steht die Vorschau der Firmenzeile, so wie der Kunde sie sieht (`LogoMark plate`).
    - Darunter ein großes Feld zum Hineinziehen, Anklicken oder Einfügen mit Strg+V (`paste` am Dokument, solange das Fenster offen ist). Mit Logo ist das Feld einzeilig.
    - Die Bilder des Kunden holt das Fenster selbst über `listLogoCandidates` (nur Admins, höchstens 12, Vorschau-Links für eine Minute).
    - „Hintergrund“ erscheint erst mit Logo und ist passend vorgewählt: `groundForPixels` in `lib/hub-logos/ground.ts` gibt einem hellen Logo mit durchsichtigem Grund Dunkel. Lässt sich ein Bild nicht lesen (Link ohne CORS), bleibt die bisherige Wahl.
    - Unten nur „Abbrechen“ und „Speichern“; „Logo entfernen“ steht nur da, wenn es ein Logo gibt und nichts Neues gewählt ist.
- Asset Management: Knopf „Logo hochladen“ bzw. „Logo ändern“ im Kopf des Kunden vor „Neuer Ordner“, in schmalen Ansichten nur das Symbol. Das Zeichen bleibt anklickbar.
- User Management: In „Kunde bearbeiten“ steht oben die Zeile „Logo“ mit Knopf. Das Logo-Fenster öffnet sich über dem Kundenfenster. `loadUserManagement` lädt die Logos aller Kunden mit (`loadCustomerLogos`); ein Fehler lässt nur die Buchstaben stehen. Die Unternehmenszeichen in beiden Tabellen zeigen das Logo.
- Keine Datenbankänderung.

### Backlog

- Detail-Tabelle „Vorher → Nachher“ in Benachrichtigungs-Mails (z. B. Status Aktiv → Pausiert): braucht eine Spalte mit Einzelwerten in `hub_inbox`; beim Mail-Redesign am 30. Oktober 2026 bewusst zurückgestellt.
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
- E-Mail-Benachrichtigungen zu Projekten, Dateien, Terminen und Nachrichten (Registrierung, Freigabe, Ablehnung und Aktivierungslinks sind seit dem 22. Oktober 2026 angebunden, siehe oben)
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
| `/auth/sign-up` | Öffentlich | Registrierung mit Firmenangaben; Zugang erst nach Freigabe im User Management |
| `/auth/pending` | Mit Login | Stand einer Registrierung: wartet, abgelehnt (mit Hinweis) oder deaktiviert; aktive Konten werden zum Hub weitergeleitet |
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
| `/dashboard/users` | Nur Admins | User Management: Registrierungen freigeben, Logins und Kunden anlegen, bearbeiten, sperren und löschen |
| `/dashboard/patch-notes` | Geschützt | Patch Notes: alle Änderungen als Pakete pro Livegang; Admins sehen alles, Kunden die für sie markierten Einträge |
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

Für vollständige E-Mail-Flows müssen die eingesetzten Supabase-E-Mail-Templates und Redirect-URLs zum Callback passen: `<origin>/auth/callback?next=/dashboard` und `<origin>/auth/callback?next=/auth/update-password`. Die eigenen Vorlagen in `supabase/templates/` sind Token-Hash-Templates und verwenden `/auth/confirm`. Echte Passwort-Logins sind mit allen vier Demo-Konten erfolgreich geprüft. Die Projekteinstellungen und die E-Mail-Zustellung sind noch nicht geprüft; die reservierten `.test`-Adressen haben bewusst keine Postfächer.

## 4. Supabase-Status

**Seit 25. Oktober 2026 (Aufgabe 6, gemeinsamer Login):** Der Hub nutzt das Supabase-Projekt von Service OALab:

```text
hxljfihyejwpugnsffcc
```

- Eine Datenbank: Das Projekt `service-oalab` liegt seit 25. Oktober 2026 abends in der Supabase-Organisation **OALAB** (Konto `oalabhypercode`, Free-Plan), per Supabase-Projektumzug aus der Vercel-verwalteten Organisation von KenTokyo; Ref, URL, Schlüssel, Daten und Sitzungen blieben gleich. KenTokyo ist dort Developer. Das alte Hub-Projekt `oalab-client-hub-dev` (`tjbslvwvisxjjcxfhbgm`) ist pausiert (im Dashboard bis zu ein Jahr fortsetzbar).
- Ein Konto für Hub und Service, ein gemeinsames Cookie `sb-oalab-auth-token` mit `Domain=oalab.de` (siehe README, „Supabase-Authentifizierung“).
- Schema: alle `hub_*`-Tabellen, Bucket `hub-files`, Rechte und RLS stehen in `service-oalab/supabase/migrations/202610250001_hub_schema.sql`; die Dateien in `supabase/migrations/` hier sind nur Herkunft.
- Bestehende Service-Konten bekamen ein aktives Hub-Profil (`source = existing`); neue Registrierungen warten auf Freigabe.
- Hub-Konten und -Daten übernimmt `service-oalab/scripts/hub-import.mjs` mit der Zuordnung `hub_import_user_map` (Hub-ID → Ziel-ID). Gleiche E-Mail verbindet nicht stillschweigend: Das Service-Konto führt, der Fall wird vorher im Plan gezeigt.
- Rollen: Service liest nur `memberships`. Der Hub liest vorerst `app_metadata.app_role` und `hub_profiles.status`. Hub-Admin ist kein Release-Manager. Hub-Rollen aus `memberships` abzuleiten ist offen (Phase E).
- **Seit 31. Oktober 2026: ein Kundenstamm für Hub und Service** (Entscheidungen des Nutzers: alle Kontaktdaten in beide Richtungen; in Service eingeladene Logins brauchen im Hub weiter eine Freigabe; Servicepakete später angleichen):
  - Neue Kunden aus dem User Management (Kunden-Tab, neuer Kunde beim Login-Anlegen oder bei einer Freigabe) entstehen wie beim Assistenten zuerst als Service-Organisation (Paket wie Service es wählt, Protokoll `hub.customer_created` in `audit_events`); den Hub-Kunden legt Services Trigger an, danach bekommt er Pakete und Kontaktdaten. Seine Logins kommen über `service_access_from_hub` auf service.oalab.de. Scheitert ein späterer Schritt, nimmt `removeServiceCustomer` alles zurück (Mitgliedschaften zuerst, sonst baut Services Abgleich den Hub-Kunden neu).
  - Kundennummern neuer und verknüpfter Kunden haben Services Format `OA-` plus 4 bis 20 Großbuchstaben oder Ziffern; der Vorschlag folgt der Regel vom 29. Oktober 2026 (`OA-` und eine zufällige freie Zahl, auch gegen Nummern in Service geprüft). Unternehmen höchstens 160 Zeichen.
  - Firma und Nummer eines verknüpften Kunden schreibt der Hub in die Organisation, Services Trigger bringt sie zurück. Kontaktdaten (E-Mail, Telefon, Website, Anschrift) gleicht die Migration `202610310001_hub_customer_contact_sync.sql` in `service-oalab` mit `business_customer_profiles` ab: Trigger in beide Richtungen, feldweise, nur direkte Änderungen (`pg_trigger_depth() = 1`), Autor über `hub_customers.updated_by`; die Anschrift wird als „Straße, PLZ Ort, Land“ geschrieben und zurück zerlegt. Ansprechpartner und interne Notizen bleiben in Service, Pakete sind noch getrennt (Hub: vier Website-Pakete, Service: `plans`). Die drei Demo-Kunden bleiben reine Hub-Kunden.
- Rückweg: altes Projekt im Supabase-Dashboard fortsetzen, Vercel-Umgebung des Hubs darauf zurückstellen und den vorigen Stand deployen; das alte Projekt wird nicht gelöscht. Keine alte Sicherung über neue Daten spielen.

**Seit 26. Oktober 2026: zweiter Faktor nach Wahl, Code per E-Mail oder Authenticator-App** (Nutzerentscheidungen: keine Kosten; zuerst nur Mail-Code, dann am selben Tag „Email oder Authenticator soll möglich sein“, fest pro Konto, jede Person stellt es im Profil ein; Supabase kennt Mail nicht als Faktor, SMS hätte 75 $ im Monat gekostet):

- Profil → „Zwei-Faktor-Schutz“: Aus, Code per E-Mail oder Authenticator-App (`app_metadata.second_factor`); Änderungen nur aus einer Sitzung, die den bisherigen Faktor bestätigt hat. Admins setzen im User Management auf E-Mail oder Aus zurück (entfernt die App). Testadressen ohne Postfach bekommen keinen Mail-Code.
- E-Mail: Passwort → Code an die Login-Adresse (10 Minuten, 5 Versuche, „Neuen Code senden“) → `/auth/mfa` → die Sitzung ist in `oalab_mail_code_sessions` bestätigt, der Hook `public.oalab_access_token_hook` stellt ihre Tokens mit `aal2` aus (höchstens 30 Tage). App: Code aus der App, Supabase MFA hebt die Sitzung selbst auf `aal2`. Service verlangt `aal2` für Team-Rollen und schickt diese Konten zur Code-Seite des Hubs.
- Passwort zurücksetzen: bei E-Mail zählt der Link als Code, bei App braucht es den App-Code (Supabase verlangt ihn), bei Aus keinen Code.
- Fund vom 5. November 2026 (Freelancer-Login kam nicht rein): Codes wurden richtig ausgestellt und geprüft, eingegeben wurde ein älterer Code. Alle Code-Mails hießen gleich, Mail-Apps stapelten sie und zeigten einen älteren zuerst; das Senden dauert außerdem rund 15 Sekunden. Seitdem trägt der Betreff die Uhrzeit der Anforderung („Dein Sicherheitscode für oalab · 01:04 Uhr“, der Code selbst bleibt draußen), Vorschauzeile und Code-Hinweis nennen, bis wann er gilt, und die Code-Seite sagt, aus welcher Mail der gültige Code stammt (Zeit von `oalab_mail_codes.created_at`). Freelancer lesen in Mail und Code-Seite nur vom Hub, nicht von der Serviceplattform.
- Stand 26.10.2026: Migration `202610260001_mail_second_factor.sql` angewendet (direkte TLS-Verbindung, in `supabase_migrations.schema_migrations` eingetragen; `pnpm db:push` scheitert unter Windows am fehlenden CLI-Binary), Hook im Dashboard eingeschaltet, App-Faktoren (TOTP) bleiben in Supabase an. Geprüft mit einem Service-Testkonto: Tokens werden mit Hook normal ausgestellt (`aal1`), nach bestätigtem Code trägt das erneuerte Token `aal2`. info@oalab.de steht nur noch auf „Code per E-Mail“: Der Kontoinhaber besitzt keine Authenticator-App, die alte App aus Service wurde am 26.10.2026 auf seinen Wunsch entfernt (Admin-Protokoll `user.second_factor_email`). Die beiden alten Service-Testkonten `oalab-ops-…@example.invalid` und `oalab-admin-…@example.invalid` (zuletzt 16.08.2026 angemeldet) haben eine App, aber kein Postfach.

Bis zur Umstellung verwies die lokale Umgebung auf das Supabase-Projekt mit dem Ref:

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
- `npm test` umfasst 81 Tests für Auth-Weiterleitungen, Seed-Konfiguration, Demo-Zugriffsregeln, lokales Ein-Klick-Login, gemeinsames Branding, die öffentliche Signatur-/Origin-Policy, Kontrast und Darstellungslogik des Hubs sowie die Regeln, RLS-Migration und Musterdateien des Dateiaustauschs, die Kalenderregeln (Zeitzone und Sommerzeit, freie Slots, Teams-Links), die RLS-Migration des Kalenders, die Projekt-Terminierungen, Suche und Sortierung der Tabellen, das User Management (Eingaberegeln, Migration, Admin-Prüfungen), die E-Mail-Benachrichtigungen (Vorlagen, SMTP-Zugang und -Nachricht, Versandprotokoll, Supabase-Vorlagen) sowie KI-Assistent und WhatsApp-Anbindung unter Node.js 24. In Windows-Checkouts mit `core.autocrlf=true` schlägt der Musterdatei-Test fehl, weil Git die Beispiel-PDFs auf CRLF umstellt (siehe Aufräumbedarf).
- `npm run demo:verify` besteht für alle vier echten Logins inklusive Rolle, Workspace und Abmeldung.
- `npm run demo:smoke` besteht für alle vier Dashboard-Datensichten, fremde Projekt-IDs und den Schutz vor unangemeldetem Zugriff.
- Alle vier lokalen Ein-Klick-Logins und der Kontowechsel sind im Browser geprüft. Produktion ohne öffentliche Freigabe verweigert Demo-POSTs mit 404. `npm run demo:public:smoke -- --local` besteht im explizit freigegebenen Produktionsmodus für alle vier Fixture-Identitäten, Kundentrennung, Abmeldung, Host-/Origin-Prüfung und die Grenze zu echten Auth-Routen. Passwörter fehlen in HTML, Browser-Assets und Deployment-Traces.
- Öffentliche Demo am 15. Oktober 2026 auf der Vercel-Hauptadresse bereitgestellt. `npm run demo:public:smoke` besteht live für alle vier Identitäten. Alle vier Zugänge und der Kontowechsel sind zusätzlich im Live-Browser geprüft; mobile Auswahl bei 390 Pixeln ohne horizontalen Überlauf. Änderungen und Betriebsanleitung sind auf `main` versioniert, die privaten Werte ausschließlich in Vercel beziehungsweise lokal.
- `next` und `eslint-config-next` sind fest auf Version 16.4.2 gepinnt (Sicherheitsupdate für GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr und GHSA-p3m5-59mp-jv5r). `eslint.config.mjs` nutzt die native Flat Config von `eslint-config-next` (`core-web-vitals` und `typescript`) einschließlich der Regeln aus `eslint-plugin-react-hooks` 7.
- `npm audit` meldet noch 3 mittlere Funde, alle über Tailwind CSS 3: `postcss-selector-parser` (GHSA-rj75-hqrm-r3gf) sowie darüber `postcss-nested` und `tailwindcss`. `npm audit --omit=dev` ist ohne Befund. Beheben lässt sich das nur mit Tailwind CSS 4. Das `braces`-Advisory GHSA-vfj7-8cjw-p6xm, auf das die übrigen hohen Funde zurückgingen, hat GitHub am 23. Oktober 2026 zurückgezogen.
- `@supabase/ssr` und `@supabase/supabase-js` werden weiterhin mit `latest` statt mit einer festen Version deklariert.
- Browserprüfung: Desktop und Mobilgerät, Navigation, Filter, Suche, Dateidialoge und unangemeldeter Zugriff; echter Admin-Login, neun Projekte, Kundenfilter, Abmeldung und Wechsel zwischen Kundenkonten. An-/Abmeldung verwerfen alte Client-Router-Zustände.

### Technischer Aufräumbedarf

- [x] ESLint-Konfiguration um generierte Verzeichnisse ergänzen
- [x] `eslint-config-next` an die installierte Next.js-Version angleichen
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
- [x] Rechtliche Seiten: Impressum und Datenschutzerklärung als eigene Seiten im Hub (4. November 2026).

### Betrieb und Datenschutz

- [x] Aktuelle Test-/Main-Adresse: `https://oalab-client-hub.vercel.app/`; eine eigene finale Domain ist noch offen.
- [x] Bestehendes Vercel-Projekt `oalabs-projects/oalab-client-hub`, Produktion aus `main`; Details in README.
- [ ] Welche Anforderungen gelten für DSGVO, Aufbewahrung und Löschung?
- [ ] WhatsApp: Datenschutzerklärung um die WhatsApp-Anbindung ergänzen (Meta als Dienstleister, gespeicherte Nummer, Verlauf 48 Stunden) und die Meta-Bedingungen zur Datenverarbeitung prüfen.
- [x] KI-Assistent: DPA mit Anthropic geregelt (28. Oktober 2026), USA über Standardvertragsklauseln; der Abschnitt zum Assistenten steht seit dem 4. November 2026 in der Datenschutzerklärung des Hubs. Offen bleibt die Löschfrist für das KI-Protokoll.
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
