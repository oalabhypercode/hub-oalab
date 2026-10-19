import Link from "next/link";
import { ArrowUpRight, Package, Sparkles } from "lucide-react";
import { categories } from "@/lib/categories";
import type { Highlight, Insight, MetricSnapshot } from "@/lib/hub-metrics";
import { SERVICE_PLATFORM_URL, servicePackages } from "@/lib/service-packages";
import { ComparisonBars, MiniChart, WeekBars } from "./charts";
import type { HubAccount } from "./shell-context";
import { CategoryIcon, Chevron } from "./glass";

/** Greets the signed-in person and shows whom they represent (company, customer number). */
export function WelcomeCard({ account, initials }: { account: HubAccount; initials: string }) {
  return (
    <section className="glass glass-card-feature welcome-card" aria-labelledby="welcome-title">
      <div className="welcome-head">
        <span className="avatar welcome-avatar" aria-hidden="true">{initials}</span>
        <h2 className="welcome-title" id="welcome-title"><span className="welcome-greeting">Willkommen zurück,</span> <span className="welcome-name">{account.name}</span></h2>
      </div>
      <dl className="welcome-facts">
        <div><dt>{account.admin ? "Organisation" : "Unternehmen"}</dt><dd>{account.company ?? "Noch nicht zugeordnet"}</dd></div>
        <div><dt>{account.admin ? "Betreute Kunden" : "Kundennummer"}</dt><dd className="numeric">{account.admin ? account.customers : account.customerNumber ?? "–"}</dd></div>
      </dl>
      {!account.company && <p className="t-footnote t-secondary">Dein Projektteam ordnet deinen Zugang einem Unternehmen zu. Danach siehst du hier auch deine Kundennummer.</p>}
    </section>
  );
}

/** Active service package(s) next to the welcome card, with the way to the service platform. */
export function ServiceCard({ account }: { account: HubAccount }) {
  const packages = account.servicePackages.map((id) => servicePackages[id].name);
  const title = account.admin ? "Serviceplattform" : packages.length > 1 ? "Aktive Servicepakete" : "Aktives Servicepaket";
  return (
    <section className="glass glass-card-feature service-card" aria-labelledby="service-title">
      <div className="card-head">
        <Package size={17} color="var(--accent)" strokeWidth={2.2} aria-hidden="true" />
        <h2 className="card-head-title service-title" id="service-title">{title}</h2>
      </div>
      {account.admin
        ? <p className="t-subheadline t-secondary">Servicepakete und Anfragen deiner Kunden verwaltest du auf der Serviceplattform.</p>
        : packages.length
          ? <ul className="service-packages">{packages.map((name) => <li key={name}><span className="service-package-name">{name}</span><span className="service-status">Aktiv</span></li>)}</ul>
          : <p className="service-package-name service-pending">Wird zugeordnet</p>}
      <a className="service-cta" href={SERVICE_PLATFORM_URL} target="_blank" rel="noopener noreferrer">
        Ab zur Serviceplattform <ArrowUpRight size={18} aria-hidden="true" /><span className="visually-hidden"> (öffnet in neuem Tab)</span>
      </a>
    </section>
  );
}

/** Rule-based summary of the workspace (replaceable by an AI summary later). */
export function InsightsCard({ insight, href }: { insight: Insight; href?: string }) {
  const content = <>
    <div className="card-head">
      <Sparkles size={17} color="var(--insights)" strokeWidth={2.2} aria-hidden="true" />
      <span className="card-head-title" style={{ color: "var(--insights-text)" }}>Insights</span>
      <span className="card-head-time">{insight.timestamp}</span>{href && <Chevron />}
    </div>
    <h2 className="insights-headline">{insight.headline}</h2>
    <p className="t-body insights-body">{insight.body}</p>
    <dl className="insights-figures">
      {insight.figures.map((figure) => (
        <div key={figure.label}><dt>{figure.label}</dt><dd className="numeric" style={{ color: categories[figure.category].text }}>{figure.value}</dd></div>
      ))}
    </dl>
  </>;
  return href
    ? <Link href={href} className="glass glass-card-feature insights-card pressable">{content}</Link>
    : <section className="glass glass-card-feature insights-card">{content}</section>;
}

function MetricCardContent({ metric }: { metric: MetricSnapshot }) {
  const { text } = categories[metric.category];
  return <>
    <div className="card-head">
      <CategoryIcon category={metric.category} />
      <span className="card-head-title" style={{ color: text }}>{metric.name}</span>
      <span className="card-head-time">{metric.timestamp}</span><Chevron />
    </div>
    <div className="metric-card-body">
      <div className="metric-card-figure">
        <p className="metric-value-line"><span className="metric-value numeric">{metric.value}</span><span className="metric-unit">{metric.unit}</span></p>
        <p className="metric-context">{metric.context}</p>
      </div>
      {metric.mini && <MiniChart data={metric.mini} category={metric.category} />}
    </div>
  </>;
}

/** Whole card is a link to the metric's detail page. */
export function MetricCard({ metric }: { metric: MetricSnapshot }) {
  return <Link href={metric.href} className="glass glass-card metric-card pressable"><MetricCardContent metric={metric} /></Link>;
}

/** Static card used while favourites are being edited (controls live outside the card body). */
export function MetricCardStatic({ metric, children }: { metric: MetricSnapshot; children: React.ReactNode }) {
  return <div className="glass glass-card metric-card is-editing">{children}<div className="metric-card-static"><MetricCardContent metric={metric} /></div></div>;
}

export function HighlightCard({ highlight, href }: { highlight: Highlight; href?: string }) {
  const category = categories[highlight.category];
  const content = <>
    <div className="card-head">
      <CategoryIcon category={highlight.category} />
      <span className="card-head-title" style={{ color: category.text }}>{category.name}</span>
      <span className="card-head-time">{highlight.period}</span>{href && <Chevron />}
    </div>
    <p className="t-headline highlight-headline">{highlight.headline}</p>
    {highlight.viz.type === "comparison"
      ? <ComparisonBars rows={highlight.viz.rows} category={highlight.category} />
      : <WeekBars days={highlight.viz.days} average={highlight.viz.average} averageLabel={highlight.viz.averageLabel} category={highlight.category} />}
  </>;
  return href
    ? <Link href={href} className="glass glass-card highlight-card pressable">{content}</Link>
    : <section className="glass glass-card highlight-card">{content}</section>;
}
