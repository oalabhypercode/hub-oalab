<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Hub-Regeln für jede KI

Gemeinsame OALab-Regeln: `service-oalab/AGENTS.md`. Produktstand: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md), Technik: [README.md](README.md).

## Git

- Abgeschlossene Änderung ohne Rückfrage committen und auf den aktuellen Branch pushen; ist `main` ausgecheckt → vorher Feature-Branch
- Vor dem Commit `npx tsc --noEmit`, `npm run lint`, `npm test`; rote Prüfung erst beheben (Ausnahme: Beispiel-PDF-Test unter Windows wegen CRLF)
- Nie direkt auf `main`: jeder Stand dort ist in 2–4 Minuten live (Coolify `oalab-hub`, Server 2)
- PR nur auf ausdrückliche Anweisung mergen, genau den genannten; danach Live-Deployment prüfen
- Keine Secrets committen; `.env.local` bleibt lokal; Passwörter und Schlüssel trägt der Nutzer selbst ein
- Parallele Session im selben Ordner → nur eigene Änderungen committen
- Commit-Nachrichten Englisch, `feat: …`, `fix: …`, `docs: …`; letzte Zeile `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Patch Notes (`lib/patch-notes.ts`)

- Jede Änderung auf `main` → Eintrag im selben PR; ein Paket je Livegang-Tag, neueste zuerst, fortlaufend nummeriert; mehrere PRs am selben Tag → dasselbe Paket
- Art Neu, Verbessert, Behoben oder Sicherheit; kurzer Titel, zwei, drei Sätze Deutsch: was sich ändert, was man merkt
- Keine Namen, E-Mail-Adressen, Links, Schlüssel, Infrastruktur-Details
- `customers: true` nur für Kunden-relevante Einträge; sonst nur Admins („Intern“)
- Reine Doku- und Werkzeug-Änderungen ohne Wirkung auf den Hub: kein Eintrag
