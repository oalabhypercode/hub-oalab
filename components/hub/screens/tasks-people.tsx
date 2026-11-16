"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Lock, UserCog } from "lucide-react";
import { MiniLoader } from "@/components/brand-loader";
import { hubHref } from "@/lib/hub-data";
import { projectFreelancerLogins } from "@/lib/hub-tasks/rules";
import type { BoardFreelancer, BoardPerson, BoardProject } from "@/lib/hub-tasks/types";
import { Switch } from "../controls";
import { useInfo } from "../info-box";
import { Avatar } from "./tasks-parts";

/**
 * „Beteiligte“ in the head of a project's board (user 16.11.2026, as in the design): the avatars of the team and the
 * project's freelancers. For admins they open a window with the team and every freelancer who looks after the
 * project's customer, one switch each: on, the freelancer sees the project and every task except „Nur Team“; off, it
 * is gone for them at once. There is no other switch: being on the project is the release.
 */
export function ProjectPeople({ project, people, freelancers, manage, canEdit, preview, onToggle }: {
  project: BoardProject;
  people: readonly BoardPerson[];
  /** Freelancers the board knows (admins: everybody who looks after a customer with a project). */
  freelancers: readonly BoardFreelancer[];
  /** Admins manage the participants; freelancers only see them. */
  manage: boolean;
  /** The session confirmed its code: only then the database takes the change. */
  canEdit: boolean;
  preview: boolean;
  onToggle: (freelancer: BoardFreelancer, on: boolean) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const info = useInfo("Beteiligte", {
    steps: [
      <><b>Nur Freelancer,</b> die den Kunden betreuen.</>,
      <><b>Eingetragen</b> sehen sie das Projekt und sein Board.</>,
      <><b>Ausgetragen</b> verschwindet es sofort bei ihnen.</>,
    ],
    ask: "Wie trage ich einen Freelancer in ein Projekt ein?",
  });

  useEffect(() => {
    if (!open) return;
    // The ⓘ card floats in the top layer but sits inside this box: a click in it keeps the window, Escape closes it first.
    const cardOpen = () => { try { return Boolean(box.current?.querySelector(":popover-open")); } catch { return false; } };
    const onPointer = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !cardOpen()) { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const team = people.filter((person) => person.kind === "team").sort((a, b) => a.name.localeCompare(b.name, "de"));
  const logins = new Set(projectFreelancerLogins(project, freelancers));
  const onProject = people.filter((person) => person.kind === "freelancer" && logins.has(person.id));
  const stack = <span className="kb-stack">{[...team, ...onProject].map((person) => <Avatar key={person.id} person={person} />)}</span>;
  const serving = freelancers.filter((freelancer) => freelancer.organizationIds.includes(project.organizationId) || project.freelancerIds.includes(freelancer.id));
  const byId = new Map(people.map((person) => [person.id, person]));

  const toggle = async (freelancer: BoardFreelancer, on: boolean) => {
    setBusy(freelancer.id);
    await onToggle(freelancer, on);
    setBusy(null);
  };

  if (!manage) return <div className="kb-stat">Beteiligte<strong>{stack}</strong></div>;
  return (
    <div className="kb-stat kb-people" ref={box}>
      Beteiligte
      <strong>
        <button ref={trigger} type="button" className="kb-people-btn" aria-expanded={open} aria-controls={panelId} aria-label="Beteiligte verwalten" data-tip="Beteiligte verwalten" data-tip-sub={project.freelancerIds.length ? undefined : "Freelancer ins Projekt holen"} onClick={() => setOpen((now) => !now)}>
          {stack}{!project.freelancerIds.length && <span className="kb-people-add" aria-hidden="true">+</span>}
        </button>
      </strong>
      <div id={panelId} className="sheet-pop is-end kb-people-pop" role="group" aria-label="Beteiligte" hidden={!open}>
        <div className="kb-people-head"><strong>Beteiligte</strong>{info.button}</div>
        {info.box}
        <div className="hub-list-group">oalab-Team</div>
        {team.map((person) => (
          <div key={person.id} className="kb-people-row">
            <Avatar person={person} size="m" />
            <span className="kb-people-text"><strong>{person.name}</strong></span>
            <span className="hub-option-meta">oalab</span>
          </div>
        ))}
        <div className="hub-list-group">Freelancer, die {project.company || "den Kunden"} betreuen</div>
        {serving.length ? serving.map((freelancer) => {
          const on = project.freelancerIds.includes(freelancer.id);
          const login = freelancer.loginIds.map((id) => byId.get(id)).find(Boolean);
          return (
            <div key={freelancer.id} className="kb-people-row">
              <Avatar person={login ?? { id: freelancer.id, name: freelancer.name, initials: freelancer.name.slice(0, 2).toUpperCase(), kind: "freelancer", company: freelancer.name }} size="m" />
              <span className="kb-people-text"><strong>{login?.name ?? freelancer.name}</strong><small>{freelancer.name} · <span className="numeric">{freelancer.number}</span></small></span>
              {busy === freelancer.id ? <MiniLoader size={16} /> : null}
              <Switch checked={on} disabled={!canEdit || busy !== null} label={`${freelancer.name} im Projekt`} onChange={(value) => void toggle(freelancer, value)} />
            </div>
          );
        }) : <div className="hub-list-empty">Für diesen Kunden ist kein Freelancer eingetragen.</div>}
        <p className="kb-pop-note">Freelancer sehen nur dieses Projekt und darin alle Aufgaben außer „Nur Team“.</p>
        {!canEdit && <p className="kb-pop-note"><Lock size={12} aria-hidden="true" /> Ändern geht nach „Mit Code bestätigen“.</p>}
        <p className="kb-pop-note">Wer einen Kunden betreut, legst du im <Link href={hubHref(preview, "users")} className="kb-pop-link"><UserCog size={13} aria-hidden="true" />User Management</Link> beim Kunden unter „Betreut von“ fest.</p>
      </div>
    </div>
  );
}
