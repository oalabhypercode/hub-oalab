# Planung: oalab als eigenes Unternehmen im Hub

Stand 24. November 2026 · Etappe 1 gebaut auf `feat/oalab-unternehmen` (Hub) und `feat/hub-team-entry` (service-oalab), PRs offen, noch nicht live (Abschnitt 11) · Entscheidungen 1 bis 10 am 23. November 2026 wie empfohlen getroffen (Abschnitt 9)

Dieser Plan beschreibt den Wunsch vom 23. November 2026: Als Admin gehörst du zu keinem Unternehmen und kannst deshalb für oalab selbst keine Projekte, keine Aufgaben und keine Notizen anlegen. oalab soll ein eigenes Unternehmen im Hub werden, in dem das Team untereinander mit denselben Werkzeugen arbeitet wie mit Kunden und Freelancern: Projekte und Aufgaben anlegen, Notizen schreiben und freigeben.

Kurz gesagt: **Du hast recht.** Abschnitt 1 zeigt, woran es im Einzelnen liegt. Die gute Nachricht: Das Fundament ist schon da. Die Serviceplattform führt das oalab-Team bereits als eigene Organisation, und das Studio nimmt dort Projekte an. Es fehlt nur der passende Eintrag im Hub und dass der Hub ihn überall richtig behandelt.

