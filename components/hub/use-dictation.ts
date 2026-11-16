"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  chosenMic, DICTATION_LANG, dictationError, MAX_DICTATION_MS, micChoices, micErrorCode, MIC_STORAGE_KEY, SILENCE_STOP_MS, storedMic, type Mic,
} from "@/lib/hub-assistant/dictation";

/*
 * Dictation for the assistant chat (admins, since 16.11.2026): the browser's own speech recognition (Web Speech API)
 * turns speech into text. Claude never hears audio; only the text the admin sends reaches the hub and Claude.
 * lib.dom knows only the results of the recognition, so the parts used here are typed by hand.
 */
type SpeechAlternative = { readonly transcript: string };
type SpeechResult = { readonly isFinal: boolean; readonly length: number; readonly [index: number]: SpeechAlternative };
type SpeechResultEvent = Event & { readonly resultIndex: number; readonly results: { readonly length: number; readonly [index: number]: SpeechResult } };
type SpeechErrorEvent = Event & { readonly error: string };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: (track?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const noSubscription = () => () => {};
const canDictate = () => recognitionClass() !== null;

/**
 * Desktop Chrome and Edge take the audio track of a chosen microphone (SpeechRecognition.start(track)), and the page
 * shows its level from the same track. Elsewhere (Safari, phones) the browser picks the microphone itself and the page
 * opens none of its own, so nothing competes with the recognition for the microphone.
 */
function desktopChromium() {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean; brands?: { brand: string }[] } }).userAgentData;
  return Boolean(data && data.mobile === false && data.brands?.some((item) => item.brand === "Chromium"));
}

function readStored() {
  try { return window.localStorage.getItem(MIC_STORAGE_KEY); } catch { return null; }
}
function writeStored(value: string) {
  try { window.localStorage.setItem(MIC_STORAGE_KEY, value); } catch { /* private mode: the list asks again next time */ }
}

/** One dictation from start to end: the recognition, the microphone the page opened (desktop Chromium) and the timers. */
type Session = {
  recognition: Recognition;
  stream: MediaStream | null;
  audio: AudioContext | null;
  frame: number;
  silence: number;
  limit: number;
  closing: number;
  /** Words not final yet; they are kept if the browser ends without delivering them. */
  pending: string;
  heard: boolean;
};

/** Stops everything a session holds, without touching React state (also used when the chat unmounts). */
function release(current: Session) {
  window.clearTimeout(current.silence);
  window.clearTimeout(current.limit);
  window.clearTimeout(current.closing);
  cancelAnimationFrame(current.frame);
  current.recognition.onresult = null;
  current.recognition.onerror = null;
  current.recognition.onend = null;
  current.stream?.getTracks().forEach((track) => track.stop());
  if (current.audio) void current.audio.close().catch(() => undefined);
}

export type DictationState = "idle" | "starting" | "choosing" | "listening";

export type Dictation = {
  supported: boolean;
  state: DictationState;
  /** Words still being recognised: shown in the bar, they reach the field once final (or when the question is sent). */
  interim: string;
  error: string;
  /** Microphones to pick from; only desktop Chrome and Edge list them. */
  mics: Mic[];
  /** The microphone in use, null for the standard one. */
  mic: Mic | null;
  /** The page measures the level itself (desktop Chromium); elsewhere the bar shows a calm animation instead. */
  metered: boolean;
  startedAt: number;
  /** The bar's level meter registers here; the page writes --level (0–1) on it every frame, without a React render. */
  attachLevel: (element: HTMLElement | null) => void;
  /** The microphone button: start, stop while listening, cancel while asking for the microphone. */
  toggle: () => void;
  choose: (mic: Mic | null) => void;
  changeMic: () => void;
  stop: () => void;
  cancel: () => void;
  clearError: () => void;
};

/**
 * `onFinal` gets every finished piece of text (to append to the field), `onEnd` runs when a dictation is over, so the
 * caller can put the cursor back into the field.
 */
