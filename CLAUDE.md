@AGENTS.md

# Arbeitsregeln für Claude

## Git: automatisch committen und pushen

- Jede abgeschlossene Änderung ohne Rückfrage committen und auf den Branch pushen, auf dem gerade gearbeitet wird. Nicht auf eine Aufforderung warten. Ist `main` ausgecheckt, vorher einen Feature-Branch anlegen.
- Vor dem Commit `npx tsc --noEmit`, `npm run lint` und `npm test` laufen lassen. Unter Windows schlägt der Test der Beispiel-PDFs wegen CRLF-Zeilenenden fehl; das ist bekannt und kein Befund. Andere rote Prüfungen erst beheben, dann pushen.
- Nie direkt auf `main` pushen: Jeder Stand auf `main` geht in 2–4 Minuten live (Coolify-App `oalab-hub` auf Server 2, seit 08.11.2026; Vercel baut nicht mehr). Pull Requests nur auf ausdrückliche Anweisung des Nutzers mergen, für genau den genannten PR; danach das Live-Deployment prüfen.
- Keine Secrets committen. `.env.local` bleibt lokal; Passwörter und Schlüssel trägt der Nutzer selbst ein.
- Arbeitet eine andere Session parallel im selben Ordner, nur die eigenen Änderungen committen und ihre liegen lassen.
- Commit-Nachrichten auf Englisch im Stil `feat: …`, `fix: …`, `docs: …`, am Ende die Zeile `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Patch Notes pflegen

- Jede Änderung, die auf `main` geht, bekommt im selben PR einen Eintrag in `lib/patch-notes.ts`, und zwar in Patch-Blöcken: Patch 1 fasst alles bis 27.11.2026 zusammen, danach sammelt jeder Patch rund 20 Änderungen (Patch 1.1, 1.2, …). Erst ein großer Schritt bekommt die nächste ganze Nummer (Patch 2), und nur auf Ansage des Nutzers.
- `patchDays` hat einen Block je Livegang-Tag (`patch`, `date`, `changes`), neueste zuerst. Neue Einträge kommen in den obersten Block, wenn er den Livegang-Tag hat, sonst darüber in einen neuen Block mit der Nummer des offenen Patches. Hat der offene Patch schon rund 20 Einträge (der Test erlaubt höchstens 25), beginnt der neue Block mit der nächsten Nummer.
- Jeder Eintrag ist eine von Neu, Verbessert, Behoben oder Sicherheit, mit kurzem Titel und zwei, drei verständlichen Sätzen auf Deutsch: was sich ändert und was man davon merkt. Keine Namen, E-Mail-Adressen, Links, Schlüssel oder Infrastruktur-Details.
- Jeder Eintrag nennt mit `area` einen der sechs Bereiche (`start` Übersicht & Insights, `projects` Projekte & Kalender, `files` Dateien, `customers` Kunden & Verträge, `messages` Chat & Benachrichtigungen, `hub` Hub & Konto) und mit `place` die genaue Stelle im Hub, Ebenen mit „ › “ getrennt (etwa „Kalender › Freie Zeiten“); berührt er weitere Bereiche, stehen sie in `also`.
- `customers: true` nur für Einträge, die Kunden selbst im Hub sehen oder nutzen, `freelancers: true` entsprechend für Freelancer; alles andere sehen nur Admins (mit „Intern“). Kunden- und Freelancertexte sprechen die Rolle mit „du“ an und nennen nur, was sie selbst sieht: nie Admins, andere Rollen, Technik, Tests oder interne Werkzeuge (ein Test prüft die Wörter). Was nur Admins brauchen, steht in einem eigenen internen Eintrag. Reine Doku- und Werkzeug-Änderungen ohne Wirkung auf den Hub brauchen keinen Eintrag.
