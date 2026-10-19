"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { categories } from "@/lib/categories";
import { hubHref } from "@/lib/hub-data";
import type { MetricId, RangeId } from "@/lib/hub-metrics";
import { HighlightCard } from "../cards";
import { BarChart } from "../charts";
import { SegmentedControl, Switch } from "../controls";
import { CategoryIcon, GlassCard, GlassLinkButton, SectionHeader } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { InsetGroupedList, ListRow } from "../list";
import type { ScreenProps } from "./types";

const ranges: { id: RangeId; label: string; name: string }[] = [
  { id: "T", label: "T", name: "Tag" },
  { id: "W", label: "W", name: "Woche" },
  { id: "M", label: "M", name: "Monat" },
  { id: "6M", label: "6M", name: "6 Monate" },
  { id: "J", label: "J", name: "Jahr" },
];

const primaryAction = { projects: "Projekte öffnen", files: "Dateien öffnen", messages: "Zum Gespräch" } as const;

export function MetricDetailScreen({ model, preview, populated, favorites, metricId }: ScreenProps & { metricId: MetricId }) {
  const [range, setRange] = useState<RangeId>("W");
  const metric = model.metrics[metricId];
  const category = categories[metric.category];
  const series = model.series(metricId, range);
  const comparison = model.weekComparison(metricId);
  const favorite = favorites.isFavorite(metricId);
  const switchId = `favorite-${metricId}`;

  return (
    <>
      <LargeTitleHeader
        title={metric.name}
        icon={<span className="title-icon"><CategoryIcon category={metric.category} size={24} /></span>}
        leading={<>
          <Link href={hubHref(preview)} className="on-bg-link"><ChevronLeft size={22} strokeWidth={2.5} aria-hidden="true" />Übersicht</Link>
          <GlassLinkButton href={hubHref(preview, category.section)}>{primaryAction[metric.category]}</GlassLinkButton>
        </>}
      />

      <div className="section-first"><SegmentedControl options={ranges} value={range} onChange={setRange} label="Zeitraum" /></div>

      <GlassCard feature className="chart-card">
        <p className="chart-caption">{series.caption}</p>
        <p className="chart-value-line"><span className="chart-value numeric">{series.value}</span>{series.unit && <span className="metric-unit">{series.unit}</span>}</p>
        <p className="t-footnote t-secondary">{series.rangeLabel}</p>
        {series.buckets.length > 0 && !series.empty
          ? <BarChart series={series} category={metric.category} label={metric.name} />
          : <p className="chart-empty t-subheadline t-secondary">{populated ? "Für diesen Zeitraum gibt es noch keinen Verlauf." : "Sobald dein Workspace Daten enthält, siehst du hier den Verlauf."}</p>}
      </GlassCard>

      {comparison && <>
        <SectionHeader title="Highlights" />
        <div className="highlight-grid"><HighlightCard highlight={comparison} /></div>
      </>}

      <SectionHeader title={`Über ${metric.name}`} />
      <GlassCard><p className="t-body">{model.definitions[metricId].about}</p></GlassCard>

      <SectionHeader title="Optionen" />
      <InsetGroupedList label="Optionen">
        <li className="list-item"><div className="list-row"><label htmlFor={switchId} className="list-row-text"><span className="list-row-title">Zu Favoriten hinzufügen</span></label><Switch id={switchId} checked={favorite} onChange={() => favorites.toggle(metricId)} label="Zu Favoriten hinzufügen" /></div></li>
        <ListRow href={hubHref(preview, category.section)} title={`Alle ${category.name} anzeigen`} />
      </InsetGroupedList>
    </>
  );
}
