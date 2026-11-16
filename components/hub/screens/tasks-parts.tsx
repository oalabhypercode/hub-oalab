"use client";

import type { CSSProperties } from "react";
import { PRIORITY_NAMES } from "@/lib/hub-tasks/rules";
import type { BoardPerson, TaskPriority, TaskStatus } from "@/lib/hub-tasks/types";

/** The column symbols in Studio's manner: dashed (backlog), ring (open), half (in progress), three quarters (review), tick. */
const tones: Record<TaskStatus, string> = { backlog: "off", todo: "off", progress: "ok", review: "info", done: "off" };

export function TaskGlyph({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const ring = <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" />;
  return (
    <svg className={`status-glyph tone-${tones[status]}`} viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
      {status === "backlog" && <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.9" />}
      {status === "todo" && ring}
      {status === "progress" && <>{ring}<path d="M7 3.4a3.6 3.6 0 0 1 0 7.2z" fill="currentColor" /></>}
      {status === "review" && <>{ring}<path d="M7 3.4A3.6 3.6 0 1 1 3.4 7H7z" fill="currentColor" /></>}
      {status === "done" && <><circle cx="7" cy="7" r="6.3" fill="currentColor" /><path d="m4.5 7.2 1.7 1.7 3.3-3.5" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></>}
    </svg>
  );
}

/** Three bars like Studio; "Dringend" as a red exclamation mark. Nothing for "Keine Priorität". */
export function PriorityIcon({ priority, size = 14 }: { priority: TaskPriority; size?: number }) {
  if (priority === "none") return null;
  if (priority === "urgent") {
    return (
      <svg className="kb-prio-svg" viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--tone-bad-bar)" />
        <path d="M7 4v3.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="7" cy="10" r="1" fill="#fff" />
      </svg>
    );
  }
  const level = { low: 1, medium: 2, high: 3 }[priority];
  const bars: [number, number][] = [[1.5, 4], [5.7, 7], [9.9, 10]];
  return (
    <svg className={`kb-prio-svg kb-prio-${priority}`} viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
      {bars.map(([x, height], index) => <rect key={x} x={x} y={12 - height} width="2.6" height={height} rx="1" fill="currentColor" opacity={index < level ? 1 : 0.25} />)}
    </svg>
  );
}

export const priorityLabel = (priority: TaskPriority) => PRIORITY_NAMES[priority];

/** A person's initials in a circle, with the name as the hover hint. */
export function Avatar({ person, size = "s" }: { person: BoardPerson | undefined; size?: "s" | "m" }) {
  const name = person?.name ?? "Unbekannt";
  return <span className={`kb-av${size === "m" ? " is-m" : ""}`} data-tip={name} data-tip-sub={person?.kind === "team" ? "oalab-Team" : undefined}>{person?.initials ?? "?"}</span>;
}

export function AvatarStack({ ids, people }: { ids: readonly string[]; people: ReadonlyMap<string, BoardPerson> }) {
  if (!ids.length) return null;
  return <span className="kb-stack">{ids.map((id) => <Avatar key={id} person={people.get(id)} />)}</span>;
}

// Known labels keep the hub's category colours; others get one of the same palette by their name.
const labelColors: Record<string, string> = { design: "#5856D6", text: "#0E7C86", technik: "#007AFF", konzept: "#8E8E93", recht: "#2E9B4B", kunde: "#FF9500", seo: "#AF52DE" };
const palette = ["#5856D6", "#0E7C86", "#007AFF", "#AF52DE", "#2E9B4B", "#B4400F", "#8E8E93"];
export function labelColor(label: string) {
  const key = label.trim().toLowerCase();
  if (labelColors[key]) return labelColors[key];
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

export function LabelPill({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="kb-label" style={{ "--c": labelColor(label) } as CSSProperties}>
      {label}
      {onRemove && <button type="button" className="kb-label-x" onClick={onRemove} aria-label={`Label ${label} entfernen`}>×</button>}
    </span>
  );
}

/** A customer's mark: its initials on a colour from its name (the logos come with the freelancer step). */
export function CompanyMark({ company, size = "l" }: { company: string; size?: "s" | "m" | "l" }) {
  const words = company.replace(/[^\p{L}\p{N}\s&]/gu, " ").split(/\s+/).filter((word) => word && word !== "&");
  const letters = (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  return <span className={`kb-mark${size === "s" ? " is-s" : size === "m" ? " is-m" : ""}`} style={{ "--c": labelColor(company) } as CSSProperties} aria-hidden="true">{letters}</span>;
}
