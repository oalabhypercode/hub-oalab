"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, CheckCheck, ChevronLeft, Info, Lock, MessagesSquare, Search, SendHorizontal, SquarePen, Wrench } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { BrandLogo } from "../wordmark";
import { useInfo } from "../info-box";
import { MessagesHost } from "../messages-host";
import { Modal } from "../modal";
import { PlainText } from "../rich-text";
import { LoadNotice } from "./overview";
import { CustomerSign } from "./customer-sign";
import { openPrivateChat, refreshPrivateChats, sendPrivateMessage } from "@/lib/hub-private-chat/actions";
import { demoPrivateChats } from "@/lib/hub-private-chat/fixtures";
import { chatListSender, chatMessageSide, chatSender, peopleLine, type ChatSide } from "@/lib/hub-private-chat/rules";
import type { PrivateChatMessage, PrivateChatState, PrivateChatSummary, PrivateChatThread } from "@/lib/hub-private-chat/types";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { clockTime, listTime, MAX_MESSAGE_LENGTH, previewText, threadItems } from "@/lib/hub-conversations/rules";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";
import { LEGAL_PATHS } from "@/lib/legal-links";

const POLL_MS = 15_000;

export type ChatTab = "private" | "service";

/** Admins: the private chats of all customers and, to follow along, the service platform's conversations. */
export function ChatTabs({ tab, unread, onChange }: { tab: ChatTab; unread: number; onChange: (tab: ChatTab) => void }) {
  return (
    <div className="chat-tabs" role="group" aria-label="Art der Gespräche">
      <button type="button" aria-pressed={tab === "private"} onClick={() => onChange("private")}>
        <Lock size={14} aria-hidden="true" />Privat{unread > 0 && <span className="chat-tab-count"><span className="visually-hidden">, ungelesen: </span>{unread}</span>}
      </button>
      <button type="button" aria-pressed={tab === "service"} onClick={() => onChange("service")}><Wrench size={14} aria-hidden="true" />Service</button>
    </div>
  );
}

/** oalab as the customer's conversation partner: the logo on the brand gradient. */
function OalabAvatar() {
  return <span className="chat-avatar is-oalab" aria-hidden="true"><BrandLogo /></span>;
}

/**
 * Two columns (list and chat side by side) or one: on phones, tablets and narrow windows the sheet shows either the list
 * or the open chat. A customer's single chat opens by itself only where it is visible next to the list.
 */
function useTwoColumns(ref: RefObject<HTMLElement | null>) {
  const [two, setTwo] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const phone = window.matchMedia("(max-width: 767px)");
    const check = () => setTwo(!phone.matches && element.getBoundingClientRect().width > 720);
    // The observer reports the first size by itself.
    const observer = new ResizeObserver(check);
    observer.observe(element);
    phone.addEventListener("change", check);
    return () => { observer.disconnect(); phone.removeEventListener("change", check); };
  }, [ref]);
  return two;
}

function lastLine(chat: PrivateChatSummary) {
  if (!chat.last) return "Noch keine Nachricht";
  return `${chatListSender(chat.last)}: ${previewText(chat.last.body)}`;
}

/**
 * The private chat (4 November 2026): customers write here with oalab, one chat for their company; the way to the
 * service platform sits right below, Ali thinks along at the bottom. Admins see every customer's chat with the logo
 * from the Asset Management, answer in it and write to a customer first through the pen. Real logins read the
 * database; the preview shows examples whose new messages stay in this window.
 */
