"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

/**
 * A modal dialog. Windows may open over windows (the logo from "Kunde bearbeiten"): each has its own title id, and
 * Escape closes only the top one, because "cancel" does not bubble in the browser and must not in React either.
 * The field to start typing in carries `data-autofocus`: React's `autoFocus` runs before the window is open, and the
 * browser would put the cursor on „Schließen“ instead. A field that only appears later in an open window keeps
 * `autoFocus` as well.
 */
export function Modal({ title, children, onClose, className = "", actions }: { title: string; children: React.ReactNode; onClose: () => void; className?: string; actions?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={ref} className={`hub-modal glass ${className}`} aria-labelledby={titleId} onCancel={(event) => { event.stopPropagation(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-heading"><h2 id={titleId}>{title}</h2>{actions}<button className="modal-close" aria-label="Schließen" onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
      {children}
    </dialog>
  );
}
