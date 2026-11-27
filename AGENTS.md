<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## OALab im Überblick

- Der Hub teilt eine Datenbank mit dem Service. Gemeinsame Doku (Architektur, Kundenprojekte, GitHub-Konten) liegt im privaten Nachbar-Repo `oalabhypercode/service-oalab` unter `docs/oalab/`; dort auch alle Datenbank-Migrationen.
- **Nur `hub-oalab` und `service-oalab` sind sicher da.** NoteTree Business und andere Ordner gibt es nur bei einem Teammitglied; fehlt ein Pfad außerhalb der zwei Repos, weiterarbeiten und nicht danach suchen.
- Dieses Repo ist öffentlich: keine Kundennamen, Domains oder Zugangsdaten in Code, Doku oder Commits.
