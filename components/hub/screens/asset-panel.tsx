"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * A panel over the files of the Asset Management (upload, a file's details). It is no dialog: the customers and the
 * list stay usable next to it, so a click on another file only changes what it shows. On phones it fills the screen.
 * Focus moves into it when it opens and back to where it came from when it closes, unless it has moved on outside of
 * it, such as to a tick in the list; Escape closes it.
 */
export function AssetPanel({ label, icon, title, subtitle, actions, onClose, closeDisabled = false, footer, children }: {
  label: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Buttons in the head before the close button, such as "Bearbeiten". */
  actions?: React.ReactNode;
  onClose: () => void;
  /** While an upload runs, the panel stays open until it is done. */
  closeDisabled?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const panel = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.focus({ preventScroll: true });
    return () => {
      // Still in the panel, or fallen back to the page with it, the focus returns; moved on elsewhere, it stays there.
      const active = document.activeElement;
      const left = active !== null && active !== document.body && !panel?.contains(active);
      if (!left && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <aside ref={ref} className="am-panel" aria-label={label} tabIndex={-1} onKeyDown={(event) => {
      if (event.key !== "Escape" || closeDisabled) return;
      event.stopPropagation();
      onClose();
    }}>
      <header className="am-panel-head">
        {icon}
        <div className="am-panel-title"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
        {actions}
        <button type="button" className="chat-icon-button is-muted" onClick={onClose} disabled={closeDisabled} aria-label="Schließen" title="Schließen"><X size={20} aria-hidden="true" /></button>
      </header>
      <div className="am-panel-body">{children}</div>
      {footer && <footer className="am-panel-foot">{footer}</footer>}
    </aside>
  );
}
