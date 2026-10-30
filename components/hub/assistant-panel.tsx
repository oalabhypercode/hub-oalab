"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Building2, Check, ChevronDown, ChevronUp, FolderPen, ListChecks, ListPlus, Loader2, PanelRightClose, PanelRightOpen, RotateCcw, Sparkles, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { isExpired } from "@/lib/hub-assistant/chat-storage";
import { MAX_ADMIN_QUESTION_CHARS, MAX_QUESTION_CHARS, MAX_TURNS, type AssistantTurn } from "@/lib/hub-assistant/conversation";
import { proposalNote, type ProposalView, type TaskChoice } from "@/lib/hub-assistant/proposals";
import { confirmCustomerProposal, confirmProjectUpdate, confirmTaskProposal, confirmTaskUpdates, discardTaskProposal, type CustomerCreated } from "@/lib/hub-assistant/actions";
import { changeNote, projectChangeLine, taskChangeLines, type ChangeLine, type ChangeView } from "@/lib/hub-assistant/updates";
import { contactLines, customerNote, type CustomerChoice, type CustomerView } from "@/lib/hub-assistant/customers";
import { formatDeadline } from "@/lib/hub-data";
import { Modal } from "./modal";

/** New tasks (Schritt 3/4), a change to a project or to existing tasks (Schritt 5) or a new customer (Schritt 6). */
type AnyView = (ProposalView & { kind?: "tasks.create" }) | ChangeView | CustomerView;

/**
 * A proposal as the chat shows it: the stored proposal, the admin's choices and what happened to it.
 * New tasks use `choices` (pick and switch), changes use `picks` (one tick per field or task), a customer `customer`.
 */
type ProposalState = { view: AnyView; choices: TaskChoice[]; picks: boolean[]; customer?: CustomerChoice; state: "open" | "saving" | "saved" | "discarded" | "failed" | "expired"; message?: string; saved?: number };

/** What a card shows: an open proposal past its 30 minutes counts as expired without asking the server. */
const shownState = (item: ProposalState) => isExpired(item) ? "expired" : item.state;

const isChange = (view: AnyView): view is ChangeView => view.kind === "project.update" || view.kind === "tasks.update";
const isCustomer = (view: AnyView): view is CustomerView => view.kind === "customer.create";

/** The outcome of creating a customer in one or two sentences; the activation link stays in the user management. */
function customerMessage(result: CustomerCreated) {
  const created = `Angelegt: ${result.company} · ${result.customerNumber}.`;
  if (result.login === "failed") return `${created} Der Login wurde nicht angelegt: ${result.loginError ?? "unbekannter Fehler"}`;
  if (result.login === "none") return created;
  if (result.mail === "sent") return `${created} Login angelegt, die Einladung ist per E-Mail unterwegs.`;
  if (result.mail === "failed") return `${created} Login angelegt, aber die Einladungs-Mail ist fehlgeschlagen. Den Aktivierungslink gibt es im User Management.`;
  return `${created} Login angelegt. Den Aktivierungslink erzeugst oder verschickst du im User Management.`;
}

/** A chat turn; assistant turns may carry task proposals (admins only). */
export type ChatTurn = AssistantTurn & { proposals?: ProposalState[] };

/** What goes to the server: plain text, with a factual note on each proposal so Claude knows what was saved. */
function toApiTurn(turn: ChatTurn): AssistantTurn {
  if (turn.role !== "assistant" || !turn.proposals?.length) return { role: turn.role, content: turn.content };
  const notes = turn.proposals.map((item) => {
    const state = shownState(item);
    // An expired proposal saved nothing; the notes know no "expired", "failed" with the message comes closest.
    const outcome = state === "saved" ? "saved" : state === "discarded" ? "discarded" : state === "failed" || state === "expired" ? "failed" : "open";
    return isCustomer(item.view) ? customerNote(item.view, outcome, item.message)
      : isChange(item.view) ? changeNote(item.view, outcome, item.message)
      : proposalNote(item.view, outcome, item.saved);
  });
  return { role: "assistant", content: [turn.content, ...notes].filter(Boolean).join("\n\n") };
}

