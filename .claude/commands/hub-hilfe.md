---
description: Beantwortet Fragen zu den Funktionen des oalab Client Hub (Kunden- und Admin-Sicht)
argument-hint: <Frage zur Plattform>
allowed-tools: Read, Grep, Glob
---

Beantworte diese Frage zum oalab Client Hub: $ARGUMENTS

Vorgehen:

1. Lies zuerst die Wissensbasis in `lib/hub-assistant/knowledge.ts` (Konstante `HUB_KNOWLEDGE`). Sie ist dieselbe Grundlage, mit der der Chat-Assistent im Hub antwortet.
2. Reicht sie nicht, prüfe im Code, was tatsächlich umgesetzt ist (zum Beispiel `components/hub/screens/`, `lib/hub-calendar/`, `lib/hub-files/`). Was geplant oder offen ist, steht in `PROJECT_CONTEXT.md`.
3. Antworte auf Deutsch, kurz und konkret, aus Sicht der Nutzer. Sag dazu, ob etwas nur Admins können und ob es noch geplant ist.
4. Weicht der Code von der Wissensbasis ab, nenne die Datei und schlag vor, die Wissensbasis anzupassen. Ändere selbst keine Dateien.

Steht oben keine Frage, frag kurz nach, worum es gehen soll.
