# Pricing-Konzept: OALAB Service Lite und Service Max

Stand 5. November 2026 · Entwurf zur Entscheidung · alle Preise netto zzgl. Umsatzsteuer

Dieses Konzept schlägt Leistungsumfang und Preise für „OALAB Service Lite“ und „OALAB Service Max“ vor und ordnet die Domain-Pakete „OALAB Domain“ und „OALAB Domain & Mail“ ein. Die beiden bestehenden Serviceverträge bleiben vorerst, wie sie sind; Abschnitt 4 schlägt vor, wie Bestandskunden später umgestellt werden. Im Hub und auf service.oalab.de ist davon nichts umgesetzt.

Die Eckdaten der bestehenden Verträge stammen aus dem Auftrag; die Vertragstexte selbst wurden nicht eingesehen. Alle Marktpreise und Fremdkosten wurden am 05.11.2026 abgerufen (Quellen im Anhang).

## Auf einen Blick

| Paket | Monat | Jahr, im Voraus (−10 %) | Arbeitszeit je Kalendermonat | Anfragen je Monat | Reaktion |
|---|---|---|---|---|---|
| **Service Lite** | 60 € | 648 € | 30 Minuten | bis 5 | 2 Werktage |
| **Service Max** | 200 € | 2.160 € | 150 Minuten | bis 20 | 1 Werktag, bei Ausfall 4 Stunden |
| weitere Arbeitszeit (beide) | 95 € je angefangene 60 Minuten | kein Rabatt | | | |
| **Domain** | 12 € | 129,60 € | | | Störung 1 Werktag |
| **Domain & Mail** (bis 5 Postfächer) | 20 € | 216 € | | | Störung 1 Werktag |
| weitere Domain, weiteres Postfach | je 2 € | je 21,60 € | | | |

- **Rechnung:** Beide Service-Pakete erreichen den Bezug von 95 € pro Stunde, solange Kunden im Schnitt höchstens 68 % (Lite) bzw. 69 % (Max) ihrer Minuten nutzen. Schöpft ein Kunde jeden Monat alles aus, bleiben rund 75 € (Lite) bzw. 69 € (Max) pro Stunde.
- **Markt:** Lite liegt in der Mitte der Pakete mit 30 Minuten Arbeitszeit (49 bis 149 €). Max liegt auf der Preislinie der Pakete mit 120 Minuten (159 €), verlängert um 30 Minuten.
- **Upgrade:** Ab 91 Minuten Bedarf im Monat ist Max in jedem Monat 50 € günstiger als Lite plus Blöcke. Max lohnt sich also ab gut anderthalb Stunden Bedarf oder ab der sechsten Anfrage.
- **Bestand:** Beide heutigen Verträge liegen klar unter dem Bezug: Vertrag A bringt höchstens etwa 16 € pro Stunde, Vertrag B je nach Nutzung 35 bis 104 €.

### Wie gut sind die Vorschläge belegt?

| Vorschlag | Beleg | Einschätzung |
|---|---|---|
| 95 € je angefangene Stunde | sechs Anbieter mit festem Zusatzsatz von 90 bis 120 € (Median 97,50 €), Ratgeber nennen 80 bis 150 €, freelancermap im Schnitt 103 € | gut belegt |
| 10 % Rabatt bei Jahreszahlung | ein Anbieter mit genau 10 %, am Markt 8 bis 20 % | gut belegt |
| Lite: 60 € für 30 Minuten | vier Pakete mit 30 Minuten zwischen 49 und 149 € | Marktlage gut belegt; die interne Rechnung stützt sich auf geschätzten Aufwand ohne Ist-Daten |
| Max: 200 € für 150 Minuten | zwei Pakete mit 120 Minuten für 159 €, eines mit 2 Stunden und Hosting für 199 €, eines mit 4 Stunden und Hosting für 299 € | mittel: für 150 Minuten gibt es kein direktes Gegenstück; der Wert ist interpoliert und für eine saubere Upgrade-Grenze gewählt |
| Reaktionszeiten | Markt von 1 Stunde bis 2 Werktage | Markt gut belegt; ob zwei Personen 4 Stunden bei Ausfall zuverlässig halten, ist eine Einschätzung |
| Domain: 12 € | netcup-Kosten belegt; Hosting-Aufschlag am Markt 10 € bzw. 15 € (je ein Anbieter) | mittel |
| Domain & Mail: 20 € | Kosten belegt, Aufwand geschätzt; kein vergleichbares Agentur-Angebot für Mail gefunden | eher schwach |
| 5 und 20 Anfragen | Planungsstand; die Nutzung auf service.oalab.de ist nicht ausgewertet | offen |

## 1. Leistungsumfang

### 1.1 Service Lite und Service Max

