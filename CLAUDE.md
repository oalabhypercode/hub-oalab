@AGENTS.md

# Arbeitsregeln für Claude

## Git: automatisch committen und pushen

- Jede abgeschlossene Änderung ohne Rückfrage committen und auf den Branch pushen, auf dem gerade gearbeitet wird. Nicht auf eine Aufforderung warten. Ist `main` ausgecheckt, vorher einen Feature-Branch anlegen.
- Vor dem Commit `npx tsc --noEmit`, `npm run lint` und `npm test` laufen lassen. Unter Windows schlägt der Test der Beispiel-PDFs wegen CRLF-Zeilenenden fehl; das ist bekannt und kein Befund. Andere rote Prüfungen erst beheben, dann pushen.
- Nie direkt auf `main` pushen: Jeder Stand auf `main` geht auf Vercel sofort live. Pull Requests nur auf ausdrückliche Anweisung des Nutzers mergen, für genau den genannten PR; danach das Live-Deployment prüfen.
- Keine Secrets committen. `.env.local` bleibt lokal; Passwörter und Schlüssel trägt der Nutzer selbst ein.
- Arbeitet eine andere Session parallel im selben Ordner, nur die eigenen Änderungen committen und ihre liegen lassen.
- Commit-Nachrichten auf Englisch im Stil `feat: …`, `fix: …`, `docs: …`, am Ende die Zeile `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Patch Notes pflegen

- Jede Änderung, die auf `main` geht, bekommt im selben PR einen Eintrag in `lib/patch-notes.ts`: ein Paket pro Livegang-Tag, neueste zuerst, fortlaufend nummeriert. Gehen mehrere PRs am selben Tag live, landen ihre Einträge im Paket dieses Tages.
- Jeder Eintrag ist eine von Neu, Verbessert, Behoben oder Sicherheit, mit kurzem Titel und zwei, drei verständlichen Sätzen auf Deutsch: was sich ändert und was man davon merkt. Keine Namen, E-Mail-Adressen, Links, Schlüssel oder Infrastruktur-Details.
- `customers: true` nur für Einträge, die Kunden betreffen; alles andere sehen nur Admins (mit „Intern“). Reine Doku- und Werkzeug-Änderungen ohne Wirkung auf den Hub brauchen keinen Eintrag.
