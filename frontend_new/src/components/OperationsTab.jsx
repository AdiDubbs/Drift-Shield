import React from 'react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import {
  ChartCard,
  CustomTooltip,
  TimeRangeToggle,
  CHART_COMMON,
  LINE_COLORS,
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
} from './shared'

const EmptyState = ({ height = 180 }) => (
  <div className="flex items-center justify-center rounded-md bg-muted/30" style={{ height }}>
    <p className="typo-body-sm text-muted-foreground">Waiting for data…</p>
  </div>
)

const ChartLegend = ({ items }) => (
  <div className="flex items-center gap-4 pt-1">
    {items.map((item) => (
      <div key={item.label} className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: item.color, ...(item.dashed ? { borderRadius: 0, height: 2, width: 10 } : {}) }}
        />
        <span className="typo-caption text-text-secondary">{item.label}</span>
      </div>
    ))}
  </div>
)

const StatStrip = ({ label, value, unit, accent }) => (
  <div className="flex flex-col gap-1 px-5 py-4">
    <span className="typo-overline text-text-muted">{label}</span>
    <div className="flex items-baseline gap-1.5">
      <span className="typo-stat-md" style={{ color: accent ?? 'var(--text-primary)' }}>
        {value ?? '—'}
      </span>
      {unit && <span className="typo-overline text-text-secondary">{unit}</span>}
    </div>
  </div>
)

export default function OperationsTab({
  metrics,
  timeRange,
  setTimeRange,
  driftWarning = 0.5,
  driftCritical = 0.7,
}) {
  const { latencyChartData, chartData, fraudProbChartData } = metrics

  // Latest values for the stat strip
  const lastLatency = latencyChartData.at(-1)
  const lastChart = chartData.at(-1)
  const lastFraud = fraudProbChartData.at(-1)

  const latencyP99 = lastLatency?.p99 != null ? lastLatency.p99.toFixed(1) : '—'
  const latencyP50 = lastLatency?.p50 != null ? lastLatency.p50.toFixed(1) : '—'
  const currentRps = lastChart?.rps != null ? lastChart.rps.toFixed(2) : '—'
  const driftPct = lastChart?.drift != null ? `${(lastChart.drift * 100).toFixed(1)}` : '—'
  const fraudP50 = lastFraud?.p50 != null ? lastFraud.p50.toFixed(3) : '—'

  const driftVal = lastChart?.drift ?? 0
  const driftAccent =
    driftVal >= driftCritical ? 'var(--accent-crimson-vibrant)' :
    driftVal >= driftWarning ? 'var(--accent-amber-vibrant)' :
    'var(--accent-steel-vibrant)'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="typo-title text-text-primary">Monitoring</h1>
          <p className="typo-subtitle text-text-dimmed mt-1">Latency, throughput, and drift telemetry</p>
        </div>
        <div className="pt-1">
          <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
        </div>
      </div>

      <div className="card card-glass grid grid-cols-5 divide-x divide-white/[0.07]">
        <StatStrip label="p50 Latency" value={latencyP50} unit="ms" />
        <StatStrip label="p99 Latency" value={latencyP99} unit="ms" accent="var(--accent-amber-vibrant)" />
        <StatStrip label="Request Rate" value={currentRps} unit="req/s" />
        <StatStrip label="Drift Score" value={driftPct} unit="%" accent={driftAccent} />
        <StatStrip label="Fraud p50" value={fraudP50} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Latency (ms)">
          {latencyChartData.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={latencyChartData} {...CHART_COMMON}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis dataKey="time" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} interval="preserveStartEnd" />
                <YAxis width={42} tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip formatter={(v) => `${v.toFixed(1)} ms`} />} />
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

        <ChartCard title="Drift Score">
          {chartData.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} {...CHART_COMMON}>
                <defs>
                  <linearGradient id="driftFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-steel-vibrant)" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="var(--accent-steel-vibrant)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis dataKey="time" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} interval="preserveStartEnd" />
                <YAxis width={42} tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip content={<CustomTooltip formatter={(v) => `${(v * 100).toFixed(1)}%`} />} />
                <ReferenceLine y={driftCritical} stroke="var(--accent-crimson-vibrant)" strokeDasharray="4 2" strokeWidth={1} />
                <ReferenceLine y={driftWarning} stroke="var(--accent-amber-vibrant)" strokeDasharray="4 2" strokeWidth={1} />
                <Area type="monotone" dataKey="drift" stroke={LINE_COLORS.steel} fill="url(#driftFill)" dot={false} strokeWidth={1.5} name="Drift" />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <ChartLegend items={[
            { color: LINE_COLORS.steel, label: 'Drift' },
            { color: 'var(--accent-amber-vibrant)', label: `Soft (${(driftWarning * 100).toFixed(0)}%)` },
            { color: 'var(--accent-crimson-vibrant)', label: `Hard (${(driftCritical * 100).toFixed(0)}%)` },
          ]} />
        </ChartCard>

        <ChartCard title="Request Rate (req/s)">
          {chartData.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} {...CHART_COMMON}>
                <defs>
                  <linearGradient id="rpsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-steel-vibrant)" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="var(--accent-steel-vibrant)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis dataKey="time" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} interval="preserveStartEnd" />
                <YAxis width={42} tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip formatter={(v) => `${v.toFixed(2)} req/s`} />} />
                <Area type="monotone" dataKey="rps" stroke={LINE_COLORS.steel} fill="url(#rpsFill)" dot={false} strokeWidth={1.5} name="RPS" />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <ChartLegend items={[
            { color: LINE_COLORS.steel, label: 'req/s' },
          ]} />
        </ChartCard>

        <ChartCard title="Fraud Probability">
          {fraudProbChartData.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={fraudProbChartData} {...CHART_COMMON}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis dataKey="time" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} interval="preserveStartEnd" />
                <YAxis width={42} tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(2)} />
                <Tooltip content={<CustomTooltip formatter={(v, name) => `${v.toFixed(3)} (${name})`} />} />
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
      </div>
    </div>
  )
}
