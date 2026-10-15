"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, Circle, Clock3, FileText, FolderOpen, Layers3, MessageSquare, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { hubHref, previewFiles, previewProjects, type HubSection, type Project, type HubDemoData } from "@/lib/hub-data";
import { ProjectArtwork } from "./artwork";
import { Modal } from "./modal";

function Status({ value }: { value: Project["status"] }) {
  return <span className={`project-status status-${value === "Dein Feedback" ? "feedback" : value === "Abgeschlossen" ? "done" : "active"}`}><i />{value}</span>;
}

function ProjectCard({ project, preview }: { project: Project; preview: boolean }) {
  return (
    <Link href={`${hubHref(preview, "projects")}?project=${project.id}`} className="project-card">
      <div className="project-image-wrap"><ProjectArtwork variant={project.artwork} brand={project.brand} /><span className="project-open"><ArrowUpRight size={20} /></span></div>
      <div className="project-card-meta"><span>{project.company ? `${project.company} / ${project.category}` : project.category}</span><Status value={project.status} /></div>
      <h3>{project.name}</h3>
      <div className="project-card-bottom"><span>Projektfortschritt</span><strong>{project.progress}%</strong></div>
      <div className="progress-track"><span style={{ width: `${project.progress}%` }} /></div>
    </Link>
  );
}

function EmptyState({ section }: { section: HubSection }) {
  const content = {
    overview: ["Dein nächstes Kapitel beginnt hier.", "Sobald dein Projektteam deinen Workspace eingerichtet hat, findest du hier Projekte, nächste Schritte und Neuigkeiten."],
    projects: ["Raum für große Ideen.", "Hier erscheinen deine Projekte, sobald sie deinem Workspace zugeordnet sind."],
    files: ["Alles am richtigen Ort.", "Briefings, Entwürfe und finale Ergebnisse finden hier bald ihren Platz."],
    messages: ["Lass uns im Gespräch bleiben.", "Hier laufen künftig die Rückfragen und Updates zu deinen Projekten zusammen."],
    settings: ["Dein Workspace.", "Die Einrichtung deines Workspaces folgt im nächsten Schritt."],
  }[section];
  return <div className="empty-workspace"><div className="empty-orbit" aria-hidden="true">↗</div><span className="eyebrow">GEMEINSAM GEHT MEHR.</span><h2>{content[0]}</h2><p>{content[1]}</p><Link className="button-secondary" href="/preview">Designvorschau entdecken <ArrowUpRight size={17} /></Link></div>;
}

