import React from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { cn } from '../lib/utils'
import {
  StatCard, ChartCard, CustomTooltip, TimeRangeToggle,
  CHART_COMMON, LINE_COLORS, CHART_AXIS_TICK, CHART_GRID_STROKE,
} from './shared'

export default function OverviewTab({
  stats, metrics, driftScore, coverageGuarantee, rps, timeRange, setTimeRange,
}) {
  const { fraudProbChartData, chartData, currentMetrics } = metrics

  const driftPct = ((driftScore ?? 0) * 100).toFixed(1)
  const driftStatus = driftScore >= 0.7 ? 'ALERT' : driftScore >= 0.5 ? 'WARN' : 'OPTIMAL'
  const driftAccent =
    driftScore >= 0.7 ? 'text-crimson' :
    driftScore >= 0.5 ? 'text-amber-accent' : 'text-mint'

  const coverage = coverageGuarantee != null
    ? `${(coverageGuarantee * 100).toFixed(1)}`
    : null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="typo-title text-text-primary">Overview</h1>
        <p className="typo-subtitle text-text-dimmed mt-1">Real-time model health &amp; fraud detection summary</p>
      </div>

      <div className="card card-glass grid grid-cols-3 divide-x divide-white/[0.07]">
        <StatCard
          label="Total Requests"
          value={stats?.total_requests?.toLocaleString() ?? '0'}
          unit="RPS"
          sub={rps != null ? `${rps.toFixed(1)} req/s` : 'Calculating…'}
          tooltip="Total transactions scored by the fraud model. RPS shows the current throughput."
          delay={1}
        />
        <StatCard
          label="Drift Score"
          value={driftPct}
          unit="%"
          accentClass={driftAccent}
          sub={`${currentMetrics.featureDriftSoft} soft · ${currentMetrics.featureDriftHard} hard features`}
          tooltip="How much incoming transaction patterns have shifted from training data. Above 70% triggers a retrain."
          status={driftStatus}
          hero
          delay={2}
        />
        <StatCard
          label="Coverage Guarantee"
          value={coverage ?? '—'}
          unit={coverage != null ? '%' : undefined}
          accentClass="text-mint"
          sub={coverageGuarantee != null ? `α = ${(100 - coverageGuarantee * 100).toFixed(1)}%` : 'Awaiting model'}
          tooltip="Conformal coverage guarantee — the model's prediction set contains the true label at least this fraction of the time."
          delay={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ChartCard
          title="Fraud Probability"
          action={<TimeRangeToggle value={timeRange} onChange={setTimeRange} />}
        >
          {fraudProbChartData.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={fraudProbChartData} {...CHART_COMMON}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={CHART_AXIS_TICK}
                  tickLine={false} axisLine={false}
                  minTickGap={20}
                  interval="preserveStartEnd"
                />
                <YAxis
                  width={42}
                  tick={CHART_AXIS_TICK}
                  tickLine={false} axisLine={false}
                  tickFormatter={(v) => v.toFixed(2)}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="p50" stroke={LINE_COLORS.mint} dot={false} strokeWidth={1.5} name="p50" />
                <Line type="monotone" dataKey="p90" stroke={LINE_COLORS.amber} dot={false} strokeWidth={1.5} name="p90" />
                <Line type="monotone" dataKey="p99" stroke={LINE_COLORS.crimson} dot={false} strokeWidth={1.5} name="p99" />
              </LineChart>
            </ResponsiveContainer>
          )}
          <ChartLegend items={[
            { color: LINE_COLORS.mint, label: 'p50' },
            { color: LINE_COLORS.amber, label: 'p90' },
            { color: LINE_COLORS.crimson, label: 'p99' },
          ]} />
        </ChartCard>

        <ChartCard title="Drift Score over Time">
          {chartData.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={chartData} {...CHART_COMMON}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={CHART_AXIS_TICK}
                  tickLine={false} axisLine={false}
                  minTickGap={20}
                  interval="preserveStartEnd"
                />
                <YAxis
                  width={42}
                  tick={CHART_AXIS_TICK}
                  tickLine={false} axisLine={false}
                  domain={[0, 1]}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                />
                <Tooltip content={<CustomTooltip formatter={(v) => `${(v * 100).toFixed(1)}%`} />} />
                <ReferenceLine y={0.7} stroke="var(--accent-crimson-vibrant)" strokeDasharray="4 2" strokeWidth={1} />
                <ReferenceLine y={0.5} stroke="var(--accent-amber-vibrant)" strokeDasharray="4 2" strokeWidth={1} />
                <Line type="monotone" dataKey="drift" stroke={LINE_COLORS.steel} dot={false} strokeWidth={1.5} name="Drift" />
              </LineChart>
            </ResponsiveContainer>
          )}
          <ChartLegend items={[
            { color: LINE_COLORS.steel, label: 'Drift' },
            { color: 'var(--accent-amber-vibrant)', label: '50% warn' },
            { color: 'var(--accent-crimson-vibrant)', label: '70% crit' },
          ]} />
        </ChartCard>
      </div>

    </div>
  )
}

const EmptyState = () => (
  <div className="flex h-[380px] items-center justify-center">
    <p className="typo-body-sm text-text-dimmed">Waiting for data…</p>
  </div>
)

const ChartLegend = ({ items }) => (
  <div className="flex items-center gap-4 pt-1">
    {items.map((item) => (
      <div key={item.label} className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
        <span className="typo-caption text-text-muted">{item.label}</span>
      </div>
    ))}
  </div>
)
