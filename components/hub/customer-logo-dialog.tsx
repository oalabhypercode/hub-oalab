"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ImageIcon, ImageUp, Trash2 } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { createClient } from "@/lib/supabase/client";
import { formatBytes } from "@/lib/hub-files/catalog";
import { listLogoCandidates, prepareLogoUpload, removeCustomerLogo, saveCustomerLogo } from "@/lib/hub-logos/actions";
import { detectLogoGround } from "@/lib/hub-logos/ground";
import { checkLogoFile, cleanLogoColor, DEFAULT_BRAND_COLOR, LOGO_ACCEPT, LOGO_BUCKET, logoBackgrounds, type CustomerLogo, type LogoBackground, type LogoType } from "@/lib/hub-logos/rules";
import { useInfo } from "./info-box";
import { LogoMark, companyInitials } from "./logo-mark";
import { Modal } from "./modal";

/** What the window needs of a customer; the asset management and the user management both have it. */
export type LogoCustomer = { id: string; company: string; customerNumber: string; logo?: CustomerLogo | null };

type Candidate = { id: string; title: string; url: string | null };
type Choice = { kind: "file"; fileId: string; url: string; name: string } | { kind: "upload"; file: File; type: LogoType; url: string };
type Source = Parameters<typeof saveCustomerLogo>[0]["source"];

const groundLabels: Record<LogoBackground, string> = { light: "Hell", dark: "Dunkel", brand: "Farbe" };

/**
 * The logo of one customer (admins, real data): the same window from the asset management („Logo hochladen“) and from
 * the user management („Kunde bearbeiten“), so both ways save the same logo. Its preview is the company row the
 * customer sees in the overview. The way in is one large zone (drop, click to choose, or paste with Ctrl+V); images
 * the customer already has stand below as a row. The ground appears once there is a logo, chosen to fit it.
 */