| | Lite | Max |
|---|---|---|
| Für wen | Website mit gelegentlichen Änderungen: Öffnungszeiten, Texte, Bilder, Stellenanzeigen | Website mit regelmäßigen Änderungen, mehreren Ansprechpartnern oder Aktionen |
| Arbeitszeit je Kalendermonat | 30 Minuten | 150 Minuten |
| Service-Anfragen auf service.oalab.de | bis 5 je Monat | bis 20 je Monat |
| Grundpflege (unten) | inklusive, zählt nicht gegen die Minuten | inklusive, zählt nicht gegen die Minuten |
| Erste Rückmeldung mit Einschätzung | innerhalb von 2 Werktagen | innerhalb von 1 Werktag |
| Ausfall der Website, wenn oalab sie hostet | Beginn der Behebung innerhalb von 1 Werktag | Beginn innerhalb von 4 Stunden in der Servicezeit |
| Weitere Arbeitszeit | 95 € je angefangene 60 Minuten | 95 € je angefangene 60 Minuten |
| Ungenutzte Minuten | verfallen zum Monatsende | verfallen zum Monatsende |

**Servicezeit** ist Montag bis Freitag von 9 bis 17 Uhr deutscher Zeit, ohne gesetzliche Feiertage in NRW, also dieselben Zeiten wie bei den Terminanfragen im Hub. Reaktion heißt Rückmeldung mit Einschätzung und Termin, nicht Erledigung.

**Grundpflege:** Die vier geprüften Kundenseiten sind eigener Code (React mit Vite oder Next.js), keine WordPress-Seiten mit Plugins. Zur Grundpflege gehören Sicherheits- und Versionsupdates von Framework und Paketen, Build- und Funktionsprüfung nach Updates sowie die Überwachung von Erreichbarkeit, SSL-Zertifikat und Formularversand.

**Regeln für Minuten und Anfragen**

- Eine Anfrage ist ein Ticket auf service.oalab.de, unabhängig von ihrer Größe. Zusammengehörige Wünsche gehören in eine Anfrage.
- Gezählt wird die Arbeitszeit für eine Anfrage: Rückfragen, Umsetzung, Test, Veröffentlichung und Termine, erfasst in 5-Minuten-Schritten.
- Reicht die Restzeit absehbar nicht, schätzt oalab den Aufwand vorab. Ein weiterer Block beginnt erst nach Freigabe in Textform. Der Rest eines angefangenen Blocks gilt für weitere Anfragen im selben Monat.
- Fehler, die oalab verursacht hat, zählen nicht gegen die Minuten.
- Es gilt die Grenze, die zuerst erreicht ist: Anfragen oder Minuten.
- Auch bei Jahreszahlung gilt das Kontingent je Monat und wird nicht über das Jahr gesammelt.

**Nicht enthalten** (eigenes Angebot oder Abrechnung nach Aufwand):

- neue Funktionen, neue Seiten oder Bereiche, Redesign, weitere Sprachen
- Texte, Fotos, Grafiken, SEO-Kampagnen, Werbung, Social Media
- Lizenzen und Fremddienste, etwa Schriften, Bildrechte, Buchungs- oder Newsletter-Werkzeuge
- Rechtsberatung: Impressum und Datenschutzerklärung baut oalab ein, für den Inhalt ist der Kunde zuständig
- die IT des Kunden: Rechner, Telefon, Microsoft 365 und Server anderer Anbieter; bei Hosting beim externen IT-Dienstleister dessen Server, Sicherungen und Mail
- Arbeit außerhalb der Servicezeit und Notdienst am Wochenende
- Wiederherstellung nach Fehlern oder fremden Zugriffen auf Kundenseite, etwa bei gestohlenen Zugangsdaten des Kunden
- Umbau auf Barrierefreiheit als Projekt
- Übertrag ungenutzter Minuten

**Einmalig:** Für Websites von oalab gibt es keine Einrichtungsgebühr. Eine fremde Website in Lite oder Max aufzunehmen (Code sichten, Zugänge, Veröffentlichung einrichten) und ein Mail-Umzug von einem anderen Anbieter werden nach Aufwand abgerechnet, Richtwert ein bis zwei Blöcke.

### 1.2 Domain und Domain & Mail

| | Domain | Domain & Mail |
|---|---|---|
| Enthalten | eine Domain (.de, .com und weitere), DNS, SSL, Auslieferung der Website, Überwachung, Verlängerung, Behebung von Störungen auf Seiten von oalab und der Hoster | wie Domain, dazu E-Mail bei netcup: bis 5 Postfächer, Postfächer anlegen und löschen, Passwort zurücksetzen, Spam- und Zustellprüfung |
| Zusätze | weitere Domain 2 € | weiteres Postfach 2 €, weitere Domain 2 € |
| Nicht enthalten | Änderungen an der Website (dafür gibt es die Service-Pakete) und der Umzug zu einem anderen Anbieter; die Herausgabe des Auth-Codes ist inklusive | Hilfe an Geräten und Programmen des Kunden (geht über die Service-Minuten), revisionssichere Mail-Archivierung, Speicher über 25 GB insgesamt |
| Störungen | Beginn innerhalb von 1 Werktag, mit Max innerhalb von 4 Stunden in der Servicezeit | wie Domain |

