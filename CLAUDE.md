@AGENTS.md

# Arbeitsregeln für Claude

## Git: automatisch committen und pushen

- Jede abgeschlossene Änderung ohne Rückfrage committen und auf den Branch pushen, auf dem gerade gearbeitet wird. Nicht auf eine Aufforderung warten. Ist `main` ausgecheckt, vorher einen Feature-Branch anlegen.
- Vor dem Commit `npx tsc --noEmit`, `npm run lint` und `npm test` laufen lassen. Unter Windows schlägt der Test der Beispiel-PDFs wegen CRLF-Zeilenenden fehl; das ist bekannt und kein Befund. Andere rote Prüfungen erst beheben, dann pushen.
- Nie direkt auf `main` pushen und keine Pull Requests mergen: Jeder Stand auf `main` geht auf Vercel sofort live. Mergen übernimmt der Nutzer.
- Keine Secrets committen. `.env.local` bleibt lokal; Passwörter und Schlüssel trägt der Nutzer selbst ein.
- Arbeitet eine andere Session parallel im selben Ordner, nur die eigenen Änderungen committen und ihre liegen lassen.
- Commit-Nachrichten auf Englisch im Stil `feat: …`, `fix: …`, `docs: …`, am Ende die Zeile `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
