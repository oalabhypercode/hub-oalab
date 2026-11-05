"use client";

import { useId, useState } from "react";
import { Info, X } from "lucide-react";

/**
 * The ⓘ next to a feature and the box that explains it, right where the feature is used. Rule of the user since
 * 5.11.2026: every feature beyond plain viewing gets one. The caller places both: the button next to the heading or
 * label, the box below it (`box` is null while closed).
 *
 *   const info = useInfo("So funktioniert der Vertragsgenerator", <ul>…</ul>);
 *   <h3>Vertragsvorlagen{info.button}</h3>
 *   {info.box}
 */
export function useInfo(title: string, content: React.ReactNode) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = (
    <button type="button" className="info-button" aria-expanded={open} aria-controls={id} aria-label={`${open ? "Erklärung schließen" : "Erklärung"}: ${title}`} title={title} onClick={() => setOpen((now) => !now)}>
      <Info size={15} strokeWidth={2.4} aria-hidden="true" />
    </button>
  );
  const box = open ? (
    <div id={id} className="info-box" role="note" aria-label={title}>
      <div className="info-box-head">
        <strong>{title}</strong>
        <button type="button" className="info-box-close" aria-label="Erklärung schließen" onClick={() => setOpen(false)}><X size={14} aria-hidden="true" /></button>
      </div>
      <div className="info-box-body">{content}</div>
    </div>
  ) : null;
  return { button, box, open };
}
