/**
 * The assistant chat in the browser (decision of 30.10.2026): localStorage per login, so the conversation survives a
 * reload and a browser restart until "Neu starten" or signing out. Pasted transcripts are kept as well. Nothing here
 * reaches the server. Self-contained (no imports), so `node --test` checks it directly.
 *
 * Proposals restored from storage may be stale (expired after 30 minutes, decided in another tab); the shell asks
 * the server for their status and `applyProposalStatus` brings the cards up to date.
 */

export const CHAT_VERSION = 1;
/** The newest turns that are kept; older ones fall away first. */
export const MAX_STORED_TURNS = 50;
/** Upper bound for the stored text, well below the usual 5 MB of localStorage. */
export const MAX_STORED_CHARS = 2_000_000;
export const MODE_KEY = "hub-assistant-mode";

export const chatKey = (userId: string) => `hub-assistant-chat:${userId}`;

type StoredProposal = { view: { id: string; expiresAt?: string }; state: string; message?: string };
export type StoredTurn = { role: "user" | "assistant"; content: string; proposals?: StoredProposal[] };

/** What gets written: the newest turns, nothing half-done (a running answer, a proposal being saved). */
export function serializeChat<T extends StoredTurn>(turns: T[]) {
  let kept = turns
    .filter((turn) => turn.role === "user" || turn.content.trim() || turn.proposals?.length)
    .map((turn) => turn.proposals?.some((item) => item.state === "saving")
      ? { ...turn, proposals: turn.proposals.map((item) => item.state === "saving" ? { ...item, state: "open" } : item) }
      : turn)
    .slice(-MAX_STORED_TURNS);
  let text = JSON.stringify({ v: CHAT_VERSION, turns: kept });
  while (text.length > MAX_STORED_CHARS && kept.length > 1) {
    kept = kept.slice(1);
    text = JSON.stringify({ v: CHAT_VERSION, turns: kept });
  }
  return kept.length ? text : null;
}

const isProposal = (value: unknown): value is StoredProposal => {
  const item = value as StoredProposal | null;
  return Boolean(item && typeof item === "object" && item.view && typeof item.view.id === "string" && typeof item.state === "string");
};

const isTurn = (value: unknown): value is StoredTurn => {
  const turn = value as StoredTurn | null;
  return Boolean(turn && typeof turn === "object" && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string"
    && (turn.proposals === undefined || (Array.isArray(turn.proposals) && turn.proposals.every(isProposal))));
};

/** Reads a stored chat; anything unreadable or from another version starts empty instead of breaking the panel. */
export function parseChat<T extends StoredTurn>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { v?: unknown; turns?: unknown };
    if (data?.v !== CHAT_VERSION || !Array.isArray(data.turns) || !data.turns.every(isTurn)) return [];
    return data.turns as T[];
  } catch {
    return [];
  }
}

/** Proposals that still look undecided and need a word from the server. */
export function openProposalIds(turns: StoredTurn[]) {
  return turns.flatMap((turn) => (turn.proposals ?? []).filter((item) => item.state === "open").map((item) => item.view.id));
}

export type ProposalStatus = "proposed" | "executing" | "done" | "discarded" | "failed" | "expired" | "missing";

const restored: Record<Exclude<ProposalStatus, "proposed">, { state: string; message: string }> = {
  executing: { state: "open", message: "Dieser Vorschlag wird gerade gespeichert." },
  done: { state: "saved", message: "Schon gespeichert." },
  discarded: { state: "discarded", message: "Verworfen, nichts gespeichert." },
  failed: { state: "failed", message: "Dieser Vorschlag ist fehlgeschlagen. Bitte den Assistenten neu vorschlagen lassen." },
  expired: { state: "expired", message: "Abgelaufen (30 Minuten), nichts gespeichert. Bitte den Assistenten neu vorschlagen lassen." },
  missing: { state: "expired", message: "Diesen Vorschlag gibt es nicht mehr. Bitte den Assistenten neu vorschlagen lassen." },
};

/** Brings restored open proposals up to date; proposals the server still has as open stay as they are. */
export function applyProposalStatus<T extends StoredTurn>(turns: T[], statuses: Record<string, ProposalStatus>): T[] {
  return turns.map((turn) => {
    const proposals = turn.proposals;
    if (!proposals?.some((item) => item.state === "open" && statuses[item.view.id] && statuses[item.view.id] !== "proposed")) return turn;
    return {
      ...turn,
      proposals: proposals.map((item) => {
        const status = statuses[item.view.id];
        return item.state !== "open" || !status || status === "proposed" ? item : { ...item, ...restored[status] };
      }),
    };
  });
}

/** An open proposal past its 30 minutes, without asking the server. */
export const isExpired = (item: StoredProposal, now = Date.now()) =>
  item.state === "open" && typeof item.view.expiresAt === "string" && Date.parse(item.view.expiresAt) <= now;
