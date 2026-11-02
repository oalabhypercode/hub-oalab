"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, ChevronLeft, Info, Loader2, MessagesSquare, Search, SendHorizontal, SquarePen } from "lucide-react";
import { HeaderActions } from "../app-shell";
import { LargeTitleHeader } from "../large-title-header";
import { PlainText, RichText } from "../rich-text";
import { CategoryTitle } from "./workspace";
import { LoadNotice } from "./overview";
import type { ScreenProps } from "./types";
import { openConversation, refreshConversations, sendConversationMessage } from "@/lib/hub-conversations/actions";
import { demoConversations } from "@/lib/hub-conversations/fixtures";
import { clockTime, listTime, MAX_MESSAGE_LENGTH, messageSide, previewText, senderLabel, threadItems } from "@/lib/hub-conversations/rules";
import type { ConversationMessage, ConversationsState, ConversationSummary, ConversationThread } from "@/lib/hub-conversations/types";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";

const POLL_MS = 15_000;
const newConversationUrl = `${SERVICE_PLATFORM_URL}/requests/new`;

/** Two letters for the round picture: the company for admins, otherwise the topic. */
function initialsOf(text: string) {
  const words = text.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "OA";
}

/** A calm colour per conversation, always the same for the same one. */
function hueOf(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return ["bordeaux", "blue", "green", "orange", "violet"][hash % 5];
}

function Avatar({ conversation, admin }: { conversation: ConversationSummary; admin: boolean }) {
  return admin && conversation.company
    ? <span className="chat-avatar is-company" aria-hidden="true">{initialsOf(conversation.company)}</span>
    : <span className={`chat-avatar is-${hueOf(conversation.id)}`} aria-hidden="true">{initialsOf(conversation.title)}</span>;
}

function lastLine(conversation: ConversationSummary) {
  const last = conversation.lastMessage;
  if (!last) return "Noch keine Nachricht";
  const text = previewText(last.body);
  if (last.sender === "system") return text;
  const who = senderLabel(last.sender, last.own, last.name);
  return `${who}: ${text}`;
}

/**
 * Nachrichten as a messenger (2 November 2026): the conversations with oalab on the left under „Gespräche“, the open one
 * on the right. Real logins read the service platform's requests and answer through it; the preview, the public demo
 * and the demo logins show examples whose new messages stay in this window. Admins read along.
 */
