"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, ChevronLeft, Globe, Info, Lock, MessagesSquare, PauseCircle, Search, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { HeaderActions } from "../app-shell";
import { LargeTitleHeader } from "../large-title-header";
import { PlainText, RichText } from "../rich-text";
import { CategoryTitle } from "./workspace";
import { LoadNotice } from "./overview";
import { CustomerSign } from "./customer-sign";
import { ChatTabs, PrivateChats, type ChatTab } from "./private-chat";
import { ComposeRow, runStep, useGrowingField, type Attempt } from "./conversation-compose";
import { TeamIssueComposer, TeamIssueDialog, TeamSign, type ReportInput } from "./team-issue";
import type { ScreenProps } from "./types";
import { handBackService, openConversation, refreshConversations, reportTeamIssue, serviceSites, writeService } from "@/lib/hub-conversations/actions";
import { DEMO_NOW, demoConversations, demoReport, demoStep, type DemoStep } from "@/lib/hub-conversations/fixtures";
import {
  CONVERSATION_FILTERS, TEAM_ISSUE_PREFIX, clockTime, conversationFilter, handBackCopy, listTime, messageSide, previewText, reportRest, senderLabel,
  serviceTeamHint, serviceWriteHint, stampLabel, teamIssueTitle, threadItems, type ConversationFilter,
} from "@/lib/hub-conversations/rules";
import type { ConversationMessage, ConversationResult, ConversationsState, ConversationSummary, ConversationThread, ServiceControls, ServiceWriteKind, TeamIssueReport } from "@/lib/hub-conversations/types";
import {
  QUIPS, QUIP_MS, WORKING_STATES, freshViewLabel, mailNote, preparedReply, silenceCopy, statusFromFacts, teamSlowLines, threadStatus,
  unreportedSiteAt, type TestSiteView, type WorkStatus,
} from "@/lib/hub-conversations/work-status";
import { demoPrivateChats } from "@/lib/hub-private-chat/fixtures";
import type { PrivateChatState } from "@/lib/hub-private-chat/types";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";

const POLL_MS = 15_000;
/** How often the list asks for the test sites of requests in work („Rückmeldung fehlt“). */
const SITES_MS = 120_000;

/**
 * The clock of the work status (26.11.2026): every half minute in the browser and none on the server, so the server and
 * the browser render the same first and the bubble, the site line and „Rückmeldung fehlt“ follow right after.
 */
const CLOCK_MS = 30_000;
const clockNow = () => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS;
function subscribeClock(change: () => void) {
  const timer = window.setInterval(change, CLOCK_MS);
  return () => window.clearInterval(timer);
}
function useClock(fixed: number | null): number | null {
  const live = useSyncExternalStore(subscribeClock, clockNow, () => null);
  return fixed ?? live;
}

/**
 * Nachrichten (4 November 2026): customers write here with oalab in their private chat; requests go to the service
 * platform. Admins have two tabs: "Privat" with every customer's private chat to answer, and "Service" with every
 * request of the service platform, where they also step in: give a paused request back, write for the customer or
 * answer as oalab. The team reports problems with NoteTree there too (./team-issue.tsx).
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

/** The customer's logo; a report of the team has its own sign. */
function ServiceAvatar({ conversation }: { conversation: ConversationSummary }) {
  if (conversation.team) return <TeamSign />;
  const company = conversation.company ?? conversation.title;
  return <CustomerSign customer={{ id: conversation.customerId ?? company, company }} logo={conversation.logo} />;
}

// A report of the team names its kind once, in the line where a request names its company, not in every title.
const titleOf = (conversation: ConversationSummary) => conversation.team ? teamIssueTitle(conversation.title) : conversation.title;
const originOf = (conversation: ConversationSummary) => conversation.team ? TEAM_ISSUE_PREFIX : conversation.company;

function lastLine(conversation: ConversationSummary) {
  const last = conversation.lastMessage;
  if (!last) return "Noch keine Nachricht";
  const text = previewText(conversation.team ? reportRest(last.body, titleOf(conversation)) : last.body);
  if (last.sender === "system") return text;
  const who = senderLabel(last.sender, last.name, last.onBehalf, conversation.company);
  // A report of one line is its own title already.
  return text ? `${who}: ${text}` : `Gemeldet von ${who}`;
}

/** „oa 14“, „OA-14“ and „14“ all find OA-14. */
const compact = (value: string) => value.toLowerCase().replace(/[\s-]+/g, "");

