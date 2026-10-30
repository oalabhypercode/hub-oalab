"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function Modal({ title, children, onClose, className = "", actions }: { title: string; children: React.ReactNode; onClose: () => void; className?: string; actions?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={ref} className={`hub-modal glass ${className}`} aria-labelledby="modal-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-heading"><h2 id="modal-title">{title}</h2>{actions}<button className="modal-close" aria-label="Schließen" onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
      {children}
    </dialog>
  );
}
