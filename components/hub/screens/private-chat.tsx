"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, BellPlus, CalendarPlus, Check, CheckCheck, ChevronLeft, Info, Lock, MessagesSquare, Search, SendHorizontal, SquarePen, Wrench, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { BrandLogo } from "../wordmark";
import { useInfo } from "../info-box";
import { MessagesHost } from "../messages-host";
import { Modal } from "../modal";
import { PlainText } from "../rich-text";
import { Switch } from "../controls";
import { noticeSymbol } from "../notice-symbols";
import { LoadNotice } from "./overview";
import { CustomerSign } from "./customer-sign";
import { confirmChatRequest, openPrivateChat, refreshPrivateChats, sendPrivateMessage, setChatSubscription } from "@/lib/hub-private-chat/actions";
import { DEMO_NOW, demoPrivateChats } from "@/lib/hub-private-chat/fixtures";
import {
  AREA_LABELS, CHAT_AREAS, DEFAULT_SUBSCRIPTIONS, SUBSCRIPTION_FOOT, areaDescription, cardView, eventListLine, isSystemEvent, subscriptionIntro, systemLine,
  type AppointmentNow, type ChatArea, type ChatCardView, type ChatEvent, type ChatEventKind,
} from "@/lib/hub-chat-events/rules";
import { chatListSender, chatMessageSide, chatSender, peopleLine, type ChatSide } from "@/lib/hub-private-chat/rules";
import type { PrivateChatMessage, PrivateChatState, PrivateChatSummary, PrivateChatThread } from "@/lib/hub-private-chat/types";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { clockTime, listTime, MAX_MESSAGE_LENGTH, previewText, threadItems } from "@/lib/hub-conversations/rules";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";
import { LEGAL_PATHS } from "@/lib/legal-links";

const POLL_MS = 15_000;

export type ChatTab = "private" | "service";