const suggestions = {
  customer: ["Wie frage ich einen Termin an?", "Wo finde ich meine Dateien?", "Was bedeutet „Dein Feedback“?", "Wie ändere ich den Hintergrund?"],
  admin: ["Welche Aufgaben liegen gerade bei Kunden?", "Welche Projekte sind überfällig?", "Wie nehme ich eine Terminanfrage an?", "Wie lade ich eine Datei für einen Kunden hoch?"],
};

/** A window on top of the page, or a sidebar next to it that leaves the page usable (from 1024 px). */
export type AssistantMode = "window" | "dock";

type PanelProps = {
  turns: ChatTurn[];
  setTurns: React.Dispatch<React.SetStateAction<ChatTurn[]>>;
  admin: boolean;
  /** False for the preview and the public demo, which have no real login. */
  available: boolean;
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  /** The project "Assistent zu diesem Projekt fragen" was opened from; it stays the reference until removed. */
  project: { id: string; name: string } | null;
  onClearProject: () => void;
  onClose: () => void;
};

/** Chat with the hub assistant (Claude); the conversation lives in the shell (and the browser) so it survives page changes. */
export function AssistantPanel({ turns, setTurns, admin, available, mode, onModeChange, project, onClearProject, onClose }: PanelProps) {
  // Admins paste meeting transcripts; the server applies the same limit by role.
  const limit = admin ? MAX_ADMIN_QUESTION_CHARS : MAX_QUESTION_CHARS;
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
    const text = question.trim().slice(0, limit);
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
      const context = { section: url.pathname.split("/")[2] || "overview", projectId: url.searchParams.get("project") ?? project?.id ?? null };
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
            const view = JSON.parse(event.v) as AnyView;
            if (isCustomer(view)) {
              // A new customer starts with the default package and the offered login ticked; the invitation mail stays off.
              proposals.push({ view, choices: [], picks: [], customer: { planId: view.planId, login: Boolean(view.login && !view.login.taken), mail: false }, state: "open" });
            } else if (isChange(view)) {
              // A change starts with every field or task ticked, as the assistant proposed it.
              proposals.push({ view, choices: [], picks: (view.kind === "project.update" ? view.changes : view.tasks).map(() => true), state: "open" });
            } else {
              // New tasks start as proposed; possible duplicates and tasks whose quote is not in the pasted text start deselected.
              proposals.push({ view, choices: view.tasks.map((task) => ({ include: !task.duplicate && !task.unsupported, customer: task.customer, visible: task.visible })), picks: [], state: "open" });
            }
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
      if (save && item.view.kind === "customer.create") {
        const result = await confirmCustomerProposal({ id: item.view.id, choice: item.customer });
        patchProposal(turnIndex, proposalIndex, result.ok
          ? { state: "saved", saved: 1, message: customerMessage(result.data) }
          : { state: result.error.includes("Nichts wurde") ? "failed" : "open", message: result.error });
      } else if (save && item.view.kind === "project.update") {
        const result = await confirmProjectUpdate({ id: item.view.id, picks: item.picks });
        patchProposal(turnIndex, proposalIndex, result.ok
          ? { state: "saved", saved: result.data.saved, message: `${result.data.saved === 1 ? "Eine Änderung" : `${result.data.saved} Änderungen`} am Projekt gespeichert.` }
          : { state: result.error.includes("Nichts wurde") ? "failed" : "open", message: result.error });
      } else if (save && item.view.kind === "tasks.update") {
        const result = await confirmTaskUpdates({ id: item.view.id, picks: item.picks });
        if (!result.ok) {
          patchProposal(turnIndex, proposalIndex, { state: "open", message: result.error });
        } else {
          const { saved, stale, failed } = result.data;
          const list = (numbers: number[]) => numbers.map((number) => `#${number}`).join(", ");
          const message = [
            saved.length ? `Gespeichert: ${list(saved)}.` : "Nichts wurde gespeichert.",
            stale.length ? `Nicht gespeichert, weil inzwischen im Studio geändert: ${list(stale)}.` : "",
            failed.length ? `Nicht gespeichert (Fehler): ${list(failed)}.` : "",
          ].filter(Boolean).join(" ");
          patchProposal(turnIndex, proposalIndex, { state: saved.length ? "saved" : "failed", saved: saved.length, message });
        }
      } else if (save) {
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

  const title = "Wie können wir helfen?";
  const modeToggle = (
    <button type="button" className="assistant-mode" onClick={() => onModeChange(mode === "dock" ? "window" : "dock")}
      aria-label={mode === "dock" ? "Als Fenster öffnen" : "Rechts andocken"} title={mode === "dock" ? "Als Fenster öffnen" : "Rechts andocken, die Seite bleibt bedienbar"}>
      {mode === "dock" ? <PanelRightClose size={19} aria-hidden="true" /> : <PanelRightOpen size={19} aria-hidden="true" />}
    </button>
  );
  const body = <>
      <div className="assistant-messages" ref={list} aria-live="polite">
        <div className="assistant-intro">
          <span className="assistant-avatar" aria-hidden="true"><Sparkles size={18} /></span>
          <p>{admin
            ? "Ich bin der KI-Assistent von oalab. Ich erkläre den Client Hub, lese für dich Kunden, Projekte und Aufgaben, schlage neue Aufgaben, Änderungen und neue Kunden vor (mit aktivem Zwei-Faktor-Schutz). Gespeichert wird erst, wenn du in der Vorschau auf „Speichern“ klickst."
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
              {turn.proposals?.map((item, position) => isCustomer(item.view) ? (
                <CustomerCard key={item.view.id} item={item} view={item.view}
                  onChoose={(customer) => patchProposal(index, position, { customer })}
                  onDecide={(save) => decide(index, position, item, save)} />
              ) : isChange(item.view) ? (
                <ChangeCard key={item.view.id} item={item} view={item.view}
                  onPick={(picks) => patchProposal(index, position, { picks })}
                  onDecide={(save) => decide(index, position, item, save)} />
              ) : (
                <ProposalCard key={item.view.id} item={item} view={item.view}
                  onChoose={(choices) => patchProposal(index, position, { choices })}
                  onDecide={(save) => decide(index, position, item, save)} />
              ))}
            </div>
          </div>
        ))}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      {available && project && (
        <p className="assistant-context">
          <FolderPen size={14} aria-hidden="true" /><span>Bezug: <strong>{project.name}</strong></span>
          <button type="button" onClick={onClearProject} aria-label={`Bezug auf ${project.name} entfernen`}><X size={14} aria-hidden="true" /></button>
        </p>
      )}
      {available && (
        <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={limit}
            placeholder={admin ? "Frag mich etwas oder füge ein Meeting-Transkript ein …" : "Frag mich etwas zum Client Hub …"}
            aria-label="Frage an den Assistenten"
            disabled={busy}
          />
          <button type="submit" className="assistant-send" disabled={busy || !draft.trim()} aria-label="Frage senden">{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}</button>
        </form>
      )}
      <div className="assistant-footer">
        <span>{admin
          ? "Die Antworten erzeugt eine KI (Claude von Anthropic) anhand der Hub-Dokumentation und der Daten im Hub und können Fehler enthalten. Eingefügte Transkripte verarbeitet Anthropic im Auftrag von OALAB. Der Hub speichert sie nicht auf seinem Server; der Chatverlauf bleibt in diesem Browser, bis du „Neu starten“ klickst oder dich abmeldest."
          : "Die Antworten erzeugt eine KI (Claude von Anthropic) anhand der Hub-Dokumentation und können Fehler enthalten. Bitte keine persönlichen Daten eingeben. Der Chatverlauf bleibt in diesem Browser, bis du „Neu starten“ klickst oder dich abmeldest."}</span>
        {turns.length > 0 && <button type="button" onClick={() => { setTurns([]); setError(""); onClearProject(); }} disabled={busy}><RotateCcw size={14} aria-hidden="true" />Neu starten</button>}
      </div>
  </>;

  // Docked, the chat is no dialog: the page next to it stays usable. Below 1024 px CSS turns it into a full sheet.
  return mode === "dock" ? (
    <aside className="assistant-dock glass" aria-labelledby="assistant-dock-title">
      <div className="modal-heading"><h2 id="assistant-dock-title">{title}</h2>{modeToggle}<button type="button" className="modal-close" aria-label="Schließen" onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
      {body}
    </aside>
  ) : (
    <Modal title={title} onClose={onClose} className="assistant-modal" actions={modeToggle}>{body}</Modal>
  );
}