/**
 * Every request of the service platform for admins, one list with its number and state: open one to read along and
 * step in. Answers and internal notes from NoteTree Business keep coming from there. The team's own reports
 * („NoteTree-Verbesserung“) are made here and sit in the same list.
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
  // The examples read the work status at their own afternoon; real requests at the browser's clock.
  const clock = useClock(fixtures ? Date.parse(DEMO_NOW) : null);
  // Test sites of the requests in work, asked after the list shows; the examples bring theirs along.
  const [sites, setSites] = useState<Readonly<Record<string, TestSiteView | null>>>(() => fixtures ? Object.fromEntries(fixtures.sites) : {});
  // „NoteTree-Problem melden“: the draft stays with the list, so closing the window loses nothing.
  const [reporting, setReporting] = useState(false);
  const [reportDraft, setReportDraft] = useState("");
  // Said in a report right after it was made, until the next step there.
  const [notice, setNotice] = useState<{ readonly id: string; readonly text: string } | null>(null);

  const withLogo = (item: ConversationSummary): ConversationSummary => ({ ...item, logo: logos.get(item.id) ?? item.logo });
  const conversation = list.find((item) => item.id === openId) ?? null;
  const thread: ConversationThread | null = live
    ? liveThread && liveThread.conversation.id === openId ? liveThread : null
    : conversation && demo && fixtures
      ? { conversation, messages: demo.messages.get(conversation.id) ?? [], controls: demo.controls.get(conversation.id) ?? null, testSite: fixtures.sites.get(conversation.id) ?? null, mails: fixtures.mails.get(conversation.id) }
      : null;

  // Requests the AI or the team works on: only their test sites can tell that the AI did not report.
  const watched = useMemo(() => list.filter((item) => WORKING_STATES.has(item.state) && item.lastClientAt && !item.aiPaused).map((item) => item.id).sort().join(","), [list]);
  useEffect(() => {
    if (!live || !watched) return;
    let current = true;
    const look = () => serviceSites({ ids: watched.split(",") })
      .then((result) => { if (current && result.ok) setSites((before) => ({ ...before, ...result.data })); })
      .catch(() => { /* the next look tries again */ });
    look();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") look(); }, SITES_MS);
    return () => { current = false; window.clearInterval(timer); };
  }, [live, watched]);

  /** „Rückmeldung fehlt“: the test site changed after the customer's last message and the AI has not reported for half an hour. */
  const silent = (item: ConversationSummary) => {
    if (clock === null) return false;
    // The open conversation knows its test site freshest.
    const site = thread?.conversation.id === item.id && thread.testSite !== undefined ? thread.testSite : sites[item.id];
    return statusFromFacts({ state: item.state, lastClientAt: item.lastClientAt ?? null, lastResultAt: item.lastResultAt ?? null, siteAt: unreportedSiteAt(site), paused: item.aiPaused, now: clock }).silentSince !== null;
  };

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
    setNotice((current) => current?.id === id ? current : null);
    router.push(`${pathname}?tab=service&conversation=${encodeURIComponent(id)}`, { scroll: false });
  };
  const isNew = (item: ConversationSummary) => unread.has(item.id) && item.id !== openId;
  const close = () => { setNotice(null); router.push(`${pathname}?tab=service`, { scroll: false }); };

  // From an open request of a customer the report may name it.
  const related = conversation && !conversation.team && conversation.group !== "done" ? conversation : null;
  const submitReport = async (input: ReportInput): Promise<ConversationResult<TeamIssueReport>> => {
    if (live) return reportTeamIssue(input);
    const about = list.find((item) => item.id === input.relatedRequestId) ?? null;
    return { ok: true, data: demoReport({ body: input.body, related: about, author: author || "Du", at: new Date().toISOString() }, list, demo!.messages) };
  };
  /** The report (new, or the open one with the same text) shows in the list, opens and says what happened. */
  const reported = ({ thread: next, existing }: TeamIssueReport) => {
    const { id } = next.conversation;
    if (live) setLiveThread(next);
    else setDemo((before) => before && { messages: new Map(before.messages).set(id, [...next.messages]), controls: new Map(before.controls).set(id, next.controls!) });
    setList((current) => [next.conversation, ...current.filter((item) => item.id !== id)]);
    setReporting(false);
    setReportDraft("");
    setFilter("all");
    setQuery("");
    open(id);
    setNotice({ id, text: existing ? "Diese Meldung gibt es schon, sie ist noch offen." : "Gemeldet. Sie steht jetzt hier und in NoteTree Business." });
  };

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
          <div className="chat-list-head has-report">
            <h2>Anfragen</h2>
            <button type="button" className="sheet-action chat-report-open" onClick={() => setReporting(true)}><Wrench size={14} aria-hidden="true" />NoteTree-Problem melden</button>
          </div>
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
                      <span className="chat-conv-top"><strong>{titleOf(item)}</strong><time dateTime={item.lastAt} className={isNew(item) ? "is-new" : undefined}>{listTime(item.lastAt, now)}</time></span>
                      <span className="chat-conv-company"><span className="chat-ref">{item.reference}</span>{originOf(item) && <span>{originOf(item)}</span>}</span>
                      <span className="chat-conv-sub">
                        <span className="chat-conv-last">{lastLine(item)}</span>
                        <StatePill conversation={item} silent={silent(item)} />
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

        <section className="chat-pane" aria-label={thread ? `${thread.conversation.team ? "Meldung" : "Anfrage"} ${thread.conversation.reference}: ${titleOf(thread.conversation)}` : "Anfrage"}>
          {thread ? (
            <ServiceThread key={thread.conversation.id} thread={{ ...thread, conversation: withLogo(thread.conversation) }} now={now} clock={clock} live={live} onClose={close} onChanged={changed} onDemoStep={demoChange}
              notice={notice?.id === thread.conversation.id ? notice.text : undefined} onNoticeSeen={() => setNotice(null)} />
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
      {reporting && <TeamIssueDialog draft={reportDraft} onDraft={setReportDraft} related={related} submit={submitReport} onReported={reported} onClose={() => setReporting(false)} />}
    </div>
  );
}

