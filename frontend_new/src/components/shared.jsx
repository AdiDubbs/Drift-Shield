import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Info, RefreshCw, AlertTriangle, CircleCheck, TriangleAlert, ShieldAlert } from 'lucide-react'
import { cn } from '../lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { Button } from './ui/button'
import AnimatedNumber from './AnimatedNumber'

const STATUS_META = {
  nominal: {
    label: 'Nominal',
    textColor: 'var(--accent-mint-vibrant)',
    bgColor: 'rgba(82,149,123,0.12)',
    borderColor: 'rgba(82,149,123,0.35)',
    Icon: CircleCheck,
  },
  warning: {
    label: 'Warning',
    textColor: 'var(--status-warning-fg)',
    bgColor: 'var(--status-warning-bg)',
    borderColor: 'var(--status-warning-border)',
    Icon: TriangleAlert,
  },
  critical: {
    label: 'Critical',
    textColor: 'var(--status-critical-fg)',
    bgColor: 'var(--status-critical-bg)',
    borderColor: 'var(--status-critical-border)',
    Icon: ShieldAlert,
  },
}

const getDriftStatusMeta = (driftScore, warningThreshold, criticalThreshold) => {
  if (driftScore >= criticalThreshold) return STATUS_META.critical
  if (driftScore >= warningThreshold) return STATUS_META.warning
  return STATUS_META.nominal
}

const StatusBadge = ({ status }) => {
  if (!status) return null
  const Icon = status.Icon
  return (
    <span
      className="inline-flex items-center gap-1 typo-overline px-1.5 py-0.5 rounded-md border"
      style={{ backgroundColor: status.bgColor, borderColor: status.borderColor, color: 'var(--text-primary)' }}
    >
      <Icon className="h-3 w-3" style={{ color: status.textColor }} />
      {status.label}
    </span>
  )
}

const StatCard = ({ label, value, unit, sub, accentClass, tooltip, status, hero = false, delay = 0 }) => {
  const [showTip, setShowTip] = useState(false)
  const valueColor = accentClass
      ? undefined
      : hero && status?.label === 'Nominal'
        ? 'var(--accent-mint-vibrant)'
      : 'var(--text-primary)'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay * 0.08, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex flex-col gap-3 p-6"
    >
      <div className="flex items-center gap-1.5">
        <span className="typo-overline text-text-muted">{label}</span>
        {hero && status ? <StatusBadge status={status} /> : null}
        {tooltip && (
          <div
            className="relative"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
          >
            <Info className="w-3 h-3 text-text-muted hover:text-text-secondary transition-colors cursor-default" />
            {showTip && (
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-xl border border-border-dim px-3 py-2 typo-caption text-text-secondary leading-relaxed z-50"
                style={{ backgroundColor: 'var(--surface-frost-strong)' }}
              >
                {tooltip}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className={cn('block typo-stat-lg', accentClass)}
          style={valueColor ? { color: valueColor } : undefined}
        >
          <AnimatedNumber value={String(value ?? '—')} />
        </span>
        {unit && <span className="typo-overline text-text-secondary">{unit}</span>}
      </div>

      {sub && <p className="typo-body-sm text-muted-foreground">{sub}</p>}
    </motion.div>
  )
}

const SectionTitle = ({ children }) => (
  <h2 className="typo-body font-semibold text-foreground">{children}</h2>
)

const ChartCard = ({ title, children, action }) => (
  <Card glass className="p-5 flex flex-col gap-4">
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {action}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
)

const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (!active || !payload?.length) return null
  const points = [...payload]
    .filter((entry) => entry?.value != null && !Number.isNaN(Number(entry.value)))
    .sort((a, b) => Number(b.value) - Number(a.value))
  return (
    <div
      className="rounded-xl border border-border p-3 shadow-md backdrop-blur-sm"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--surface-frost-strong), transparent 6%)',
      }}
    >
      <p className="mb-1.5 typo-caption text-text-secondary">{label}</p>
      {points.map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-0.5">
          <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="typo-body-sm text-text-muted">{entry.name}</span>
          </div>
          <span className="typo-body-sm font-medium text-foreground">
            {formatter ? formatter(entry.value, entry.name) : entry.value?.toFixed(3)}
          </span>
        </div>
      ))}
    </div>
  )
}

const TimeRangeToggle = ({ value, onChange }) => (
  <div className="flex items-center gap-0.5 rounded-full border border-border-dim bg-secondary p-0.5">
    {['5m', '15m', '1h'].map((v) => (
      <Button
        key={v}
        size="sm"
        variant="tab"
        active={value === v}
        onClick={() => onChange(v)}
        className="!px-3 !py-1"
      >
        {v}
      </Button>
    ))}
  </div>
)

const ChartStatePane = ({ state, onRetry, height = 260 }) => {
  if (state?.loading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <div className="flex items-center gap-2 typo-body-sm text-text-muted">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Fetching live telemetry…
        </div>
      </div>
    )
  }

  if (state?.error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ height }}>
        <div className="space-y-1">
          <p className="typo-body-sm text-text-primary">We couldn’t load this panel.</p>
          <div className="flex items-center justify-center gap-2 typo-caption text-accent-amber">
          <AlertTriangle className="h-4 w-4" />
          {state.error}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <div className="flex flex-col items-center gap-3">
        <p className="typo-body-sm text-text-dimmed">No data available yet for this time range.</p>
        <Button variant="secondary" size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    </div>
  )
}

const CHART_COMMON = {
  margin: { top: 6, right: 10, left: -10, bottom: 0 },
}

const LINE_COLORS = {
  mint: 'var(--accent-mint-vibrant)',
  crimson: 'var(--accent-crimson-vibrant)',
  steel: 'var(--accent-steel-vibrant)',
  amber: 'var(--accent-amber-vibrant)',
}

const CHART_AXIS_TICK = { fontSize: 11, fill: 'var(--text-secondary)' }
const CHART_GRID_STROKE = 'rgba(255,255,255,0.12)'

export {
  StatCard,
  ChartCard,
  CustomTooltip,
  TimeRangeToggle,
  CHART_COMMON,
  LINE_COLORS,
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  SectionTitle,
  ChartStatePane,
  getDriftStatusMeta,
  StatusBadge,
}
