"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import { HOST_CUES, consumeHost, hostCue } from "@/lib/welcome-host";
import { HostAvatar, type HostAvatarHandle } from "./host-avatar";
import { LogoMark, companyInitials } from "./logo-mark";
import type { HubAccount } from "./shell-context";

/** Ali starts a little after the page (or the greeting after sign-in) has made room, while the waterfall settles. */
const START_DELAY = 450;
/** A video that has not started by then (slow line, blocked) gives way to the still with its bubble. */
const START_TIMEOUT = 5000;

type Run = "idle" | "starting" | "talking" | "done";

// One snapshot of <html>: data-host (the welcome is due, lib/welcome-host.ts), data-greeting (the greeting after
// sign-in still covers the hub) and whether motion is reduced.
const subscribe = (change: () => void) => {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-host", "data-greeting", "data-reduce-motion"] });
  return () => observer.disconnect();
};
const snapshot = () => {
  const { host = "", greeting = "", reduceMotion } = document.documentElement.dataset;
  const reduced = reduceMotion ? reduceMotion === "true" : window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return `${host}|${greeting}|${reduced ? "reduced" : ""}`;
};
const serverSnapshot = () => "||";

/**
 * A customer's welcome at the top of the overview: Ali from oalab, cut out of his video, stands on the card's lower
 * edge and greets with a bubble. Once per sign-in (and once per tab in the design preview) he rises and talks, without
 * sound; else, and with "Bewegung reduzieren", he stands there with the finished bubble. Under the bubble the company
 * has its own row: its logo as a plate (else its letters), the name and the customer number.
 */
export function WelcomeStage({ account, logo = null, preview }: { account: HubAccount; logo?: CustomerLogo | null; preview: boolean }) {
  const [host, greeting, reduced] = useSyncExternalStore(subscribe, snapshot, serverSnapshot).split("|");
  const armed = host === "pending" && !reduced;
  const [run, setRun] = useState<Run>("idle");
  const [cue, setCue] = useState<number>(HOST_CUES.length);
  const avatar = useRef<HostAvatarHandle>(null);
  const phase = run === "idle" ? (armed ? "ready" : "still") : run === "starting" ? "ready" : run;

  // The welcome is due: once the greeting has given way, Ali rises and talks after a short pause. Taking the mark off
  // <html> ends this effect, so the start runs on by itself; a late video still plays, just without the entrance.
  useEffect(() => {
    if (!armed || greeting) return;
    const timer = window.setTimeout(() => {
      setRun("starting");
      setCue(0);
      consumeHost(document.documentElement, preview);
      const late = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), START_TIMEOUT));
      void Promise.race([avatar.current?.play() ?? Promise.resolve(false), late]).then((started) => {
        setRun((current) => current === "starting" ? (started ? "talking" : "done") : current);
        if (!started) setCue(HOST_CUES.length);
      });
    }, START_DELAY);
    return () => window.clearTimeout(timer);
  }, [armed, greeting, preview]);

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
          <div className="welcome-company-number"><dt>Kundennummer</dt><dd className="numeric">{account.customerNumber ?? "–"}</dd></div>
        </dl>
      </div>
      {!account.company && <p className="t-footnote t-secondary welcome-note">Dein Projektteam ordnet deinen Zugang einem Unternehmen zu. Danach siehst du hier auch deine Kundennummer.</p>}
    </section>
  );
}