/**
 * The state as the customer reads it; a paused AI is what the team has to look at first, then a test site that changed
 * without a word from the AI (26.11.2026).
 */
function StatePill({ conversation, silent = false }: { conversation: ConversationSummary; silent?: boolean }) {
  if (conversation.aiPaused) return <span className="chat-pill tone-todo">KI pausiert</span>;
  if (silent) return <span className="chat-pill tone-todo" data-tip="Die Testseite hat sich geändert, die KI hat sich seit einer halben Stunde nicht gemeldet.">Rückmeldung fehlt</span>;
  return <span className={`chat-pill tone-${conversation.tone}`}>{conversation.stateLabel}</span>;
}

/** The test site in the head of a conversation, with the date of its last change (26.11.2026). */
function SiteLink({ site, now }: { site: TestSiteView; now: Date }) {
  const label = site.updatedAt ? stampLabel(site.updatedAt, now) : null;
  return (
    <a className="chat-site" href={site.url} target="_blank" rel="noopener noreferrer" data-tip={label ? `Testseite öffnen · zuletzt angepasst ${label}` : "Testseite öffnen"}
      aria-label={label ? `Testseite öffnen, zuletzt angepasst ${label} (neuer Tab)` : "Testseite öffnen (neuer Tab)"}>
      <span className="chat-site-dot" aria-hidden="true" /><b>Testseite</b>{label && <span>· {label}</span>}
    </a>
  );
}

/** After a result: what landed on the test site and when, and whether the customer got the e-mail. */
function FreshLine({ message, people, now }: { message: ConversationMessage; people: number | undefined; now: Date }) {
  const label = freshViewLabel(message.result);
  if (!label) return null;
  const note = mailNote(people);
  return <p className="chat-system is-fresh"><Sparkles size={14} aria-hidden="true" /><span><b>{label}</b> · Testseite angepasst {stampLabel(message.at, now)}{note && ` · ${note}`}</span></p>;
}

/**
 * Lines that take turns while the AI works, each a few seconds; honest lines once it takes long or the AI did not
 * report. Screen readers hear one steady sentence instead of every line.
 */
function Quips({ lines, honest }: { lines: readonly string[]; honest: boolean }) {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const count = lines.length;
  useEffect(() => {
    if (count < 2) return;
    let swap: number | undefined;
    const timer = window.setInterval(() => {
      if (document.documentElement.dataset.reduceMotion === "true") { setIndex((value) => (value + 1) % count); return; }
      setLeaving(true);
      swap = window.setTimeout(() => { setIndex((value) => (value + 1) % count); setLeaving(false); }, 320);
    }, QUIP_MS);
    return () => { window.clearInterval(timer); window.clearTimeout(swap); };
  }, [count]);
  return (
    <span className={`chat-quip${honest ? " is-slow" : ""}`}>
      <span className="chat-quip-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className={`chat-quip-t${leaving ? " is-out" : ""}`} aria-hidden="true">{lines[index % count]}</span>
      <span className="visually-hidden">{honest ? lines[0] : "Die KI arbeitet an dieser Anfrage."}</span>
    </span>
  );
}