export function CustomerLogoDialog({ customer, onClose, onSaved }: { customer: LogoCustomer; onClose: () => void; onSaved: (message: string) => void }) {
  const current = customer.logo ?? null;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [background, setBackground] = useState<LogoBackground>(current?.background ?? "light");
  const [color, setColor] = useState(current?.color ?? DEFAULT_BRAND_COLOR);
  const [fitted, setFitted] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");
  const latest = useRef("");
  const info = useInfo("Kundenlogo", {
    steps: [
      <><b>SVG, PNG, JPG oder WebP</b> bis 2 MB, auch per Strg+V.</>,
      <><b>Den Hintergrund</b> wählt der Hub vor, ein Klick ändert ihn.</>,
      <><b>Gespeichert</b> ersetzt es die Buchstaben, auch beim Kunden.</>,
    ],
    ask: "Wie funktioniert das Kundenlogo?",
  });

  // The customer's images, with preview links for a minute.
  useEffect(() => {
    let live = true;
    listLogoCandidates(customer.id)
      .then((result) => { if (live && result.ok) setCandidates(result.data); })
      .catch(() => { /* the zone alone still works */ });
    return () => { live = false; };
  }, [customer.id]);

  // A picked image is shown from the browser until it is replaced or the window closes; it uploads only on saving.
  const pickedUrl = choice?.kind === "upload" ? choice.url : null;
  useEffect(() => () => { if (pickedUrl) URL.revokeObjectURL(pickedUrl); }, [pickedUrl]);

  // The ground that fits the new image (a white logo gets the dark one); the last image picked wins.
  async function fit(url: string) {
    latest.current = url;
    const ground = await detectLogoGround(url);
    if (ground && latest.current === url) { setBackground(ground); setFitted(true); }
  }

  function pick(file: File | undefined) {
    if (!file || busy) return;
    const check = checkLogoFile(file.name, file.size, file.type);
    if (!check.ok) { setError(check.error); return; }
    setError("");
    const url = URL.createObjectURL(file);
    setChoice({ kind: "upload", file, type: check.type, url });
    void fit(url);
  }

  function chooseFile(candidate: Candidate) {
    if (!candidate.url) return;
    setError("");
    setChoice({ kind: "file", fileId: candidate.id, url: candidate.url, name: candidate.title });
    void fit(candidate.url);
  }

  // Ctrl+V with an image anywhere while the window is open (a logo copied from a website, say).
  const pickRef = useRef(pick);
  useLayoutEffect(() => { pickRef.current = pick; });
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      pickRef.current(file);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, []);

  const shownUrl = choice?.url ?? current?.url ?? null;
  const preview: CustomerLogo | null = shownUrl ? { url: shownUrl, background, color: background === "brand" ? color : null } : null;
  const changed = Boolean(choice) || Boolean(current && (background !== current.background || (background === "brand" && color !== current.color)));

  async function save() {
    setBusy("save");
    setError("");
    let source: Source = { kind: "keep" };
    if (choice?.kind === "upload") {
      const prepared = await prepareLogoUpload(customer.id, choice.file.name, choice.file.size, choice.type);
      if (!prepared.ok) { setBusy(null); setError(prepared.error); return; }
      const uploaded = await createClient().storage.from(LOGO_BUCKET).uploadToSignedUrl(prepared.data.path, prepared.data.token, choice.file, { contentType: choice.type });
      if (uploaded.error) { setBusy(null); setError("Das Bild konnte nicht hochgeladen werden. Bitte erneut versuchen."); return; }
      source = { kind: "upload", path: prepared.data.path };
    } else if (choice?.kind === "file") {
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

  const fileInput = <input type="file" accept={LOGO_ACCEPT} className="visually-hidden" disabled={busy !== null} onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }} />;

  return (
    <Modal title={`Logo von ${customer.company}`} onClose={onClose} className="logo-window" actions={info.button}>
      <div className="logo-window-body">
        {info.box}
        <figure className="logo-window-preview">
          <div className="logo-window-row">
            <LogoMark logo={preview} initials={companyInitials(customer.company)} className="avatar welcome-company-logo" plate />
            <span className="logo-window-name"><strong>{customer.company}</strong><small>Kundennummer {customer.customerNumber}</small></span>
          </div>
          <figcaption>So sieht {customer.company} das Logo: in der Übersicht, unten links und am Handy.</figcaption>
        </figure>

        {choice ? (
          <div className="logo-window-chosen">
            <span className="logo-window-check"><Check size={16} aria-hidden="true" /></span>
            <span className="logo-window-file">
              <strong>{choice.kind === "upload" ? choice.file.name || "Eingefügtes Bild" : choice.name}</strong>
              <small>{choice.kind === "upload" ? `${formatBytes(choice.file.size)} · wird beim Speichern hochgeladen` : `aus den Dateien von ${customer.company}`}</small>
            </span>
            <label className="sheet-action logo-window-again"><ImageUp size={15} aria-hidden="true" />Anderes Bild{fileInput}</label>
          </div>
        ) : (
          <label className={`logo-window-drop${current ? " is-compact" : ""}${dragging ? " is-dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); pick(event.dataTransfer.files[0]); }}>
            <ImageUp size={current ? 22 : 30} aria-hidden="true" />
            {current ? <strong>Neues Logo hierher ziehen oder <u>auswählen</u></strong> : <><strong>Logo hierher ziehen</strong><span>oder <u>Datei auswählen</u></span></>}
            <small>SVG, PNG, JPG oder WebP · bis 2 MB{current ? "" : " · auch mit Strg+V"}</small>
            {fileInput}
          </label>
        )}

        {candidates.length > 0 && (
          <div className="logo-window-files">
            <span className="logo-window-label">Oder ein Bild aus den Dateien von {customer.company}</span>
            <div className="logo-window-thumbs">
              {candidates.map((candidate) => {
                const chosen = choice?.kind === "file" && choice.fileId === candidate.id;
                return (
                  <button key={candidate.id} type="button" className={`logo-window-thumb${chosen ? " is-chosen" : ""}`} aria-pressed={chosen} disabled={!candidate.url || busy !== null} onClick={() => chooseFile(candidate)}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a one-minute preview link, nothing to optimise */}
                    <span className="logo-window-thumb-img">{candidate.url ? <img src={candidate.url} alt="" /> : <ImageIcon size={20} aria-hidden="true" />}</span>
                    <span className="logo-window-thumb-name">{candidate.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {preview && (
          <div className="logo-window-ground">
            <span className="logo-window-label" id="logo-window-ground">Hintergrund</span>
            <div className="logo-window-grounds" role="group" aria-labelledby="logo-window-ground">
              {logoBackgrounds.map((item) => (
                <button key={item} type="button" aria-pressed={background === item} disabled={busy !== null} onClick={() => { setBackground(item); setFitted(false); }}>
                  <span className={`logo-window-dot is-${item}`} style={item === "brand" ? { background: color } : undefined} aria-hidden="true" />{groundLabels[item]}
                </button>
              ))}
              {background === "brand" && (
                <label className="logo-window-color"><input type="color" value={color} disabled={busy !== null} onChange={(event) => { setColor(cleanLogoColor(event.target.value) ?? DEFAULT_BRAND_COLOR); setFitted(false); }} /><span className="numeric">{color.toUpperCase()}</span><span className="visually-hidden">Markenfarbe wählen</span></label>
              )}
            </div>
            <span className="logo-window-hint">{fitted ? "Passend zum Logo vorgewählt. Ein Klick ändert ihn." : "Für Logos mit durchsichtigem Hintergrund, etwa ein weißes Logo."}</span>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        {current && !choice && (
          <button type="button" className="logo-window-remove" onClick={remove} disabled={busy !== null}>{busy === "remove" ? <MiniLoader size={16} /> : <Trash2 size={16} aria-hidden="true" />}Logo entfernen</button>
        )}
        <div className="logo-window-actions">
          <button type="button" className="sheet-button" onClick={onClose} disabled={busy !== null}>Abbrechen</button>
          <button type="button" className="sheet-button sheet-button-primary" onClick={save} disabled={busy !== null || !changed}>{busy === "save" ? <MiniLoader size={18} /> : <Check size={18} aria-hidden="true" />}Speichern</button>
        </div>
      </div>
    </Modal>
  );
}