**Domain ohne Service-Paket** ist im Hub möglich, weil jede Gruppe leer bleiben darf. Dann betreibt oalab Domain, Hosting und Mail, pflegt aber den Code der Website nicht. Kritische Sicherheitslücken meldet oalab und behebt sie nach Freigabe als Einzelauftrag. Ohne Service-Paket sollen neue Anfragen auf service.oalab.de gesperrt sein (Etappe 3); Änderungen laufen dann als Einzelauftrag per Mail oder Hub-Chat. Im Verkauf empfiehlt es sich, Domain immer zusammen mit Lite anzubieten.

## 2. Preise

### 2.1 Preisliste

| Paket | monatlich | jährlich im Voraus (−10 %) | entspricht je Monat |
|---|---|---|---|
| Service Lite | 60,00 € | 648,00 € | 54,00 € |
| Service Max | 200,00 € | 2.160,00 € | 180,00 € |
| Domain | 12,00 € | 129,60 € | 10,80 € |
| Domain & Mail | 20,00 € | 216,00 € | 18,00 € |
| weitere Domain, weiteres Postfach | je 2,00 € | je 21,60 € | je 1,80 € |
| weitere Arbeitszeit | 95,00 € je angefangene 60 Minuten | kein Rabatt | |

- Der Jahrespreis ist genau 10 % unter zwölf Monatspreisen, wie in den bestehenden Verträgen (162 € und 324 €).
- Zahlungsziel 14 Tage wie in Vertrag B; weitere Blöcke kommen auf die nächste Rechnung.
- Vorschlag für die Vertragsvorlagen: Service-Pakete monatlich kündbar mit einem Monat Frist zum Monatsende, bei Jahreszahlung zum Ende des bezahlten Jahres. Domain-Pakete mit 12 Monaten Mindestlaufzeit, weil auch netcup Domains und Webhosting nur mit 12 Monaten Mindestlaufzeit vergibt.
- Ein Upgrade auf Max gilt ab dem nächsten Monatsersten, ein Downgrade zum Ende des bezahlten Zeitraums.

### 2.2 Ist ein Aufschlag für Domain oder Domain & Mail sinnvoll?

Ja, aber als eigener fester Preis je Domain-Paket und nicht als prozentualer Aufschlag auf Lite oder Max.

- Die netcup-Kosten sind klein: 0,35 € netto für eine .de-Domain und 2,26 € für ein Webhosting 1000 mit Mail. Der Preis deckt vor allem Betrieb, Störungen, die Verantwortung als Hoster und den Anteil an Vercel.
- Kunden mit eigenem IT-Dienstleister buchen nur ein Service-Paket. Ein fester Domain-Preis bleibt für alle übersichtlich und trifft nur die, die ihn nutzen.
- Mit Domain & Mail verarbeitet oalab die Mails des Kunden in dessen Auftrag. Das rechtfertigt den Abstand zu Domain und braucht einen Vertrag zur Auftragsverarbeitung mit dem Kunden.

Beispiele: Lite mit Domain 72 € im Monat, Lite mit Domain & Mail 80 € (864 € im Jahr), Max mit Domain & Mail 220 € (2.376 € im Jahr).

## 3. Begründung

### 3.1 Interne Kalkulation

Bezug sind 95 € pro Stunde netto, also 1,58 € pro Minute; das ist der Blockpreis aus Vertrag B. Weil es noch keine Zeiterfassung gibt, sind die Aufwände geschätzt und eher vorsichtig angesetzt.

| Annahme je Kunde und Monat | Lite | Max | Domain | Domain & Mail |
|---|---|---|---|---|
| feste Arbeitszeit | 15 Min.: 10 Grundpflege, 5 Verwaltung und Rechnung | 20 Min.: 10 Grundpflege, 10 Verwaltung und Abstimmung | 5 Min.: DNS, Verlängerung, Überwachung, Störungen | 8 Min.: zusätzlich 3 Min. Mail-Betrieb |
| Fremdkosten | 4 € Plattformanteil | 4 € Plattformanteil | 3 € | 5 € |
| Inklusivminuten | 30 | 150 | – | – |

**Laufende Kosten.** netcup zeigt Preise mit 19 % Umsatzsteuer. Gerechnet wird netto, weil oalab netto abrechnet und die Vorsteuer abzieht.

