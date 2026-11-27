import { createTurns } from "./turns";

/**
 * One heavy image job at a time in the whole hub, which may use 512 MB in all: the previews of the Asset Management
 * (lib/hub-files/preview-server.ts) and the pictures pasted into notes (lib/hub-notes/write.ts, since 27.11.2026) wait
 * in the same line, so two large pictures are never decoded at once. A job that waited 40 s gets "busy" and never runs.
 * Kept on globalThis, so routes the bundler builds apart still share the one line.
 */
type Turns = ReturnType<typeof createTurns>;

const shared = globalThis as typeof globalThis & { __oalabImageTurns?: Turns };

export const inImageTurn: Turns = (shared.__oalabImageTurns ??= createTurns(1, 40_000));