/** Admins: the private chats of all customers and, to follow along, the service platform's conversations. */
export function ChatTabs({ tab, unread, serviceUnread = 0, onChange }: { tab: ChatTab; unread: number; serviceUnread?: number; onChange: (tab: ChatTab) => void }) {
  return (
    <div className="chat-tabs" role="group" aria-label="Art der Gespräche">
      <button type="button" aria-pressed={tab === "private"} onClick={() => onChange("private")}>
        <Lock size={14} aria-hidden="true" />Privat{unread > 0 && <span className="chat-tab-count"><span className="visually-hidden">, ungelesen: </span>{unread}</span>}
      </button>
      {/* Customers' messages on the service platform nobody of the team has opened yet (23.11.2026). */}
      <button type="button" aria-pressed={tab === "service"} onClick={() => onChange("service")}>
        <Wrench size={14} aria-hidden="true" />Service{serviceUnread > 0 && <span className="chat-tab-count"><span className="visually-hidden">, ungelesen: </span>{serviceUnread}</span>}
      </button>
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

function lastLine(chat: PrivateChatSummary, viewer: ChatSide) {
  if (!chat.last) return "Noch keine Nachricht";
  // A card reads as its heading, as the reader's side says it („Neuer Termin: Abstimmung Texte“).
  const text = chat.last.event ? eventListLine(chat.last.event, viewer, chat.company) : previewText(chat.last.body);
  return `${chatListSender(chat.last)}: ${text}`;
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
  // The preview's subscriptions and requests change only in this window.
  const [demoSubscriptions, setDemoSubscriptions] = useState(() => fixtures?.subscriptions ?? new Map<string, Record<ChatArea, boolean>>());
  const [demoAppointments, setDemoAppointments] = useState<Record<string, Exclude<AppointmentNow, undefined>>>(() => fixtures?.appointments ?? {});
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
    : chat ? {
      chat, messages: demoMessages.get(chat.customerId) ?? [], people: fixtures?.people.get(chat.customerId) ?? [],
      subscriptions: demoSubscriptions.get(chat.customerId) ?? DEFAULT_SUBSCRIPTIONS, appointments: demoAppointments, calendarLinks: fixtures?.calendarLinks ?? {},
    } : null;

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

  const appendDemo = (body: string, event: ChatEvent | null = null) => {
    if (!chat) return;
    const message: PrivateChatMessage = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, side: viewer, own: true, name: null, body, at: new Date().toISOString(), read: false, event };
    setDemoMessages((current) => new Map(current).set(chat.customerId, [...(current.get(chat.customerId) ?? []), message]));
    // A grey line is no news for the list.
    if (!event || !isSystemEvent(event)) replaceInList({ ...chat, lastAt: message.at, last: { body, side: viewer, own: true, name: null, event }, unread: false });
  };
  // Preview: a switch adds its grey line, „Bestätigen“ confirms the request with a card, as the hub would.
  const demoToggle = (area: ChatArea, on: boolean) => {
    if (!chat) return;
    setDemoSubscriptions((current) => new Map(current).set(chat.customerId, { ...(current.get(chat.customerId) ?? DEFAULT_SUBSCRIPTIONS), [area]: on }));
    appendDemo("", { v: 1, kind: "subscription", area, on });
  };
  const demoConfirm = (appointmentId: string) => {
    const now = demoAppointments[appointmentId];
    const asked = (demoMessages.get(chat?.customerId ?? "") ?? []).map((message) => message.event)
      .find((event) => event?.kind === "appointment.requested" && event.appointment.id === appointmentId);
    if (!now || now.status !== "requested" || !asked || !("appointment" in asked)) return;
    setDemoAppointments((current) => ({ ...current, [appointmentId]: { ...now, status: "confirmed" } }));
    appendDemo("", { v: 1, kind: "appointment.confirmed", appointment: asked.appointment });
  };

  const title = (item: PrivateChatSummary) => admin ? item.company : list.length > 1 ? `oalab · ${item.company}` : "oalab-Team";
  const sign = (item: PrivateChatSummary) => admin ? <CustomerSign customer={{ id: item.customerId, company: item.company }} logo={logoOf(item.customerId)} /> : <OalabAvatar />;

  return (
    <div className="sheet chat section-first" ref={sheet} data-open={chatParam ? "true" : undefined}>
      <div className="chat-grid">
        <section className={`chat-list${admin ? "" : " is-single"}`} aria-label="Gespräche">
          <div className="chat-list-head">
            <h2>Gespräche{info.button}</h2>
            {admin && <button type="button" className="chat-icon-button" onClick={() => setPicking(true)} data-tip="Kunden anschreiben" aria-label="Kunden anschreiben"><SquarePen size={19} aria-hidden="true" /></button>}
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
                        <span className="chat-conv-last">{item.last?.own && <Check size={14} aria-hidden="true" />}{lastLine(item, viewer)}</span>
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
              onClose={close} onSent={(next) => { setLiveThread(next); replaceInList(next.chat); }} onDemoSend={(body) => appendDemo(body)}
              onDemoToggle={demoToggle} onDemoConfirm={demoConfirm} />
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
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kunde oder Kundennummer" data-autofocus /></label>
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

function PrivateThread({ thread, admin, live, now, logo, onClose, onSent, onDemoSend, onDemoToggle, onDemoConfirm }: {
  thread: PrivateChatThread; admin: boolean; live: boolean; now: Date; logo: CustomerLogo | null;
  onClose: () => void; onSent: (thread: PrivateChatThread) => void; onDemoSend: (body: string) => void;
  onDemoToggle: (area: ChatArea, on: boolean) => void; onDemoConfirm: (appointmentId: string) => void;
}) {
  const { chat, messages, people } = thread;
  const viewer: ChatSide = admin ? "oalab" : "customer";
  // Every card and grey line stands alone; messages in a row by the same person form a run.
  const items = useMemo(() => threadItems(messages.map((message) => ({ ...message, author: message.event ? `event:${message.id}` : `${message.side}:${message.own ? "me" : message.name ?? ""}` })), now), [messages, now]);
  // The preview's cards count from a fixed day, so its request stays open.
  const at = live ? now.getTime() : DEMO_NOW;
  const [busy, setBusy] = useState(false);
  const [aboError, setAboError] = useState("");
  // A switch shows its new position at once; the server's answer then replaces it.
  const [pending, setPending] = useState<Partial<Record<ChatArea, boolean>>>({});
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

  async function toggle(area: ChatArea, on: boolean) {
    setAboError("");
    if (!live) { onDemoToggle(area, on); return; }
    setPending((current) => ({ ...current, [area]: on }));
    setBusy(true);
    try {
      const result = await setChatSubscription({ customerId: chat.customerId, area, enabled: on });
      if (result.ok) onSent(result.data);
      else setAboError(result.error);
    } catch {
      setAboError("Keine Verbindung. Bitte versuche es erneut.");
    } finally {
      setPending((current) => { const next = { ...current }; delete next[area]; return next; });
      setBusy(false);
    }
  }

  async function confirm(appointmentId: string) {
    setError("");
    if (!live) { onDemoConfirm(appointmentId); return; }
    setBusy(true);
    try {
      const result = await confirmChatRequest({ customerId: chat.customerId, appointmentId });
      if (result.ok) onSent(result.data);
      else setError(result.error);
    } catch {
      setError("Keine Verbindung. Bitte versuche es erneut.");
    } finally {
      setBusy(false);
    }
  }

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
        {thread.subscriptions && (
          <ChatAbos subscriptions={{ ...thread.subscriptions, ...pending }} viewer={viewer} company={chat.company} busy={busy} error={aboError} onToggle={(area, on) => void toggle(area, on)} />
        )}
        <span className="chat-pill is-private"><Lock size={11} aria-hidden="true" />Privat</span>
      </header>
      <div className="chat-log" ref={log} role="log" aria-live="polite" aria-label="Nachrichten">
        {/* Customers learn here, where they write, that the team's Telegram group hears of new messages (Art. 13 DSGVO). */}
        <p className="chat-system"><Info size={14} aria-hidden="true" />{admin ? `Privater Chat mit ${chat.company}. Nur ihr Team und oalab lesen mit.` : <span>Hier schreibst du direkt mit dem oalab-Team. Nur {chat.company} und oalab lesen mit; neue Nachrichten und Terminanfragen meldet der Hub unserem Team auch über Telegram.{thread.subscriptions ? " Was du abonniert hast, steht hier als Karte." : ""} <Link href={`${LEGAL_PATHS.privacy}#nachrichten`}>Mehr dazu</Link></span>}</p>
        {items.map(({ message, day, first, last }) => {
          const side = chatMessageSide({ side: message.side, own: message.own, viewer });
          const sender = chatSender({ side: message.side, own: message.own, name: message.name, viewer });
          const event = message.event;
          // A grey line: who switched a subscription or withdrew a request; never news.
          if (event && isSystemEvent(event)) {
            return (
              <div key={message.id} className="chat-item">
                {day && <span className="chat-day">{day}</span>}
                <p className="chat-system is-event"><span>{systemLine(event, { own: message.own, who: sender })}</span><time dateTime={message.at}>{clockTime(message.at)}</time></p>
              </div>
            );
          }
          const view = event ? cardView(event, { viewer, company: chat.company, customerId: chat.customerId, appointment: "appointment" in event ? thread.appointments[event.appointment.id] : undefined, at }) : null;
          // On the right only the own side; admins see there which of them wrote, unless it was themselves.
          const who = side === "in" || (admin && !message.own) ? sender : "";
          const meta = <span className="chat-meta"><time dateTime={message.at}>{clockTime(message.at)}</time>{side === "out" && (message.read ? <CheckCheck size={14} aria-label="gelesen" /> : <Check size={14} aria-label="gesendet" />)}</span>;
          return (
            <div key={message.id} className="chat-item">
              {day && <span className="chat-day">{day}</span>}
              <div className={`chat-msg is-${side}${first ? " is-first" : ""}${last ? " is-last" : ""}${view ? " is-card" : ""}`}>
                {first && who && <span className="chat-who">{who}</span>}
                {view && event ? (
                  <div className="chat-bubble is-card">
                    <ChatCard kind={event.kind} view={view} live={live} busy={busy} links={"appointment" in event ? thread.calendarLinks[event.appointment.id] ?? null : null} onConfirm={(id) => void confirm(id)} />
                    {meta}
                  </div>
                ) : (
                  <div className="chat-bubble">
                    <div className="chat-text"><PlainText text={message.body} /></div>
                    {meta}
                  </div>
                )}
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

/** The symbol of a card's area and change, with the colour the bell gives it (components/hub/notice-symbols.ts). */
function CardSymbol({ kind }: { kind: ChatEventKind | string }) {
  const { icon: Icon, color } = noticeSymbol(kind);
  return <span className="chat-card-symbol" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }} aria-hidden="true"><Icon size={18} color={color} /></span>;
}

/** One bell kind per area, for the symbols of the switches. */
const AREA_SYMBOL: Readonly<Record<ChatArea, string>> = {
  appointments: "appointment.created", files: "file.shared", notes: "note.shared", tasks: "task.created", projects: "project.changed", contract: "contract.changed",
};

/**
 * A change as a card (24.11.2026, plan „Änderungen im Chat mitteilen“ 3.4): symbol and colour of its area, heading with
 * the state an older appointment wears, two or three lines, round buttons. Into the own calendar app as in the mails;
 * admins confirm a request here as it was asked. The preview keeps its links on the page.
 */
function ChatCard({ kind, view, live, busy, links, onConfirm }: {
  kind: ChatEventKind; view: ChatCardView; live: boolean; busy: boolean;
  links: { ics: string; google: string; outlook: string } | null; onConfirm: (appointmentId: string) => void;
}) {
  const [calendar, setCalendar] = useState(false);
  const calendarId = useId();
  const stay = live ? undefined : (event: React.MouseEvent) => event.preventDefault();
  return (
    <div className="chat-card">
      <CardSymbol kind={kind} />
      <div className="chat-card-main">
        <p className="chat-card-head"><strong>{view.heading}</strong>{view.badge && <span className={`chat-pill tone-${view.badge.tone}`}>{view.badge.label}</span>}</p>
        {view.subject && <p className="chat-card-subject">{view.subject}</p>}
        {view.lines.map((line, index) => <p key={index} className="chat-card-line">{line}</p>)}
        {view.was && <p className="chat-card-line">vorher <s>{view.was}</s></p>}
        {view.actions.length > 0 && (
          <div className="chat-card-actions">
            {view.actions.map((action) => {
              if (action.kind === "confirm") {
                return <button key="confirm" type="button" className="chat-card-action is-primary" disabled={busy} onClick={() => onConfirm(action.appointmentId)}><Check size={15} aria-hidden="true" />{action.label}</button>;
              }
              if (action.kind === "calendar") {
                return links ? (
                  <button key="calendar" type="button" className="chat-card-action" aria-expanded={calendar} aria-controls={calendarId} onClick={() => setCalendar((open) => !open)}>
                    <CalendarPlus size={15} aria-hidden="true" />{action.label}
                  </button>
                ) : null;
              }
              return live
                ? <Link key={action.href} className="chat-card-action" href={action.href}><ArrowUpRight size={15} aria-hidden="true" />{action.label}</Link>
                : <a key={action.href} className="chat-card-action" href={action.href} onClick={stay}><ArrowUpRight size={15} aria-hidden="true" />{action.label}</a>;
            })}
          </div>
        )}
        {calendar && links && (
          <div id={calendarId} className="chat-card-calendar" role="group" aria-label="In meinen Kalender">
            <a className="chat-card-action" href={links.ics} onClick={stay}>Apple Kalender</a>
            <a className="chat-card-action" href={links.google} target="_blank" rel="noopener noreferrer" onClick={stay}>Google<span className="visually-hidden"> (neuer Tab)</span></a>
            <a className="chat-card-action" href={links.outlook} target="_blank" rel="noopener noreferrer" onClick={stay}>Outlook<span className="visually-hidden"> (neuer Tab)</span></a>
          </div>
        )}
      </div>
    </div>
  );
}

const noSubscription = () => () => {};
/** The Popover API puts the window above the chat (the sheet clips); older browsers show it inline below the head. */
const popoverSupported = () => typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;
const ABOS_WIDTH = 396;

/** Below its button, right-aligned, never past the screen edges; phones show it as a sheet at the bottom (CSS). */
function placeAbos(card: HTMLElement, button: HTMLElement) {
  if (window.matchMedia("(max-width: 767px)").matches) {
    card.style.removeProperty("left");
    card.style.removeProperty("top");
    return;
  }
  const rect = button.getBoundingClientRect();
  const width = Math.min(ABOS_WIDTH, window.innerWidth - 16);
  const left = Math.min(Math.max(8, rect.right + 14 - width), window.innerWidth - width - 8);
  const height = card.offsetHeight;
  card.style.left = `${left}px`;
  card.style.top = `${Math.max(8, Math.min(rect.bottom + 10, window.innerHeight - height - 8))}px`;
  card.style.setProperty("--abos-origin", `${rect.left + rect.width / 2 - left}px`);
}

/**
 * „Abos“ (plan 3.5): a round glass button left of „Privat“ opens „Im Chat mitteilen“, one switch per area. It counts for
 * everybody in the chat; every switch becomes a grey line. The bell keeps telling everything.
 */
function ChatAbos({ subscriptions, viewer, company, busy, error, onToggle }: {
  subscriptions: Readonly<Record<ChatArea, boolean>>; viewer: ChatSide; company: string; busy: boolean; error: string; onToggle: (area: ChatArea, on: boolean) => void;
}) {
  const floating = useSyncExternalStore(noSubscription, popoverSupported, () => false);
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // The browser opens and closes the window (the button is its invoker; Escape and a click elsewhere close it); the
  // page places it and follows the button while the window is open.
  useEffect(() => {
    const element = cardRef.current;
    const button = buttonRef.current;
    if (!floating || !element || !button) return;
    const follow = () => { if (element.matches(":popover-open")) placeAbos(element, button); };
    const before = (event: Event) => { if ((event as ToggleEvent).newState === "open") placeAbos(element, button); };
    const toggle = (event: Event) => {
      const now = (event as ToggleEvent).newState === "open";
      setOpen(now);
      if (now) {
        placeAbos(element, button);
        window.addEventListener("resize", follow);
        window.addEventListener("scroll", follow, true);
      } else {
        window.removeEventListener("resize", follow);
        window.removeEventListener("scroll", follow, true);
      }
    };
    element.addEventListener("beforetoggle", before);
    element.addEventListener("toggle", toggle);
    return () => {
      element.removeEventListener("beforetoggle", before);
      element.removeEventListener("toggle", toggle);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [floating]);

  const hide = () => (floating ? cardRef.current?.hidePopover() : setOpen(false));
  const content = (
    <>
      <span className="chat-abos-grab" aria-hidden="true" />
      <div className="chat-abos-head">
        <strong id={`${id}-title`}>Im Chat mitteilen</strong>
        <button type="button" className="chat-abos-close" aria-label="Schließen" onClick={hide}><X size={16} aria-hidden="true" /></button>
      </div>
      <p className="chat-abos-intro">{subscriptionIntro(viewer, company)}</p>
      <ul className="chat-abos-list">
        {CHAT_AREAS.map((area) => (
          <li key={area} className="chat-abos-row">
            <CardSymbol kind={AREA_SYMBOL[area]} />
            <span className="chat-abos-text"><strong>{AREA_LABELS[area]}</strong><small>{areaDescription(area, viewer, company)}</small></span>
            <Switch checked={subscriptions[area]} onChange={(on) => onToggle(area, on)} label={`${AREA_LABELS[area]} im Chat mitteilen`} disabled={busy} />
          </li>
        ))}
      </ul>
      {error && <p className="form-error chat-abos-error" role="alert">{error}</p>}
      <p className="chat-abos-foot">{SUBSCRIPTION_FOOT}</p>
    </>
  );
  return (
    <>
      <button ref={buttonRef} type="button" className="chat-abo-button" aria-label="Abos: was in diesem Chat als Karte erscheint" data-tip="Abos"
        aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={floating ? id : undefined} onClick={floating ? undefined : () => setOpen((now) => !now)}>
        <BellPlus size={18} aria-hidden="true" />
      </button>
      {floating
        ? <div ref={cardRef} id={id} popover="auto" className="glass glass-float chat-abos" role="dialog" aria-labelledby={`${id}-title`}>{content}</div>
        : open ? <div id={id} className="glass glass-float chat-abos is-inline" role="dialog" aria-labelledby={`${id}-title`}>{content}</div> : null}
    </>
  );
}