| Posten | Listenpreis | netto je Monat | Anmerkung |
|---|---|---|---|
| netcup Webhosting 1000 | 2,69 € inkl. USt | 2,26 € | 1 .de-Domain inklusive, 100 Mail-Adressen, 25 GB Web und 25 GB Mail, 12 Monate Mindestlaufzeit |
| netcup Webhosting 2000 | 4,03 € inkl. USt | 3,39 € | 3 .de-Domains und eine weitere, 500 Adressen, je 75 GB |
| netcup Reseller Webhosting 2000 | 10,13 € inkl. USt | 8,51 € | bis 15 Kundenkonten, bei 11 Kunden 0,77 € je Kunde zuzüglich Domain |
| netcup .de-Domain | 0,42 € inkl. USt | 0,35 € | 12 Monate |
| netcup .com-Domain | 1,38 € inkl. USt | 1,16 € | 12 Monate |
| Vercel Pro | 20 US-$ je Entwicklerplatz | rund 17,20 € | nötig für kommerzielle Nutzung, siehe unten |
| Supabase Pro | ab 25 US-$ | rund 21,50 € | Tarif der Plattform heute nicht geprüft |

Umgerechnet mit 1 US-$ ≈ 0,86 €. Vercel und Supabase zusammen kosten rund 38,70 € im Monat, auf 11 Kunden verteilt etwa 3,50 € je Kunde. Angesetzt sind 4 €; der Rest ist Puffer, etwa für die KI-Schnittstelle. Bei Domain (3 €) und Domain & Mail (5 €) deckt der Puffer über den netcup-Preis hinaus .com-Domains und den Vercel-Anteil von Kunden ohne Service-Paket.

**Wo die Websites laufen.** Zwei von vier geprüften Kundenprojekten enthalten eine Vercel-Konfiguration; diese Websites werden also über Vercel ausgeliefert, Domain und Mail liegen bei netcup. Vertrag A nennt netcup als Hoster. Den kostenlosen Hobby-Tarif erlaubt Vercel nur für private, nicht-kommerzielle Projekte. Wer für Erstellen, Pflegen oder Hosten einer Website bezahlt wird, nutzt Vercel kommerziell und braucht Pro. Das Hub-Projekt läuft heute auf Hobby; in welchem Vercel-Team die Kundenseiten liegen, ist nicht geprüft.

**Günstigere Mail-Variante.** Bekommt jeder Kunde mit Domain & Mail ein eigenes Webhosting 1000, kostet das 2,26 € je Kunde. Ein Reseller Webhosting 2000 trennt bis zu 15 Kunden in eigenen Konten; ab fünf Mail-Kunden ist es günstiger als einzelne Pakete, bei 11 Kunden kostet es rund 1,12 € je Kunde samt .de-Domain.

**Effektiver Stundensatz** = (Preis − Fremdkosten) ÷ (feste Minuten + genutzte Inklusivminuten) × 60

| Auslastung der Inklusivminuten | 0 % | 25 % | 50 % | 75 % | 100 % | 95 € erreicht bis |
|---|---|---|---|---|---|---|
| Lite, 60 € | 224 € | 149 € | 112 € | 90 € | 75 € | 68 % |
| Lite bei Jahreszahlung, 54 € | 200 € | 133 € | 100 € | 80 € | 67 € | 55 % |
| Max, 200 € | 588 € | 205 € | 124 € | 89 € | 69 € | 69 % |
| Max bei Jahreszahlung, 180 € | 528 € | 184 € | 111 € | 80 € | 62 € | 61 % |
| Vertrag A, 15 € (Betrieb wie Domain & Mail) | 16 € | 9 € | 7 € | 5 € | 4 € | nie |
| Vertrag B, 30 € | 104 € | 69 € | 52 € | 42 € | 35 € | unter 5 % |

Domain kommt auf 108 € pro Stunde (bei Jahreszahlung 94 €), Domain & Mail auf 113 € (98 €), unabhängig von der Auslastung. Für Vertrag A sind 23 feste Minuten (Grundpflege, Verwaltung, Betrieb von Domain und Mail) und 9 € Fremdkosten angesetzt.

So ist die Tabelle zu lesen:

- Die Pakete funktionieren wie eine Versicherung: Wer wenig braucht, trägt die mit, die viel brauchen. Die Rechnung setzt voraus, dass im Schnitt nicht jedes Kontingent ausgeschöpft wird; gemessen ist das für oalab noch nicht.
- Der schlechteste Fall ist volle Auslastung ohne Blöcke: 75 € (Lite) bzw. 69 € (Max) pro Stunde, also rund drei Viertel des Bezugs. Jede weitere Stunde läuft wieder zu 95 €.
- Am empfindlichsten ist die Grundpflege. Bei 10 statt 15 Minuten trägt Lite die 95 € bis 85 % Auslastung, bei 25 Minuten nur noch bis 35 %. Deshalb sollte die Zeit erfasst und nach sechs Monaten nachgerechnet werden.
- Zur Größenordnung: Hätten alle 11 Kunden Lite und nutzten 60 % ihrer Minuten, wären das rund 6 Stunden Arbeit und 660 € Umsatz im Monat.

