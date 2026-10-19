"use client";

import { useState } from "react";
import { categories, type CategoryId } from "@/lib/categories";
import { formatNumber, type ComparisonRow, type MetricSeries, type MiniChartData } from "@/lib/hub-metrics";

const percent = (value: number, max: number) => `${Math.max(0, Math.min(100, (value / Math.max(max, 1e-9)) * 100))}%`;

/** Small chart on the right side of a MetricCard. Decorative: the numbers carry the meaning. */
export function MiniChart({ data, category }: { data: MiniChartData; category: CategoryId }) {
  const { fill, text } = categories[category];
  if (data.type === "bars") {
    const max = Math.max(1, ...data.values);
    return <div className="mini-bars" aria-hidden="true">{data.values.map((value, index) => <span key={index} style={{ height: value ? percent(value, max) : "3px", background: fill, opacity: value && index === data.values.length - 1 ? 1 : 0.38 }} />)}</div>;
  }
  if (data.type === "sparkline") {
    const max = Math.max(...data.values);
    const min = Math.min(...data.values);
    const points = data.values.map((value, index) => `${(index / Math.max(1, data.values.length - 1)) * 108 + 2},${34 - ((value - min) / Math.max(max - min, 1e-9)) * 30}`).join(" ");
    return <svg className="mini-sparkline" viewBox="0 0 112 36" aria-hidden="true"><polyline points={points} fill="none" stroke={fill} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (data.type === "progress") {
    return <div className="mini-progress" aria-hidden="true" style={{ background: `color-mix(in srgb, ${fill} 25%, transparent)` }}><span style={{ width: percent(data.value, 100), background: fill }} /></div>;
  }
  if (data.type === "ticks") {
    return <div className="mini-ticks" aria-hidden="true">{data.values.map((value, index) => <span key={index} style={{ background: value === "warning" ? "var(--warning)" : fill, opacity: value === "warning" ? 1 : 0.38 }} />)}</div>;
  }
  return <span className="mini-badge" style={{ background: `color-mix(in srgb, ${fill} 20%, transparent)`, color: text }}>{data.label}</span>;
}

/** "This week" vs. "last week" bars, proportional, current value in the category colour. */
export function ComparisonBars({ rows, category }: { rows: ComparisonRow[]; category: CategoryId }) {
  const max = Math.max(...rows.map((row) => row.value), 1e-9);
  return (
    <dl className="comparison-bars">
      {rows.map((row, index) => (
        <div key={row.label} className="comparison-row">
          <dt>{row.label}</dt>
          <dd><span className="comparison-bar" aria-hidden="true" style={{ width: row.value ? percent(row.value, max) : "6px", background: index === 0 ? categories[category].fill : "var(--track-neutral)" }} /><span className="comparison-value numeric">{row.display}</span></dd>
        </div>
      ))}
    </dl>
  );
}

/** Seven daily bars with a dashed average line; days above the average are fully coloured. */
export function WeekBars({ days, average, averageLabel, category }: { days: { label: string; value: number }[]; average: number; averageLabel: string; category: CategoryId }) {
  const max = Math.max(1, ...days.map((day) => day.value));
  return (
    <figure className="week-bars">
      <div className="week-bars-plot" aria-hidden="true">
        <span className="week-bars-average" style={{ bottom: percent(average, max) }}><span>{averageLabel}</span></span>
        {days.map((day, index) => <span key={index} className="week-bars-bar" style={{ height: day.value ? percent(day.value, max) : "3px", background: categories[category].fill, opacity: day.value > 0 && day.value >= average ? 1 : 0.35 }} />)}
      </div>
      <div className="week-bars-labels" aria-hidden="true">{days.map((day, index) => <span key={index}>{day.label}</span>)}</div>
      <figcaption className="visually-hidden">{days.map((day) => `${day.label}: ${day.value}`).join(", ")}; {averageLabel}</figcaption>
    </figure>
  );
}

function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

/** Period-aware bar chart for the detail page. Hover, tap or focus highlights a bar. */
export function BarChart({ series, category, label }: { series: MetricSeries; category: CategoryId; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceCeiling(series.max);
  const fill = categories[category].fill;
  return (
    <div className="bar-chart" role="group" aria-label={`${label}: ${series.caption.toLowerCase()} ${series.value} ${series.unit}, ${series.rangeLabel}`} onMouseLeave={() => setActive(null)}>
      <div className="bar-chart-plot">
        <div className="bar-chart-grid" aria-hidden="true">
          {[1, 0.5, 0].map((ratio) => <span key={ratio} className={ratio === 0 ? "is-baseline" : ""} style={{ bottom: `${ratio * 100}%` }}><span>{formatNumber(top * ratio)}</span></span>)}
        </div>
        <div className="bar-chart-bars">
          {series.buckets.map((bucket, index) => (
            <button
              key={index}
              type="button"
              className={`bar-chart-slot${active === index ? " is-active" : ""}${index < 2 ? " edge-start" : index > series.buckets.length - 3 ? " edge-end" : ""}`}
              aria-label={bucket.tooltip}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onClick={() => setActive((value) => value === index ? null : index)}
            >
              {bucket.value !== null && <span className="bar-chart-bar" style={{ height: bucket.value ? percent(bucket.value, top) : "0%", background: fill, opacity: active === null || active === index ? 1 : 0.35 }} />}
              {active === index && <span className="bar-chart-bubble" role="status">{bucket.tooltip}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="bar-chart-labels" aria-hidden="true">{series.buckets.map((bucket, index) => <span key={index}>{bucket.showLabel ? bucket.label : ""}</span>)}</div>
    </div>
  );
}
