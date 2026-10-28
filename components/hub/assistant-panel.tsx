"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, Loader2, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { MAX_QUESTION_CHARS, MAX_TURNS, type AssistantTurn } from "@/lib/hub-assistant/conversation";
import { proposalNote, type ProposalView, type TaskChoice } from "@/lib/hub-assistant/proposals";
import { confirmTaskProposal, discardTaskProposal } from "@/lib/hub-assistant/actions";
import { formatDeadline } from "@/lib/hub-data";
import { Modal } from "./modal";

/** A task proposal as the chat shows it: the stored proposal, the admin's switches and what happened to it. */
type ProposalState = { view: ProposalView; choices: TaskChoice[]; state: "open" | "saving" | "saved" | "discarded" | "failed"; message?: string; saved?: number };

/** A chat turn; assistant turns may carry task proposals (admins only). */
export type ChatTurn = AssistantTurn & { proposals?: ProposalState[] };

/** What goes to the server: plain text, with a factual note on each proposal so Claude knows what was saved. */
function toApiTurn(turn: ChatTurn): AssistantTurn {
  if (turn.role !== "assistant" || !turn.proposals?.length) return { role: turn.role, content: turn.content };
  const notes = turn.proposals.map((item) => proposalNote(item.view, item.state === "saved" ? "saved" : item.state === "discarded" ? "discarded" : item.state === "failed" ? "failed" : "open", item.saved));
  return { role: "assistant", content: [turn.content, ...notes].filter(Boolean).join("\n\n") };
}

const suggestions = {
  customer: ["Wie frage ich einen Termin an?", "Wo finde ich meine Dateien?", "Was bedeutet „Dein Feedback“?", "Wie ändere ich den Hintergrund?"],
  admin: ["Welche Aufgaben liegen gerade bei Kunden?", "Welche Projekte sind überfällig?", "Wie nehme ich eine Terminanfrage an?", "Wie lade ich eine Datei für einen Kunden hoch?"],
};

type PanelProps = {
  turns: ChatTurn[];
  setTurns: React.Dispatch<React.SetStateAction<ChatTurn[]>>;
  admin: boolean;
  /** False for the preview and the public demo, which have no real login. */
  available: boolean;
  onClose: () => void;
};

