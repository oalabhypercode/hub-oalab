"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { MAX_QUESTION_CHARS, MAX_TURNS, type AssistantTurn } from "@/lib/hub-assistant/conversation";
import { Modal } from "./modal";

const suggestions = {
  customer: ["Wie frage ich einen Termin an?", "Wo finde ich meine Dateien?", "Was bedeutet „Dein Feedback“?", "Wie ändere ich den Hintergrund?"],
  admin: ["Wie lade ich eine Datei für einen Kunden hoch?", "Wie nehme ich eine Terminanfrage an?", "Wie hinterlege ich einen Teams-Link?", "Was sehen Kunden von meinem Kalender?"],
};

type PanelProps = {
  turns: AssistantTurn[];
  setTurns: (turns: AssistantTurn[]) => void;
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
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns, error]);

  async function ask(question: string) {
    const text = question.trim().slice(0, MAX_QUESTION_CHARS);
    if (!text || busy) return;
    const history: AssistantTurn[] = [...turns, { role: "user", content: text }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-MAX_TURNS) }),
      });
      // Without a session the proxy redirects to the login page instead of answering.
      if (response.redirected) throw new Error("Der Assistent ist nur mit echtem Login verfügbar.");
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "Der Assistent ist gerade nicht erreichbar.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setTurns([...history, { role: "assistant", content: answer }]);
      }
      if (!answer.trim()) throw new Error("Es kam keine Antwort. Bitte versuche es erneut.");
    } catch (failure) {
      // Back to the state before the question, which returns to the input for a retry.
      setTurns(turns);
      setDraft(text);
      setError(failure instanceof Error ? failure.message : "Der Assistent ist gerade nicht erreichbar.");
    } finally {
      setBusy(false);
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
          <p>Ich bin der KI-Assistent von oalab und erkläre dir die Funktionen des Client Hub. Bei Fragen zu deinem Projekt ist dein OALAB-Team die erste Anlaufstelle.</p>
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
                : <span className="assistant-typing" role="status"><Loader2 size={16} className="spin" aria-hidden="true" />Antwort wird geschrieben …</span>}
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
        <span>Die Antworten erzeugt eine KI (Claude von Anthropic) anhand der Hub-Dokumentation und können Fehler enthalten. Bitte keine persönlichen Daten eingeben.</span>
        {turns.length > 0 && <button type="button" onClick={() => { setTurns([]); setError(""); }} disabled={busy}><RotateCcw size={14} aria-hidden="true" />Neu starten</button>}
      </div>
    </Modal>
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