### 3.2 Marktvergleich

Gesichtet wurden 17 Seiten deutscher Agenturen und Freelancer sowie die Freelancer-Statistik von freelancermap, alle abgerufen am 05.11.2026. Die meisten Angebote betreffen WordPress-Wartung, die vor allem aus Plugin-Updates besteht. Bei den oalab-Seiten aus eigenem Code fallen weniger Routine-Updates an, dafür können Kunden Inhalte in der Regel nicht selbst ändern, sodass Änderungen über oalab laufen. Am besten vergleichbar sind deshalb Pakete mit fester Arbeitszeit.

**Pakete mit fester Arbeitszeit**

| Anbieter (Ort) | Pakete | Preis je Monat | Arbeitszeit | Zusatzstunde | Reaktion | Hinweis |
|---|---|---|---|---|---|---|
| angelmedia (Stadtilm) | Basic, Plus, Premium | 49, 89, 159 € netto | 30, 60, 120 Min. | 119 € netto | Antwort in 24 Stunden an Werktagen | keine Einrichtungsgebühr |
| COMARTIST (Leipzig) | Standard, Premium, Business | 52,50, 89, 159 € netto | 30, 60, 120 Min. | 120 € netto | spätestens 48 Stunden | Mindestlaufzeit 12, 6, 3 Monate, quartalsweise im Voraus |
| zweigelb (Pfalz) | Basic, Professional | 39, 79 €, USt nicht angegeben | keine, 30 Min. | – | – | ohne Hosting |
| NEUZEITWERBER (Waiblingen) | Starter, Business | 79, 149 €, USt nicht angegeben | keine, 30 Min. | – | 4 Stunden (Business) | monatlich kündbar |
| Fly & Froth (Karben) | Basis, Standard, Premium | 29, 49, 99 €, USt nicht angegeben | keine, bis 1 Std., bis 3 Std. | – | – | monatlich kündbar; Domain und Hosting separat, laut Hinweis 15 € im Monat |
| DOSIGNY (Ismaning) | Basic, Pro, Plus | 99, 199, 299 € netto | keine, 2 Std., 4 Std. | 100 € netto | 48, 24, 8 Stunden an Werktagen | Hosting inklusive, 10 % bei jährlicher Vorauszahlung |
| XICTRON (Söhlde) | Website-Abo Basis, Plus, Pro | 129, 229, 449 € netto | 30 Min., 1 Std., 4 Std. | 95 € netto | Antwort meist in 24 Stunden | Website, Hosting und Pflege zusammen, 24 Monate Laufzeit |
| adfera (Erfurt) | Website-Abo | ab 69 € netto | 60 Min. Inhaltsänderungen | – | – | Website inklusive |

**Pakete ohne Arbeitszeit** (Updates, Sicherung, Überwachung)

| Anbieter (Ort) | Pakete | Preis je Monat | Reaktion | Hinweis |
|---|---|---|---|---|
| WordPress Wartung (München) | Starter bis Prime | 23,50 bis 55,50 € netto, mit Hosting je 10 € mehr | 24 bis 4 Stunden an Werktagen | jährlich 20 % günstiger |
| Kopf & Stift (Dresden) | Basis bis Shop | 30 bis 149 € netto, bei Jahreszahlung 25 bis 124 € | – | Jahreszahlung: zwei Monate geschenkt; Änderungen nach Aufwand |
| Seiten Design (Günzburg) | Basis, Business, Shop | 39, 79, 129 € netto | – | Jahr kostet elf Monate |
| Webdesign Wilsdruff (Sachsen) | Basis, Pflege | 29, 79 € | bei Ausfall 48 Stunden | Pflege enthält Inhaltsänderungen ohne feste Zeit |
| hypemore | Basic, Business, Business+ | 69, 99, 199 € netto | – | Zusatzstunde 90 €, 12 Monate Mindestlaufzeit |
| max2-consulting (München) | Basic, Professional, Premium | rund 49, 98, 199 € netto je Monat (Pakete für 3 Monate) | 2 Werktage, 8 Servicestunden, 4 Stunden | Stundensatz 90 € netto, kein Abo |
| Ucentric Media (Regensburg) | Betreuung | ab 50 €, USt nicht angegeben | – | Umfang nach Absprache |
| die mainagentur (Langen) | Wartung | ab 69 € | – | |

**Marktspannen aus Ratgebern**

