import Link from "next/link";
import { ArrowUpRight, ChevronRight, Handshake } from "lucide-react";
import { categories } from "@/lib/categories";
import type { Highlight, MetricSnapshot } from "@/lib/hub-metrics";
import type { CustomerLogo } from "@/lib/hub-logos/rules";
import type { OverviewFacts } from "@/lib/hub-overview/types";
import { SERVICE_PLATFORM_URL } from "@/lib/service-packages";
import { ComparisonBars, MiniChart, WeekBars } from "./charts";
import type { HubAccount } from "./shell-context";
import { CategoryIcon, Chevron } from "./glass";
import { LogoMark } from "./logo-mark";

/** The way to the service platform, on the right of the long welcome card (customers and admins, not freelancers). */
export function ServiceButton() {
  return (
    <a className="service-cta welcome-cta" href={SERVICE_PLATFORM_URL} target="_blank" rel="noopener noreferrer">
      Ab zur Serviceplattform <ArrowUpRight size={18} aria-hidden="true" /><span className="visually-hidden"> (öffnet in neuem Tab)</span>
    </a>
  );
}

/**
 * The admins' welcome (design „V5“, 18.11.2026): one long card with the greeting, the team's facts (customers without
 * freelancers and archived ones, those with a Service package) and the way to the service platform on the right.
 */
export function WelcomeCard({ account, initials, logo = null, facts }: { account: HubAccount; initials: string; logo?: CustomerLogo | null; facts: OverviewFacts | null }) {
  return (
    <section className="glass glass-card-feature welcome-card welcome-admin" aria-labelledby="welcome-title">
      <div className="welcome-head">
        <LogoMark logo={logo} initials={initials} className="avatar welcome-avatar" />
        <h2 className="welcome-title" id="welcome-title"><span className="welcome-greeting">Willkommen zurück,</span> <span className="welcome-name">{account.name}</span></h2>
      </div>
      <div className="welcome-admin-bar">
        <dl className="welcome-facts">
          <div><dt>Organisation</dt><dd>oalab-Team</dd></div>
          <div><dt>Kunden</dt><dd className="numeric">{facts ? facts.customers : "–"}</dd></div>
          <div><dt>Mit Servicepaket</dt><dd className="numeric">{facts ? facts.withService : "–"}</dd></div>
        </dl>
        <ServiceButton />
      </div>
    </section>
  );
}

/**
 * Freelancers instead of the service packages: how many customers they look after and the way to their asset
 * management. They have no access to the service platform, so there is no button to it.
 */
export function FreelancerCard({ customers, href }: { customers: number; href: string }) {
  return (
    <section className="glass glass-card-feature service-card" aria-labelledby="freelancer-title">
      <div className="card-head">
        <Handshake size={17} color="var(--accent)" strokeWidth={2.2} aria-hidden="true" />
        <h2 className="card-head-title service-title" id="freelancer-title">Deine Kunden</h2>
      </div>
      <p className="service-package-name">{customers === 1 ? "1 Kunde" : `${customers} Kunden`}</p>
      <p className="t-subheadline t-secondary">Ihre Dateien und die von oalab für dich liegen im Asset Management.</p>
      <Link className="service-cta" href={href}>Zum Asset Management <ChevronRight size={18} aria-hidden="true" /></Link>
    </section>
  );
}

/** A key figure as a card (Mehr › Kennzahlen); the whole card is a link to the metric's detail page. */
export function MetricCard({ metric }: { metric: MetricSnapshot }) {
  const { text } = categories[metric.category];
  return (
    <Link href={metric.href} className="glass glass-card metric-card pressable">
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
    </Link>
  );
}

/** `label` overrides the category name (admins see the files as "Asset Management"). */
export function HighlightCard({ highlight, href, label }: { highlight: Highlight; href?: string; label?: string }) {
  const category = categories[highlight.category];
  const content = <>
    <div className="card-head">
      <CategoryIcon category={highlight.category} />
      <span className="card-head-title" style={{ color: category.text }}>{label ?? category.name}</span>
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
