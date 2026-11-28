"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, HardDrive, Hourglass, Info, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { formatBytes } from "@/lib/hub-files/catalog";
import { removeUpload } from "@/lib/hub-uploads/actions";
import { checkCustomerUpload } from "@/lib/hub-uploads/check";
import { expiryOf, spaceMeter, UPLOAD_KEEP_DAYS } from "@/lib/hub-uploads/rules";
import type { HubUploadsState } from "@/lib/hub-uploads/types";
import { useInfo } from "../info-box";
import { timeToGo, UploadIcon, uploadedWhen } from "./upload-parts";
import { useCustomerUploadQueue } from "./use-upload-queue";

/**
 * The customers' upload area above their files (preview „Version 3“, approved 27.11.2026): large files for oalab, up
 * to 5 GB each, in the space of the customer (5 GB unless oalab set another). oalab takes them over into the files below;
 * what nobody takes over goes after 7 days. Each file goes up in parts with its progress; leaving the page asks first.
 */
export function CustomerUploadArea({ uploads }: { uploads: HubUploadsState }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const queue = useCustomerUploadQueue({ onDone: () => router.refresh() });
  const info = useInfo("Upload-Bereich", {
    steps: [
      <><b>Große Dateien</b> bis 5 GB schickst du hier an oalab.</>,
      <><b>oalab übernimmt</b> sie zu deinen Dateien darunter.</>,
      <><b>Nach 7 Tagen</b> löscht der Hub, was keiner übernimmt.</>,
    ],
    ask: "Wie funktioniert der Upload-Bereich?",
  });
  // Progress and time left move on while files are on their way.
  useEffect(() => {
    if (!queue.busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [queue.busy]);

  const space = uploads.space ?? { used: 0, limit: 0, maxFile: 0 };
  const coming = queue.items.filter((item) => item.state !== "failed").reduce((sum, item) => sum + item.size, 0);
  const room = Math.max(0, space.maxFile - coming);
  const meter = spaceMeter(space.used + coming, space.limit);
  const waiting = uploads.uploads.filter((upload) => upload.status === "waiting");
  const empty = !uploads.uploads.length && !queue.items.length;

  function send(list: File[]) {
    if (!list.length || !uploads.customerId) return;
    const errors: string[] = [];
    const accepted: File[] = [];
    let left = room;
    for (const file of list) {
      const check = checkCustomerUpload(file.name, file.size, left);
      if (!check.ok) { errors.push(check.error); continue; }
      accepted.push(file);
      left -= file.size;
    }
    setProblems(errors);
    setNow(Date.now());
    if (accepted.length) queue.add(accepted, uploads.customerId);
  }

  async function remove(id: string) {
    setRemoving(id);
    setFailure("");
    const result = await removeUpload(id);
    setRemoving(null);
    setConfirming(null);
    if (result.ok) router.refresh(); else setFailure(result.error);
  }

  const pickButton = (
    <button type="button" className="sheet-action is-primary" onClick={() => input.current?.click()} disabled={room <= 0}>
      <Upload size={15} aria-hidden="true" /><span className="am-btn-text">Dateien hochladen</span>
    </button>
  );
  const drop = room <= 0 ? (
    <div className="up-drop is-blocked" aria-disabled="true"><CloudUpload aria-hidden="true" /><span>Kein Platz mehr frei · neue Dateien passen, sobald oalab etwas übernimmt oder du eine Datei löschst</span></div>
  ) : (
    <div className={`up-drop${empty ? " is-big" : ""}${over ? " is-over" : ""}`} role="button" tabIndex={0} aria-label="Dateien für oalab hochladen"
      onClick={() => input.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.current?.click(); } }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { event.preventDefault(); setOver(false); send(Array.from(event.dataTransfer.files)); }}>
      <CloudUpload aria-hidden="true" />
      {empty ? <>
        <strong>Dateien für oalab hochladen</strong>
        <span>Hierher ziehen oder <b>auswählen</b>. Videos, Fotos, ZIP oder PDF bis {formatBytes(Math.min(room, space.maxFile))}.</span>
        <small>oalab bekommt eine Meldung und übernimmt die Dateien zu deinen Dateien. Was keiner übernimmt, löscht der Hub nach {UPLOAD_KEEP_DAYS} Tagen.</small>
      </> : <>
        <span className="up-drop-desk">Dateien hierher ziehen oder <b>auswählen</b> · bis {formatBytes(room)} je Datei</span>
        <span className="up-drop-phone"><b>Dateien auswählen</b> · bis {formatBytes(room)}</span>
      </>}
    </div>
  );

  return (
    <section className="sheet section-first up-sheet" aria-label="Upload-Bereich">
      <header className="am-pane-head">
        <span className="am-tile is-upload is-lg"><CloudUpload size={22} aria-hidden="true" /></span>
        <div className="am-pane-title"><strong>Upload-Bereich</strong><span>Große Dateien an oalab schicken. Sie liegen hier höchstens {UPLOAD_KEEP_DAYS} Tage, bis oalab sie übernimmt.</span></div>
        <div className="am-pane-actions">{info.button}{pickButton}</div>
      </header>
      {info.box}
      <input ref={input} type="file" multiple hidden onChange={(event) => { send(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <div className="up-quota">
        <span className="up-quota-text"><b>{formatBytes(space.used + coming)}</b> von {formatBytes(space.limit)} belegt</span>
        <span className="up-quota-side"><HardDrive aria-hidden="true" />{formatBytes(Math.max(0, space.limit - space.used - coming))} frei</span>
        <div className={`up-meter${meter.tone ? ` is-${meter.tone}` : ""}`} role="meter" aria-valuemin={0} aria-valuemax={space.limit} aria-valuenow={space.used + coming} aria-label="Speicher im Upload-Bereich">
          <span style={{ width: `${Math.max(meter.percent, space.used + coming ? 2 : 0)}%` }} />
        </div>
      </div>
      {queue.busy && <div className="up-note is-info"><Info aria-hidden="true" /><span><b>Bitte das Fenster offen lassen.</b> Große Dateien gehen in Teilen hoch; schließt du es, bricht der Upload ab.</span></div>}
      {[...problems, ...(failure ? [failure] : [])].map((problem) => <div key={problem} className="up-note is-bad" role="alert"><TriangleAlert aria-hidden="true" /><span>{problem}</span></div>)}
      {drop}
      {(queue.items.length > 0 || uploads.uploads.length > 0) && (
        <ul className="up-list" role="list">
          {queue.items.map((item) => {
            const percent = item.size ? Math.min(100, Math.round((item.sent / item.size) * 100)) : 0;
            const failed = item.state === "failed";
            return (
              <li key={item.key} className={`up-row${failed ? " is-failed" : ""}`}>
                <UploadIcon fileName={item.name} />
                <span className="up-main">
                  <strong>{item.name}</strong>
                  <span>{failed ? item.error : item.state === "finishing" ? `${formatBytes(item.size)} · wird abgeschlossen …` : `${formatBytes(item.sent)} von ${formatBytes(item.size)}${timeToGo(item.sent, item.size, item.startedAt, now) ? ` · ${timeToGo(item.sent, item.size, item.startedAt, now)}` : ""}`}</span>
                  {!failed && <span className="up-progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>}
                </span>
                {failed
                  ? <span className="chat-pill has-icon tone-bad"><TriangleAlert aria-hidden="true" />Nicht hochgeladen</span>
                  : <span className="chat-pill has-icon tone-info">{item.state === "uploading" ? <CloudUpload aria-hidden="true" /> : <MiniLoader size={12} />}{item.state === "starting" ? "Startet" : `Lädt hoch · ${percent} %`}</span>}
                <span className="up-acts">
                  <button type="button" className="am-icon-btn" onClick={() => (failed ? queue.dismiss(item.key) : queue.cancel(item.key))} aria-label={failed ? `${item.name} ausblenden` : `Upload von ${item.name} abbrechen`} data-tip={failed ? "Ausblenden" : "Abbrechen"}><X size={15} aria-hidden="true" /></button>
                </span>
              </li>
            );
          })}
          {uploads.uploads.map((upload) => {
            const expiry = upload.expiresAt ? expiryOf(upload.expiresAt, now, "customer") : null;
            const asking = confirming === upload.id;
            return (
              <li key={upload.id} className="up-row">
                <UploadIcon fileName={upload.fileName} mimeType={upload.mimeType} />
                <span className="up-main">
                  <strong>{upload.fileName}</strong>
                  <span>{[formatBytes(upload.sizeBytes), uploadedWhen(upload.createdAt, now), upload.uploader].filter(Boolean).join(" · ")}</span>
                </span>
                {expiry
                  ? <span className={`chat-pill has-icon tone-${expiry.tone}`}><Hourglass aria-hidden="true" />Wartet auf oalab · {expiry.text}</span>
                  : <span className="chat-pill has-icon tone-info"><CloudUpload aria-hidden="true" />Wird hochgeladen</span>}
                <span className="up-acts">
                  {asking
                    ? <button type="button" className="sheet-action is-danger" onClick={() => remove(upload.id)} disabled={removing !== null}>{removing === upload.id ? <MiniLoader size={14} /> : <Trash2 size={14} aria-hidden="true" />}Löschen</button>
                    : <button type="button" className="am-icon-btn" onClick={() => setConfirming(upload.id)} aria-label={`${upload.fileName} löschen`} data-tip="Löschen" data-tip-sub="Nur solange oalab sie nicht übernommen hat"><Trash2 size={15} aria-hidden="true" /></button>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="up-foot">
        <span>{waiting.length ? `${waiting.length} ${waiting.length === 1 ? "Datei wartet" : "Dateien warten"} auf oalab` : "Nichts wartet auf oalab"}</span>
        <span>Übernommene Dateien zählen nicht mehr zum Speicher.</span>
      </div>
    </section>
  );
}