/** While the AI or the team works: since when, with the lines; and that the test site changed before the AI said a word. */
function WorkLines({ status, now }: { status: WorkStatus; now: Date }) {
  const short = (iso: string) => stampLabel(iso, now).replace(/^heute, /, "");
  const working = status.working;
  const honest = Boolean(working && (working.slow || status.silentSince));
  return (
    <>
      {status.siteChangedAt && (
        <div className="chat-item"><p className="chat-system is-site"><Globe size={14} aria-hidden="true" /><span><b>Testseite wurde neu gebaut</b> · {short(status.siteChangedAt)}, noch ohne Nachricht der KI</span></p></div>
      )}
      {working && (
        <div className="chat-item">
          <div className="chat-msg is-in is-first is-last is-working">
            <span className="chat-who">oalab-KI · arbeitet seit {short(working.since)}</span>
            <div className="chat-bubble"><div className="chat-text">
              <Quips key={honest ? "honest" : "quips"} honest={honest} lines={honest ? teamSlowLines({ since: working.since, siteChangedAt: status.siteChangedAt }, short) : QUIPS} />
            </div></div>
          </div>
        </div>
      )}
    </>
  );
}

/** Why nobody can write in a conversation any more. */
function closedLine({ group, team }: ConversationSummary) {
  if (group !== "done") return team ? "Hier kann gerade niemand schreiben: Die Meldung liegt im Papierkorb." : "Hier kann gerade niemand schreiben: Die Anfrage liegt im Papierkorb oder die Firma ist gesperrt.";
  return team ? "Abgeschlossen. Taucht das Problem wieder auf, melde es neu." : "Abgeschlossen. Hier schreibt niemand mehr; neue Wünsche kommen als neue Anfrage.";
}