const kinds: Record<AnyView["kind"] & string, { label: string; icon: LucideIcon }> = {
  "tasks.create": { label: "Neue Aufgaben", icon: ListPlus },
  "tasks.update": { label: "Aufgaben ändern", icon: ListChecks },
  "project.update": { label: "Projekt ändern", icon: FolderPen },
  "customer.create": { label: "Neuer Kunde", icon: Building2 },
};

const statusLabels: Record<ProposalState["state"], string> = {
  open: "Offen", saving: "Wird gespeichert …", saved: "Gespeichert", discarded: "Verworfen", failed: "Fehler", expired: "Abgelaufen",
};

/** Rows of a card: from six on only the first five show, until "Alle zeigen". */
const SHORT_LIST = 5;

function useShortList<T>(rows: T[]) {
  const [all, setAll] = useState(false);
  const hidden = rows.length > SHORT_LIST && !all ? rows.length - SHORT_LIST : 0;
  const shown = hidden ? rows.slice(0, SHORT_LIST) : rows;
  const toggle = rows.length > SHORT_LIST
    ? <button type="button" className="proposal-more" onClick={() => setAll(!all)}>{all ? <><ChevronUp size={14} aria-hidden="true" />Weniger zeigen</> : <><ChevronDown size={14} aria-hidden="true" />Alle {rows.length} zeigen</>}</button>
    : null;
  return { shown, toggle };
}

