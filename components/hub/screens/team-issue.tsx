"use client";

import { useRef, useState } from "react";
import { Check, CircleCheck, Wrench } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { Modal } from "../modal";
import { ComposeRow, runStep, useGrowingField, type Attempt } from "./conversation-compose";
import { reopenTeamIssue, resolveTeamIssue, writeService } from "@/lib/hub-conversations/actions";
import type { DemoStep } from "@/lib/hub-conversations/fixtures";
import { MAX_MESSAGE_LENGTH } from "@/lib/hub-conversations/rules";
import type { ConversationResult, ConversationSummary, ConversationThread, ServiceControls, TeamIssueReport } from "@/lib/hub-conversations/types";

// Reports of the team in Nachrichten › Service: „NoteTree-Problem melden“, and in the report itself an answer to the
// team, „Als erledigt markieren“ and „Wieder öffnen“. No customer is part of it.

/** The sign of a report, where a request shows the customer's logo. */
export function TeamSign() {
  return <span className="chat-avatar am-avatar is-issue" aria-hidden="true"><Wrench size={19} /></span>;
}

export type ReportInput = { key: string; body: string; relatedRequestId?: string };

/**
 * „NoteTree-Problem melden“. The draft lives with the list, so closing the window loses nothing. From an open request of
 * a customer the report may name it.
 */
export function TeamIssueDialog({ draft, onDraft, related, submit, onReported, onClose }: {
  draft: string; onDraft: (draft: string) => void; related: ConversationSummary | null;
  submit: (input: ReportInput) => Promise<ConversationResult<TeamIssueReport>>;
  onReported: (report: TeamIssueReport) => void; onClose: () => void;
}) {
  const [withRelated, setWithRelated] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per report as written: a double click or a resend after a lost answer stays one report.
  const attempt = useRef<string | null>(null);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    attempt.current ??= crypto.randomUUID();
    try {
      const result = await submit({ key: attempt.current, body, ...(related && withRelated ? { relatedRequestId: related.id } : {}) });
      attempt.current = null;
      if (result.ok) { onReported(result.data); return; }
      setError(result.error);
    } catch {
      setError("Keine Verbindung. Dein Text bleibt hier, bitte versuche es erneut.");
    }
    setBusy(false);
  }

  return (
    <Modal title="NoteTree-Problem melden" onClose={() => { if (!busy) onClose(); }} className="chat-report">
      <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label className="um-field">
          <span className="am-label">Was geht nicht oder sollte besser gehen?</span>
          <textarea className="am-textarea" rows={5} value={draft} maxLength={MAX_MESSAGE_LENGTH} data-autofocus readOnly={busy}
            placeholder={"z. B. Beim Senden bleibt die Anfrage stehen\nNach „Senden“ dreht sich nur der Kreis."}
            onChange={(event) => { attempt.current = null; setError(""); onDraft(event.target.value); }}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
        </label>
        <p className="field-hint">Die erste Zeile wird die Überschrift. Die Meldung steht hier und in NoteTree Business.</p>
        {related && (
          <label className="um-check">
            <input type="checkbox" checked={withRelated} disabled={busy} onChange={(event) => { attempt.current = null; setWithRelated(event.target.checked); }} />
            <span>Bezug nennen: {related.reference}{related.company && ` · ${related.company}`}</span>
          </label>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="um-actions">
          <button type="button" className="sheet-action" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button type="submit" className="sheet-action is-primary" disabled={busy || !draft.trim()}>{busy ? <MiniLoader size={15} /> : <Check size={15} aria-hidden="true" />}Melden</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The field of a report: answer the team, finish it (a written answer goes out with it) or open it again. An answer to a
 * finished report leaves it finished.
 */
export function TeamIssueComposer({ conversation, controls, live, notice, onNoticeSeen, onChanged, onDemoStep }: {
  conversation: ConversationSummary; controls: ServiceControls; live: boolean;
  /** Said once right after the report was made, until the next step. */
  notice?: string; onNoticeSeen: () => void;
  onChanged: (thread: ConversationThread) => void; onDemoStep: (step: DemoStep) => void;
}) {
  const resolved = conversation.group === "done";
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"send" | "state" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const field = useGrowingField(draft);
  const sendAttempt: Attempt = useRef(null);
  const resolveAttempt: Attempt = useRef(null);
  const reopenAttempt: Attempt = useRef(null);
  const step = { id: conversation.id, version: controls.version, onChanged, onError: setError };
  const body = draft.trim();

  function clear() {
    setError("");
    setDone("");
    onNoticeSeen();
  }

  async function send() {
    if (!body || busy) return;
    clear();
    if (!live) { onDemoStep({ kind: "reply", body }); setDraft(""); return; }
    setBusy("send");
    if (await runStep({ ...step, attempt: sendAttempt, call: (input) => writeService({ ...input, kind: "reply", body }) })) setDraft("");
    setBusy(null);
  }

  async function toggle() {
    if (busy) return;
    const answer = !resolved && body ? body : undefined;
    const said = resolved ? "Die Meldung ist wieder offen." : answer ? "Antwort gesendet, Meldung erledigt." : "Meldung erledigt.";
    clear();
    if (!live) {
      onDemoStep(resolved ? { kind: "reopen" } : { kind: "resolve", body: answer });
      if (answer) setDraft("");
      setDone(said);
      return;
    }
    setBusy("state");
    const ok = await runStep(resolved
      ? { ...step, attempt: reopenAttempt, call: reopenTeamIssue }
      : { ...step, attempt: resolveAttempt, call: (input) => resolveTeamIssue({ ...input, body: answer }) });
    if (ok) { if (answer) setDraft(""); setDone(said); }
    setBusy(null);
  }

  const said = done || notice;
  return (
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {/* A new key per state, so the bar comes in again when the report is finished or reopened. */}
      <div key={resolved ? "done" : "open"} className={`chat-handback is-issue${resolved ? " is-done" : ""}`}>
        <span className="chat-handback-icon" aria-hidden="true">{resolved ? <CircleCheck size={18} /> : <Wrench size={17} />}</span>
        <div className="chat-handback-text">
          <strong>{resolved ? "Erledigt" : "Meldung aus dem Team"}</strong>
          <p>{resolved ? "Taucht das Problem wieder auf, öffne die Meldung erneut." : "Offen, bis jemand aus dem Team sie erledigt."}</p>
        </div>
        <button type="button" className={`chat-card-action${resolved ? "" : " is-primary"}`} disabled={busy !== null} onClick={() => void toggle()}>
          {busy === "state" && <MiniLoader size={14} />}{resolved ? "Wieder öffnen" : body ? "Antworten & erledigen" : "Als erledigt markieren"}
        </button>
      </div>
      {error && <p className="form-error chat-error" role="alert">{error}</p>}
      {said && <p className="chat-hint is-done" role="status"><Check size={14} aria-hidden="true" />{said}</p>}
      <ComposeRow id={`service-field-${conversation.id}`} label="Antwort an das Team" sendLabel="Antwort an das Team senden" field={field} value={draft} placeholder="Antwort an das Team …"
        disabled={busy !== null} sending={busy === "send"} canSend={busy === null && Boolean(body)}
        onChange={(value) => { setDraft(value); sendAttempt.current = null; resolveAttempt.current = null; setDone(""); onNoticeSeen(); }} />
      <p className="chat-hint">{!live ? "Vorschau: Neue Nachrichten bleiben in diesem Fenster und gehen an niemanden." : resolved ? "Eine Antwort lässt die Meldung erledigt." : "Das Team liest die Antwort hier und in NoteTree Business."}</p>
    </form>
  );
}
