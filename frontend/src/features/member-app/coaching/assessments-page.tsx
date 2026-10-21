"use client";

import { useState } from "react";
import {
  formatChange,
  formatMetric,
  metricProgress,
  metricSeries,
  METRICS,
  type Metric,
  type MetricKey,
  type MetricPoint,
} from "@/lib/gym/assessments";
import { fill, useT } from "../lib/i18n";
import { useLang } from "../lib/lang";
import { useMyAssessments } from "../lib/queries-coaching";
import { EmptyState, Spinner, chipClass, formatDay } from "../ui";

/** Fitness assessments: latest numbers, progress chart per metric, and the full history. */
export function AssessmentsPage() {
  const t = useT();
  const locale = useLang() === "id" ? "id-ID" : "en-US";
  const { data, isLoading } = useMyAssessments();
  const [chosen, setChosen] = useState<MetricKey | "">("");

  if (isLoading) return <Spinner label={t("Loading assessments…")} />;
  const history = data ?? [];

  const progress = METRICS.flatMap((metric) => {
    const p = metricProgress(metric, metricSeries(history, metric.key));
    return p ? [{ metric, p }] : [];
  });
  const charted = METRICS.filter((metric) => metricSeries(history, metric.key).length >= 2);
  const chartMetric = charted.find((metric) => metric.key === chosen) ?? charted[0];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl font-black">{t("Fitness assessments")}</h1>
        <p className="mt-1 text-sm text-nh-muted">{t("Body metrics and HYROX benchmarks your coach recorded.")}</p>
      </div>

      {history.length === 0 ? (
        <EmptyState title={t("No assessments yet")} hint={t("Ask your coach for a fitness assessment at the gym.")} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-2">
            {progress.map(({ metric, p }) => (
              <div key={metric.key} className="nh-card !p-3">
                <p className="truncate text-xs font-bold text-nh-muted">{t(metric.labelEn)}</p>
                <p className="nh-display text-xl font-black tabular-nums">{formatMetric(metric, p.latest, locale)}</p>
                {p.change !== null ? (
                  <p
                    className={`text-xs font-bold tabular-nums ${
                      p.improved === null ? "text-nh-muted" : p.improved ? "text-nh-ok" : "text-nh-warn"
                    }`}
                  >
                    {formatChange(metric, p.change, locale)}{" "}
                    {p.improved === null ? "" : p.improved ? t("better") : t("worse")}
                  </p>
                ) : null}
              </div>
            ))}
          </section>

          {chartMetric ? (
            <section className="nh-card flex flex-col gap-3">
              <p className="nh-label !mb-0">{t("Progress")}</p>
              <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-1">
                {charted.map((metric) => (
                  <button key={metric.key} onClick={() => setChosen(metric.key)} className={chipClass(metric.key === chartMetric.key)}>
                    {t(metric.labelEn)}
                  </button>
                ))}
              </div>
              <LineChart
                metric={chartMetric}
                points={metricSeries(history, chartMetric.key)}
                locale={locale}
                summary={fill(t("{metric}: {n} measurements, latest {value}"), {
                  metric: t(chartMetric.labelEn),
                  n: metricSeries(history, chartMetric.key).length,
                  value: formatMetric(chartMetric, metricSeries(history, chartMetric.key).at(-1)!.value, locale),
                })}
              />
            </section>
          ) : null}

          {history[0]!.goals ? (
            <section className="nh-card">
              <p className="nh-label">{t("Goals")}</p>
              <p className="text-sm whitespace-pre-line">{history[0]!.goals}</p>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <p className="nh-label !mb-0">{t("History")}</p>
            {history.map((a) => (
              <details key={a.id} className="nh-card !p-4">
                <summary className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="font-black">{formatDay(`${a.assessed_on}T12:00:00+07:00`)}</span>
                  <span className="truncate text-xs text-nh-muted">{a.coach_name}</span>
                </summary>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  {METRICS.filter((metric) => a[metric.key] !== null).map((metric) => (
                    <div key={metric.key}>
                      <dt className="text-xs text-nh-muted">{t(metric.labelEn)}</dt>
                      <dd className="font-bold tabular-nums">{formatMetric(metric, a[metric.key], locale)}</dd>
                    </div>
                  ))}
                </dl>
                {a.notes ? <p className="mt-3 text-sm whitespace-pre-line text-nh-muted">{a.notes}</p> : null}
              </details>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

const W = 320;
const H = 150;
const PAD = { top: 14, right: 14, bottom: 22, left: 14 };

/**
 * One metric over time: a 2px line with 8px markers, the first and latest
 * values labelled. Tapping a marker shows its date and value. The history
 * list below carries the same numbers as text.
 */
function LineChart({ metric, points, locale, summary }: { metric: Metric; points: MetricPoint[]; locale: string; summary: string }) {
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(points.length - 1, 1);
  const y = (v: number) => PAD.top + ((hi - v) * (H - PAD.top - PAD.bottom)) / span;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const last = points.length - 1;
  const shown = active ?? last;
  const day = (d: string) => new Date(`${d}T12:00:00+07:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-sm">
        <span className="font-bold tabular-nums">{formatMetric(metric, points[shown]!.value, locale)}</span>
        <span className="text-nh-muted"> · {day(points[shown]!.date)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={summary}>
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + f * (H - PAD.top - PAD.bottom)}
            y2={PAD.top + f * (H - PAD.top - PAD.bottom)}
            stroke="var(--color-nh-line)"
            strokeWidth={1}
          />
        ))}
        <path d={path} fill="none" stroke="var(--color-nh-forest)" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.date + i} onClick={() => setActive(i)} className="cursor-pointer">
            <circle cx={x(i)} cy={y(p.value)} r={14} fill="transparent" />
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r={i === shown ? 5 : 4}
              fill="var(--color-nh-forest)"
              stroke="var(--color-nh-cream)"
              strokeWidth={2}
            />
          </g>
        ))}
        <text x={x(0)} y={H - 6} fontSize={10} fill="var(--color-nh-muted)">
          {day(points[0]!.date)}
        </text>
        <text x={x(last)} y={H - 6} fontSize={10} fill="var(--color-nh-muted)" textAnchor="end">
          {day(points[last]!.date)}
        </text>
      </svg>
    </figure>
  );
}