function ServiceThread({ thread, now, clock, live, notice, onNoticeSeen, onClose, onChanged, onDemoStep }: {
  thread: ConversationThread; now: Date; clock: number | null; live: boolean; notice?: string; onNoticeSeen: () => void; onClose: () => void;
  onChanged: (thread: ConversationThread) => void; onDemoStep: (step: DemoStep) => void;
}) {
  const { conversation, messages, controls } = thread;
  const items = useMemo(() => threadItems(messages.map((message) => ({ ...message, author: `${message.sender}:${message.name ?? ""}:${message.onBehalf}` })), now), [messages, now]);
  const log = useRef<HTMLDivElement>(null);
  const subtitle = [conversation.reference, originOf(conversation)].filter(Boolean).join(" · ");
  const serviceUrl = `${SERVICE_PLATFORM_URL}/workspace/requests/${encodeURIComponent(conversation.reference)}`;
  // Dates of real requests read against the browser's clock; the examples against the page's day.
  const labelNow = live && clock !== null ? new Date(clock) : now;
  // A report of the team has neither a test site nor an AI at work.
  const status = clock === null || conversation.group === "done" || conversation.team ? null
    : threadStatus({ state: conversation.state, messages, testSite: thread.testSite, paused: conversation.aiPaused, now: clock });
  const site = conversation.team ? null : thread.testSite ?? null;
  const silence = status?.silentSince
    ? { copy: silenceCopy(conversation.company, stampLabel(status.silentSince, labelNow).replace(/^heute, /, "")), draft: preparedReply(stampLabel(status.silentSince, labelNow)) }
    : null;
  const tail = `${messages.length}:${status?.working ? 1 : 0}:${status?.siteChangedAt ?? ""}`;

  // New messages and the bubble scroll into view, like in a messenger.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [tail]);

  return (
    <>
      <header className="chat-pane-head">
        <button type="button" className="chat-back" onClick={onClose} aria-label="Zurück zu den Anfragen"><ChevronLeft size={24} aria-hidden="true" /></button>
        <ServiceAvatar conversation={conversation} />
        <div className="chat-pane-title"><strong>{titleOf(conversation)}</strong><span className="chat-pane-sub"><span>{subtitle}</span>{site && <SiteLink site={site} now={labelNow} />}</span></div>
        <StatePill conversation={conversation} silent={Boolean(status?.silentSince)} />
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
              {message.result && <FreshLine message={message} people={thread.mails?.[message.id]} now={labelNow} />}
            </div>
          );
        }) : <p className="chat-system">Noch keine Nachricht in dieser Anfrage.</p>}
        {status && <WorkLines status={status} now={labelNow} />}
      </div>
      {controls === null ? (
        <p className="chat-readonly"><Info size={16} aria-hidden="true" />Du liest mit. Antworten und interne Notizen von oalab entstehen in NoteTree Business.</p>
      ) : !controls.writable ? (
        <p className="chat-readonly"><Lock size={16} aria-hidden="true" />{closedLine(conversation)}</p>
      ) : !controls.teamAccess ? (
        <p className="chat-readonly"><Lock size={16} aria-hidden="true" />{serviceTeamHint(controls.handBack !== null)}</p>
      ) : conversation.team ? (
        <TeamIssueComposer conversation={conversation} controls={controls} live={live} notice={notice} onNoticeSeen={onNoticeSeen} onChanged={onChanged} onDemoStep={onDemoStep} />
      ) : (
        <ServiceComposer conversation={conversation} controls={controls} live={live} silence={silence} onChanged={onChanged} onDemoStep={onDemoStep} />
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
function ServiceComposer({ conversation, controls, live, silence, onChanged, onDemoStep }: {
  conversation: ConversationSummary; controls: ServiceControls; live: boolean;
  /** The test site changed and the AI did not report: the hint with a prepared answer as oalab (26.11.2026). */
  silence: { readonly copy: ReturnType<typeof silenceCopy>; readonly draft: string } | null;
  onChanged: (thread: ConversationThread) => void; onDemoStep: (step: DemoStep) => void;
}) {
  const company = conversation.company;
  const [kind, setKind] = useState<ServiceWriteKind>("on_behalf");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"send" | "hand_back" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const field = useGrowingField(draft);
  const sendAttempt: Attempt = useRef(null);
  const handAttempt: Attempt = useRef(null);
  const step = { id: conversation.id, version: controls.version, onChanged, onError: setError };

  // The banner stays on screen while it leaves, whoever gave the request back.
  const copy = controls.handBack ? handBackCopy(controls.handBack, company) : null;
  const [banner, setBanner] = useState<HandBackCopy | null>(copy);
  if (copy && !sameCopy(copy, banner)) setBanner(copy);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setError("");
    setDone("");
    if (!live) { onDemoStep({ kind, body }); setDraft(""); return; }
    setBusy("send");
    if (await runStep({ ...step, attempt: sendAttempt, call: (input) => writeService({ ...input, kind, body }) })) setDraft("");
    setBusy(null);
  }

  async function handBack() {
    if (!controls.handBack || busy) return;
    const mode = controls.handBack;
    setError("");
    const message = mode === "client" ? `Freigegeben: ${company || "Der Kunde"} kann der Testseite wieder zustimmen.` : "Die KI arbeitet wieder an dieser Anfrage.";
    if (!live) { onDemoStep({ kind: "hand_back" }); setDone(message); return; }
    setBusy("hand_back");
    if (await runStep({ ...step, attempt: handAttempt, call: handBackService })) setDone(message);
    setBusy(null);
  }

  /** „Antwort vorbereiten“: as oalab, with the date of the test site; nothing goes out before the admin sends it. */
  function prepare() {
    if (!silence || busy) return;
    setKind("reply");
    setDraft(silence.draft);
    sendAttempt.current = null;
    setError("");
    setDone("");
    field.current?.focus();
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
      {silence && !banner && (
        <div className="chat-handback is-hint" role="note">
          <span className="chat-handback-icon" aria-hidden="true"><TriangleAlert size={18} /></span>
          <div className="chat-handback-text"><strong>{silence.copy.title}</strong><p>{silence.copy.text}</p></div>
          <button type="button" className="chat-card-action is-primary" disabled={busy !== null} onClick={prepare}>{silence.copy.action}</button>
        </div>
      )}
      {error && <p className="form-error chat-error" role="alert">{error}</p>}
      {done && !copy && <p className="chat-hint is-done" role="status"><Check size={14} aria-hidden="true" />{done}</p>}
      <div className="chat-filter chat-mode" role="group" aria-label="So schreibst du">
        <button type="button" aria-pressed={kind === "on_behalf"} data-tip={`Für ${company || "den Kunden"} schreiben`} onClick={() => { setKind("on_behalf"); sendAttempt.current = null; }}><span>Für {company || "den Kunden"}</span></button>
        <button type="button" aria-pressed={kind === "reply"} onClick={() => { setKind("reply"); sendAttempt.current = null; }}>Als oalab</button>
      </div>
      <ComposeRow id={`service-field-${conversation.id}`} label={kind === "on_behalf" ? `Nachricht für ${company || "den Kunden"}` : "Antwort als oalab"}
        sendLabel={kind === "on_behalf" ? `Für ${company || "den Kunden"} senden` : "Als oalab senden"} field={field} value={draft} placeholder={placeholder}
        disabled={busy === "send"} sending={busy === "send"} canSend={busy === null && Boolean(draft.trim())}
        onChange={(value) => { setDraft(value); sendAttempt.current = null; setDone(""); }} />
      <p className="chat-hint">{hint}</p>
    </form>
  );
}