/**
 * The frame every proposal shares: kind, context and status on top; while open the body and the buttons, once decided
 * one line with the outcome that opens the details again. A decided card collapses on its own.
 */
function CardFrame({ item, kind, count, context, label, link, children, actions, expiryText }: {
  item: ProposalState;
  kind: keyof typeof kinds;
  count?: string;
  context: string;
  label: string;
  link?: { href: string; text: string };
  children: React.ReactNode;
  actions: React.ReactNode;
  expiryText: string;
}) {
  const state = shownState(item);
  const decided = state === "saved" || state === "discarded" || state === "failed" || state === "expired";
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? !decided;
  const { icon: Icon, label: kindLabel } = kinds[kind];
  const until = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.view.expiresAt));
  const summary = item.message ?? (state === "expired" ? "Abgelaufen (30 Minuten), nichts gespeichert. Bitte den Assistenten neu vorschlagen lassen." : state === "discarded" ? "Verworfen, nichts gespeichert." : "");
  return (
    <section className={`proposal-card is-${state}${open ? "" : " is-collapsed"}`} aria-label={label}>
      <header className="proposal-head">
        <span className="proposal-icon" aria-hidden="true"><Icon size={16} /></span>
        <span className="proposal-title">
          <strong>{kindLabel}{count ? ` · ${count}` : ""}</strong>
          {context && <span>{context}</span>}
        </span>
        <span className={`proposal-status is-${state}`}>{state === "open" ? `${statusLabels.open} · bis ${until}` : statusLabels[state]}</span>
      </header>
      {open && children}
      {summary && <p className={state === "saved" ? "proposal-done" : state === "discarded" || state === "expired" ? "proposal-hint" : "form-error"} role="status">{state === "saved" && <Check size={15} aria-hidden="true" />} {summary}</p>}
      {state === "saved" && link && <Link className="proposal-link" href={link.href}>{link.text}</Link>}
      {(state === "open" || state === "saving") && <>
        <div className="proposal-actions">{actions}</div>
        <p className="proposal-expiry">{expiryText} · gültig bis {until} Uhr</p>
      </>}
      {decided && <button type="button" className="proposal-more" onClick={() => setExpanded(!open)} aria-expanded={open}>{open ? <><ChevronUp size={14} aria-hidden="true" />Details ausblenden</> : <><ChevronDown size={14} aria-hidden="true" />Details zeigen</>}</button>}
    </section>
  );
}