export function useDictation({ onFinal, onEnd }: { onFinal: (text: string) => void; onEnd?: () => void }): Dictation {
  const supported = useSyncExternalStore(noSubscription, canDictate, () => false);
  const [state, setState] = useState<DictationState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [mics, setMics] = useState<Mic[]>([]);
  const [mic, setMic] = useState<Mic | null>(null);
  const [metered, setMetered] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const levelElement = useRef<HTMLElement | null>(null);
  const attachLevel = useCallback((element: HTMLElement | null) => { levelElement.current = element; }, []);
  const session = useRef<Session | null>(null);
  /** Counts starts and cancels: an answer of the browser that arrives after a cancel is dropped. */
  const attempt = useRef(0);
  const callbacks = useRef({ onFinal, onEnd });
  useEffect(() => {
    callbacks.current = { onFinal, onEnd };
  });
  // Closing the chat ends a running dictation and frees the microphone.
  useEffect(() => () => {
    attempt.current += 1;
    const current = session.current;
    session.current = null;
    if (!current) return;
    release(current);
    try { current.recognition.abort(); } catch { /* already over */ }
  }, []);

  function finish(current: Session, message = "", flush = false) {
    if (session.current !== current) return;
    session.current = null;
    release(current);
    if (flush && current.pending.trim()) callbacks.current.onFinal(current.pending);
    setState("idle");
    setInterim("");
    setError(message);
    callbacks.current.onEnd?.();
  }

  function stop() {
    const current = session.current;
    if (!current) return;
    try { current.recognition.stop(); } catch { /* already ending */ }
    // The last words arrive before "end"; a browser that never ends is closed after two seconds with what it had.
    window.clearTimeout(current.closing);
    current.closing = window.setTimeout(() => finish(current, "", true), 2000);
  }

  function cancel() {
    attempt.current += 1;
    const current = session.current;
    if (current) {
      try { current.recognition.abort(); } catch { /* already over */ }
      finish(current);
      return;
    }
    setState("idle");
    setInterim("");
  }

  /** Six seconds without new words end the dictation; without any word at all it says so. */
  function armSilence(current: Session) {
    window.clearTimeout(current.silence);
    current.silence = window.setTimeout(() => {
      if (current.heard) { stop(); return; }
      try { current.recognition.abort(); } catch { /* already over */ }
      finish(current, dictationError("no-speech"));
    }, SILENCE_STOP_MS);
  }

  function meter(current: Session, stream: MediaStream) {
    try {
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      current.audio = audio;
      const samples = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += ((value - 128) / 128) ** 2;
        levelElement.current?.style.setProperty("--level", Math.min(1, Math.sqrt(sum / samples.length) * 4).toFixed(2));
        current.frame = requestAnimationFrame(tick);
      };
      current.frame = requestAnimationFrame(tick);
    } catch {
      // Without Web Audio the bar simply shows no level.
    }
  }

  async function begin(choice: Mic | null, ownMicrophone: boolean, probe: MediaStream | null, token: number) {
    const Recognition = recognitionClass();
    if (!Recognition) return;
    let stream: MediaStream | null = null;
    if (ownMicrophone) {
      try {
        if (choice) {
          probe?.getTracks().forEach((track) => track.stop());
          stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: choice.deviceId } } });
        } else {
          stream = probe ?? await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch (cause) {
        if (token !== attempt.current) return;
        setState("idle");
        setError(dictationError(micErrorCode(cause instanceof DOMException ? cause.name : "")));
        return;
      }
      if (token !== attempt.current) { stream.getTracks().forEach((track) => track.stop()); return; }
    }

    const recognition = new Recognition();
    recognition.lang = DICTATION_LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    const current: Session = { recognition, stream, audio: null, frame: 0, silence: 0, limit: 0, closing: 0, pending: "", heard: false };
    session.current = current;
    recognition.onresult = (event) => {
      let pending = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) { if (text.trim()) callbacks.current.onFinal(text); } else pending += text;
      }
      current.pending = pending;
      if (pending.trim() || event.results.length) current.heard = true;
      setInterim(pending.trim());
      armSilence(current);
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" && current.heard) return;
      finish(current, dictationError(event.error));
    };
    recognition.onend = () => finish(current, "", true);
    try {
      const track = stream?.getAudioTracks()[0];
      if (track) recognition.start(track); else recognition.start();
    } catch {
      finish(current, dictationError("unknown"));
      return;
    }
    setMic(choice);
    setMetered(Boolean(stream));
    setStartedAt(Date.now());
    setInterim("");
    setState("listening");
    current.limit = window.setTimeout(stop, MAX_DICTATION_MS);
    armSilence(current);
    if (stream) meter(current, stream);
  }

  function start() {
    if (!supported || session.current) return;
    const token = ++attempt.current;
    setError("");
    if (!desktopChromium()) {
      setState("starting");
      void begin(null, false, null, token);
      return;
    }
    setState("starting");
    void (async () => {
      // The names of the microphones come only with the permission; asking for it is the browser's own prompt.
      let probe: MediaStream;
      try {
        probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (cause) {
        if (token !== attempt.current) return;
        setState("idle");
        setError(dictationError(micErrorCode(cause instanceof DOMException ? cause.name : "")));
        return;
      }
      if (token !== attempt.current) { probe.getTracks().forEach((track) => track.stop()); return; }
      const devices = micChoices(await navigator.mediaDevices.enumerateDevices().catch(() => []));
      setMics(devices);
      const remembered = chosenMic(devices, readStored());
      if (devices.length > 1 && !remembered.known) {
        // First time with more than one microphone: the admin picks one, the browser remembers it.
        probe.getTracks().forEach((track) => track.stop());
        setState("choosing");
        return;
      }
      await begin(remembered.mic, true, probe, token);
    })();
  }

  function choose(choice: Mic | null) {
    writeStored(storedMic(choice));
    const token = ++attempt.current;
    setError("");
    setState("starting");
    void begin(choice, true, null, token);
  }

  /** Another microphone while listening: what was said so far stays in the field, then the list opens. */
  function changeMic() {
    const current = session.current;
    attempt.current += 1;
    if (current) {
      session.current = null;
      release(current);
      try { current.recognition.abort(); } catch { /* already over */ }
      if (current.pending.trim()) callbacks.current.onFinal(current.pending);
    }
    setInterim("");
    setState("choosing");
  }

  function toggle() {
    if (state === "idle") start();
    else if (state === "listening") stop();
    else cancel();
  }

  return {
    supported, state, interim, error, mics, mic, metered, startedAt, attachLevel,
    toggle, choose, changeMic, stop, cancel, clearError: () => setError(""),
  };
}
