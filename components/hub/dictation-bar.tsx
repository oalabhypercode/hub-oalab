"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Mic, Square, X } from "lucide-react";
import { formatDictationTime } from "@/lib/hub-assistant/dictation";
import { useInfo } from "./info-box";
import type { Dictation } from "./use-dictation";

/** The microphone between the chat field and "Senden": starts a dictation, ends it while listening. */
export function DictationButton({ dictation, disabled }: { dictation: Dictation; disabled: boolean }) {
  const listening = dictation.state === "listening";
  const label = listening ? "Diktat beenden" : dictation.state === "idle" ? "Diktieren" : "Diktat abbrechen";
  return (
    <button type="button" className={`assistant-mic${listening ? " is-listening" : ""}`} onClick={dictation.toggle}
      disabled={disabled && dictation.state === "idle"} aria-pressed={listening} aria-label={label} data-tip={label}>
      {listening ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
    </button>
  );
}

/** Seconds since the start, counted in the bar itself so the chat does not render every second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="assistant-dictation-time numeric">{formatDictationTime(now - since)}</span>;
}

/** Five bars; the dictation writes their --level from the microphone, or they breathe calmly without a measurement. */
function LevelMeter({ attach, calm }: { attach: (element: HTMLElement | null) => void; calm: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    attach(element.current);
    return () => attach(null);
  }, [attach]);
  return <span ref={element} className={`assistant-dictation-level${calm ? " is-calm" : ""}`} aria-hidden="true"><i /><i /><i /><i /><i /></span>;
}

/**
 * Above the chat field: the list „Mikrofon wählen“ (first dictation with more than one microphone), the bar
 * „Hört zu …“ with level, time and the words being recognised, or a hint when the dictation could not start.
 */
export function DictationBar({ dictation }: { dictation: Dictation }) {
  const info = useInfo("Diktieren", {
    steps: [
      <><b>Mikrofon</b> antippen und sprechen, der Text landet im Feld.</>,
      <><b>Pause</b> oder „Fertig“ beendet, dann prüfen und senden.</>,
      <><b>Die Sprache</b> erkennt dein Browser, beim Hub kommt nur Text an.</>,
    ],
    warn: "Chrome nutzt dafür Google, Edge Microsoft, Safari Apple.",
    ask: "Wie funktioniert das Diktieren im Assistenten?",
  });

  if (dictation.state === "choosing") {
    return (
      <>
        <div className="assistant-mics" role="group" aria-label="Mikrofon wählen">
          <div className="assistant-mics-head"><strong>Mikrofon wählen</strong>{info.button}
            <button type="button" className="assistant-mics-close" onClick={dictation.cancel} aria-label="Abbrechen" data-tip="Abbrechen"><X size={15} aria-hidden="true" /></button>
          </div>
          <button type="button" className="sheet-action-item" onClick={() => dictation.choose(null)}>
            <span className="sheet-action-icon"><Mic size={16} aria-hidden="true" /></span>
            <span className="sheet-action-text"><strong>Standard</strong><small>Wie in den Einstellungen des Computers</small></span>
            {!dictation.mic && dictation.startedAt > 0 && <Check className="hub-option-check" size={15} aria-hidden="true" />}
          </button>
          {dictation.mics.map((item) => (
            <button key={item.deviceId} type="button" className="sheet-action-item" onClick={() => dictation.choose(item)}>
              <span className="sheet-action-icon"><Mic size={16} aria-hidden="true" /></span>
              <span className="sheet-action-text"><strong>{item.label}</strong></span>
              {dictation.mic?.deviceId === item.deviceId && <Check className="hub-option-check" size={15} aria-hidden="true" />}
            </button>
          ))}
          <small className="assistant-mics-note">Der Hub merkt sich die Wahl in diesem Browser.</small>
        </div>
        {info.box}
      </>
    );
  }

  if (dictation.state === "starting" || dictation.state === "listening") {
    const listening = dictation.state === "listening";
    return (
      <>
        <div className={`assistant-dictation${listening ? " is-listening" : ""}`} role="status">
          <span className="assistant-dictation-dot" aria-hidden="true" />
          <strong>{listening ? "Hört zu …" : "Mikrofon startet …"}</strong>
          {listening && <LevelMeter attach={dictation.attachLevel} calm={!dictation.metered} />}
          {listening && <Elapsed since={dictation.startedAt} />}
          {info.button}
          {listening && (
            <span className="assistant-dictation-actions">
              {dictation.mics.length > 1 && (
                <button type="button" className="assistant-dictation-chip" onClick={dictation.changeMic} data-tip="Anderes Mikrofon wählen">
                  {dictation.mic?.label ?? "Standard-Mikrofon"} ändern
                </button>
              )}
              <button type="button" className="assistant-dictation-done" onClick={dictation.stop}><Check size={14} aria-hidden="true" />Fertig</button>
            </span>
          )}
          {dictation.interim && <p className="assistant-dictation-interim">{dictation.interim}</p>}
        </div>
        {info.box}
      </>
    );
  }

  if (!dictation.error) return null;
  return (
    <p className="assistant-dictation-error" role="alert">
      <span>{dictation.error}</span>
      <button type="button" onClick={dictation.clearError} aria-label="Hinweis schließen" data-tip="Schließen"><X size={14} aria-hidden="true" /></button>
    </p>
  );
}