Grundlage ist der Code auf `main` vom 23. November 2026 (nach #160) und die Migrationen in `service-oalab` bis `202611230002_hub_notes_access`.

## Feste Regel: Hub und Service bleiben getrennt

- Interne Projekte und Aufgaben liegen in denselben Studio-Tabellen wie die Projekte der Kunden (`customer_projects`, `studio_*`). So arbeitet der Hub heute schon bei jedem Projekt; an der Trennung ändert das nichts.
- Nichts aus diesem Plan legt auf der Serviceplattform eine Anfrage oder Nachricht an, zählt auf ein Service-Kontingent, bucht etwas oder stößt die KI der Serviceplattform an. Es entsteht dort keine neue Organisation, und oalab bekommt kein Paket.
- Der private Chat bleibt, wie er ist. oalab bekommt keinen eigenen Chat (Entscheidung 9).
- Die einzige Berührung mit Zugängen der Serviceplattform ist die Team-Rolle für neue Admins (Entscheidung 4). Wer sie hat, arbeitet auf der Serviceplattform auch an Anfragen mit. Deshalb ist sie eine eigene, ausdrückliche Entscheidung und kein Nebeneffekt.

## Auf einen Blick

| Frage | Vorschlag |
|---|---|
| Hast du recht? | Ja. Projekte, Aufgaben, Notizen, Dateien und Freelancer hängen im Hub immer an einem Unternehmen, und oalab ist keins; die Datenbank lässt bei Notizen und Freelancern sogar nur Kunden zu (Abschnitt 1) |
| Die Idee | oalab wird **ein** fester Eintrag der neuen Art „Team“, verbunden mit der oalab-Organisation, die es auf der Serviceplattform schon gibt (Abschnitt 2) |
| Wer gehört dazu? | alle aktiven Admins, automatisch; Kunden und Freelancer nie (die Datenbank verhindert das) |
| Wo erscheint oalab? | ganz oben in „Projekte“, im Aufgaben-Board, in „Notizen“ und unter „Zugänge“, mit dem Zeichen „Intern“ |
| Wo nie? | Chat, Vertrag & Domain, Pakete und Kontingent, Service, Schlüsselbund, Import, Archivieren und Löschen, Kundenzahlen |
| Freigeben | intern sehen alle Admins alles (wie heute bei Kunden); „Team informieren“ meldet eine Notizseite an die Kollegen; Freelancer bekommen nur, was du freigibst |
| Neue Kollegen | „Admin anlegen“ gibt es schon; neu: Häkchen „Darf Projekte und Aufgaben bearbeiten“ für die nötige Team-Rolle im Studio (Entscheidung 4) |
| Kunden | merken nichts: Sie sehen nichts von oalab, und ihre Ansichten ändern sich nicht |
| Etappen | 1 Projekte und Aufgaben · 2 Notizen und Dateien · 3 Freelancer bei internen Projekten |
| Umfang | Etappe 1 mittel bis groß (Migration in `service-oalab` und ein PR im Hub), Etappe 2 mittel, Etappe 3 klein |

## 1. Befund: Hast du recht?

Ja. Im Einzelnen:

- **„Zugänge“ zeigt oalab nur als Ansicht.** Seit dem 21. November 2026 steht dort eine Gruppe „oalab“ mit allen Admins und „Admin anlegen“. Sie wird aber nur beim Anzeigen aus den Admin-Zugängen gebildet (`groupLoginsByCompany` in `lib/hub-users/company-groups.ts`); dahinter steht kein Eintrag. Admins gehören bewusst zu keinem Unternehmen. Damals so entschieden, weil ein echter Eintrag eine Migration gebraucht hätte, eine Organisation auf der Serviceplattform ergeben hätte und jede Kundenauswahl ihn hätte ausblenden müssen. Abschnitt 2 löst genau diese drei Punkte.
- **Projekte brauchen einen Kunden.** „Neues Projekt“ (`createProjectAs` in `lib/hub-projects/write.ts`) nimmt nur Einträge der Art „Kunde“ mit einer aktiven Organisation auf der Serviceplattform. oalab ist weder Eintrag noch Kunde, also gibt es kein internes Projekt.
- **Aufgaben brauchen ein Projekt.** Jede Karte im Board gehört zu einem Studio-Projekt. Ohne internes Projekt keine interne Aufgabe; genau das ist dir aufgefallen.
- **Notizen sind in der Datenbank an Kunden gebunden.** `hub_note_pages` hat einen Fremdschlüssel auf das Unternehmen und lässt nur die Art „customer“ zu. Auch der Hub bietet in „Notizen“ nur Kunden zur Auswahl.
- **Freelancer betreuen nur Kunden.** `hub_freelancer_customers` lässt ebenfalls nur die Art „customer“ zu, und ein Freelancer kommt nur auf Projekte von Kunden, die er betreut.
- **Dateien, Chat, Vertrag & Domain** hängen jeweils an einem Kunden.
- **Nur der Kalender** kommt ohne Unternehmen aus: Termine ohne Kunde (interne Termine) gehen schon heute. Eine Besprechungsnotiz dazu aber nicht, weil Notizen einen Kunden brauchen.
- **Neue Admins können noch keine Aufgaben schreiben.** Projekte und Aufgaben speichert der Hub mit dem eigenen Konto im Studio, und das verlangt eine Team-Rolle auf der Serviceplattform. „Admin anlegen“ gibt diese Rolle nicht mit. Ein neuer Kollege bekäme deshalb heute „Speichern abgelehnt: Dein Konto braucht im Studio eine Team-Rolle …“, und das Board bietet ihn nicht als Zuständigen an.

Was schon da ist:

- Die Serviceplattform führt das oalab-Team als eigene Organisation der Art „oalab“. Daran hängen die Team-Rollen (Admin, Operator, Release-Management), mit denen das Studio Projekte und Aufgaben erlaubt.
- Das Studio nimmt Projekte auf dieser Organisation ohne Änderung an: Weder `customer_projects` noch die `studio_*`-Tabellen fragen nach der Art der Organisation, und das Team darf dort alles.
- Kunden können dort nie Mitglied werden: Die Datenbank lehnt Kundenrollen in der oalab-Organisation ab. Ein internes Projekt ist deshalb für keinen Kunden sichtbar, selbst wenn jemand „Für den Kunden sichtbar“ anschalten würde.
- Board und Projektliste der Admins lesen schon heute jedes Projekt, egal zu welcher Organisation es gehört.
- Im Live-Hub gibt es am 23. November 2026 keinen Eintrag für oalab selbst (nur Testeinträge) und kein internes Projekt.

## 2. Die Idee: oalab wird ein Eintrag der Art „Team“

**Ein fester Eintrag.** Neben „Kunde“ und „Freelancer“ bekommt `hub_customers` eine dritte Art: „Team“. Davon gibt es genau einen, und er gehört zur vorhandenen oalab-Organisation der Serviceplattform. Name und Nummer kommen von dort und bleiben im Gleichschritt, wie bei Kunden. Das Logo pflegst du im Hub. Archivieren und Löschen gehen nicht.

**Mitglieder.** Alle aktiven Admins gehören automatisch dazu. Es gibt keine eigene Mitgliederliste: Wer Admin ist, ist im oalab-Team, wer es nicht mehr ist, ist raus. Kunden- und Freelancer-Zugänge können nie Mitglied werden; die Datenbank lehnt das ab. Das schützt alles Interne vor Kunden.

**Warum eine eigene Art und kein „normaler Kunde“?** Ein Kunde „oalab“ bekäme Pakete, ein Service-Kontingent, einen Chat, Vertrag & Domain und Zugang zur Serviceplattform als Kunde, und er stünde in jeder Kundenliste und jeder Kundenzahl. Mit der Art „Team“ lehnen die Tabellen, die nur für Kunden gedacht sind (Pakete, Verlauf, Domains, Mailserver, Postfächer), oalab schon in der Datenbank ab. Freigeschaltet wird nur, was gewollt ist: Projekte, Aufgaben, Notizen, Dateien und Freelancer.

**Was nicht geht und warum:**

- Nur Projekte auf der oalab-Organisation ohne Eintrag im Hub: Projekte und Aufgaben gingen, Notizen, Dateien und Freelancer nicht, weil sie einen Eintrag brauchen.
- Eigene Tabellen für „Internes“: würde Projekte, Board, Notizen und Dateien ein zweites Mal bauen.

**Wo oalab erscheint:**

| Bereich | So sieht es aus |
|---|---|
| Zugänge | Die Gruppe „oalab“ wird der echte Eintrag: mit Logo und Nummer, Zahnrad für das Logo, darunter alle Admins, „Admin anlegen“ wie heute |
| Projekte | „oalab“ steht ganz oben in der Liste links, mit dem Zeichen „Intern“; „Neues Projekt“ geht dort wie bei Kunden. Ohne Domains, Pakete und Service, ohne „Für den Kunden sichtbar“ |
| Aufgaben | Interne Projekte stehen mit „oalab · Intern“ im Board und lassen sich danach filtern; Zuständige sind das Team (und in Etappe 3 Freelancer) |
| Notizen | „oalab“ ganz oben in der Liste (Etappe 2), mit „Sichtbar für“ nur „Nur Team“ oder „Team und Freelancer“ |
| Dateien | eine Gruppe „oalab“ im Asset Management für eigene Dateien (Etappe 2, Entscheidung 8) |
| Kalender | interne Termine bleiben ohne Kunde; ihre Besprechungsnotiz landet bei oalab (Etappe 2, Entscheidung 7) |
| Übersicht, Insights | interne Projekte zählen bei den Projekten mit und tragen „Intern“; bei den Kunden zählt oalab nicht |

**Wo oalab nie erscheint:** im privaten Chat und bei „Kunden anschreiben“, im Reiter „Service“, unter Vertrag & Domain, bei Paketen und Kontingent, im Schlüsselbund, beim Import aus der Buchhaltung, bei Archivieren und Löschen, in der Kundenauswahl eines Termins und in allen Kundenzahlen. Für Kunden ist oalab unsichtbar; Freelancer sehen oalab erst, wenn du sie in Etappe 3 dazuholst.

## 3. Etappe 1: Grundlage, Projekte und Aufgaben

### 3.1 Zugänge

- Die Gruppe „oalab“ zeigt das Logo des Eintrags (sonst „OA“ wie heute), seine Nummer und „Team“ statt „Admin“ als Art.
- Das Zahnrad öffnet das Logo-Fenster wie bei Kunden. Name und Nummer kommen von der Serviceplattform und lassen sich im Hub nicht ändern; Kontaktdaten wie bei Kunden hat der Eintrag nicht.
- „Admin anlegen“ bleibt, wo es ist. Neu ist das Häkchen „Darf Projekte und Aufgaben bearbeiten“ (Abschnitt 3.5).

### 3.2 Projekte

- „oalab“ steht in „Projekte“ immer ganz oben, vor den Kunden, auch ohne Projekt, mit dem Zeichen „Intern“.
- „Neues Projekt“ legt das Projekt auf der oalab-Organisation an, sonst genau wie bei Kunden: Name, Status, Beschreibung, Start, Zieltermin, Meilensteine. Es erscheint sofort im Studio, im Board und im Kalender (Projektziel).
- Es fehlen nur Dinge, die intern keinen Sinn haben: „Für den Kunden sichtbar“, Domains und Links des Kunden, Pakete, Kontingent und Service-Anfragen.

### 3.3 Aufgaben

- Interne Projekte stehen im Board mit „oalab · Intern“. Aufgaben anlegen, zuweisen, verschieben, Checklisten und Kommentare funktionieren wie bei Kundenprojekten.
- Zuständig sein kann jeder mit Team-Rolle im Studio. „Für Kunden freigeben“ fehlt bei internen Aufgaben; „Nur Team“ bleibt für Etappe 3 (Freelancer).
- Die Glocke meldet neue und geänderte Aufgaben wie bei Kundenprojekten.

### 3.4 Überall sonst ausgeblendet

Der Hub liest Unternehmen an gut 30 Stellen. Etappe 1 geht sie alle durch und entscheidet je Stelle: oalab zeigen (Projekte, Board, Zugänge), als intern kennzeichnen (Übersicht, Insights, Kalender-Projektziele) oder ausblenden (alles aus „Wo nie“ in Abschnitt 2). Dazu gehören auch der Assistent Ali und der Claude-Connector (Abschnitt 6). Ein Test hält fest, dass oalab in keiner Kundenliste auftaucht.

### 3.5 Team-Rolle für neue Admins

- Heute braucht jeder, der Projekte oder Aufgaben bearbeitet, eine Team-Rolle im Studio, und die gibt es nur auf der Serviceplattform.
- Neu (wenn Entscheidung 4 so fällt): „Admin anlegen“ hat das Häkchen „Darf Projekte und Aufgaben bearbeiten“, vorbelegt an. Es gibt der Person die kleinste Team-Rolle, „Operator“. Im Reiter „Sicherheit“ eines Admins steht derselbe Schalter, damit sich das später ändern lässt; dort steht auch, ob ein Admin die Rolle schon hat.
- Was „Operator“ auf der Serviceplattform heißt: Die Person arbeitet dort an Projekten, Aufgaben und **Anfragen** der Kunden mit. Live veröffentlichen darf sie nicht.
- Deaktivieren eines Admins setzt die Team-Rolle aus, Reaktivieren gibt sie zurück; Admin-Rechte weg heißt Team-Rolle weg. Rollen über Operator hinaus (Admin, Release-Management) vergibst du weiter auf der Serviceplattform.
- Nur Admins mit bestätigtem Code können das ändern, und jede Änderung steht im Admin-Protokoll. Claude kann es nicht (Rollen bleiben tabu).

### 3.6 Technik

Migration `202611230003_hub_team_entry.sql` in `service-oalab` (Nummer nach Prüfung aller Branches vergeben; Lehre vom 23. November 2026). Sie ändert keine bestehende Funktion, sondern ergänzt Regeln und Wächter:

- `hub_customers.kind` erlaubt zusätzlich `team`; der eindeutige Teilindex `hub_customers_one_team` lässt höchstens einen Eintrag dieser Art zu. Die Art bleibt nach dem Anlegen fest (vorhandener Wächter).
- Die Regel „Freelancer nie mit Organisation“ wird zu `hub_customers_organization_by_kind`: Freelancer ohne Organisation, Team mit Organisation.
- Der Wächter `hub_customers_team_guard` prüft, dass der Team-Eintrag auf der oalab-Organisation liegt und ein Kunde nie, und lehnt Archivieren, Löschen und Umhängen des Team-Eintrags ab. Damit scheitern auch `hub_archive_customer` und `hub_delete_customer` an ihm, bevor sie die oalab-Organisation archivieren könnten; `hub_restore_customer` ändert nichts.
- `hub_customer_members_never_team` lehnt jede Mitgliedschaft im Team-Eintrag ab. Admins gehören über ihre Rolle dazu; so kann nie ein Kunden- oder Freelancer-Zugang hineinrutschen.
- Der Trigger `hub_customer_contact_to_service` bekommt `when (new.kind <> 'team')`: Kontaktdaten des Team-Eintrags gehen nicht an die Serviceplattform. Der Abgleich `hub_sync_service_organization` bleibt unverändert; er fasst Mitglieder einer Organisation, die kein Kunde ist, ohnehin nur zum Entfernen an, und der Team-Eintrag hat keine.
- `hub_team_entry_follows_organization` hält Name und Nummer des Team-Eintrags aktuell, wenn die oalab-Organisation umbenannt wird.
- Die Migration legt den Eintrag aus der oalab-Organisation an. Gibt es nicht genau eine aktive, bricht sie mit einer klaren Meldung ab, und nichts ist geändert.
- Am Studio ändert sich nichts. Weil die oalab-Organisation keine Kundenrollen zulässt, sieht kein Kunde ein internes Projekt; der Hub blendet den Schalter trotzdem aus und lehnt Freigeben ab.
- Rückweg in `supabase/rollbacks/`, Textprüfung `scripts/hub-team-entry.test.mjs`. Auf PGlite geprüft (50 Prüfungen, mit den echten Funktionen für Abgleich, Archivieren, Wiederherstellen und Löschen): ohne oder mit zwei aktiven oalab-Organisationen bricht die Migration ab; zweiter Team-Eintrag, Kunde auf der oalab-Organisation, Freelancer mit Organisation, Mitglieder im Team-Eintrag, Archivieren, Löschen, Umhängen und ein Paket für oalab werden abgelehnt, und die oalab-Organisation bleibt aktiv; Kontaktdaten des Team-Eintrags bleiben im Hub, die eines Kunden kommen wie bisher an; Umbenennen folgt; eine Team-Rolle für einen Kollegen ändert keine Mitgliedschaften; Kunden lassen sich weiter archivieren, wiederherstellen und löschen; der Rückweg stellt alles wieder her.

Im Hub:

- `customerKinds` in `lib/hub-users/rules.ts` kennt `team`; ein kleines Modul liest den Team-Eintrag fehlertolerant. Ohne Migration gibt es keinen, und der Hub sieht aus wie vorher.
- `createProjectAs` nimmt den Team-Eintrag an (Organisation der Art „oalab“), `loadProjectDesk` stellt ihn als erste Zeile ohne Pakete, Kontingent, Anfragen und Domains dazu; Panel und „Neues Projekt“ blenden „Für den Kunden sichtbar“ aus.
- Board: Kennzeichen „Intern“ und Filter.
- Zugänge: Gruppe „oalab“ aus dem Eintrag, Stammdaten mit Logo.
- Team-Rolle (Abschnitt 3.5): Mitgliedschaft der Rolle „Operator“ in der oalab-Organisation, geschrieben mit dem Server-Schlüssel nach der Admin-Prüfung (`lib/hub-team/server.ts` `changeTeamRole`); Protokoll `user.team_role_grant`, `_revoke`, `_pause` und `_resume`.
- Durchsicht aller Stellen aus Abschnitt 3.4, Wissen des Assistenten (`lib/hub-assistant/knowledge.ts`), `PROJECT_CONTEXT.md`, Patch Notes (nur für Admins, „Intern“), Tests mit Beispieldaten.

## 4. Etappe 2: Notizen und Dateien für oalab

### 4.1 Notizen

- „oalab“ steht in „Notizen“ ganz oben. Seiten, Unterseiten, Vorlagen, Aufgaben-Blöcke, Verlauf, Suche und Papierkorb funktionieren wie bei Kunden. Aufgaben-Blöcke und Projekt-Verweise zeigen die internen Projekte.
- „Sichtbar für“ hat bei oalab nur „Nur Team“ (Standard) und „Team und Freelancer“. „Mit … teilen“ unter dem Titel neuer Seiten entfällt, weil es keinen Kunden gibt.
- Alle Admins sehen und bearbeiten alle internen Seiten, wie heute bei Kunden (Entscheidung 5).

### 4.2 Kollegen informieren

- Statt „Änderung mitteilen“ an den Kunden gibt es bei internen Seiten „Team informieren“: Die anderen Admins bekommen eine Zeile in der Glocke („… hat ‚Seitentitel‘ geteilt“), auf Wunsch mit einem kurzen Satz dazu. Du selbst bekommst keine.
- So wird „freigeben“ intern spürbar, obwohl alle ohnehin alles sehen.

### 4.3 Besprechungsnotiz zu internen Terminen

- Hat ein Termin keinen Kunden, legt „Notiz anlegen“ im Terminfenster die Besprechungsnotiz bei oalab an, mit der Vorlage aus den Einstellungen und „Nur Team“. Heute geht das bei internen Terminen gar nicht.

### 4.4 Dateien

- Im Asset Management gibt es eine Gruppe „oalab“ für eigene Dateien, etwa eigene Verträge, Markenmaterial oder Vorlagen; hochladen, Ordner und Umbenennen wie bei Kunden.
- „Sichtbar für“ heißt hier „Nur Team“ oder „Team und Freelancer“. Bilder daraus stehen auch als Titelbilder interner Notizseiten zur Wahl.

### 4.5 Technik

- Migration: `hub_note_pages` lässt neben Kunden auch den Team-Eintrag zu (ein Trigger setzt die Art aus dem Eintrag); der Wächter erlaubt für den Team-Eintrag nur „Nur Team“ und „Nur Freelancer“ und eine Besprechungsnotiz auch zu Terminen ohne Kunde. Die Glocke kennt eine neue Art `note.team` (oder nutzt `note.changed` mit Admins als Empfänger; beim Bau festlegen).
- Hub: Notizen-Liste, Zahnrad und Kapsel mit den internen Wahlmöglichkeiten, „Team informieren“, Terminfenster, Asset Management.

## 5. Etappe 3: Freelancer bei internen Projekten

- Unter „Betreut von“ kannst du Freelancer auch oalab zuordnen. Danach lassen sie sich auf interne Projekte setzen und sehen dort die Aufgaben ohne „Nur Team“, wie bei Kunden.
- Interne Notizseiten und Dateien mit „Team und Freelancer“ sehen sie, alles mit „Nur Team“ nie.
- In der Sicht des Freelancers steht oalab unter „Deine Kunden“ als „oalab · Intern“.
- Technik: `hub_freelancer_customers` lässt den Team-Eintrag zu. Die Regeln für Projekte, Board, Notizen und Dateien gelten danach unverändert, weil sie alle über diese Zuordnung laufen.

## 6. Claude und Ali

- Der Claude-Connector findet oalab mit `search` als „oalab (intern)“. `create_project`, `create_tasks`, `update_task`, `create_note` und die übrigen Werkzeuge für Projekte, Aufgaben und Notizen funktionieren damit wie bei Kunden. So kannst du in Claude sagen: „Leg eine interne Aufgabe ‚Angebot überarbeiten‘ im Projekt Website an.“
- Werkzeuge für Chat, Vertrag & Domain und Kontaktdaten lehnen oalab ab. Die Team-Rolle setzt Claude nie.
- Ali, der Assistent im Hub, bekommt dieselbe Abgrenzung.
- Freelancer mit Connector sehen oalab erst nach Etappe 3 und nur, was für sie freigegeben ist.

## 7. Etappen und Reihenfolge

| Etappe | Inhalt | Umfang | Datenbank | Patch Notes |
|---|---|---|---|---|
| 1 | Eintrag „oalab“, Zugänge, interne Projekte und Aufgaben, Team-Rolle für neue Admins | mittel bis groß: Migration in `service-oalab` und ein PR im Hub | ja | Neu, nur Admins |
| 2 | Notizen, „Team informieren“, Besprechungsnotiz zu internen Terminen, Dateien | mittel: Migration und ein PR | ja | Neu, nur Admins |
| 3 | Freelancer bei internen Projekten, Notizen und Dateien | klein: Migration und ein PR | ja | Neu, Admins und Freelancer |

- Reihenfolge 1 → 2 → 3. Etappe 1 zuerst, weil dein Wunsch dort anfing (Aufgaben für oalab).
- Beim Livegang jeder Etappe geht zuerst der PR des Hubs live; er liest den neuen Eintrag fehlertolerant und sieht ohne Migration aus wie vorher. Danach spielst du die Migration über den Coolify-Import ein, und oalab erscheint. So sieht kein alter Stand des Hubs den Team-Eintrag als Kunden.
- Keine eigene Designvorschau nötig: oalab erscheint in den bestehenden Ansichten als ein Eintrag mehr, im heutigen Design. Vor dem Merge gibt es Bildschirmfotos aus `/preview` (hell und dunkel, Rechner und Handy).

## 8. Datenschutz, Sicherheit und Trennung von Service

- Kunden sehen nichts Internes: Die Datenbank lässt keine Kunden- oder Freelancer-Zugänge als Mitglieder von oalab zu und keine Kundenrollen in der oalab-Organisation. Interne Projekte, Aufgaben, Notizen und Dateien erreichen deshalb keinen Kunden, auch nicht durch einen Fehler im Hub.
- Freelancer sehen Internes erst nach einer ausdrücklichen Zuordnung (Etappe 3) und nur, was „Team und Freelancer“ trägt.
- Die Tabellen nur für Kunden (Pakete, Verlauf, Domains, Mailserver, Postfächer) lehnen oalab in der Datenbank ab.
- Hub und Service bleiben getrennt (siehe „Feste Regel“): keine Anfrage, keine Nachricht, kein Kontingent, keine KI, keine neue Organisation. Die einzige neue Berührung ist die Team-Rolle aus Entscheidung 4.
- Das Repo des Hubs ist öffentlich: Tests und Vorschau nutzen nur Beispieldaten, keine echten Namen.

## 9. Entscheidungen

Am 23. November 2026 entschieden: alle zehn wie empfohlen („Ja, Etappe 1 bauen“ auf die Frage, ob Etappe 1 mit den Empfehlungen gebaut werden soll).

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Wird oalab ein eigener Eintrag der Art „Team“, verbunden mit der vorhandenen oalab-Organisation der Serviceplattform, statt eines „normalen Kunden“? | Ja: keine neue Organisation, keine Pakete, kein Chat, und die Datenbank hält Kundendinge von selbst fern |
| 2 | Wer gehört zu oalab? | Alle aktiven Admins automatisch, ohne eigene Mitgliederliste; Kunden und Freelancer nie |
| 3 | Braucht es Mitarbeiter mit weniger Rechten als ein Admin, die nur Internes sehen? | Nicht jetzt. Heute sieht jeder Admin alle Kunden; eine eingeschränkte Rolle wäre ein eigener, größerer Plan |
| 4 | Bekommen neue Admins mit „Admin anlegen“ die Team-Rolle „Operator“ im Studio (nötig für Projekte und Aufgaben)? Folge: Sie arbeiten auf der Serviceplattform auch an Anfragen der Kunden mit. | Ja, als Häkchen „Darf Projekte und Aufgaben bearbeiten“, vorbelegt an, später per Schalter änderbar. Beispiel: Du legst eine Kollegin als Admin an; ohne Häkchen kann sie Notizen schreiben, aber keine Aufgabe anlegen oder übernehmen |
| 5 | Sehen intern alle Admins alles, oder braucht es private Seiten und Projekte („Nur ich“)? | Alle sehen alles, wie heute bei Kunden; „Nur ich“ später, falls es fehlt |
| 6 | „Team informieren“ bei internen Notizseiten: Meldung in der Glocke der anderen Admins? | Ja, wie „Änderung mitteilen“ bei Kunden |
| 7 | Besprechungsnotizen zu internen Terminen (ohne Kunde) landen bei oalab? | Ja |
| 8 | Eigene Dateien für oalab im Asset Management? | Ja, in Etappe 2 |
| 9 | Bekommt oalab einen Chat (etwa einen Team-Chat unter „Nachrichten“)? | Nein. Ein Chat mit sich selbst ergibt keinen Sinn; ein Team-Chat wäre ein eigener Wunsch |
| 10 | Freelancer auch bei internen Projekten, Notizen und Dateien (Etappe 3)? | Ja, nach Etappe 2 |

## 10. Abnahme

Für alle Etappen:

- Ein Kunde sieht nach jeder Etappe genau dasselbe wie vorher: keine internen Projekte, Aufgaben, Notizen oder Dateien, keine geänderten Zahlen.
- Keine Etappe legt auf der Serviceplattform eine Anfrage, Nachricht oder Buchung an; das Service-Kontingent bleibt unverändert, der Reiter „Service“ zeigt dasselbe wie vorher.
- Ohne Migration sieht der Hub aus wie vorher.

Etappe 1:

- Unter „Zugänge“ trägt die Gruppe „oalab“ Logo und Nummer, das Zahnrad öffnet die Stammdaten, „Admin anlegen“ funktioniert.
- In „Projekte“ steht oalab ganz oben mit „Intern“. „Neues Projekt“ legt ein internes Projekt an; es steht im Studio, im Board und mit seinem Zieltermin im Kalender, ohne „Für den Kunden sichtbar“, Domains, Pakete und Service.
- Im Board lassen sich interne Aufgaben anlegen, zuweisen, verschieben und kommentieren; der Filter „Intern“ zeigt nur sie.
- oalab steht nicht im Chat, nicht bei „Kunden anschreiben“, nicht unter Vertrag & Domain, nicht in der Kundenauswahl eines Termins, nicht im Schlüsselbund, nicht beim Import und zählt nicht als Kunde.
- Datenbank: Ein zweiter Team-Eintrag, ein Mitglied im Team-Eintrag, Archivieren, Löschen sowie Paket, Domain und Postfach für oalab werden abgelehnt.
- Team-Rolle: Eine neu angelegte Kollegin mit Häkchen legt nach „Mit Code bestätigen“ eine Aufgabe an und steht als Zuständige zur Wahl; ohne Häkchen kommt die klare Meldung, und das Board bietet sie nicht an. Deaktivieren setzt die Rolle aus; beides steht im Admin-Protokoll.
- Claude findet „oalab (intern)“ und legt dort ein Projekt und Aufgaben an; `get_contract` und `send_chat_message` lehnen oalab ab.

Etappe 2:

- In „Notizen“ steht oalab oben; eine neue Seite startet mit „Nur Team“; „Sichtbar für“ bietet nur „Nur Team“ und „Team und Freelancer“.
- „Team informieren“ bringt den anderen Admins eine Zeile in die Glocke, dem Absender keine.
- Bei einem Termin ohne Kunde legt „Notiz anlegen“ die Besprechungsnotiz bei oalab an.
- Im Asset Management lassen sich Dateien bei oalab hochladen, ordnen und als Titelbild interner Seiten wählen.

Etappe 3:

- Ein Freelancer, der oalab betreut, lässt sich auf ein internes Projekt setzen und sieht dort alle Aufgaben außer „Nur Team“.
- Er sieht interne Seiten und Dateien mit „Team und Freelancer“, keine mit „Nur Team“, und oalab steht bei ihm unter „Deine Kunden“ als „oalab · Intern“.
- Ein Freelancer ohne Zuordnung sieht von oalab nichts, auch nicht über den Connector.

## 11. Umsetzung Etappe 1 (23. November 2026)

Gebaut am 23. November 2026 nach „Ja, Etappe 1 bauen“, noch nicht live:

- `service-oalab`, Branch `feat/hub-team-entry`: Migration `202611230003_hub_team_entry.sql`, Rückweg und Textprüfung (Abschnitt 3.6). Alle 140 Skript-Tests grün.
- Hub, Branch `feat/oalab-unternehmen` auf dem Plan:
  - `lib/hub-team/rules.ts` (Art „team“, Zeichen „Intern“, Zustände der Team-Rolle) und `lib/hub-team/server.ts` (`loadTeamEntry`, `loadTeamRoles`, `changeTeamRole`).
  - Projekte: `createProjectAs` nimmt den Team-Eintrag an und legt nie für Kunden sichtbar an, `saveProjectDetailsAs` lehnt Freigeben bei internen Projekten ab; `Project.internal`, `DeskCustomer.team` mit Logo; die Projektseite zeigt oalab ganz oben unter „Intern“, ohne Service, Pakete, Domain-Eintrag und Sprünge zu Chat und Vertrag, und „Neues Projekt“ sowie die Projektleiste ohne „Für den Kunden sichtbar“.
  - Board: `BoardProject.internal` über die Art der Organisation, interne Projekte zuerst, „oalab · Intern“ in Auswahl und Kopf, kein „+ Kunde“ bei „Sichtbar für“.
  - Zugänge: Gruppe „oalab“ aus dem Eintrag (Logo, Nummer, „Team“), Zahnrad öffnet das Logo-Fenster; der Eintrag steht nicht unter „Kunden“. „Admin anlegen“ mit „Darf Projekte und Aufgaben bearbeiten“, „Sicherheit“ mit „Projekte und Aufgaben“ (`components/hub/screens/users-team.tsx`).
  - Ausgeblendet: Chat, Kundenwahl im Kalender, Asset Management, Kundenzahl der Übersicht; Vertrag & Domain, Schlüsselbund, Kontingent und Domains lehnten andere Arten schon ab. `writeCustomerAs` lehnt den Team-Eintrag ab (sonst würde er die oalab-Organisation umbenennen); Archivieren, Wiederherstellen und Löschen finden ihn nicht.
  - Claude und Ali: `internal: true` in `search` und `get_customer`, `create_project` für oalab, `entryOf` ohne oalab.
  - Patch Notes im Paket 31 vom 24. November 2026 (nur Admins; geht es später live, wandert das Paket auf diesen Tag), Wissen des Assistenten, `PROJECT_CONTEXT.md`, Test `tests/hub-team.test.mjs`. `tsc`, `lint` und alle Tests grün, auch nach dem Abgleich mit `main` (#161, #162).
- Livegang: erst den Hub-PR mergen (ohne Migration sieht der Hub aus wie vorher), dann die Migration über den Coolify-Import einspielen, danach live prüfen: oalab unter „Zugänge“ und „Projekte“, ein internes Testprojekt mit einer Aufgabe, und dass ein Kundenzugang davon nichts sieht. Zuletzt den PR in `service-oalab` mergen, damit Repository und Datenbank übereinstimmen.
- Importdatei: aus dem committeten Stand gebaut wie bei den Importen davor (eigene Transaktion als Rolle `oalab`, Version mit der Prüfsumme von `scripts/oalab-db.mjs`). Ein Wächter bricht ohne Änderung ab, wenn die Migration schon eingespielt ist, `202611230002` fehlt, es nicht genau eine aktive oalab-Organisation gibt, schon ein Hub-Eintrag an ihr hängt oder ihre Nummer vergeben ist. Auf PGlite so eingespielt, wie Coolify es tut: 43 Prüfungen grün, auch Rückweg und zweiter Lauf.
