"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { HOST_CUES, hostCue } from "@/lib/welcome-host";
import { HostAvatar, type HostAvatarHandle } from "./host-avatar";
import { LogoMark, companyInitials } from "./logo-mark";
import type { HubAccount } from "./shell-context";

/** Ali starts a little after the page (or the greeting after sign-in) has made room, while the waterfall settles. */
const START_DELAY = 450;
/** A video that has not started by then (slow line, blocked) gives way to the still with its bubble. */
const START_TIMEOUT = 5000;

type Run = "idle" | "starting" | "talking" | "done";

// One snapshot of <html>: data-greeting (the greeting after sign-in still covers the hub) and whether motion is
// reduced ("Bewegung reduzieren" in data-reduce-motion, lib/appearance.ts; the system setting stands in without it).
// The server renders him due; app/welcome-host.css keeps him hidden there unless motion is reduced.
const subscribe = (change: () => void) => {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-greeting", "data-reduce-motion"] });
  return () => observer.disconnect();
};
const snapshot = () => {
  const { greeting = "", reduceMotion } = document.documentElement.dataset;
  const reduced = reduceMotion ? reduceMotion === "true" : window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return `${greeting}|${reduced ? "reduced" : ""}`;
};
const serverSnapshot = () => "|";

/**
 * A customer's welcome at the top of the overview: Ali from oalab, cut out of his video, stands on the card's lower
 * edge and greets with a bubble. Each time the overview opens he rises and talks, without sound, after sign-in once the
 * greeting has given way; with "Bewegung reduzieren" he stands there with the finished bubble. Under the bubble the
 * company has its own row: its logo as a plate (else its letters), the name and the customer number. The overview still
 * passes `preview`; the welcome plays the same in the design preview, so it goes unread.
 */
export function WelcomeStage({ account, logo = null }: { account: HubAccount; logo?: CustomerLogo | null; preview?: boolean }) {
  const [greeting, reduced] = useSyncExternalStore(subscribe, snapshot, serverSnapshot).split("|");
  const [run, setRun] = useState<Run>("idle");
  const [cue, setCue] = useState<number>(HOST_CUES.length);
  const avatar = useRef<HostAvatarHandle>(null);
  const phase = reduced ? "still" : run === "idle" || run === "starting" ? "ready" : run;

  // Next keeps the overview hidden for a later visit (Activity) together with its state. Resetting as it hides, before
  // the next paint, lets Ali rise again on that visit instead of first showing the last run's bubble.
  useLayoutEffect(() => () => setRun("idle"), []);

  // Once the greeting after sign-in has given way, Ali rises and talks after a short pause; a late video still plays,
  // just without the entrance.
  useEffect(() => {
    if (reduced || greeting) return;
    const timer = window.setTimeout(() => {
      setRun("starting");
      setCue(0);
      const late = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), START_TIMEOUT));
      void Promise.race([avatar.current?.play() ?? Promise.resolve(false), late]).then((started) => {
        setRun((current) => current === "starting" ? (started ? "talking" : "done") : current);
        if (!started) setCue(HOST_CUES.length);
      });
    }, START_DELAY);
    return () => window.clearTimeout(timer);
  }, [reduced, greeting]);

  return (
    <section className="glass glass-card-feature welcome-card welcome-stage" aria-labelledby="welcome-title" data-phase={phase} data-cue={cue}>
      <div className="welcome-host">
        <HostAvatar
          ref={avatar}
          src="/brand/ali-welcome.mp4"
          poster="/brand/ali-welcome.webp"
          onTime={(seconds) => setCue((current) => Math.max(current, hostCue(seconds)))}
          onEnded={() => { setRun("done"); setCue(HOST_CUES.length); }}
        />
      </div>
      <div className="welcome-speech">
        <div className="speech-bubble">
          <p className="speech-from">Ali von oalab</p>
          <h2 className="speech-hello" id="welcome-title">{account.firstName ? `Hallo ${account.firstName}!` : "Hallo!"}</h2>
          <p className="speech-line">Schön, dass du wieder da bist.</p>
        </div>
      </div>
      <div className="welcome-company-row">
        {account.company && <LogoMark logo={logo} initials={companyInitials(account.company)} className="avatar welcome-company-logo" plate />}
        <dl className="welcome-company-text">
          <div><dt className="visually-hidden">Unternehmen</dt><dd className="welcome-company">{account.company ?? "Noch nicht zugeordnet"}</dd></div>
          <div className="welcome-company-number"><dt>{account.freelancer ? "Freelancer-Nr." : "Kundennummer"}</dt><dd className="numeric">{account.customerNumber ?? "–"}</dd></div>
        </dl>
      </div>
      {!account.company && <p className="t-footnote t-secondary welcome-note">Dein Projektteam ordnet deinen Zugang einem Unternehmen zu. Danach siehst du hier auch deine Kundennummer.</p>}
    </section>
  );
}
