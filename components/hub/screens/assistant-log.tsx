"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, Bot, Sparkles, UserRound } from "lucide-react";
import { kindLabels, outcomeLabels, type ActionKind, type ActionOutcome } from "@/lib/hub-assistant/log-rules";
import type { AssistantLogRow, AssistantLogState } from "@/lib/hub-assistant/log";
import { formatFileDateTime } from "@/lib/hub-files/catalog";
import { matchesSearch, sortRows, type SortState, type SortValue } from "@/lib/table-tools";
import { HeaderActions } from "../app-shell";
import { GlassCard } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { alphabetical, FilterSelect, SortControl, SortHeader, TableSearch, type SortOption } from "../table-tools";

const ALL = "all";
const outcomeOrder: ActionOutcome[] = ["open", "executing", "done", "discarded", "expired", "failed"];
/** The status pills of the user management, by meaning: green saved, orange open, blue running, red failed. */
const outcomeStyle: Record<ActionOutcome, string> = { open: "status-feedback", executing: "status-invited", done: "status-active", discarded: "status-done", expired: "status-done", failed: "status-disabled" };

type SortKey = "time" | "actor" | "kind" | "target" | "outcome";
const sorts: Record<SortKey, SortOption<SortKey>> = {
  time: { id: "time", label: "Zeit", firstDir: "desc", dirLabels: { asc: "älteste zuerst", desc: "neueste zuerst" } },
  actor: { id: "actor", label: "Admin", dirLabels: alphabetical },
  kind: { id: "kind", label: "Art", dirLabels: alphabetical },
  target: { id: "target", label: "Kunde / Projekt", dirLabels: alphabetical },
  outcome: { id: "outcome", label: "Ergebnis" },
};

/** Admin page: every proposal of the assistant with who, what, where and how it ended. */
export function AssistantLogScreen({ state }: { state: AssistantLogState }) {
  const { rows } = state;
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [actor, setActor] = useState(ALL);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "time", dir: "desc" });
  const value: Record<SortKey, (row: AssistantLogRow) => SortValue> = {
    time: (row) => row.createdAt,
    actor: (row) => row.actor,
    kind: (row) => kindLabels[row.kind],
    target: (row) => row.target,
    outcome: (row) => outcomeOrder.indexOf(row.outcome),
  };
  const actors = [...new Set(rows.map((row) => row.actor))].sort((a, b) => a.localeCompare(b, "de"));
  const shown = sortRows(rows.filter((row) =>
    (outcome === ALL || row.outcome === outcome)
    && (kind === ALL || row.kind === kind)
    && (actor === ALL || row.actor === actor)
    && matchesSearch(query, [row.actor, kindLabels[row.kind], row.target, row.summary, outcomeLabels[row.outcome], row.errorCode]),
  ), value[sort.key], sort.dir, { tieBreak: (row) => row.createdAt });
  const filters = [outcome, kind, actor].filter((item) => item !== ALL).length;
  const saved = rows.filter((row) => row.outcome === "done").length;
  const title = <span className="title-icon"><Bot size={24} color="var(--accent-text)" aria-hidden="true" /></span>;

  if (state.error) {
    return <><LargeTitleHeader title="KI-Protokoll" icon={title} actions={<HeaderActions />} /><GlassCard className="section-first"><p className="t-headline">KI-Protokoll nicht verfügbar</p><p className="t-subheadline t-secondary">{state.error}</p></GlassCard></>;
  }

  return (
    <>
      <LargeTitleHeader title="KI-Protokoll" icon={title} actions={<HeaderActions />} />
      <div className="calendar-toolbar users-toolbar">
        <p className="users-summary">{rows.length === 1 ? "1 Vorschlag" : `${rows.length} Vorschläge`} des Assistenten · {saved} gespeichert</p>
      </div>
      <TableSearch value={query} onChange={setQuery} placeholder="Admin, Kunde, Projekt, Inhalt …" label="KI-Protokoll durchsuchen" activeFilters={filters}>
        <FilterSelect icon={Activity} name="Nach Ergebnis filtern" value={outcome} onChange={setOutcome} options={[{ value: ALL, label: "Alle Ergebnisse" }, ...outcomeOrder.map((item) => ({ value: item, label: outcomeLabels[item] }))]} />
        <FilterSelect icon={Sparkles} name="Nach Art filtern" value={kind} onChange={setKind} options={[{ value: ALL, label: "Alle Arten" }, ...(Object.keys(kindLabels) as ActionKind[]).map((item) => ({ value: item, label: kindLabels[item] }))]} />
        <FilterSelect icon={UserRound} name="Nach Admin filtern" value={actor} onChange={setActor} options={[{ value: ALL, label: "Alle Admins" }, ...actors.map((item) => ({ value: item, label: item }))]} />
        <SortControl options={Object.values(sorts)} sort={sort} onChange={setSort} />
      </TableSearch>
      {shown.length ? (
        <div className="table-blobs">
          <table className="data-table ai-log-table">
            <caption className="visually-hidden">Vorschläge des Assistenten mit Zeit, Admin, Art, Kunde oder Projekt, Inhalt und Ergebnis</caption>
            <thead>
              <tr>
                <SortHeader option={sorts.time} sort={sort} onChange={setSort} />
                <SortHeader option={sorts.actor} sort={sort} onChange={setSort} />
                <SortHeader option={sorts.kind} sort={sort} onChange={setSort} />
                <SortHeader option={sorts.target} sort={sort} onChange={setSort} />
                <th scope="col">Inhalt</th>
                <SortHeader option={sorts.outcome} sort={sort} onChange={setSort} />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className={`data-row${row.outcome === "discarded" || row.outcome === "expired" ? " is-muted" : ""}`}>
                  <td className="cell-login">{formatFileDateTime(row.createdAt)}</td>
                  <td>{row.actor}</td>
                  <td className="cell-role">{kindLabels[row.kind]}</td>
                  <td>{row.projectId && row.outcome === "done" ? <Link className="table-link" href={`/dashboard/projects?project=${row.projectId}`}>{row.target}</Link> : row.target || <span className="t-secondary">–</span>}</td>
                  <td className="cell-summary">{row.summary}{row.errorCode && <small className="t-secondary"> · Fehler {row.errorCode}</small>}</td>
                  <td className="cell-status"><span className={`project-status ${outcomeStyle[row.outcome]}`}><i aria-hidden="true" />{outcomeLabels[row.outcome]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <GlassCard><p className="t-subheadline t-secondary">{rows.length ? "Keine Vorschläge für diese Suche oder Filter." : "Der Assistent hat noch nichts vorgeschlagen."}</p></GlassCard>}
    </>
  );
}