export function HubView({ section = "overview", preview = false, email = "", demoData }: { section?: HubSection; preview?: boolean; email?: string; demoData?: HubDemoData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState("Alle Projekte");
  const [companyFilter, setCompanyFilter] = useState("Alle Kunden");
  const [completed, setCompleted] = useState<string[]>([]);
  const [file, setFile] = useState<(typeof previewFiles)[number] | null>(null);
  const projects = preview ? previewProjects : demoData?.projects || [];
  const files = preview ? previewFiles : demoData?.files || [];
  const populated = preview || Boolean(demoData);
  const featured = projects[0];
  const feedbackProject = projects[1] || featured;
  const selectedProject = projects.find((project) => project.id === searchParams.get("project"));
  const shownProjects = projects.filter((project) => (filter === "Alle Projekte" || (filter === "Aktiv" ? project.status !== "Abgeschlossen" : project.status === "Abgeschlossen")) && (companyFilter === "Alle Kunden" || project.company === companyFilter));
  const count = (value: number) => String(value).padStart(2, "0");
  const projectHref = (id: string) => `${hubHref(preview, "projects")}?project=${id}`;

  function toggleTask(id: string) {
    setCompleted((value) => value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  }

  return (
    <>
      {section === "overview" ? (
        <>
          <section className="page-intro"><div><span className="eyebrow"><span className="orange-dot" />DEIN WORKSPACE. DEIN FORTSCHRITT.</span><h1>Alles im Blick.<br /><span>Alles im Flow.</span></h1></div><div className="intro-aside"><span className="intro-greeting">{populated ? `Schön, dass du da bist, ${demoData?.name.split(" ")[0] || "Jana"}.` : "Schön, dass du da bist."} <span aria-hidden="true">↗</span></span><p>Gute Zusammenarbeit braucht einen guten Ort.<br />Hier kommt alles zusammen.</p></div></section>
          <section className="stats-strip" aria-label="Workspace auf einen Blick">{[{ value: count(projects.filter((project) => project.status !== "Abgeschlossen").length), label: "Aktive Projekte", detail: "Ideen werden Wirklichkeit", icon: FolderOpen }, { value: populated ? count(2 - completed.length) : "00", label: "Deine nächsten Schritte", detail: "Gemeinsam geht es weiter", icon: Circle }, { value: count(files.length), label: "Geteilte Dateien", detail: "Alles an einem Ort", icon: Layers3 }].map(({ value, label, detail, icon: Icon }) => <div className="stat" key={label}><span className="stat-number">{value}<span className="stat-symbol"><Icon size={20} strokeWidth={1.4} /></span></span><div><strong>{label}</strong><span>{detail}</span></div></div>)}</section>
          {populated ? <>
            <div className="overview-grid"><section className="spotlight-card"><div className="spotlight-top"><span className="eyebrow">IM FOKUS / WEBSITE & DIGITAL</span><span className="spotlight-tag"><i />In Umsetzung</span></div><div className="spotlight-body"><div className="spotlight-copy"><h2>Aus einer Idee<br />wird dein Auftritt.</h2><p>Deine neue Website nimmt Form an.<br />Der nächste Meilenstein ist in Sicht.</p><Link className="spotlight-link" href={projectHref(featured.id)}>Zum Projekt <span><ArrowUpRight size={21} /></span></Link></div><div className="spotlight-art"><ProjectArtwork brand={featured.brand} /></div></div><div className="spotlight-footer"><div className="avatar-stack"><span>LS</span><span>MK</span><span>JS</span></div><span>Dein Team ist dran.</span><div className="spotlight-progress"><span>{featured.progress}%</span><div><i style={{ width: `${featured.progress}%` }} /></div></div></div></section>
            <section className="next-steps panel"><div className="section-heading"><h2>Du bist am Zug<span className="count-label">{count(2 - completed.length)}</span></h2><ArrowDown size={18} /></div><p className="section-description">Kleine Schritte. Großer Unterschied.</p><div className="task-list">{[{ id: "feedback", title: "Designrichtung ansehen", category: "Brand Identity", date: "Bis 16. Oktober", href: projectHref(feedbackProject.id) }, { id: "content", title: "Website-Inhalte abstimmen", category: "Website & Digital", date: "Bis 19. Oktober", href: projectHref(featured.id) }].map((task) => <div className={`task-item${completed.includes(task.id) ? " completed" : ""}`} key={task.id}><button className="task-check" onClick={() => toggleTask(task.id)} aria-label={`${task.title} ${completed.includes(task.id) ? "wieder öffnen" : "in der Vorschau abhaken"}`} aria-pressed={completed.includes(task.id)}>{completed.includes(task.id) && <Check size={13} />}</button><div><Link href={task.href}>{task.title}<ArrowUpRight size={13} /></Link><span>{task.category}</span><span className="task-date"><Clock3 size={12} />{task.date}</span></div></div>)}</div><div className="next-steps-footer"><span className="small-spark">✳</span><p>Dein Feedback macht<br />den Unterschied.</p></div></section></div>
            <section className="projects-section"><div className="section-heading"><h2>Deine Projekte<span className="count-label">{count(projects.length)}</span></h2><Link className="text-action" href={hubHref(preview, "projects")}>Alle Projekte <ArrowUpRight size={16} /></Link></div><div className="project-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} preview={preview} />)}</div></section>
            <section className="activity-section"><div className="section-heading"><h2>Zuletzt passiert</h2><span className="tiny-label">IMMER AUF DEM LAUFENDEN.</span></div><div className="activity-row"><span className="avatar activity-avatar">LS</span><div><p><strong>Lena</strong> hat eine neue Designrichtung geteilt.</p><span>Brand Identity · 14. Oktober 2026</span></div><Link className="text-action" href={hubHref(preview, "files")}>Ansehen <ArrowUpRight size={16} /></Link></div><div className="activity-row"><span className="activity-icon"><CheckCheck size={19} /></span><div><p>Ein Meilenstein ist geschafft: <strong>Konzept & Struktur</strong></p><span>Website & Digital · 13. Oktober 2026</span></div><Link className="text-action" href={projectHref(featured.id)}>Zum Projekt <ArrowUpRight size={16} /></Link></div></section>
          </> : <EmptyState section={section} />}
        </>
      ) : section === "projects" ? (
        <>
          <section className="page-intro secondary-intro"><div><span className="eyebrow">VON DER IDEE BIS ZUM ERGEBNIS.</span><h1>Deine Projekte<span className="heading-period">.</span></h1></div><p className="intro-note">Fortschritt sehen. Gedanken teilen.<br />Gemeinsam das Nächste bewegen.</p></section>
          {populated ? <><div className="filter-bar"><div className="filter-tabs" aria-label="Projekte filtern">{["Alle Projekte", "Aktiv", "Abgeschlossen"].map((item) => <button className={filter === item ? "selected" : ""} key={item} onClick={() => setFilter(item)} aria-pressed={filter === item}>{item}<span>{item === "Alle Projekte" ? projects.length : projects.filter((project) => item === "Aktiv" ? project.status !== "Abgeschlossen" : project.status === "Abgeschlossen").length}</span></button>)}</div>{demoData?.role === "oalab_admin" ? <label className="customer-filter"><span>Kunde</span><select aria-label="Kunden filtern" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}><option>Alle Kunden</option>{Array.from(new Set(projects.map((project) => project.company))).map((company) => <option key={company}>{company}</option>)}</select></label> : <span className="filter-hint"><SlidersHorizontal size={15} />Nach Projektstatus</span>}</div><div className="project-grid projects-full">{shownProjects.map((project) => <ProjectCard key={project.id} project={project} preview={preview} />)}</div></> : <EmptyState section={section} />}
        </>
      ) : section === "files" ? (
        <>
          <section className="page-intro secondary-intro"><div><span className="eyebrow">WENIGER SUCHEN. MEHR FINDEN.</span><h1>Alles an einem Ort<span className="heading-period">.</span></h1></div><p className="intro-note">Von der ersten Idee bis zur finalen Datei.<br />Hier ist Platz für eure Ergebnisse.</p></section>
          {populated ? <div className="file-list panel"><div className="file-table-heading"><span>Dateiname</span><span>Projekt</span><span>Geändert</span><span /></div>{files.map((item) => <button className="file-row" key={item.name} onClick={() => setFile(item)}><span className="file-name"><span className={`file-icon file-icon-${item.type.toLowerCase()}`}><FileText size={22} /><small>{item.type}</small></span><span><strong>{item.name}</strong><small>{item.size}</small></span></span><span className="file-project">{item.project}</span><span className="file-date">{item.date}</span><ArrowUpRight size={18} /></button>)}</div> : <EmptyState section={section} />}
        </>
      ) : section === "messages" ? (
        <>
          <section className="page-intro secondary-intro"><div><span className="eyebrow">GUTE IDEEN BEGINNEN IM DIALOG.</span><h1>Im Gespräch bleiben<span className="heading-period">.</span></h1></div></section>
          {populated ? <div className="message-layout panel"><aside className="message-projects"><span className="tiny-label">DEINE GESPRÄCHE</span><div className="message-project selected"><span className="avatar">LS</span><div><strong>Brand Identity</strong><span>Lena · Neue Designrichtung</span></div><i /></div></aside><section className="message-thread"><div className="thread-heading"><span className="avatar">LS</span><div><strong>Lena Schneider</strong><span>Dein Designteam · Brand Identity</span></div></div><span className="thread-date">14. Oktober 2026 · Beispielunterhaltung</span><div className="message-bubble"><p>Hallo {demoData?.name.split(" ")[0] || "Jana"}! Die erste Designrichtung für {demoData?.role === "oalab_admin" ? "einen unserer Testkunden" : demoData?.company || "Nordlicht"} ist fertig. Wir haben die Klarheit eurer Marke mit einem frischen, eigenständigen Look verbunden.</p><p>Schau dir die Brand Direction in Ruhe an. Wir freuen uns auf deine Gedanken! ✳</p><Link className="message-attachment" href={hubHref(preview, "files")}><FileText size={22} /><span>Brand Direction – V01.pdf<small>PDF · 4,2 MB</small></span><ArrowUpRight size={17} /></Link></div><div className="message-preview-note"><MessageSquare size={17} /><span>{preview ? "Dies ist eine Designvorschau. Echte Gespräche folgen mit der Projektanbindung." : "Demo-Unterhaltung für Frontend-Tests. Live-Nachrichten folgen mit der Datenbankanbindung."}</span></div></section></div> : <EmptyState section={section} />}
        </>
      ) : (
        <><section className="page-intro secondary-intro"><div><span className="eyebrow">DEIN PLATZ FÜR ZUSAMMENARBEIT.</span><h1>Dein Workspace<span className="heading-period">.</span></h1></div></section><div className="settings-grid"><section className="panel settings-panel"><span className="eyebrow">01 / DEIN KONTO</span><h2>Schön, dass du dabei bist.</h2><label htmlFor="account-email">E-Mail-Adresse</label><input id="account-email" className="account-input" readOnly value={preview ? "jana@example.com" : email} /><p className="muted">{preview ? "Fiktives Beispielkonto für die Designvorschau." : "Die E-Mail-Adresse deines angemeldeten Kontos."}</p><Link className="text-action" href="/auth/forgot-password">Passwort zurücksetzen <ArrowUpRight size={16} /></Link></section><section className="panel settings-panel"><span className="eyebrow">02 / DEIN ZUGANG</span><ShieldCheck size={34} strokeWidth={1.3} className="settings-shield" /><h2>{preview ? "Du siehst die Vorschau." : "Dein Zugang ist geschützt."}</h2><p className="muted">{preview ? "Die Vorschau verwendet ausschließlich Beispieldaten. Melde dich an, um deinen persönlichen Workspace zu öffnen." : "Dein Workspace ist nur nach Anmeldung erreichbar. Projektzuordnungen und Berechtigungen ergänzen wir im nächsten Schritt."}</p>{preview && <Link className="text-action" href="/auth/login">Zum Login <ArrowUpRight size={16} /></Link>}</section></div></>
      )}
      {selectedProject && <Modal title={selectedProject.category} onClose={() => router.replace(hubHref(preview, "projects"), { scroll: false })}><div className="project-modal-art"><ProjectArtwork variant={selectedProject.artwork} brand={selectedProject.brand} /></div><div className="project-modal-status"><Status value={selectedProject.status} /><span>Ziel: {selectedProject.date}</span></div><h3 className="project-modal-title">{selectedProject.name}</h3><p className="modal-description">{selectedProject.description}</p><div className="project-card-bottom"><span>Projektfortschritt</span><strong>{selectedProject.progress}%</strong></div><div className="progress-track"><span style={{ width: `${selectedProject.progress}%` }} /></div><p className="demo-detail-note"><Sparkles size={15} /> Beispielprojekt · Die vollständige Projektverwaltung folgt im nächsten Schritt.</p><Link className="button-primary full-width" href={hubHref(preview, "messages")}>Zum Gespräch <ArrowRight size={17} /></Link></Modal>}
      {file && <Modal title="Dateiinformationen" onClose={() => setFile(null)}><div className="modal-file-icon"><FileText size={36} strokeWidth={1.3} /></div><h3 className="project-modal-title">{file.name}</h3><dl className="file-details"><div><dt>Projekt</dt><dd>{file.project}</dd></div><div><dt>Dateigröße</dt><dd>{file.size}</dd></div><div><dt>Geändert</dt><dd>{file.date}</dd></div></dl><p className="help-note">Beispieldatei für Frontend-Tests. Echte Uploads, Vorschauen und Downloads werden mit der Dateianbindung ergänzt.</p><button className="button-primary full-width" onClick={() => setFile(null)}>Verstanden <Check size={17} /></button></Modal>}
    </>
  );
}
