"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Info, MessagesSquare, Search } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { HeaderActions } from "../app-shell";
import { LargeTitleHeader } from "../large-title-header";
import { PlainText, RichText } from "../rich-text";
import { CategoryTitle } from "./workspace";
import { LoadNotice } from "./overview";
import { CustomerSign } from "./customer-sign";
import { ChatTabs, PrivateChats, type ChatTab } from "./private-chat";
import type { ScreenProps } from "./types";
import { openConversation, refreshConversations } from "@/lib/hub-conversations/actions";
import { demoConversations } from "@/lib/hub-conversations/fixtures";
import { clockTime, listTime, messageSide, previewText, senderLabel, threadItems } from "@/lib/hub-conversations/rules";
import type { ConversationsState, ConversationSummary, ConversationThread } from "@/lib/hub-conversations/types";
import { demoPrivateChats } from "@/lib/hub-private-chat/fixtures";
import type { PrivateChatState } from "@/lib/hub-private-chat/types";

const POLL_MS = 15_000;

/**
 * Nachrichten (4 November 2026): customers write here with oalab in their private chat; requests go to the service
 * platform. Admins have two tabs: "Privat" with every customer's private chat to answer, and "Service" with the service
 * platform's conversations to follow along, as before.
 */
export function ConversationsScreen({ preview, admin, freelancer, firstName, company, asOf, conversations, privateChats }: ScreenProps & { conversations?: ConversationsState; privateChats?: PrivateChatState }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: ChatTab = admin && params.get("tab") === "service" ? "service" : "private";
  // The day labels follow the server's day, so the first render on the server and in the browser say the same.
  const now = useMemo(() => new Date(`${asOf}T12:00:00+01:00`), [asOf]);
  // The tab "Privat" counts what waits there, also while "Service" is open.
  const privateUnread = useMemo(() => (privateChats ?? demoPrivateChats({ firstName, company: company ?? null, admin }).state).chats.filter((chat) => chat.unread).length, [privateChats, firstName, company, admin]);
  const switchTab = (next: ChatTab) => { if (next !== tab) router.push(next === "service" ? `${pathname}?tab=service` : pathname, { scroll: false }); };
  const tabs = admin ? (unread: number) => <ChatTabs tab={tab} unread={unread} onChange={switchTab} /> : undefined;

  return (
    <>
      <LargeTitleHeader title="Nachrichten" icon={<CategoryTitle category="messages" />} actions={<HeaderActions />} />
      {tab === "service"
        ? <ServiceConversations key="service" now={now} state={conversations} tabs={tabs?.(privateUnread)} />
        : <PrivateChats key="private" admin={admin} freelancer={freelancer} preview={preview} firstName={firstName} company={company} now={now} state={privateChats} tabs={tabs} />}
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
  return last.sender === "system" ? text : `${senderLabel(last.sender, last.name)}: ${text}`;
}

/**
 * The service platform's conversations for admins, to follow what is going on there: every customer's requests with
 * their logo, read only. Answers and internal notes from oalab come from NoteTree Business.
 */
function ServiceConversations({ now, state, tabs }: { now: Date; state?: ConversationsState; tabs?: ReactNode }) {
  const fixtures = useMemo(() => state ? null : demoConversations(), [state]);
  const initial = state ?? fixtures!.state;
  const live = initial.source === "service";
  const [list, setList] = useState<readonly ConversationSummary[]>(initial.conversations);
  const [loadError, setLoadError] = useState(initial.error);
  // The logos come signed with the first page; the look for news and opening a conversation keep them, so they do not load again.
  const [logos] = useState(() => new Map(initial.conversations.map((item) => [item.id, item.logo])));
  const router = useRouter();
  const pathname = usePathname();
  const openId = useSearchParams().get("conversation");
  const [liveThread, setLiveThread] = useState<ConversationThread | null>(null);
  const [threadError, setThreadError] = useState("");
  const [query, setQuery] = useState("");

  const withLogo = (item: ConversationSummary): ConversationSummary => ({ ...item, logo: logos.get(item.id) ?? item.logo });
  const conversation = list.find((item) => item.id === openId) ?? null;
  const thread: ConversationThread | null = live
    ? liveThread && liveThread.conversation.id === openId ? liveThread : null
    : conversation ? { conversation, messages: fixtures?.messages.get(conversation.id) ?? [] } : null;

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
      }).catch(() => { /* the next look tries again */ });
      if (openId) openConversation({ id: openId }).then((result) => { if (result.ok) setLiveThread(result.data); }).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, openId]);

  const open = (id: string) => router.push(`${pathname}?tab=service&conversation=${encodeURIComponent(id)}`, { scroll: false });
  const close = () => router.push(`${pathname}?tab=service`, { scroll: false });

  const term = query.trim().toLowerCase();
  const shown = [...list].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .filter((item) => !term || [item.title, item.company, item.reference, item.lastMessage?.body].some((value) => value?.toLowerCase().includes(term)));

  return (
    <div className="sheet chat section-first" data-open={thread || openId ? "true" : undefined}>
      <div className="chat-grid">
        <section className="chat-list" aria-label="Service-Gespräche">
          <div className="chat-list-head"><h2>Gespräche</h2></div>
          {tabs}
          <label className="chat-search"><Search size={16} aria-hidden="true" /><span className="visually-hidden">Service-Gespräche durchsuchen</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kunde, Thema oder Text" /></label>
          <p className="chat-tab-note">Die Anfragen der Serviceplattform, nur zum Mitlesen.</p>
          {loadError ? <div className="chat-list-note"><LoadNotice text={loadError} /></div>
          : shown.length ? (
            <ul className="chat-convs">
              {shown.map((item) => (
                <li key={item.id}>
                  <button type="button" className="chat-conv" aria-current={item.id === openId ? "true" : undefined} onClick={() => open(item.id)}>
                    <ServiceAvatar conversation={withLogo(item)} />
                    <span className="chat-conv-main">
                      <span className="chat-conv-top"><strong>{item.title}</strong><time dateTime={item.lastAt}>{listTime(item.lastAt, now)}</time></span>
                      {item.company && <span className="chat-conv-company">{item.company}</span>}
                      <span className="chat-conv-sub">
                        <span className="chat-conv-last">{lastLine(item)}</span>
                        {item.group !== "active" && <span className={`chat-pill tone-${item.tone}`}>{item.stateLabel}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chat-empty">{list.length ? "Keine Gespräche für diese Suche." : "Noch keine Gespräche auf der Serviceplattform."}</p>
          )}
        </section>

        <section className="chat-pane" aria-label={thread ? `Gespräch: ${thread.conversation.title}` : "Gespräch"}>
          {thread ? (
            <ServiceThread key={thread.conversation.id} thread={{ ...thread, conversation: withLogo(thread.conversation) }} now={now} onClose={close} />
          ) : openId && live && !threadError ? (
            <div className="chat-placeholder"><MiniLoader size={22} /><span>Gespräch wird geladen …</span></div>
          ) : (
            <div className="chat-placeholder">
              <MessagesSquare size={30} aria-hidden="true" />
              <span>{threadError || (list.length ? "Wähle links ein Gespräch." : "Hier erscheinen die Gespräche der Serviceplattform.")}</span>
              {openId && <button type="button" className="text-link" onClick={close}>Zur Liste</button>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ServiceThread({ thread, now, onClose }: { thread: ConversationThread; now: Date; onClose: () => void }) {
  const { conversation, messages } = thread;
  const items = useMemo(() => threadItems(messages.map((message) => ({ ...message, author: `${message.sender}:${message.name ?? ""}` })), now), [messages, now]);
  const subtitle = [conversation.company, conversation.reference].filter(Boolean).join(" · ");
  return (
    <>
      <header className="chat-pane-head">
        <button type="button" className="chat-back" onClick={onClose} aria-label="Zurück zu den Gesprächen"><ChevronLeft size={24} aria-hidden="true" /></button>
        <ServiceAvatar conversation={conversation} />
        <div className="chat-pane-title"><strong>{conversation.title}</strong><span>{subtitle}</span></div>
        <span className={`chat-pill tone-${conversation.tone}`}>{conversation.stateLabel}</span>
      </header>
      <div className="chat-log" role="log" aria-live="polite" aria-label="Nachrichten">
        {items.length ? items.map(({ message, day, first, last }) => {
          const side = messageSide(message.sender);
          return (
            <div key={message.id} className="chat-item">
              {day && <span className="chat-day">{day}</span>}
              {side === "center" ? (
                <p className="chat-system"><Info size={14} aria-hidden="true" />{message.body}</p>
              ) : (
                <div className={`chat-msg is-${side}${first ? " is-first" : ""}${last ? " is-last" : ""}${message.sender === "assistant" ? " is-assistant" : ""}`}>
                  {first && <span className="chat-who">{senderLabel(message.sender, message.name)}</span>}
                  <div className="chat-bubble">
                    <div className={message.markdown ? "chat-text is-rich" : "chat-text"}>{message.markdown ? <RichText text={message.body} links /> : <PlainText text={message.body} />}</div>
                    <span className="chat-meta"><time dateTime={message.at}>{clockTime(message.at)}</time></span>
                  </div>
                </div>
              )}
            </div>
          );
        }) : <p className="chat-system">Noch keine Nachricht in diesem Gespräch.</p>}
      </div>
      <p className="chat-readonly"><Info size={16} aria-hidden="true" />Du liest mit. Antworten und interne Notizen von oalab entstehen in NoteTree Business.</p>
    </>
  );
}
