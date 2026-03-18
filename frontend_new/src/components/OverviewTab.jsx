import React from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { cn } from '../lib/utils'
import {
  StatCard, ChartCard, CustomTooltip, TimeRangeToggle,
  CHART_COMMON, LINE_COLORS, CHART_AXIS_TICK, CHART_GRID_STROKE, ChartStatePane, getDriftStatusMeta,
} from './shared'

export default function OverviewTab({
  stats,
  systemStatus,
  metrics,
  driftScore,
  driftReady = true,
  coverageGuarantee,
  rps,
  timeRange,
  setTimeRange,
  driftWarning = 0.5,
  driftCritical = 0.7,
}) {
  const { fraudProbChartData, chartData, driftScoreData, currentMetrics } = metrics

  const driftPct = driftReady ? ((driftScore ?? 0) * 100).toFixed(1) : 'warming up'
  const driftStatus = getDriftStatusMeta(driftScore ?? 0, driftWarning, driftCritical)
  const coverage = coverageGuarantee != null
    ? `${(coverageGuarantee * 100).toFixed(1)}`
    : null

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="typo-title text-text-primary">Overview</h1>
          <p className="typo-subtitle text-text-dimmed mt-1">Real-time model health &amp; fraud detection summary</p>
          <p className="typo-caption text-text-dimmed mt-2 max-w-2xl">
            DriftShield monitors a live fraud detection model — tracking when incoming transaction patterns shift away from what the model was trained on, and automatically retraining before accuracy degrades.
          </p>
        </div>
        {systemStatus?.retraining?.is_active && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 animate-pulse">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            <span className="typo-caption-bold">Retraining Active</span>
          </div>
        )}
      </div>

      <div>
        <p className="typo-caption text-text-dimmed">
          Drift state uses a single policy: <span className="text-text-primary">Nominal</span> below {(driftWarning * 100).toFixed(0)}%, <span className="text-text-primary">Warning</span> at {(driftWarning * 100).toFixed(0)}%+, and <span className="text-text-primary">Critical</span> at {(driftCritical * 100).toFixed(0)}%+ (retrain risk).
        </p>
      </div>

      <div className="card card-glass grid grid-cols-3 divide-x divide-white/[0.07]">
        <StatCard
          label="Total Requests"
          value={stats?.total_requests?.toLocaleString() ?? '0'}
          unit="RPS"
          sub={rps != null ? `${rps.toFixed(1)} req/s` : 'Calculating…'}
          tooltip="Total number of transactions the fraud model has scored since startup. RPS (requests per second) shows current live throughput."
          delay={1}
        />
        <StatCard
          label="Drift Score"
          value={driftPct}
          unit={driftReady ? '%' : undefined}
          sub={driftReady ? `${currentMetrics.featureDriftSoft} warned · ${currentMetrics.featureDriftHard} critical features` : 'No scored drift window yet'}
          tooltip={`Measures how much live transaction patterns have diverged from the data the model was trained on. A score above ${(driftCritical * 100).toFixed(0)}% means the model may no longer be reliable and a retrain is triggered.`}
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
          tooltip="How often the model is statistically guaranteed to be correct. At 95%, no more than 1 in 20 predictions should be wrong — this bound is enforced by conformal calibration at training time."
          delay={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ChartCard
          title="Fraud Probability"
          action={<TimeRangeToggle value={timeRange} onChange={setTimeRange} />}
        >
          {fraudProbChartData.length === 0 ? (
            <ChartStatePane state={metrics.chartStates.fraud} onRetry={metrics.refresh} height={380} />
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
          {driftScoreData.length === 0 ? (
            <ChartStatePane state={metrics.chartStates.drift} onRetry={metrics.refresh} height={380} />
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
                <ReferenceLine y={driftCritical} stroke="var(--accent-crimson-vibrant)" strokeDasharray="4 2" strokeWidth={1} />
                <ReferenceLine y={driftWarning} stroke="var(--accent-amber-vibrant)" strokeDasharray="4 2" strokeWidth={1} />
                <Line type="monotone" dataKey="drift" stroke={LINE_COLORS.steel} dot={false} strokeWidth={1.5} name="Drift" />
              </LineChart>
            </ResponsiveContainer>
          )}
          <ChartLegend items={[
            { color: LINE_COLORS.steel, label: 'Drift' },
            { color: 'var(--accent-amber-vibrant)', label: `${(driftWarning * 100).toFixed(0)}% warn` },
            { color: 'var(--accent-crimson-vibrant)', label: `${(driftCritical * 100).toFixed(0)}% crit` },
          ]} />
        </ChartCard>
      </div>

    </div>
  )
}

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
