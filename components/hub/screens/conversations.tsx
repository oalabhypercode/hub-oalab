"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, ChevronLeft, Info, Lock, MessagesSquare, PauseCircle, Search, SendHorizontal } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { HeaderActions } from "../app-shell";
import { LargeTitleHeader } from "../large-title-header";
import { PlainText, RichText } from "../rich-text";
import { CategoryTitle } from "./workspace";
import { LoadNotice } from "./overview";
import { CustomerSign } from "./customer-sign";
import { ChatTabs, PrivateChats, type ChatTab } from "./private-chat";
import type { ScreenProps } from "./types";
import { handBackService, openConversation, refreshConversations, writeService } from "@/lib/hub-conversations/actions";
import { demoConversations, demoStep, type DemoStep } from "@/lib/hub-conversations/fixtures";
import {
  CONVERSATION_FILTERS, MAX_MESSAGE_LENGTH, clockTime, conversationFilter, handBackCopy, listTime, messageSide, previewText, senderLabel,
  serviceWriteHint, threadItems, type ConversationFilter,
} from "@/lib/hub-conversations/rules";
import type { ConversationResult, ConversationsState, ConversationSummary, ConversationThread, ServiceControls, ServiceWriteKind } from "@/lib/hub-conversations/types";
import { demoPrivateChats } from "@/lib/hub-private-chat/fixtures";
import type { PrivateChatState } from "@/lib/hub-private-chat/types";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";

const POLL_MS = 15_000;

/**
 * Nachrichten (4 November 2026): customers write here with oalab in their private chat; requests go to the service
 * platform. Admins have two tabs: "Privat" with every customer's private chat to answer, and "Service" with every
 * request of the service platform, where they also step in: give a paused request back, write for the customer or
 * answer as oalab.
 */
export function ConversationsScreen({ admin, freelancer, firstName, company, asOf, conversations, privateChats }: ScreenProps & { conversations?: ConversationsState; privateChats?: PrivateChatState }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: ChatTab = admin && params.get("tab") === "service" ? "service" : "private";
  // The day labels follow the server's day, so the first render on the server and in the browser say the same.
  const now = useMemo(() => new Date(`${asOf}T12:00:00+01:00`), [asOf]);
  // The tab "Privat" counts what waits there, also while "Service" is open.
  const privateUnread = useMemo(() => (privateChats ?? demoPrivateChats({ firstName, company: company ?? null, admin }).state).chats.filter((chat) => chat.unread).length, [privateChats, firstName, company, admin]);
  const switchTab = (next: ChatTab) => { if (next !== tab) router.push(next === "service" ? `${pathname}?tab=service` : pathname, { scroll: false }); };
  // „Service“ counts the requests with a customer's message nobody of the team has opened yet (23.11.2026).
  const serviceUnread = conversations?.unread?.length ?? 0;
  const tabs = admin ? (unread: number, service: number) => <ChatTabs tab={tab} unread={unread} serviceUnread={service} onChange={switchTab} /> : undefined;

  return (
    <>
      <LargeTitleHeader title="Nachrichten" icon={<CategoryTitle category="messages" />} actions={<HeaderActions />} />
      {tab === "service"
        ? <ServiceConversations key="service" now={now} state={conversations} author={firstName} tabs={tabs ? (service) => tabs(privateUnread, service) : undefined} />
        : <PrivateChats key="private" admin={admin} freelancer={freelancer} firstName={firstName} company={company} now={now} state={privateChats} tabs={tabs ? (unread) => tabs(unread, serviceUnread) : undefined} />}
    </>
  );
}

function ServiceAvatar({ conversation }: { conversation: ConversationSummary }) {
  const company = conversation.company ?? conversation.title;
  return <CustomerSign customer={{ id: conversation.customerId ?? company, company }} logo={conversation.logo} />;
}

function lastLine(conversation: ConversationSummary) {
  const last = conversation.lastMessage;
  if (!last) return "Noch keine Nachricht";
  const text = previewText(last.body);
  return last.sender === "system" ? text : `${senderLabel(last.sender, last.name, last.onBehalf, conversation.company)}: ${text}`;
}