/** Chat with the hub assistant (Claude); the conversation lives in the shell so it survives page changes. */
export function AssistantPanel({ turns, setTurns, admin, available, onClose }: PanelProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** What the assistant is looking up right now, e.g. "Suche „Müller“ …". */
  const [status, setStatus] = useState("");
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns, error]);

  async function ask(question: string) {
    const text = question.trim().slice(0, MAX_QUESTION_CHARS);
    if (!text || busy) return;
    const history: ChatTurn[] = [...turns, { role: "user", content: text }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError("");
    setStatus("");
    setBusy(true);
    try {
      // The open page, so "dieses Projekt" works; the server only passes on a project the admin can see.
      const url = new URL(window.location.href);
      const context = { section: url.pathname.split("/")[2] || "overview", projectId: url.searchParams.get("project") };
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-MAX_TURNS).map(toApiTurn), context }),
      });
      // Without a session the proxy redirects to the login page instead of answering.
      if (response.redirected) throw new Error("Der Assistent ist nur mit echtem Login verfügbar.");
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "Der Assistent ist gerade nicht erreichbar.");
      }
      // One JSON event per line: answer text, a note on what is being looked up, or an error.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      let buffer = "";
      const proposals: ProposalState[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = done ? "" : lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { t: "text" | "tool" | "proposal" | "error"; v: string };
          if (event.t === "error") throw new Error(event.v);
          if (event.t === "tool") { setStatus(event.v); continue; }
          if (event.t === "proposal") {
            // New tasks start as the assistant proposed them; the admin can switch each one before saving.
            const view = JSON.parse(event.v) as ProposalView;
            proposals.push({ view, choices: view.tasks.map((task) => ({ include: !task.duplicate, customer: task.customer, visible: task.visible })), state: "open" });
          } else {
            answer += event.v;
            setStatus("");
          }
          setTurns([...history, { role: "assistant", content: answer, ...(proposals.length ? { proposals: [...proposals] } : {}) }]);
        }
        if (done) break;
      }
      if (!answer.trim() && !proposals.length) throw new Error("Es kam keine Antwort. Bitte versuche es erneut.");
    } catch (failure) {
      // Back to the state before the question, which returns to the input for a retry.
      setTurns(turns);
      setDraft(text);
      setError(failure instanceof Error ? failure.message : "Der Assistent ist gerade nicht erreichbar.");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  /** Changes one proposal in place; functional, because the server answer arrives after other updates. */
  function patchProposal(turnIndex: number, proposalIndex: number, patch: Partial<ProposalState>) {
    setTurns((current) => current.map((turn, index) => index !== turnIndex || !turn.proposals ? turn
      : { ...turn, proposals: turn.proposals.map((item, position) => position === proposalIndex ? { ...item, ...patch } : item) }));
  }

  async function decide(turnIndex: number, proposalIndex: number, item: ProposalState, save: boolean) {
    patchProposal(turnIndex, proposalIndex, { state: "saving", message: undefined });
    try {
      if (save) {
        const result = await confirmTaskProposal({ id: item.view.id, choices: item.choices });
        patchProposal(turnIndex, proposalIndex, result.ok
          ? { state: "saved", saved: result.data.saved, message: `${result.data.saved === 1 ? "Eine Aufgabe" : `${result.data.saved} Aufgaben`} gespeichert: ${result.data.taskNumbers.map((number) => `#${number}`).join(", ")}.` }
          : { state: result.error.includes("Nichts wurde gespeichert") ? "failed" : "open", message: result.error });
      } else {
        const result = await discardTaskProposal({ id: item.view.id });
        patchProposal(turnIndex, proposalIndex, result.ok ? { state: "discarded", message: "Verworfen, nichts gespeichert." } : { state: "open", message: result.error });
      }
    } catch {
      patchProposal(turnIndex, proposalIndex, { state: "open", message: "Keine Verbindung. Bitte erneut versuchen." });
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask(draft);
    }
  }

  return (
    <Modal title="Wie können wir helfen?" onClose={onClose} className="assistant-modal">
      <div className="assistant-messages" ref={list} aria-live="polite">
        <div className="assistant-intro">
          <span className="assistant-avatar" aria-hidden="true"><Sparkles size={18} /></span>
          <p>{admin
            ? "Ich bin der KI-Assistent von oalab. Ich erkläre den Client Hub, lese für dich Kunden, Projekte und Aufgaben und schlage neue Aufgaben vor (mit aktivem Zwei-Faktor-Schutz). Gespeichert wird erst, wenn du in der Vorschau auf „Speichern“ klickst."
            : "Ich bin der KI-Assistent von oalab und erkläre dir die Funktionen des Client Hub. Bei Fragen zu deinem Projekt ist dein OALAB-Team die erste Anlaufstelle."}</p>
        </div>
        {!available && <p className="assistant-note">Der Assistent ist mit einem echten Login verfügbar. In der Vorschau und der öffentlichen Demo werden keine Fragen an Claude gesendet.</p>}
        {available && !turns.length && (
          <ul className="assistant-suggestions" aria-label="Vorschläge">
            {suggestions[admin ? "admin" : "customer"].map((question) => <li key={question}><button type="button" onClick={() => ask(question)}>{question}</button></li>)}
          </ul>
        )}
        {turns.map((turn, index) => (
          <div key={index} className={`assistant-turn assistant-turn-${turn.role}`}>
            {turn.role === "assistant" && <span className="assistant-avatar" aria-hidden="true"><Sparkles size={18} /></span>}
            <div className="assistant-bubble">
              {turn.role === "user" ? turn.content
                : turn.content ? <AssistantText text={turn.content} />
                : !turn.proposals?.length && <span className="assistant-typing" role="status"><Loader2 size={16} className="spin" aria-hidden="true" />{status || "Antwort wird geschrieben …"}</span>}
              {turn.proposals?.map((item, position) => (
                <ProposalCard key={item.view.id} item={item}
                  onChoose={(choices) => patchProposal(index, position, { choices })}
                  onDecide={(save) => decide(index, position, item, save)} />
              ))}
            </div>
          </div>
        ))}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      {available && (
        <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={MAX_QUESTION_CHARS}
            placeholder="Frag mich etwas zum Client Hub …"
            aria-label="Frage an den Assistenten"
            disabled={busy}
          />
          <button type="submit" className="assistant-send" disabled={busy || !draft.trim()} aria-label="Frage senden">{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}</button>
        </form>
      )}
      <div className="assistant-footer">
        <span>Die Antworten erzeugt eine KI (Claude von Anthropic) anhand der Hub-Dokumentation{admin ? " und der Daten im Hub" : ""} und können Fehler enthalten. Bitte keine persönlichen Daten eingeben.</span>
        {turns.length > 0 && <button type="button" onClick={() => { setTurns([]); setError(""); }} disabled={busy}><RotateCcw size={14} aria-hidden="true" />Neu starten</button>}
      </div>
    </Modal>
  );
}

/** Preview of proposed tasks: the admin picks, switches owner and release, then saves or discards. */
function ProposalCard({ item, onChoose, onDecide }: { item: ProposalState; onChoose: (choices: TaskChoice[]) => void; onDecide: (save: boolean) => void }) {
  const { view, choices, state } = item;
  const editable = state === "open";
  const chosen = choices.filter((choice) => choice.include).length;
  const set = (index: number, patch: Partial<TaskChoice>) => onChoose(choices.map((choice, position) => position === index ? { ...choice, ...patch } : choice));
  const until = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(view.expiresAt));
  return (
    <section className={`proposal-card is-${state}`} aria-label={`Vorschlag: Aufgaben für ${view.projectName}`}>
      <header>
        <strong>Vorschlag · {view.tasks.length === 1 ? "1 Aufgabe" : `${view.tasks.length} Aufgaben`}</strong>
        <span>{[view.customer, view.projectName].filter(Boolean).join(" · ")}</span>
      </header>
      <ul>
        {view.tasks.map((task, index) => (
          <li key={index} className={choices[index].include ? undefined : "is-off"}>
            <label className="proposal-pick">
              <input type="checkbox" checked={choices[index].include} disabled={!editable} onChange={(event) => set(index, { include: event.target.checked })} />
              <span>{task.title}</span>
            </label>
            {task.description && <p className="proposal-description">{task.description}</p>}
            <div className="proposal-switches">
              <button type="button" disabled={!editable} aria-pressed={choices[index].customer} onClick={() => set(index, { customer: !choices[index].customer })}>{choices[index].customer ? "Kunde" : "OALAB"}</button>
              <button type="button" disabled={!editable} aria-pressed={choices[index].visible} onClick={() => set(index, { visible: !choices[index].visible })}>{choices[index].visible ? "Für Kunde sichtbar" : "Intern"}</button>
              <span>{task.dueOn ? `bis ${formatDeadline(task.dueOn)}` : "ohne Fälligkeit"}</span>
            </div>
            {task.duplicate && <p className="proposal-warning"><TriangleAlert size={14} aria-hidden="true" /> Eine offene Aufgabe mit diesem Titel gibt es schon.</p>}
            {choices[index].customer && !choices[index].visible && choices[index].include && <p className="proposal-hint">Der Kunde sieht diese Aufgabe erst, wenn sie freigegeben ist.</p>}
          </li>
        ))}
      </ul>
      {item.message && <p className={state === "saved" ? "proposal-done" : state === "discarded" ? "proposal-hint" : "form-error"} role="status">{state === "saved" && <Check size={15} aria-hidden="true" />} {item.message}</p>}
      {state === "saved" && <Link className="proposal-link" href={`/dashboard/projects?project=${view.projectId}`}>Im Projekt ansehen</Link>}
      {(state === "open" || state === "saving") && (
        <div className="proposal-actions">
          <button type="button" className="proposal-discard" disabled={state === "saving"} onClick={() => onDecide(false)}>Verwerfen</button>
          <button type="button" className="proposal-save" disabled={state === "saving" || !chosen} onClick={() => onDecide(true)}>
            {state === "saving" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}{chosen === 1 ? "1 Aufgabe speichern" : `${chosen} Aufgaben speichern`}
          </button>
        </div>
      )}
      {state === "open" && <p className="proposal-expiry">Noch nicht gespeichert · gültig bis {until} Uhr</p>}
    </section>
  );
}

/** **bold** inside a line; everything else stays plain text (no HTML from the model is ever rendered). */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.length > 4 && part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>);
}

/** Renders the small format the assistant is asked to use: paragraphs, "- " lists, "1. " steps and bold. */
function AssistantText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    paragraph = [];
    list = null;
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const step = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? step;
    if (item) {
      const ordered = Boolean(step);
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[1]);
    } else if (!line.trim()) {
      flush();
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return <>{blocks}</>;
}