- die mainagentur: Unternehmenswebsite meist 40 bis 150 € im Monat, Richtwert 59 bis 149 € netto; Stundensätze meist 80 bis 150 € netto.
- adfera: Freelancer 30 bis 80 €, Agenturen 80 bis 200 €, Premium 200 bis 500 € im Monat; Einzelleistungen 80 bis 150 € pro Stunde.
- Webdesign Wilsdruff: kleine Seiten 15 bis 50 €, Firmenwebseite 40 bis 150 €, Shops 100 bis 300 € im Monat; Domain, Hosting und SSL 70 bis 200 € im Jahr.
- Seiten Design: 39 bis 149 € netto im Monat.
- Netgenerator (Berlin): 50 bis 179 € bzw. 50 bis 199 € netto im Monat; einige Agenturen geben bei 12 Monaten Laufzeit 10 bis 15 % Nachlass.
- zweigelb: Basis meist 30 bis 60 € im Monat.
- max2-consulting: zehn Anbieter im September 2026, im Schnitt 49,90 € netto im Monat, Spanne 9,50 bis 149 € netto.
- freelancermap, Freelancer-Kompass 2026: im Schnitt 103 € pro Stunde im deutschsprachigen Raum (Stundenverteilung aus 1.310 Angaben), in der Branche IT und Software 95 €. Im Freelancer-Verzeichnis (Stand April 2026) liegt das Fachgebiet Entwicklung bei 92 €. Ob netto oder brutto, sagen die Seiten nicht.

**Einordnung**

- 30 Minuten kosten am Markt 49, 52,50, 79 und 149 €. Lite liegt mit 60 € in der Mitte (Median 65,75 €).
- 120 Minuten kosten bei zwei Anbietern 159 €. Deren Preislinie (89 € für 60, 159 € für 120 Minuten) ergibt für 150 Minuten etwa 194 €. Max liegt mit 200 € darauf und bietet zusätzlich 20 Anfragen und eine schnellere Reaktion.
- 95 € je Zusatzstunde liegen knapp unter dem Median der festen Zusatzsätze (97,50 €) und unter dem freelancermap-Schnitt von 103 €.
- 10 % Jahresrabatt gibt DOSIGNY genauso; andere geben 8 % (ein Monat frei), 17 % (zwei Monate frei) oder 20 %.
- Lite reagiert in 2 Werktagen wie COMARTIST, DOSIGNY Basic und max2 Basic. Max liegt mit 1 Werktag und 4 Stunden bei Ausfall zwischen DOSIGNY Pro (24 Stunden) und WordPress Wartung Prime (4 Stunden).
- Grenzen: Alle Preise sind Selbstangaben der Anbieter und überwiegend WordPress-Angebote. Mehrere Seiten nennen nicht, ob netto oder brutto. Für Münster wurden keine Wartungsangebote mit Preisen gefunden.

### 3.3 Lite gegen Max: Abgrenzung und Upgrade

| Bedarf im Monat | Lite | Max | günstiger |
|---|---|---|---|
| bis 30 Min. | 60 € | 200 € | Lite |
| 31 bis 90 Min. | 155 € (1 Block) | 200 € | Lite, 45 € |
| 91 bis 150 Min. | 250 € (2 Blöcke) | 200 € | Max, 50 € |
| 151 bis 210 Min. | 345 € | 295 € (1 Block) | Max, 50 € |
| 211 bis 270 Min. | 440 € | 390 € | Max, 50 € |

- Ab 91 Minuten ist Max in jedem Monat 50 € günstiger, bei Jahreszahlung 64 €. Bis 90 Minuten ist Lite mit einem Block günstiger.
- Max bringt zusätzlich 20 statt 5 Anfragen, Rückmeldung in 1 statt 2 Werktagen und 4 Stunden bei Ausfall.
- Max empfehlen, wenn ein Lite-Kunde in zwei von drei Monaten mehr als 90 Minuten braucht oder die 5 Anfragen ausschöpft. Einen Wechsel zurück anbieten, wenn ein Max-Kunde drei Monate in Folge unter 90 Minuten und unter 6 Anfragen bleibt.
- Warum 150 und nicht 120 Minuten: Mit 120 Minuten (etwa für 170 €) wäre Lite mit zwei Blöcken bei 121 bis 150 Minuten Bedarf günstiger als Max mit einem Block (250 € gegen 265 €). Mit 150 Minuten liegen beide Pakete im selben 60-Minuten-Raster (30 + 2 × 60), und die Upgrade-Grenze bleibt eindeutig.
- Die Minuten sind bei Max günstiger: Lite kostet umgerechnet 120 € pro Inklusivstunde (der Preis trägt vor allem Grundpflege und Bereitschaft), Max 80 €. Das ist der Anreiz für Kunden mit regelmäßigem Bedarf.

## 4. Bestehende Verträge

### 4.1 Einordnung

