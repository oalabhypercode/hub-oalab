"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { finishCustomerUpload, removeUpload, startCustomerUpload, uploadPartUrls } from "@/lib/hub-uploads/actions";
import { partCount, partRange, UPLOAD_PARALLEL_PARTS } from "@/lib/hub-uploads/rules";

/*
 * The browser side of the upload area: each file goes to the object storage in parts (S3 multipart) through short PUT
 * links the hub signs, three parts at a time, each with its own progress. A part that fails is tried again with a
 * fresh link. Cancelling stops the parts and removes the upload; leaving the page while a file is on its way asks first.
 */

export type QueueItem = {
  key: string;
  name: string;
  size: number;
  sent: number;
  state: "starting" | "uploading" | "finishing" | "done" | "failed" | "cancelled";
  error: string;
  startedAt: number;
};

type Job = { item: QueueItem; file: File; customerId: string; id: string | null; requests: Set<XMLHttpRequest>; cancelled: boolean };

const PART_TRIES = 3;
const URL_BATCH = 10;

function putPart(url: string, body: Blob, onProgress: (loaded: number) => void, requests: Set<XMLHttpRequest>) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    requests.add(request);
    request.open("PUT", url);
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => { requests.delete(request); if (request.status >= 200 && request.status < 300) resolve(); else reject(new Error(`HTTP ${request.status}`)); };
    request.onerror = () => { requests.delete(request); reject(new Error("network")); };
    request.onabort = () => { requests.delete(request); reject(new Error("aborted")); };
    request.send(body);
  });
}

export function useCustomerUploadQueue({ onDone }: { onDone: () => void }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const jobs = useRef(new Map<string, Job>());
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });

  const update = useCallback((key: string, change: Partial<QueueItem>) => {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...change } : item));
  }, []);

  const run = useCallback(async (job: Job) => {
    const { item, file } = job;
    const fail = (error: string) => { if (!job.cancelled) update(item.key, { state: "failed", error }); };
    const started = await startCustomerUpload({ customerId: job.customerId, fileName: file.name, size: file.size, type: file.type });
    if (job.cancelled) { if (started.ok) void removeUpload(started.data.id); return; }
    if (!started.ok) { fail(started.error); return; }
    job.id = started.data.id;
    update(item.key, { state: "uploading" });

    const total = partCount(file.size);
    const loaded = new Map<number, number>();
    const report = () => update(item.key, { sent: [...loaded.values()].reduce((sum, value) => sum + value, 0) });
    const urls = new Map<number, string>();
    const pending = Array.from({ length: total }, (_, index) => index + 1);
    const urlFor = async (number: number, fresh = false) => {
      if (!fresh && urls.has(number)) return urls.get(number)!;
      const wanted = fresh ? [number] : pending.slice(0, URL_BATCH).filter((value) => !urls.has(value)).concat(urls.has(number) ? [] : [number]);
      const signed = await uploadPartUrls(job.id!, [...new Set(wanted)]);
      if (!signed.ok) throw new Error(signed.error);
      for (const [key, value] of Object.entries(signed.data.urls)) urls.set(Number(key), value);
      const url = urls.get(number);
      if (!url) throw new Error("Der Upload-Link fehlt.");
      return url;
    };
    let failure = "";
    const worker = async () => {
      while (pending.length && !failure && !job.cancelled) {
        const number = pending.shift()!;
        const { start, end } = partRange(file.size, number);
        const body = file.slice(start, end);
        for (let attempt = 1; ; attempt += 1) {
          try {
            const url = await urlFor(number, attempt > 1);
            await putPart(url, body, (bytes) => { loaded.set(number, bytes); report(); }, job.requests);
            loaded.set(number, end - start);
            report();
            break;
          } catch (error) {
            if (job.cancelled) return;
            loaded.set(number, 0);
            if (attempt >= PART_TRIES) { failure = error instanceof Error && error.message.startsWith("Der ") ? error.message : "Die Verbindung ist abgebrochen. Bitte versuch es noch einmal."; return; }
            await new Promise((resolve) => window.setTimeout(resolve, 1200 * attempt));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL_PARTS, total) }, worker));
    if (job.cancelled) return;
    if (failure) { void removeUpload(job.id); fail(failure); return; }

    update(item.key, { state: "finishing", sent: file.size });
    const finished = await finishCustomerUpload(job.id);
    if (job.cancelled) return;
    if (!finished.ok) { fail(finished.error); return; }
    update(item.key, { state: "done" });
    jobs.current.delete(item.key);
    doneRef.current();
  }, [update]);

  const add = useCallback((files: File[], customerId: string) => {
    const now = Date.now();
    const next = files.map((file, index) => {
      const item: QueueItem = { key: `${now}-${index}-${file.name}`, name: file.name, size: file.size, sent: 0, state: "starting", error: "", startedAt: now };
      const job: Job = { item, file, customerId, id: null, requests: new Set(), cancelled: false };
      jobs.current.set(item.key, job);
      return job;
    });
    setItems((current) => [...current, ...next.map((job) => job.item)]);
    // One file after the other: the parts of one file already run side by side.
    void next.reduce((chain, job) => chain.then(() => (job.cancelled ? undefined : run(job))), Promise.resolve());
  }, [run]);

  const cancel = useCallback((key: string) => {
    const job = jobs.current.get(key);
    if (job) {
      job.cancelled = true;
      job.requests.forEach((request) => request.abort());
      if (job.id) void removeUpload(job.id);
      jobs.current.delete(key);
    }
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  const dismiss = useCallback((key: string) => setItems((current) => current.filter((item) => item.key !== key)), []);

  // A file on its way: leaving the page asks first (the browser shows its own question).
  const busy = items.some((item) => item.state === "starting" || item.state === "uploading" || item.state === "finishing");
  useEffect(() => {
    if (!busy) return;
    const hold = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [busy]);

  return { items: items.filter((item) => item.state !== "done"), busy, add, cancel, dismiss };
}
