"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Eye, ImageIcon, ImageUp, Info, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createDownloadUrls } from "@/lib/hub-files/actions";
import { fileFormat, formatBytes } from "@/lib/hub-files/catalog";
import type { HubFileCustomer, HubStoredFile } from "@/lib/hub-files/types";
import { prepareLogoUpload, removeCustomerLogo, saveCustomerLogo } from "@/lib/hub-logos/actions";
import { canBeLogo, checkLogoFile, cleanLogoColor, DEFAULT_BRAND_COLOR, LOGO_ACCEPT, LOGO_BUCKET, logoBackgroundLabels, logoBackgrounds, type CustomerLogo, type LogoBackground, type LogoType } from "@/lib/hub-logos/rules";
import { Modal } from "../modal";
import { CustomerSign, type SignSize } from "./customer-sign";

type Choice = { kind: "current" } | { kind: "file"; fileId: string; url: string } | { kind: "upload"; file: File; type: LogoType; url: string };
type Source = Parameters<typeof saveCustomerLogo>[0]["source"];

/**
 * The logo of one customer (admins, real data): one of the customer's images or another upload, on a light, dark or
 * brand-coloured tile. The preview shows it big, in a light and a dark list row and in the small sizes of the lists.
 */
export function LogoDialog({ customer, files, onClose, onSaved }: { customer: HubFileCustomer; files: HubStoredFile[]; onClose: () => void; onSaved: (message: string) => void }) {
  const current = customer.logo ?? null;
  const candidates = useMemo(() => files.filter(canBeLogo), [files]);
  const [choice, setChoice] = useState<Choice | null>(current ? { kind: "current" } : null);
  const [background, setBackground] = useState<LogoBackground>(current?.background ?? "light");
  const [color, setColor] = useState(current?.color ?? DEFAULT_BRAND_COLOR);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");

  // Thumbnails of the customer's images, through the same short-lived links as downloads.
  useEffect(() => {
    if (!candidates.length) return;
    let live = true;
    createDownloadUrls(candidates.map((file) => file.id))
      .then((result) => { if (live && result.ok) setPreviews(Object.fromEntries(result.data.map((item) => [item.id, item.url]))); })
      .catch(() => { /* the thumbnails keep their symbol */ });
    return () => { live = false; };
  }, [candidates]);

  // A picked image is shown from the browser until it is replaced or the dialog closes; it uploads only on saving.
  const pickedUrl = choice?.kind === "upload" ? choice.url : null;
  useEffect(() => () => { if (pickedUrl) URL.revokeObjectURL(pickedUrl); }, [pickedUrl]);

  const preview: CustomerLogo | null = choice ? { url: choice.kind === "current" ? current!.url : choice.url, background, color: background === "brand" ? color : null } : null;
  const unchanged = choice?.kind === "current" && background === current?.background && (background !== "brand" || color === current?.color);
  const sign = (size: SignSize) => <CustomerSign customer={customer} logo={preview} size={size} />;

  function pick(file: File | undefined) {
    if (!file) return;
    const check = checkLogoFile(file.name, file.size, file.type);
    if (!check.ok) { setError(check.error); return; }
    setError("");
    setChoice({ kind: "upload", file, type: check.type, url: URL.createObjectURL(file) });
  }

  async function save() {
    if (!choice) return;
    setBusy("save");
    setError("");
    let source: Source = { kind: "keep" };
    if (choice.kind === "upload") {
      const prepared = await prepareLogoUpload(customer.id, choice.file.name, choice.file.size, choice.type);
      if (!prepared.ok) { setBusy(null); setError(prepared.error); return; }
      const uploaded = await createClient().storage.from(LOGO_BUCKET).uploadToSignedUrl(prepared.data.path, prepared.data.token, choice.file, { contentType: choice.type });
      if (uploaded.error) { setBusy(null); setError("Das Bild konnte nicht hochgeladen werden. Bitte erneut versuchen."); return; }
      source = { kind: "upload", path: prepared.data.path };
    } else if (choice.kind === "file") {
      source = { kind: "file", fileId: choice.fileId };
    }
    const result = await saveCustomerLogo({ customerId: customer.id, source, background, color });
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    onSaved(`Logo von ${customer.company} gespeichert.`);
  }

  async function remove() {
    setBusy("remove");
    setError("");
    const result = await removeCustomerLogo(customer.id);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    onSaved(`Logo von ${customer.company} entfernt, es stehen wieder die Buchstaben.`);
  }

  return (
    <Modal title={`Logo von ${customer.company}`} onClose={onClose} className="am-logo-dialog">
      <div className="am-logo-body">
        <div className="am-logo-stage">
          <div className="am-logo-big">{sign("xl")}</div>
          <div className="am-logo-uses" aria-hidden="true">
            <div className="am-logo-use is-light">{sign("md")}<span>{customer.company}</span><b>{files.length}</b></div>
            <div className="am-logo-use is-dark">{sign("md")}<span>{customer.company}</span><b>{files.length}</b></div>
            <div className="am-logo-sizes">{sign("sm")}{sign("xs")}<span>klein in Listen</span></div>
          </div>
        </div>
        <p className="am-note"><Eye size={16} aria-hidden="true" /><span>{customer.company} sieht das Logo auch im eigenen Login: unten links, in der Begrüßung der Übersicht und am Handy oben rechts. Ohne Logo stehen dort die Buchstaben.</span></p>

        <div className="am-field">
          <span className="am-label">Aus den Dateien von {customer.company}</span>
          {candidates.length ? (
            <div className="am-thumbs">
              {candidates.map((file) => {
                const chosen = choice?.kind === "file" && choice.fileId === file.id;
                const url = previews[file.id];
                return (
                  <button key={file.id} type="button" className={`am-thumb${chosen ? " is-chosen" : ""}`} aria-pressed={chosen} disabled={!url || busy !== null} onClick={() => { if (url) { setError(""); setChoice({ kind: "file", fileId: file.id, url }); } }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a 60-second preview link, nothing to optimise */}
                    <span className="am-thumb-img">{url ? <img src={url} alt="" /> : <ImageIcon size={22} aria-hidden="true" />}</span>
                    <span className="am-thumb-name">{file.title}</span>
                    <span className="am-thumb-meta">{fileFormat(file.fileName)} · {formatBytes(file.sizeBytes)}</span>
                  </button>
                );
              })}
            </div>
          ) : <p className="am-note is-muted"><Info size={16} aria-hidden="true" /><span>Bei {customer.company} liegt noch kein Bild, das als Logo passt: SVG, PNG, JPG oder WebP bis 2 MB.</span></p>}
        </div>

        <label className={`am-zone${dragging ? " is-dragging" : ""}${choice?.kind === "upload" ? " is-chosen" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); pick(event.dataTransfer.files[0]); }}>
          <ImageUp size={24} aria-hidden="true" />
          <span>
            <strong>{choice?.kind === "upload" ? choice.file.name : "Anderes Bild hochladen"}</strong>
            <small>{choice?.kind === "upload" ? `${formatBytes(choice.file.size)} · wird beim Speichern hochgeladen` : "SVG, PNG, JPG oder WebP · am besten quadratisch · bis 2 MB"}</small>
          </span>
          <input type="file" accept={LOGO_ACCEPT} className="visually-hidden" disabled={busy !== null} onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }} />
        </label>

        <div className="am-field">
          <span className="am-label" id="am-logo-background">Hintergrund</span>
          <div className="am-bg-choices" role="group" aria-labelledby="am-logo-background">
            {logoBackgrounds.map((item) => (
              <button key={item} type="button" className={`am-bg-choice${background === item ? " is-chosen" : ""}`} aria-pressed={background === item} disabled={!preview || busy !== null} onClick={() => setBackground(item)}>
                <span className={`am-bg-dot is-${item}`} style={item === "brand" ? { background: color } : undefined} aria-hidden="true" />{logoBackgroundLabels[item]}
              </button>
            ))}
            {background === "brand" && preview && (
              <label className="am-color"><input type="color" value={color} disabled={busy !== null} onChange={(event) => setColor(cleanLogoColor(event.target.value) ?? DEFAULT_BRAND_COLOR)} /><span className="numeric">{color.toUpperCase()}</span><span className="visually-hidden">Markenfarbe wählen</span></label>
            )}
          </div>
          <span className="am-help">Für Logos mit durchsichtigem Hintergrund, etwa ein weißes Logo.</span>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="file-assign-actions am-logo-actions">
          {current && <button type="button" className="sheet-button" onClick={remove} disabled={busy !== null}>{busy === "remove" ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <X size={18} aria-hidden="true" />}Buchstaben verwenden</button>}
          <button type="button" className="sheet-button" onClick={onClose} disabled={busy !== null}>Abbrechen</button>
          <button type="button" className="sheet-button sheet-button-primary" onClick={save} disabled={busy !== null || !preview || unchanged}>{busy === "save" ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}Logo speichern</button>
        </div>
      </div>
    </Modal>
  );
}