/** „oa 14“, „OA-14“ and „14“ all find OA-14. */
const compact = (value: string) => value.toLowerCase().replace(/[\s-]+/g, "");

/**
 * Every request of the service platform for admins, one list with its number and state: open one to read along and
 * step in. Answers and internal notes from NoteTree Business keep coming from there.
 */
function ServiceConversations({ now, state, author, tabs }: { now: Date; state?: ConversationsState; author: string; tabs?: (unread: number) => ReactNode }) {
  const fixtures = useMemo(() => state ? null : demoConversations(), [state]);
  const initial = state ?? fixtures!.state;
  const live = initial.source === "service";
  const [list, setList] = useState<readonly ConversationSummary[]>(initial.conversations);
  // Requests with a customer's message nobody of the team has opened yet; opening one counts for the team.
  const [unread, setUnread] = useState<ReadonlySet<string>>(() => new Set(initial.unread ?? []));
  const [loadError, setLoadError] = useState(initial.error);
  // The logos come signed with the first page; the look for news and opening a conversation keep them, so they do not load again.
  const [logos] = useState(() => new Map(initial.conversations.map((item) => [item.id, item.logo])));
  const router = useRouter();
  const pathname = usePathname();
  const openId = useSearchParams().get("conversation");
  const [liveThread, setLiveThread] = useState<ConversationThread | null>(null);
  const [threadError, setThreadError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  // The preview keeps its steps in this window: messages and controls per example.
  const [demo, setDemo] = useState(() => fixtures ? { messages: fixtures.messages, controls: fixtures.controls } : null);

  const withLogo = (item: ConversationSummary): ConversationSummary => ({ ...item, logo: logos.get(item.id) ?? item.logo });
  const conversation = list.find((item) => item.id === openId) ?? null;
  const thread: ConversationThread | null = live
    ? liveThread && liveThread.conversation.id === openId ? liveThread : null
    : conversation && demo ? { conversation, messages: demo.messages.get(conversation.id) ?? [], controls: demo.controls.get(conversation.id) ?? null } : null;

  useEffect(() => {
    if (!openId || !live) return;
    let current = true;
    openConversation({ id: openId }).then((result) => {
      if (!current) return;
      setThreadError(result.ok ? "" : result.error);
      if (result.ok) setLiveThread(result.data);
    }).catch(() => { if (current) setThreadError("Keine Verbindung. Bitte versuche es erneut."); });
    return () => { current = false; };
  }, [openId, live]);

  // Look for news every 15 seconds while the page is visible.
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshConversations().then((result) => {
        if (!result.ok) return;
        setLoadError(null);
        setList(result.data.conversations);
        setUnread(new Set(result.data.unread ?? []));
      }).catch(() => { /* the next look tries again */ });
      if (openId) openConversation({ id: openId }).then((result) => { if (result.ok) setLiveThread(result.data); }).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, openId]);

  /** A step of the team changed the request: the open conversation and its line in the list show the new state at once. */
  const changed = (next: ConversationThread) => {
    setLiveThread(next);
    setList((current) => current.map((item) => item.id === next.conversation.id ? next.conversation : item));
  };
  const demoChange = (step: DemoStep) => {
    if (!thread || !demo) return;
    const next = demoStep(thread, step, author || "Du", new Date().toISOString());
    setDemo({ messages: new Map(demo.messages).set(next.conversation.id, [...next.messages]), controls: new Map(demo.controls).set(next.conversation.id, next.controls!) });
    setList((current) => current.map((item) => item.id === next.conversation.id ? next.conversation : item));
  };

  const open = (id: string) => {
    setUnread((current) => { const next = new Set(current); next.delete(id); return next; });
    router.push(`${pathname}?tab=service&conversation=${encodeURIComponent(id)}`, { scroll: false });
  };
  const isNew = (item: ConversationSummary) => unread.has(item.id) && item.id !== openId;
  const close = () => router.push(`${pathname}?tab=service`, { scroll: false });

  const term = query.trim().toLowerCase();
  const found = [...list].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .filter((item) => !term || compact(item.reference).includes(compact(term)) || [item.title, item.company, item.lastMessage?.body].some((value) => value?.toLowerCase().includes(term)));
  const counts = { team: 0, customer: 0, done: 0 };
  for (const item of found) counts[conversationFilter(item)] += 1;
  const shown = filter === "all" ? found : found.filter((item) => conversationFilter(item) === filter);

  return (
    <div className="sheet chat section-first" data-open={thread || openId ? "true" : undefined}>
      <div className="chat-grid">
        <section className="chat-list" aria-label="Service-Anfragen">
          <div className="chat-list-head"><h2>Anfragen</h2></div>
          {tabs?.(list.filter(isNew).length)}
          <label className="chat-search"><Search size={16} aria-hidden="true" /><span className="visually-hidden">Anfragen durchsuchen</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nummer, Kunde, Thema oder Text" /></label>
          <div className="chat-filter is-wide" role="group" aria-label="Anfragen filtern">
            {CONVERSATION_FILTERS.map((item) => (
              <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label}{item.id !== "all" && counts[item.id] > 0 && <span>{counts[item.id]}</span>}
              </button>
            ))}
          </div>
          {loadError ? <div className="chat-list-note"><LoadNotice text={loadError} /></div>
          : shown.length ? (
            <ul className="chat-convs">
              {shown.map((item) => (
                <li key={item.id}>
                  <button type="button" className="chat-conv" aria-current={item.id === openId ? "true" : undefined} onClick={() => open(item.id)}>
                    <ServiceAvatar conversation={withLogo(item)} />
                    <span className="chat-conv-main">
                      <span className="chat-conv-top"><strong>{item.title}</strong><time dateTime={item.lastAt} className={isNew(item) ? "is-new" : undefined}>{listTime(item.lastAt, now)}</time></span>
                      <span className="chat-conv-company"><span className="chat-ref">{item.reference}</span>{item.company && <span>{item.company}</span>}</span>
                      <span className="chat-conv-sub">
                        <span className="chat-conv-last">{lastLine(item)}</span>
                        <StatePill conversation={item} />
                        {isNew(item) && <span className="chat-badge"><span className="visually-hidden">Neu</span></span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chat-empty">{!list.length ? "Noch keine Anfragen auf der Serviceplattform." : term ? "Keine Anfrage für diese Suche." : "Keine Anfrage in diesem Filter."}</p>
          )}
        </section>

        <section className="chat-pane" aria-label={thread ? `Anfrage ${thread.conversation.reference}: ${thread.conversation.title}` : "Anfrage"}>
          {thread ? (
            <ServiceThread key={thread.conversation.id} thread={{ ...thread, conversation: withLogo(thread.conversation) }} now={now} live={live} onClose={close} onChanged={changed} onDemoStep={demoChange} />
          ) : openId && live && !threadError ? (
            <div className="chat-placeholder"><MiniLoader size={22} /><span>Anfrage wird geladen …</span></div>
          ) : (
            <div className="chat-placeholder">
              <MessagesSquare size={30} aria-hidden="true" />
              <span>{threadError || (list.length ? "Wähle links eine Anfrage." : "Hier erscheinen die Anfragen der Serviceplattform.")}</span>
              {openId && <button type="button" className="text-link" onClick={close}>Zur Liste</button>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** The state as the customer reads it; a paused AI is what the team has to look at first. */
function StatePill({ conversation }: { conversation: ConversationSummary }) {
  return conversation.aiPaused
    ? <span className="chat-pill tone-todo">KI pausiert</span>
    : <span className={`chat-pill tone-${conversation.tone}`}>{conversation.stateLabel}</span>;
}

function ServiceThread({ thread, now, live, onClose, onChanged, onDemoStep }: {
  thread: ConversationThread; now: Date; live: boolean; onClose: () => void;
  onChanged: (thread: ConversationThread) => void; onDemoStep: (step: DemoStep) => void;
}) {
  const { conversation, messages, controls } = thread;
  const items = useMemo(() => threadItems(messages.map((message) => ({ ...message, author: `${message.sender}:${message.name ?? ""}:${message.onBehalf}` })), now), [messages, now]);
  const log = useRef<HTMLDivElement>(null);
  const subtitle = [conversation.reference, conversation.company].filter(Boolean).join(" · ");
  const serviceUrl = `${SERVICE_PLATFORM_URL}/workspace/requests/${encodeURIComponent(conversation.reference)}`;

  // New messages scroll into view, like in a messenger.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  return (
    <>
      <header className="chat-pane-head">
        <button type="button" className="chat-back" onClick={onClose} aria-label="Zurück zu den Anfragen"><ChevronLeft size={24} aria-hidden="true" /></button>
        <ServiceAvatar conversation={conversation} />
        <div className="chat-pane-title"><strong>{conversation.title}</strong><span>{subtitle}</span></div>
        <StatePill conversation={conversation} />
        <a className="chat-icon-button" href={serviceUrl} target="_blank" rel="noopener noreferrer" data-tip="In Service öffnen" aria-label={`${conversation.reference} in Service öffnen (neuer Tab)`}><ArrowUpRight size={19} aria-hidden="true" /></a>
      </header>
      <div className="chat-log" ref={log} role="log" aria-live="polite" aria-label="Nachrichten">
        {items.length ? items.map(({ message, day, first, last }) => {
          const side = messageSide(message.sender);
          return (
            <div key={message.id} className="chat-item">
              {day && <span className="chat-day">{day}</span>}
              {side === "center" ? (
                <p className="chat-system"><Info size={14} aria-hidden="true" />{message.body}</p>
              ) : (
                <div className={`chat-msg is-${side}${first ? " is-first" : ""}${last ? " is-last" : ""}${message.sender === "assistant" ? " is-assistant" : ""}${message.onBehalf ? " is-proxy" : ""}`}>
                  {first && <span className="chat-who">{senderLabel(message.sender, message.name, message.onBehalf, conversation.company)}</span>}
                  <div className="chat-bubble">
                    <div className={message.markdown ? "chat-text is-rich" : "chat-text"}>{message.markdown ? <RichText text={message.body} links /> : <PlainText text={message.body} />}</div>
                    <span className="chat-meta"><time dateTime={message.at}>{clockTime(message.at)}</time></span>
                  </div>
                </div>
              )}
            </div>
          );
        }) : <p className="chat-system">Noch keine Nachricht in dieser Anfrage.</p>}
      </div>
      {controls === null ? (
        <p className="chat-readonly"><Info size={16} aria-hidden="true" />Du liest mit. Antworten und interne Notizen von oalab entstehen in NoteTree Business.</p>
      ) : !controls.writable ? (
        <p className="chat-readonly"><Lock size={16} aria-hidden="true" />{conversation.group === "done"
          ? "Abgeschlossen. Hier schreibt niemand mehr; neue Wünsche kommen als neue Anfrage."
          : "Hier kann gerade niemand schreiben: Die Anfrage liegt im Papierkorb oder die Firma ist gesperrt."}</p>
      ) : (
        <ServiceComposer conversation={conversation} controls={controls} live={live} onChanged={onChanged} onDemoStep={onDemoStep} />
      )}
    </>
  );
}

type HandBackCopy = ReturnType<typeof handBackCopy>;
const sameCopy = (a: HandBackCopy | null, b: HandBackCopy | null) => a?.action === b?.action && a?.text === b?.text;

/**
 * The field of an open request: write for the customer (counts as their message, the AI takes it up) or as oalab, and
 * give a paused request back. Every step carries the request's version and one key per draft or click, so a double
 * click or a resend after a lost answer stays one step.
 */
function ServiceComposer({ conversation, controls, live, onChanged, onDemoStep }: {
  conversation: ConversationSummary; controls: ServiceControls; live: boolean;
  onChanged: (thread: ConversationThread) => void; onDemoStep: (step: DemoStep) => void;
}) {
  const company = conversation.company;
  const [kind, setKind] = useState<ServiceWriteKind>("on_behalf");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"send" | "hand_back" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  // The key and version of a step that got no answer; sending the same again repeats exactly that step.
  const sendAttempt = useRef<{ key: string; version: number } | null>(null);
  const handAttempt = useRef<{ key: string; version: number } | null>(null);

  // The banner stays on screen while it leaves, whoever gave the request back.
  const copy = controls.handBack ? handBackCopy(controls.handBack, company) : null;
  const [banner, setBanner] = useState<HandBackCopy | null>(copy);
  if (copy && !sameCopy(copy, banner)) setBanner(copy);

  // The field grows with the text up to a few lines.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

  async function run(attempt: { current: { key: string; version: number } | null }, call: (input: { id: string; version: number; key: string }) => Promise<ConversationResult<ConversationThread>>) {
    attempt.current ??= { key: crypto.randomUUID(), version: controls.version };
    try {
      const result = await call({ id: conversation.id, ...attempt.current });
      // The server answered: the next click is a new step.
      attempt.current = null;
      if (result.data) onChanged(result.data);
      if (!result.ok) setError(result.error);
      return result.ok;
    } catch {
      setError("Keine Verbindung. Bitte versuche es erneut.");
      return false;
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setError("");
    setDone("");
    if (!live) { onDemoStep({ kind, body }); setDraft(""); return; }
    setBusy("send");
    if (await run(sendAttempt, (input) => writeService({ ...input, kind, body }))) setDraft("");
    setBusy(null);
  }

  async function handBack() {
    if (!controls.handBack || busy) return;
    const mode = controls.handBack;
    setError("");
    const message = mode === "client" ? `Freigegeben: ${company || "Der Kunde"} kann der Testseite wieder zustimmen.` : "Die KI arbeitet wieder an dieser Anfrage.";
    if (!live) { onDemoStep({ kind: "hand_back" }); setDone(message); return; }
    setBusy("hand_back");
    if (await run(handAttempt, handBackService)) setDone(message);
    setBusy(null);
  }

  const placeholder = kind === "on_behalf" ? `Für ${company || "den Kunden"} schreiben …` : `Antwort an ${company || "den Kunden"} …`;
  const hint = !live ? "Vorschau: Neue Nachrichten bleiben in diesem Fenster und gehen an niemanden." : serviceWriteHint(kind, { company, aiState: controls.aiState, paused: controls.handBack !== null });
  return (
    <form className={`chat-composer${kind === "on_behalf" ? " is-proxy" : ""}`} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {banner && (
        <div className="chat-handback" data-state={copy ? "open" : "closed"} inert={!copy} onAnimationEnd={() => { if (!copy) setBanner(null); }}>
          <span className="chat-handback-icon" aria-hidden="true"><PauseCircle size={18} /></span>
          <div className="chat-handback-text"><strong>{banner.title}</strong><p>{banner.text}</p></div>
          <button type="button" className="chat-card-action is-primary" disabled={busy !== null} onClick={() => void handBack()}>
            {busy === "hand_back" && <MiniLoader size={14} />}{banner.action}
          </button>
        </div>
      )}
      {error && <p className="form-error chat-error" role="alert">{error}</p>}
      {done && !copy && <p className="chat-hint is-done" role="status"><Check size={14} aria-hidden="true" />{done}</p>}
      <div className="chat-filter chat-mode" role="group" aria-label="So schreibst du">
        <button type="button" aria-pressed={kind === "on_behalf"} data-tip={`Für ${company || "den Kunden"} schreiben`} onClick={() => { setKind("on_behalf"); sendAttempt.current = null; }}><span>Für {company || "den Kunden"}</span></button>
        <button type="button" aria-pressed={kind === "reply"} onClick={() => { setKind("reply"); sendAttempt.current = null; }}>Als oalab</button>
      </div>
      <div className="chat-compose-row">
        <label className="visually-hidden" htmlFor={`service-field-${conversation.id}`}>{kind === "on_behalf" ? `Nachricht für ${company || "den Kunden"}` : "Antwort als oalab"}</label>
        <textarea id={`service-field-${conversation.id}`} ref={field} rows={1} value={draft} maxLength={MAX_MESSAGE_LENGTH} placeholder={placeholder} disabled={busy === "send"}
          onChange={(event) => { setDraft(event.target.value); sendAttempt.current = null; setDone(""); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <button type="submit" className="chat-send" disabled={busy !== null || !draft.trim()} aria-label={kind === "on_behalf" ? `Für ${company || "den Kunden"} senden` : "Als oalab senden"}>{busy === "send" ? <MiniLoader size={18} /> : <SendHorizontal size={18} aria-hidden="true" />}</button>
      </div>
      <p className="chat-hint">{hint}</p>
    </form>
  );
}