/** Preview of a new customer: company and contact data, the package to pick and the optional login with its invitation. */
function CustomerCard({ item, view, onChoose, onDecide }: { item: ProposalState; view: CustomerView; onChoose: (choice: CustomerChoice) => void; onDecide: (save: boolean) => void }) {
  const state = shownState(item);
  const choice = item.customer ?? { planId: view.planId, login: false, mail: false };
  const editable = state === "open";
  const login = view.login;
  return (
    <CardFrame item={item} kind="customer.create" context={view.company} label={`Vorschlag: neuer Kunde ${view.company}`}
      link={{ href: "/dashboard/users", text: "Im User Management ansehen" }} expiryText="Noch nicht angelegt"
      actions={<>
        <button type="button" className="proposal-discard" disabled={state === "saving"} onClick={() => onDecide(false)}>Verwerfen</button>
        <button type="button" className="proposal-save" disabled={state === "saving"} onClick={() => onDecide(true)}>
          {state === "saving" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}Kunde anlegen
        </button>
      </>}>
      <p className="proposal-hint">Die Kundennummer vergibt der Hub beim Anlegen.</p>
      <ul>
        <li className="proposal-facts">
          <p className="proposal-company">{view.company}</p>
          {contactLines(view.contact).map((line) => (
            <p key={line.label} className="proposal-change"><span className="proposal-change-label">{line.label}: </span>{line.value}</p>
          ))}
          <label className="proposal-field">
            Service-Paket
            <select value={choice.planId} disabled={!editable} onChange={(event) => onChoose({ ...choice, planId: event.target.value })}>
              {view.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </label>
          {view.similar.map((other) => (
            <p key={other.customerNumber} className="proposal-warning"><TriangleAlert size={14} aria-hidden="true" /> {other.reason === "name" ? "Ähnlicher Kunde" : "Gleiche Kontakt-E-Mail wie"}: {other.company} ({other.customerNumber})</p>
          ))}
        </li>
        {login && (
          <li className={choice.login ? undefined : "is-off"}>
            {login.taken ? (
              <p className="proposal-hint">Für {login.email} gibt es schon einen Login, hier entsteht keiner.</p>
            ) : <>
              <label className="proposal-pick">
                <input type="checkbox" checked={choice.login} disabled={!editable} onChange={(event) => onChoose({ ...choice, login: event.target.checked, mail: event.target.checked && choice.mail })} />
                <span>Login für {login.firstName} {login.lastName} anlegen</span>
              </label>
              <p className="proposal-change">{login.email}</p>
              {choice.login && editable && (view.mailReady ? <>
                <label className="proposal-pick proposal-pick-sub">
                  <input type="checkbox" checked={choice.mail} disabled={!editable} onChange={(event) => onChoose({ ...choice, mail: event.target.checked })} />
                  <span>Einladungs-Mail an {login.email} senden</span>
                </label>
                {!choice.mail && <p className="proposal-hint">Ohne Mail erzeugst oder verschickst du den Aktivierungslink später im User Management.</p>}
              </> : <p className="proposal-hint">Der Mailversand ist nicht eingerichtet; den Aktivierungslink gibst du im User Management weiter.</p>)}
            </>}
          </li>
        )}
      </ul>
    </CardFrame>
  );
}

/** Preview of a change: every field or task as "old → new" with a tick; the admin saves the ticked ones or discards. */
function ChangeCard({ item, view, onPick, onDecide }: { item: ProposalState; view: ChangeView; onPick: (picks: boolean[]) => void; onDecide: (save: boolean) => void }) {
  const { picks } = item;
  const state = shownState(item);
  const editable = state === "open";
  const chosen = picks.filter(Boolean).length;
  const toggle = (index: number) => onPick(picks.map((pick, position) => position === index ? !pick : pick));
  const rows: { key: string; title?: string; lines: ChangeLine[] }[] = view.kind === "project.update"
    ? view.changes.map((change) => ({ key: change.field, lines: [projectChangeLine(change)] }))
    : view.tasks.map((task) => ({ key: task.taskId, title: `#${task.number} ${task.before.title}`, lines: taskChangeLines(task) }));
  const { shown, toggle: more } = useShortList(rows);
  return (
    <CardFrame item={item} kind={view.kind} count={view.kind === "tasks.update" ? (view.tasks.length === 1 ? "1 Aufgabe" : `${view.tasks.length} Aufgaben`) : undefined}
      context={[view.customer, view.projectName].filter(Boolean).join(" · ")} label={`Änderungsvorschlag für ${view.projectName}`}
      link={{ href: `/dashboard/projects?project=${view.projectId}`, text: "Im Projekt ansehen" }} expiryText="Noch nicht gespeichert"
      actions={<>
        <button type="button" className="proposal-discard" disabled={state === "saving"} onClick={() => onDecide(false)}>Verwerfen</button>
        <button type="button" className="proposal-save" disabled={state === "saving" || !chosen} onClick={() => onDecide(true)}>
          {state === "saving" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}{chosen === 1 ? "1 Änderung speichern" : `${chosen} Änderungen speichern`}
        </button>
      </>}>
      <ul>
        {shown.map((row, index) => (
          <li key={row.key} className={picks[index] ? undefined : "is-off"}>
            <label className="proposal-pick">
              <input type="checkbox" checked={picks[index]} disabled={!editable} onChange={() => toggle(index)} />
              <span>{row.title ?? row.lines[0].label}</span>
            </label>
            {row.lines.map((line) => (
              <p key={line.label} className="proposal-change">
                {row.title && <span className="proposal-change-label">{line.label}: </span>}
                {line.before ? <><del>{line.before}</del> → </> : "+ "}<strong>{line.after}</strong>
              </p>
            ))}
          </li>
        ))}
      </ul>
      {more}
    </CardFrame>
  );
}

/** Preview of proposed tasks: the admin picks, switches owner and release, then saves or discards. */
function ProposalCard({ item, view, onChoose, onDecide }: { item: ProposalState; view: ProposalView; onChoose: (choices: TaskChoice[]) => void; onDecide: (save: boolean) => void }) {
  const { choices } = item;
  const state = shownState(item);
  const editable = state === "open";
  const chosen = choices.filter((choice) => choice.include).length;
  const set = (index: number, patch: Partial<TaskChoice>) => onChoose(choices.map((choice, position) => position === index ? { ...choice, ...patch } : choice));
  const { shown, toggle: more } = useShortList(view.tasks);
  return (
    <CardFrame item={item} kind="tasks.create" count={view.tasks.length === 1 ? "1 Aufgabe" : `${view.tasks.length} Aufgaben`}
      context={[view.customer, view.projectName].filter(Boolean).join(" · ")} label={`Vorschlag: Aufgaben für ${view.projectName}`}
      link={{ href: `/dashboard/projects?project=${view.projectId}`, text: "Im Projekt ansehen" }} expiryText="Noch nicht gespeichert"
      actions={<>
        <button type="button" className="proposal-discard" disabled={state === "saving"} onClick={() => onDecide(false)}>Verwerfen</button>
        <button type="button" className="proposal-save" disabled={state === "saving" || !chosen} onClick={() => onDecide(true)}>
          {state === "saving" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}{chosen === 1 ? "1 Aufgabe speichern" : `${chosen} Aufgaben speichern`}
        </button>
      </>}>
      <ul>
        {shown.map((task, index) => (
          <li key={index} className={choices[index].include ? undefined : "is-off"}>
            <label className="proposal-pick">
              <input type="checkbox" checked={choices[index].include} disabled={!editable} onChange={(event) => set(index, { include: event.target.checked })} />
              <span>{task.title}</span>
            </label>
            {task.description && <p className="proposal-description">{task.description}</p>}
            {view.evidence?.[index] && <blockquote className="proposal-evidence">„{view.evidence[index]}“</blockquote>}
            <div className="proposal-switches">
              <button type="button" disabled={!editable} aria-pressed={choices[index].customer} onClick={() => set(index, { customer: !choices[index].customer })}>{choices[index].customer ? "Kunde" : "OALAB"}</button>
              <button type="button" disabled={!editable} aria-pressed={choices[index].visible} onClick={() => set(index, { visible: !choices[index].visible })}>{choices[index].visible ? "Für Kunde sichtbar" : "Intern"}</button>
              <span>{task.dueOn ? `bis ${formatDeadline(task.dueOn)}` : "ohne Fälligkeit"}</span>
            </div>
            {task.duplicate && <p className="proposal-warning"><TriangleAlert size={14} aria-hidden="true" /> Eine offene Aufgabe mit diesem Titel gibt es schon.</p>}
            {task.unsupported && <p className="proposal-warning"><TriangleAlert size={14} aria-hidden="true" /> Dieses Zitat steht so nicht im eingefügten Text. Bitte prüfen.</p>}
            {choices[index].customer && !choices[index].visible && choices[index].include && <p className="proposal-hint">Der Kunde sieht diese Aufgabe erst, wenn sie freigegeben ist.</p>}
          </li>
        ))}
      </ul>
      {more}
    </CardFrame>
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