| | Vertrag A: Website-, Domain- & Mail-Service | Vertrag B: Website-Pflege und technischer Support |
|---|---|---|
| Preis | 15 € im Monat, 162 € im Jahr | 30 € im Monat, 324 € im Jahr |
| Inklusivzeit | 60 Minuten | 30 Minuten |
| Hosting, Domain, Mail | bei oalab (netcup) | beim IT-Dienstleister des Kunden |
| weitere Zeit | nach Absprache | 95 € je angefangene 60 Minuten, Zahlungsziel 14 Tage |
| effektiver Stundensatz | 4 bis 16 € | 35 bis 104 € |
| neu am nächsten | Domain & Mail und Lite: 80 € (für 60 Minuten wie bisher 175 €) | Lite: 60 € |

- **Vertrag A** ist ein Sonderpreis. Von 15 € gehen rund 9 € an Fremdkosten; die übrigen 6 € reichen bei 95 € pro Stunde für knapp 4 Minuten Arbeit. Schon die feste Arbeit von 23 Minuten ist damit nicht gedeckt, die 60 Inklusivminuten erst recht nicht. Wer die Minuten nutzt, arbeitet für 4 bis 9 € pro Stunde.
- **Vertrag B** entspricht Lite zum halben Preis. Der Blockpreis von 95 € passt schon; neu kämen Grundpflege, Reaktionszeit und die Grenze von 5 Anfragen dazu.

### 4.2 Vorschlag für die Umstellung

Die bestehenden Verträge laufen vorerst unverändert weiter. Neukunden bekommen ab der Freigabe nur noch Lite, Max und die Domain-Pakete.

1. **Nutzung messen:** Anfragen je Kunde und Monat auf service.oalab.de auswerten und ab sofort die Zeit je Anfrage erfassen. Daraus ergibt sich je Kunde eine Empfehlung für Lite oder Max.
2. **Laufzeiten prüfen:** Mindestlaufzeit und Kündigungsfrist von Vertrag A und B bestimmen den frühesten Termin.
3. **Ankündigen:** mindestens drei Monate vorher, persönlich und mit einem konkreten Paketvorschlag je Kunde, etwa Ankündigung im Januar 2027 und Umstellung zum 1. April 2027 oder zum nächsten Vertragsende.
4. **Übergangspreis:** zwölf Monate 25 % Rabatt auf das Service-Paket (Lite 45 €, Max 150 €), Domain-Pakete zum Listenpreis. Bei Jahreszahlung gilt der höhere der beiden Rabatte, nicht beide.
5. **Je Gruppe:**
   - Vertrag A: Domain & Mail und Lite, im Übergangsjahr 65 €, danach 80 €. Braucht der Kunde kaum Änderungen, genügt Domain & Mail für 20 €; Änderungen laufen dann als Einzelauftrag.
   - Vertrag B: Lite, im Übergangsjahr 45 €, danach 60 €.
   - Kunden ohne Servicevertrag, die heute im Plan „Starter“ auf service.oalab.de sind: Lite oder Max nach gemessenem Bedarf, mit demselben Übergangspreis bei Buchung bis zum Stichtag.
6. **Im Hub eintragen:** Pakete aller Kunden zuordnen (Filter „Ohne Servicepaket“). Erst danach greift wie geplant Etappe 3 mit der Sperre.

## 5. Offene Entscheidungen

| Nr. | Entscheidung | Empfehlung |
|---|---|---|
| 1 | Preise | Lite 60 €, Max 200 €, Block 95 €, Domain 12 €, Domain & Mail 20 €, Zusätze je 2 € |
| 2 | Kontingent von Max | 150 Minuten statt 120 |
| 3 | Lesart der Anfragen | je Kalendermonat, ab der 6. bzw. 21. Anfrage gesperrt. Störungsmeldungen mit der Priorität „Dringend“ nie sperren; Missbrauch wird umgestuft und gezählt. Der Monat sollte nach deutscher Zeit wechseln: service.oalab.de zählt heute nach UTC-Monat, Anfragen aus den ersten ein bis zwei Stunden eines Monats fallen dort noch in den Vormonat. Der Hinweistext bei erreichtem Limit ist noch ein fester Beispieltext („10 von 10 … 1. September 2026“). |
| 4 | Domain ohne Service-Paket | erlauben, aber nur als Betrieb; im Verkauf immer mit Lite anbieten |
| 5 | Zeiterfassung je Anfrage | vor dem ersten berechneten Block einführen. service.oalab.de kennt heute weder Zeiterfassung noch Messung der Reaktionszeit. |
| 6 | Übergang für Bestandskunden | zwölf Monate 25 % Rabatt, Ankündigung drei Monate vorher, Stichtag zum Beispiel 1. April 2027 |
| 7 | Vercel Pro und Supabase-Tarif | Vercel Pro buchen, bevor Hosting verkauft wird; den Supabase-Tarif prüfen |
| 8 | Vertragsvorlagen | Reaktionszeiten als Zusage ohne Vertragsstrafe formulieren, Auftragsverarbeitung für Domain & Mail regeln, Texte vor dem Einsatz prüfen lassen |

