"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { THINK_CUES, cueCount } from "@/lib/welcome-host";
import { HostAvatar, type HostAvatarHandle } from "./host-avatar";

/** Ali starts a moment after Nachrichten has opened. */
const START_DELAY = 400;
/** A video that has not started by then (slow line, blocked) gives way to the still with its bubble. */
const START_TIMEOUT = 5000;

type Run = "idle" | "starting" | "talking" | "done";

// "Bewegung reduzieren" lives on <html data-reduce-motion> (lib/appearance.ts); the system setting stands in without it.
const subscribe = (change: () => void) => {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
  return () => observer.disconnect();
};
const reducedSnapshot = () => {
  const flag = document.documentElement.dataset.reduceMotion;
  return flag ? flag === "true" : window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

/**
 * Ali from oalab thinks along at the bottom of a customer's conversation column. Each time Nachrichten opens he
 * rises, two small circles and his thought bubble come up, then he stands still; always without sound. With
 * "Bewegung reduzieren" he stands there with the finished bubble. The list above him scrolls by itself.
 */
export function MessagesHost() {
  const reduced = useSyncExternalStore(subscribe, reducedSnapshot, () => false);
  const [run, setRun] = useState<Run>("idle");
  const [cue, setCue] = useState<number>(THINK_CUES.length);
  const avatar = useRef<HostAvatarHandle>(null);
  const phase = reduced ? "still" : run === "idle" || run === "starting" ? "ready" : run;

  // Each visit thinks again: leaving Nachrichten, or the router keeping the page hidden for a later visit, resets him.
  useEffect(() => {
    if (reduced) return;
    const timer = window.setTimeout(() => {
      setRun("starting");
      setCue(0);
      const late = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), START_TIMEOUT));
      void Promise.race([avatar.current?.play() ?? Promise.resolve(false), late]).then((started) => {
        setRun((current) => current === "starting" ? (started ? "talking" : "done") : current);
        if (!started) setCue(THINK_CUES.length);
      });
    }, START_DELAY);
    return () => { window.clearTimeout(timer); setRun("idle"); };
  }, [reduced]);

  return (
    <div className="chat-think" data-phase={phase} data-cue={cue}>
      <div className="chat-think-figure">
        <HostAvatar
          ref={avatar}
          src="/brand/ali-thinking.mp4"
          poster="/brand/ali-thinking.webp"
          onTime={(seconds) => setCue((current) => Math.max(current, cueCount(THINK_CUES, seconds)))}
          onEnded={() => { setRun("done"); setCue(THINK_CUES.length); }}
        />
      </div>
      <div className="think-wrap">
        <div className="think-bubble">
          <p className="think-from">Ali von oalab</p>
          <p className="think-main">Hmm … was liegt dir auf dem Herzen?</p>
          <p className="think-line">Schreib uns einfach hier. Wir antworten dir persönlich.</p>
        </div>
        <span className="think-dot is-2" aria-hidden="true" />
        <span className="think-dot is-1" aria-hidden="true" />
      </div>
    </div>
  );
}