export function PrivateChats({ admin, freelancer = false, firstName, company, now, state, tabs }: {
  admin: boolean; firstName: string; company?: string; now: Date; state?: PrivateChatState; tabs?: (unread: number) => ReactNode;
  /** Freelancers write with oalab like a customer, but have nothing to ask on the service platform. */
  freelancer?: boolean;
}) {
  const fixtures = useMemo(() => state ? null : demoPrivateChats({ firstName, company: company ?? null, admin }), [state, firstName, company, admin]);
  const initial = state ?? fixtures!.state;
  const live = initial.source === "live";
  const viewer: ChatSide = admin ? "oalab" : "customer";
  const [list, setList] = useState<readonly PrivateChatSummary[]>(initial.chats);
  const [loadError, setLoadError] = useState(initial.error);
  const [demoMessages, setDemoMessages] = useState(() => fixtures?.messages ?? new Map<string, PrivateChatMessage[]>());
  // The logos come signed with the first page; the look for news and opening a chat keep them, so they do not load again.
  const [logos] = useState(() => new Map(initial.chats.map((chat) => [chat.customerId, chat.logo])));
  const logoOf = (customerId: string): CustomerLogo | null => logos.get(customerId) ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const chatParam = useSearchParams().get("chat");
  const sheet = useRef<HTMLDivElement>(null);
  const twoColumns = useTwoColumns(sheet);
  const selectedId = chatParam ?? (!admin && twoColumns && list.length === 1 ? list[0].customerId : null);
  const [liveThread, setLiveThread] = useState<PrivateChatThread | null>(null);
  const [threadError, setThreadError] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const info = useInfo(admin ? "Private Chats" : "Chat", admin ? {
    steps: [
      <><b>Privat:</b> ein Chat je Firma, hier antwortest du.</>,
      <><b>Service</b> zeigt die Serviceplattform zum Mitlesen.</>,
      <><b>Neue Nachrichten</b> meldet die Glocke sofort.</>,
    ],
    ask: "Wie funktionieren die privaten Chats mit Kunden?",
  } : {
    steps: [
      freelancer ? <><b>Direkt mit oalab;</b> nur oalab und dein Zugang lesen mit.</> : <><b>Ein Chat</b> für deine ganze Firma.</>,
      <><b>Zwei Häkchen</b> heißen gelesen.</>,
      freelancer ? <><b>Antworten</b> erscheinen ohne Neuladen.</> : <><b>Aufträge</b> bitte über die Serviceplattform.</>,
    ],
    ask: "Wie funktioniert der Chat mit oalab?",
  });

  const chat = list.find((item) => item.customerId === selectedId) ?? null;
  const thread: PrivateChatThread | null = live
    ? liveThread && liveThread.chat.customerId === selectedId ? liveThread : null
    : chat ? { chat, messages: demoMessages.get(chat.customerId) ?? [], people: fixtures?.people.get(chat.customerId) ?? [] } : null;

  const replaceInList = useCallback((next: PrivateChatSummary) => setList((items) => items.map((item) => item.customerId === next.customerId ? next : item)), []);

  // Opening a chat reads it and marks it read, which also clears its notices in the bell.
  useEffect(() => {
    if (!selectedId || !live) return;
    let current = true;
    openPrivateChat({ customerId: selectedId, opened: true }).then((result) => {
      if (!current) return;
      setThreadError(result.ok ? "" : result.error);
      if (result.ok) { setLiveThread(result.data); replaceInList(result.data.chat); }
    }).catch(() => { if (current) setThreadError("Keine Verbindung. Bitte versuche es erneut."); });
    return () => { current = false; };
  }, [selectedId, live, replaceInList]);

  // A messenger shows news without reloading: look every 15 seconds while the page is visible.
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshPrivateChats().then((result) => {
        if (!result.ok) return;
        setLoadError(null);
        setList(result.data.chats.map((item) => item.customerId === selectedId ? { ...item, unread: false } : item));
      }).catch(() => { /* the next look tries again */ });
      if (selectedId) openPrivateChat({ customerId: selectedId }).then((result) => { if (result.ok) setLiveThread(result.data); }).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, selectedId]);

  const open = (customerId: string) => router.push(`${pathname}?chat=${encodeURIComponent(customerId)}`, { scroll: false });
  const close = () => router.push(pathname, { scroll: false });
  const isNew = (item: PrivateChatSummary) => item.unread && item.customerId !== selectedId;

  const term = query.trim().toLowerCase();
  const unreadCount = list.filter(isNew).length;
  // Admins see the chats that have something in them (and the one just opened); customers see their company's chat.
  const shown = [...list]
    .filter((item) => !admin || item.lastAt || item.customerId === selectedId)
    .sort((a, b) => (b.lastAt ?? "9").localeCompare(a.lastAt ?? "9"))
    .filter((item) => (filter === "all" || isNew(item)) && (!term || [item.company, item.customerNumber, item.last?.name, item.last?.body].some((value) => value?.toLowerCase().includes(term))));

  const appendDemo = (body: string) => {
    if (!chat) return;
    const message: PrivateChatMessage = { id: `local-${Date.now()}`, side: viewer, own: true, name: null, body, at: new Date().toISOString(), read: false };
    setDemoMessages((current) => new Map(current).set(chat.customerId, [...(current.get(chat.customerId) ?? []), message]));
    replaceInList({ ...chat, lastAt: message.at, last: { body, side: viewer, own: true, name: null }, unread: false });
  };

  const title = (item: PrivateChatSummary) => admin ? item.company : list.length > 1 ? `oalab · ${item.company}` : "oalab-Team";
  const sign = (item: PrivateChatSummary) => admin ? <CustomerSign customer={{ id: item.customerId, company: item.company }} logo={logoOf(item.customerId)} /> : <OalabAvatar />;

  return (
    <div className="sheet chat section-first" ref={sheet} data-open={chatParam ? "true" : undefined}>
      <div className="chat-grid">
        <section className={`chat-list${admin ? "" : " is-single"}`} aria-label="Gespräche">
          <div className="chat-list-head">
            <h2>Gespräche{info.button}</h2>
            {admin && <button type="button" className="chat-icon-button" onClick={() => setPicking(true)} title="Kunden anschreiben" aria-label="Kunden anschreiben"><SquarePen size={19} aria-hidden="true" /></button>}
          </div>
          {info.box}
          {tabs?.(unreadCount)}
          {admin && (
            <>
              <label className="chat-search"><Search size={16} aria-hidden="true" /><span className="visually-hidden">Private Chats durchsuchen</span>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kunde, Person oder Text" /></label>
              <div className="chat-filter" role="group" aria-label="Chats filtern">
                <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Alle</button>
                <button type="button" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Ungelesen{unreadCount > 0 && <span>{unreadCount}</span>}</button>
              </div>
            </>
          )}
          {loadError ? <div className="chat-list-note"><LoadNotice text={loadError} /></div>
          : shown.length ? (
            <ul className="chat-convs">
              {shown.map((item) => (
                <li key={item.customerId}>
                  <button type="button" className="chat-conv" aria-current={item.customerId === selectedId ? "true" : undefined} onClick={() => open(item.customerId)}>
                    {sign(item)}
                    <span className="chat-conv-main">
                      <span className="chat-conv-top"><strong>{title(item)}</strong>{item.lastAt && <time dateTime={item.lastAt} className={isNew(item) ? "is-new" : undefined}>{listTime(item.lastAt, now)}</time>}</span>
                      <span className="chat-conv-sub">
                        <span className="chat-conv-last">{item.last?.own && <Check size={14} aria-hidden="true" />}{lastLine(item)}</span>
                        {isNew(item) ? <span className="chat-badge"><span className="visually-hidden">Neu</span></span>
                          : !admin && <span className="chat-pill is-private"><Lock size={11} aria-hidden="true" />Privat</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chat-empty">{admin
              ? list.some((item) => item.lastAt) ? "Keine Chats für diese Suche." : "Noch keine privaten Chats. Über den Stift oben schreibst du einen Kunden an."
              : "Dein Login gehört noch zu keiner Firma. Sobald oalab ihn zuordnet, steht hier euer Chat."}</p>
          )}
          {!admin && !freelancer && (
            <div className="chat-service">
              <span className="chat-service-icon" aria-hidden="true"><Wrench size={18} /></span>
              <div>
                <strong>Service-Anfragen</strong>
                <p>Änderungen an deiner Website und andere Aufträge stellst du direkt auf der Serviceplattform. Dort siehst du auch ihren Stand.</p>
                <div className="chat-service-links">
                  <a className="sheet-action is-primary" href={`${SERVICE_PLATFORM_URL}/requests/new`} target="_blank" rel="noopener noreferrer">Anfrage stellen<ArrowUpRight size={14} aria-hidden="true" /><span className="visually-hidden"> (neuer Tab)</span></a>
                  <a className="sheet-action" href={SERVICE_PLATFORM_URL} target="_blank" rel="noopener noreferrer">Meine Anfragen<ArrowUpRight size={14} aria-hidden="true" /><span className="visually-hidden"> (neuer Tab)</span></a>
                </div>
              </div>
            </div>
          )}
          {!admin && <MessagesHost />}
        </section>

        <section className="chat-pane" aria-label={thread ? `Privater Chat: ${title(thread.chat)}` : "Chat"}>
          {thread ? (
            <PrivateThread key={thread.chat.customerId} thread={thread} admin={admin} live={live} now={now} logo={logoOf(thread.chat.customerId)}
              onClose={close} onSent={(next) => { setLiveThread(next); replaceInList(next.chat); }} onDemoSend={appendDemo} />
          ) : selectedId && live && !threadError ? (
            <div className="chat-placeholder"><MiniLoader size={22} /><span>Chat wird geladen …</span></div>
          ) : (
            <div className="chat-placeholder">
              <MessagesSquare size={30} aria-hidden="true" />
              <span>{threadError || (admin ? "Wähle links einen Chat oder schreib über den Stift einen Kunden an." : "Hier schreibst du mit dem oalab-Team.")}</span>
              {chatParam && <button type="button" className="text-link" onClick={close}>Zur Liste</button>}
            </div>
          )}
        </section>
      </div>

      {picking && (
        <CustomerPicker chats={list} logoOf={logoOf} onClose={() => setPicking(false)} onPick={(customerId) => { setPicking(false); open(customerId); }} />
      )}
    </div>
  );
}

/** Admins write to a customer, also to one who has not written yet: every customer, searchable. */
function CustomerPicker({ chats, logoOf, onClose, onPick }: { chats: readonly PrivateChatSummary[]; logoOf: (customerId: string) => CustomerLogo | null; onClose: () => void; onPick: (customerId: string) => void }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shown = [...chats].sort((a, b) => a.company.localeCompare(b.company, "de"))
    .filter((item) => !term || item.company.toLowerCase().includes(term) || item.customerNumber.toLowerCase().includes(term));
  return (
    <Modal title="Kunden anschreiben" onClose={onClose}>
      <label className="chat-pick-search"><Search size={16} aria-hidden="true" /><span className="visually-hidden">Kunde suchen</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kunde oder Kundennummer" autoFocus /></label>
      {shown.length ? (
        <ul className="chat-pick">
          {shown.map((item) => (
            <li key={item.customerId}>
              <button type="button" onClick={() => onPick(item.customerId)}>
                <CustomerSign customer={{ id: item.customerId, company: item.company }} logo={logoOf(item.customerId)} />
                <span><strong>{item.company}</strong><small>{item.lastAt ? "Chat öffnen" : `Noch kein Chat · ${item.customerNumber}`}</small></span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="chat-empty">Kein Kunde für diese Suche.</p>}
    </Modal>
  );
}

function PrivateThread({ thread, admin, live, now, logo, onClose, onSent, onDemoSend }: {
  thread: PrivateChatThread; admin: boolean; live: boolean; now: Date; logo: CustomerLogo | null;
  onClose: () => void; onSent: (thread: PrivateChatThread) => void; onDemoSend: (body: string) => void;
}) {
  const { chat, messages, people } = thread;
  const viewer: ChatSide = admin ? "oalab" : "customer";
  const items = useMemo(() => threadItems(messages.map((message) => ({ ...message, author: `${message.side}:${message.own ? "me" : message.name ?? ""}` })), now), [messages, now]);
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
      const result = await sendPrivateMessage({ customerId: chat.customerId, body, clientId: clientId.current });
      if (result.ok) {
        clientId.current = null;
        setDraft("");
        onSent(result.data);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Keine Verbindung. Deine Nachricht ist noch hier; bitte versuche es erneut.");
    } finally {
      setSending(false);
    }
  }

  const several = people.length > 1;
  const hint = !live
    ? "Vorschau: Neue Nachrichten bleiben in diesem Fenster und gehen an niemanden."
    : admin
      ? people.length ? `${peopleLine(people)} ${several ? "sehen" : "sieht"} deine Antwort im Hub und ${several ? "bekommen" : "bekommt"} eine Benachrichtigung.` : `${chat.company} hat noch keinen aktiven Login. Deine Nachricht steht im Chat, sobald jemand Zugang hat.`
      : "";
  return (
    <>
      <header className="chat-pane-head">
        <button type="button" className="chat-back" onClick={onClose} aria-label="Zurück zu den Gesprächen"><ChevronLeft size={24} aria-hidden="true" /></button>
        {admin ? <CustomerSign customer={{ id: chat.customerId, company: chat.company }} logo={logo} /> : <OalabAvatar />}
        <div className="chat-pane-title">
          <strong>{admin ? chat.company : "oalab-Team"}</strong>
          <span>{admin ? [chat.customerNumber, peopleLine(people)].filter(Boolean).join(" · ") : `Privater Chat · ${chat.company} und oalab`}</span>
        </div>
        <span className="chat-pill is-private"><Lock size={11} aria-hidden="true" />Privat</span>
      </header>
      <div className="chat-log" ref={log} role="log" aria-live="polite" aria-label="Nachrichten">
        {/* Customers learn here, where they write, that the team's Telegram group hears of new messages (Art. 13 DSGVO). */}
        <p className="chat-system"><Info size={14} aria-hidden="true" />{admin ? `Privater Chat mit ${chat.company}. Nur ihr Team und oalab lesen mit.` : <span>Hier schreibst du direkt mit dem oalab-Team. Nur {chat.company} und oalab lesen mit; neue Nachrichten meldet der Hub unserem Team auch über Telegram. <Link href={`${LEGAL_PATHS.privacy}#nachrichten`}>Mehr dazu</Link></span>}</p>
        {items.map(({ message, day, first, last }) => {
          const side = chatMessageSide({ side: message.side, own: message.own, viewer });
          // On the right only the own side; admins see there which of them wrote, unless it was themselves.
          const who = side === "in" || (admin && !message.own) ? chatSender({ side: message.side, own: message.own, name: message.name, viewer }) : "";
          return (
            <div key={message.id} className="chat-item">
              {day && <span className="chat-day">{day}</span>}
              <div className={`chat-msg is-${side}${first ? " is-first" : ""}${last ? " is-last" : ""}`}>
                {first && who && <span className="chat-who">{who}</span>}
                <div className="chat-bubble">
                  <div className="chat-text"><PlainText text={message.body} /></div>
                  <span className="chat-meta"><time dateTime={message.at}>{clockTime(message.at)}</time>{side === "out" && (message.read ? <CheckCheck size={14} aria-label="gelesen" /> : <Check size={14} aria-label="gesendet" />)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        {error && <p className="form-error chat-error" role="alert">{error}</p>}
        <div className="chat-compose-row">
          <label className="visually-hidden" htmlFor={`chat-field-${chat.customerId}`}>Nachricht</label>
          <textarea id={`chat-field-${chat.customerId}`} ref={field} rows={1} value={draft} maxLength={MAX_MESSAGE_LENGTH} placeholder={admin ? `Antwort an ${chat.company} …` : "Nachricht an oalab …"} disabled={sending}
            onChange={(event) => { setDraft(event.target.value); clientId.current = null; }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
          <button type="submit" className="chat-send" disabled={sending || !draft.trim()} aria-label="Nachricht senden">{sending ? <MiniLoader size={18} /> : <SendHorizontal size={18} aria-hidden="true" />}</button>
        </div>
        {hint && <p className="chat-hint">{hint}</p>}
      </form>
    </>
  );
}