Später im Hub: Die Beschreibungen in `lib/service-packages.ts` lauten heute für beide Service-Pakete „Anfragen über die Serviceplattform“. Nach der Freigabe könnten sie Minuten und Anfragen nennen, etwa „Bis 5 Anfragen und 30 Minuten im Monat“.

## Anhang: Quellen

Alle Seiten abgerufen am 05.11.2026.

| Quelle | Inhalt | Link |
|---|---|---|
| netcup, Hosting-Übersicht | Webhosting 1000 bis 8000, Preise inkl. USt | https://www.netcup.com/de/hosting |
| netcup, Webhosting 1000 | Speicher, Inklusivdomain, Mail-Adressen, Laufzeit | https://www.netcup.com/de/hosting/webhosting/webhosting-1000-nue |
| netcup, Webhosting 2000 | dasselbe für 2000 | https://www.netcup.com/de/hosting/webhosting/webhosting-2000-nue |
| netcup, Reseller Webhosting | Reseller 1000 bis 8000, Kundenkonten | https://www.netcup.com/de/hosting/reseller-webhosting |
| netcup, .de-Domain | 0,42 € im Monat inkl. USt | https://www.netcup.com/de/domain/zusaetzliche-domain-de |
| netcup, .com-Domain | 1,38 € im Monat inkl. USt | https://www.netcup.com/de/domain/zusaetzliche-domain-com |
| Vercel, Preise | Pro 20 US-$ je Entwicklerplatz | https://vercel.com/pricing |
| Vercel, Fair-Use-Regeln | Hobby nur nicht-kommerziell, Definition kommerzieller Nutzung | https://vercel.com/docs/limits/fair-use-guidelines |
| Supabase, Preise | Pro ab 25 US-$ | https://supabase.com/pricing |
| angelmedia | Pflegevertrag mit 30, 60, 120 Minuten | https://www.angelmedia.de/website-pflegevertrag |
| COMARTIST | Pflegevertrag mit 30, 60, 120 Minuten | https://www.comartist.de/webdesign/website-pflegevertrag/ |
| Fly & Froth | Website-Pflege | https://www.fly-froth.com/website-pflege |
| Ucentric Media | Website-Betreuung | https://www.ucentric-media.de/website-betreuung/ |
| hypemore | Wartung und Pflege | https://hypemore.de/leistungen/wartung-pflege/ |
| NEUZEITWERBER | Website-Wartung | https://www.neuzeitwerber.de/website-wartung/ |
| DOSIGNY | Wartungsvertrag, Stand Oktober 2026 | https://www.dosigny.com/wartungsvertrag.php |
| Netgenerator | Wartungsvertrag, Marktspannen | https://www.netgenerator.de/service/wordpress-website-wartungsvertrag/ |
| zweigelb | Wartungsvertrag, Kosten (9. Juni 2026) | https://www.zweigelb.de/blog/wordpress-wartungsvertrag-kosten/ |
| die mainagentur | Wartung, Kosten (23. Juli 2026) | https://die-mainagentur.de/blog/wordpress-wartung-kosten/ |
| XICTRON | Website-Abo | https://www.xictron.com/de/website-abo/ |
| Kopf & Stift | Wartung, Stand Oktober 2026 | https://kopfundstift.de/wordpress-wartung/ |
| max2-consulting | Wartung und Marktvergleich, Stand September 2026 | https://max2-consulting.de/wordpress-wartung-service/ |
| adfera | Ratgeber Wartungskosten (aktualisiert 6. Oktober 2026) | https://adfera.de/ratgeber/website-wartung-kosten/ |
| Webdesign Wilsdruff | Ratgeber Wartungskosten (aktualisiert 3. Oktober 2026) | https://webdesign-wilsdruff.de/ratgeber/webseite-wartung-kosten/ |
| WordPress Wartung | Pakete und Preise | https://wordpresswartung.com/wordpress-wartung-kosten/ |
| Seiten Design | Ratgeber Wartungskosten (23. August 2026) | https://seiten-design.de/ratgeber/wordpress-wartung-kosten/ |
| freelancermap, Freelancer-Kompass 2026 | Stundensatz im Schnitt 103 €, Befragung | https://www.freelancermap.de/freelancer-kompass |
| freelancermap, Einkommen | Stundensatz-Verteilung aus 1.310 Angaben | https://www.freelancermap.de/freelancer-kompass/einkommen |
| freelancermap, Ratgeber Stundensatz | Sätze nach Branche und Fachgebiet | https://www.freelancermap.de/blog/welchen-stundenlohn-kann-man-als-freelancer-verlangen/ |

Interne Quellen: `lib/service-packages.ts` (Paketkatalog), in service-oalab die Migrationen `202610190002_service_packages.sql` (Zählung je UTC-Monat) und `202608100001_foundation.sql` (Prioritäten von Anfragen). Die Rechnung lässt sich mit den Annahmen aus Abschnitt 3.1 nachvollziehen.