export function ConversationsScreen({ preview, admin, firstName, company, asOf, conversations }: ScreenProps & { conversations?: ConversationsState }) {
  const fixtures = useMemo(() => conversations ? null : demoConversations({ firstName, company: company ?? null, admin }), [conversations, firstName, company, admin]);
  const initial = conversations ?? fixtures!.state;
  const live = initial.source === "service";
  const readOnly = initial.readOnly;
  const [list, setList] = useState<readonly ConversationSummary[]>(initial.conversations);
  const [loadError, setLoadError] = useState(initial.error);
  const [demoMessages, setDemoMessages] = useState(() => fixtures?.messages ?? new Map<string, ConversationMessage[]>());
  const router = useRouter();
  const pathname = usePathname();
  const openId = useSearchParams().get("conversation");
  const [liveThread, setLiveThread] = useState<ConversationThread | null>(null);
  const [threadError, setThreadError] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [query, setQuery] = useState("");
  // The day labels follow the server's day, so the first render on the server and in the browser say the same.
  const now = useMemo(() => new Date(`${asOf}T12:00:00+01:00`), [asOf]);

  const conversation = list.find((item) => item.id === openId) ?? null;
  const thread: ConversationThread | null = live
    ? liveThread && liveThread.conversation.id === openId ? liveThread : null
    : conversation ? { conversation, messages: demoMessages.get(conversation.id) ?? [] } : null;

  const replaceInList = useCallback((next: ConversationSummary) => setList((items) => items.map((item) => item.id === next.id ? next : item)), []);

  // Opening a conversation reads it, and for clients marks it read.
  useEffect(() => {
    if (!openId || !live) return;
    let current = true;
    openConversation({ id: openId }).then((result) => {
      if (!current) return;
      setThreadError(result.ok ? "" : result.error);
      if (result.ok) { setLiveThread(result.data); replaceInList(result.data.conversation); }
    }).catch(() => { if (current) setThreadError("Keine Verbindung. Bitte versuche es erneut."); });
    return () => { current = false; };
  }, [openId, live, replaceInList]);

  // A messenger shows news without reloading: look every 15 seconds while the page is visible.
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshConversations().then((result) => {
        if (!result.ok) return;
        setLoadError(null);
        setList(result.data.conversations.map((item) => item.id === openId ? { ...item, unread: false } : item));
      }).catch(() => { /* the next look tries again */ });
      if (openId) openConversation({ id: openId }).then((result) => { if (result.ok) setLiveThread(result.data); }).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, openId]);

  const open = (id: string) => {
    // The examples have no server to ask, so opening one only takes its "unread" away.
    if (!live) setList((items) => items.map((item) => item.id === id ? { ...item, unread: false } : item));
    router.push(`${pathname}?conversation=${encodeURIComponent(id)}`, { scroll: false });
  };
  const close = () => router.push(pathname, { scroll: false });

  const term = query.trim().toLowerCase();
  const unreadCount = list.filter((item) => item.unread && item.id !== openId).length;
  // The newest conversation first, as in a messenger; a sent message moves its conversation to the top.
  const shown = [...list].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)).filter((item) => (filter === "all" || (item.unread && item.id !== openId))
    && (!term || [item.title, item.company, item.reference, item.lastMessage?.body].some((value) => value?.toLowerCase().includes(term))));

  const appendDemo = (body: string) => {
    if (!conversation) return;
    const message: ConversationMessage = { id: `local-${Date.now()}`, sender: "client", own: true, name: null, body, markdown: false, at: new Date().toISOString() };
    setDemoMessages((current) => new Map(current).set(conversation.id, [...(current.get(conversation.id) ?? []), message]));
    replaceInList({ ...conversation, lastAt: message.at, lastMessage: { body, sender: "client", own: true, name: null } });
  };

  return (
    <>
      <LargeTitleHeader title="Nachrichten" icon={<CategoryTitle category="messages" />} actions={<HeaderActions />} />
      <div className="sheet chat section-first" data-open={thread || openId ? "true" : undefined}>
        <div className="chat-grid">
          <section className="chat-list" aria-label="Gespräche">
            <div className="chat-list-head">
              <h2>Gespräche</h2>
              {!readOnly && <a className="chat-icon-button" href={newConversationUrl} target="_blank" rel="noopener noreferrer" title="Neues Gespräch auf der Serviceplattform starten" aria-label="Neues Gespräch (öffnet die Serviceplattform in neuem Tab)"><SquarePen size={19} aria-hidden="true" /></a>}
            </div>
            <label className="chat-search"><Search size={16} aria-hidden="true" /><span className="visually-hidden">Gespräche durchsuchen</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={admin ? "Kunde, Thema oder Text" : "Gespräche durchsuchen"} /></label>
            {!readOnly && (
              <div className="chat-filter" role="group" aria-label="Gespräche filtern">
                <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Alle</button>
                <button type="button" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Ungelesen{unreadCount > 0 && <span>{unreadCount}</span>}</button>
              </div>
            )}
            {loadError ? <div className="chat-list-note"><LoadNotice text={loadError} /></div>
            : shown.length ? (
              <ul className="chat-convs">
                {shown.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="chat-conv" aria-current={item.id === openId ? "true" : undefined} onClick={() => open(item.id)}>
                      <Avatar conversation={item} admin={admin} />
                      <span className="chat-conv-main">
                        <span className="chat-conv-top"><strong>{item.title}</strong><time dateTime={item.lastAt} className={item.unread && item.id !== openId ? "is-new" : undefined}>{listTime(item.lastAt, now)}</time></span>
                        {admin && item.company && <span className="chat-conv-company">{item.company}</span>}
                        <span className="chat-conv-sub">
                          <span className="chat-conv-last">{item.lastMessage?.own && <Check size={14} aria-hidden="true" />}{lastLine(item)}</span>
                          {item.unread && item.id !== openId ? <span className="chat-badge"><span className="visually-hidden">Neu</span></span>
                            : item.group !== "active" && <span className={`chat-pill tone-${item.tone}`}>{item.stateLabel}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="chat-empty">{list.length ? "Keine Gespräche für diese Suche." : readOnly ? "Noch keine Gespräche mit Kunden." : "Noch keine Gespräche. Starte eines über das Stift-Symbol oben."}</p>
            )}
          </section>

          <section className="chat-pane" aria-label={thread ? `Gespräch: ${thread.conversation.title}` : "Gespräch"}>
            {thread ? (
              <ChatThread key={thread.conversation.id} thread={thread} admin={admin} readOnly={readOnly} live={live} now={now} preview={preview}
                onClose={close} onSent={(next) => { setLiveThread(next); replaceInList(next.conversation); }} onDemoSend={appendDemo}
                onReload={() => openConversation({ id: thread.conversation.id }).then((result) => { if (result.ok) setLiveThread(result.data); }).catch(() => {})} />
            ) : openId && live && !threadError ? (
              <div className="chat-placeholder"><Loader2 size={22} className="spin" aria-hidden="true" /><span>Gespräch wird geladen …</span></div>
            ) : (
              <div className="chat-placeholder">
                <MessagesSquare size={30} aria-hidden="true" />
                <span>{threadError || (list.length ? "Wähle links ein Gespräch." : "Hier erscheinen deine Gespräche mit oalab.")}</span>
                {openId && <button type="button" className="text-link" onClick={close}>Zur Liste</button>}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function ChatThread({ thread, admin, readOnly, live, now, preview, onClose, onSent, onDemoSend, onReload }: {
  thread: ConversationThread; admin: boolean; readOnly: boolean; live: boolean; now: Date; preview: boolean;
  onClose: () => void; onSent: (thread: ConversationThread) => void; onDemoSend: (body: string) => void; onReload: () => void;
}) {
  const { conversation, messages } = thread;
  const items = useMemo(() => threadItems(messages.map((message) => ({ ...message, author: `${message.sender}:${message.own}:${message.name ?? ""}` })), now), [messages, now]);
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // One id per draft: sending the same text twice (double click, slow network) stays one message.
  const clientId = useRef<string | null>(null);

  // New messages scroll into view, like in a messenger.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  // The field grows with the text up to a few lines.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setError("");
    if (!live) {
      onDemoSend(body);
      setDraft("");
      return;
    }
    clientId.current ??= crypto.randomUUID();
    setSending(true);
    try {
      const result = await sendConversationMessage({ id: conversation.id, body, clientGeneratedId: clientId.current, version: conversation.version, lastMessageId: messages.at(-1)?.id ?? null });
      if (result.ok) {
        clientId.current = null;
        setDraft("");
        onSent(result.data);
      } else {
        setError(result.error);
        onReload();
      }
    } catch {
      setError("Keine Verbindung. Deine Nachricht ist noch hier; bitte versuche es erneut.");
    } finally {
      setSending(false);
    }
  }

  const subtitle = admin ? [conversation.company, conversation.reference].filter(Boolean).join(" · ") : `${conversation.reference} · mit oalab`;
  return (
    <>
      <header className="chat-pane-head">
        <button type="button" className="chat-back" onClick={onClose} aria-label="Zurück zu den Gesprächen"><ChevronLeft size={24} aria-hidden="true" /></button>
        <Avatar conversation={conversation} admin={admin} />
        <div className="chat-pane-title"><strong>{conversation.title}</strong><span>{subtitle}</span></div>
        <span className={`chat-pill tone-${conversation.tone}`}>{conversation.stateLabel}</span>
        {live && !admin && <a className="chat-icon-button is-muted" href={`${SERVICE_PLATFORM_URL}/requests/${conversation.reference}/received`} target="_blank" rel="noopener noreferrer" title="Auf der Serviceplattform öffnen, mit Freigaben und Testseite" aria-label="Auf der Serviceplattform öffnen (neuer Tab)"><ArrowUpRight size={18} aria-hidden="true" /></a>}
      </header>
      <div className="chat-log" ref={log} role="log" aria-live="polite" aria-label="Nachrichten">
        {items.length ? items.map(({ message, day, first, last }) => {
          const side = messageSide(message.sender, message.own, admin);
          return (
            <div key={message.id} className="chat-item">
              {day && <span className="chat-day">{day}</span>}
              {side === "center" ? (
                <p className="chat-system"><Info size={14} aria-hidden="true" />{message.body}</p>
              ) : (
                <div className={`chat-msg is-${side}${first ? " is-first" : ""}${last ? " is-last" : ""}${message.sender === "assistant" ? " is-assistant" : ""}`}>
                  {first && side === "in" && <span className="chat-who">{senderLabel(message.sender, message.own, message.name)}</span>}
                  <div className="chat-bubble">
                    <div className={message.markdown ? "chat-text is-rich" : "chat-text"}>{message.markdown ? <RichText text={message.body} links /> : <PlainText text={message.body} />}</div>
                    <span className="chat-meta"><time dateTime={message.at}>{clockTime(message.at)}</time>{message.own && <Check size={14} aria-label="gesendet" />}</span>
                  </div>
                </div>
              )}
            </div>
          );
        }) : <p className="chat-system">Noch keine Nachricht in diesem Gespräch.</p>}
      </div>
      {readOnly ? (
        <p className="chat-readonly"><Info size={16} aria-hidden="true" />Du liest mit. Antworten und interne Notizen von oalab entstehen in NoteTree Business.</p>
      ) : !conversation.canReply ? (
        <p className="chat-readonly"><Info size={16} aria-hidden="true" />Dieses Gespräch ist abgeschlossen. Für etwas Neues starte ein neues Gespräch über das Stift-Symbol.</p>
      ) : (
        <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          {error && <p className="form-error chat-error" role="alert">{error}</p>}
          <div className="chat-compose-row">
            <label className="visually-hidden" htmlFor={`chat-field-${conversation.id}`}>Nachricht</label>
            <textarea id={`chat-field-${conversation.id}`} ref={field} rows={1} value={draft} maxLength={MAX_MESSAGE_LENGTH} placeholder="Nachricht schreiben …" disabled={sending}
              onChange={(event) => { setDraft(event.target.value); clientId.current = null; }}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            <button type="submit" className="chat-send" disabled={sending || !draft.trim()} aria-label="Nachricht senden">{sending ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <SendHorizontal size={18} aria-hidden="true" />}</button>
          </div>
          {!live && <p className="chat-hint">{preview ? "Vorschau: " : "Demo: "}Neue Nachrichten bleiben in diesem Fenster und gehen an niemanden.</p>}
        </form>
      )}
    </>
  );
}
