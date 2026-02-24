import React, { useState, useEffect, useRef, useCallback } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Settings, Trash2, Copy, Check } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { getDriftStatusMeta, StatusBadge } from './shared'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

const SESSION_START = new Date().toISOString()
const SYSTEM_ENTRIES = [
  { id: 'sys-0', type: 'system', message: 'Model drift monitor polling', note: 'Every 5 s', ts: SESSION_START },
  { id: 'sys-1', type: 'system', message: 'Conformal prediction calibrated', note: 'On startup', ts: SESSION_START },
  { id: 'sys-2', type: 'system', message: 'Prometheus metrics endpoint active', note: '/metrics', ts: SESSION_START },
]

const FILTERS = ['all', 'error', 'warn', 'ok', 'info', 'system']
const FILTER_LABELS = {
  all: 'All',
  error: 'Error',
  warn: 'Warning',
  ok: 'OK',
  info: 'Info',
  system: 'System',
}

export default function LogsTab({
  stats,
  driftScore,
  modelInfo,
  driftWarning = 0.5,
  driftCritical = 0.7,
}) {
  const [entries, setEntries] = useState(SYSTEM_ENTRIES)
  const [filter, setFilter] = useState('all')
  const [copied, setCopied] = useState(false)
  const [nowMs, setNowMs] = useState(Date.now())

  const prevRef = useRef({ driftScore: null, totalRequests: null, retrainTriggers: null, modelId: null })

  const addEntry = useCallback((entry) => {
    setEntries((prev) => [{ ...entry, id: `${entry.type}-${Date.now()}-${Math.random()}` }, ...prev])
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const prev = prevRef.current

    if (modelInfo?.active?.version && modelInfo.active.version !== prev.modelId) {
      addEntry({
        type: 'info',
        message: 'Model version updated',
        note: `Active version: ${modelInfo.active.version}`,
        ts: new Date().toISOString(),
      })
      prevRef.current.modelId = modelInfo.active.version
    }

    if (stats?.total_requests != null && stats.total_requests !== prev.totalRequests) {
      addEntry({
        type: 'info',
        message: 'Traffic volume changed',
        note: `Total requests: ${stats.total_requests.toLocaleString()}`,
        ts: new Date().toISOString(),
      })
      prevRef.current.totalRequests = stats.total_requests
    }

    if (stats?.retrain_triggers != null && stats.retrain_triggers !== prev.retrainTriggers && stats.retrain_triggers > 0) {
      addEntry({
        type: 'warn',
        message: 'Retraining was triggered',
        note: `Total retrain events: ${stats.retrain_triggers}`,
        ts: new Date().toISOString(),
      })
      prevRef.current.retrainTriggers = stats.retrain_triggers
    }

    if (driftScore != null && driftScore !== prev.driftScore) {
      const pct = (driftScore * 100).toFixed(1)
      if (driftScore >= driftCritical) {
        addEntry({
          type: 'error',
          message: 'Drift exceeded critical threshold',
          note: `Current score: ${pct}%`,
          ts: new Date().toISOString(),
        })
      } else if (driftScore >= driftWarning) {
        addEntry({
          type: 'warn',
          message: 'Drift exceeded warning threshold',
          note: `Current score: ${pct}%`,
          ts: new Date().toISOString(),
        })
      } else if (prev.driftScore == null || (prev.driftScore >= driftWarning && driftScore < driftWarning)) {
        addEntry({
          type: 'ok',
          message: 'Drift is back within normal range',
          note: `Current score: ${pct}%`,
          ts: new Date().toISOString(),
        })
      }
      prevRef.current.driftScore = driftScore
    }
  }, [stats, driftScore, modelInfo, addEntry, driftWarning, driftCritical])

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.type === filter)

  const counts = entries.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1
    return acc
  }, {})

  const recentWindowMs = 5 * 60 * 1000
  const recentEvents = entries.filter((entry) => {
    const ts = entry.ts ? Date.parse(entry.ts) : NaN
    return Number.isFinite(ts) && nowMs - ts <= recentWindowMs
  }).length

  const latestEventTs = entries.reduce((maxTs, entry) => {
    const ts = entry.ts ? Date.parse(entry.ts) : NaN
    if (!Number.isFinite(ts)) return maxTs
    return ts > maxTs ? ts : maxTs
  }, 0)
  const lastEventAge = latestEventTs > 0 ? formatAge(nowMs - latestEventTs) : '—'

  const grouped = groupEntries(filtered, nowMs)
  const hasTimeline = grouped.now.length > 0 || grouped.last15.length > 0 || grouped.earlier.length > 0

  const handleClear = () => setEntries(SYSTEM_ENTRIES)

  const handleCopy = () => {
    const text = filtered
      .map((e) => `[${e.ts ? new Date(e.ts).toLocaleTimeString('en-US', { hour12: false }) : 'startup'}] [${e.type.toUpperCase()}] ${e.message}${e.note ? ` - ${e.note}` : ''}`)
      .join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const driftStatus = getDriftStatusMeta(driftScore ?? 0, driftWarning, driftCritical)

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="typo-title text-text-primary">Activity Log</h1>
        <p className="typo-subtitle text-text-dimmed">System events and drift monitoring timeline</p>
      </div>

      <TooltipProvider delayDuration={180}>
      <div className="card card-glass overflow-hidden">
        <div className="grid lg:grid-cols-[1.1fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-dim)]">
          <div className="min-h-[220px] px-5 py-5 lg:px-7 lg:py-6 flex flex-col justify-center gap-3">
            <div className="flex items-center gap-1.5">
              <p className="typo-overline text-text-muted">System Pulse</p>
              <StatHint text="Current drift score and state against configured thresholds." />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <p className="typo-stat-lg" style={{ color: driftStatus.textColor }}>
                {`${((driftScore ?? 0) * 100).toFixed(1)}%`}
              </p>
              <div className="pb-1.5">
                <StatusBadge status={driftStatus} />
              </div>
            </div>
            <p className="typo-body-sm text-text-secondary max-w-xl">
              Last event {lastEventAge}. {recentEvents} events in the last 5 minutes.
            </p>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border-dim)]">
            <PulseCell
              label="Total Requests"
              value={stats?.total_requests?.toLocaleString() ?? '0'}
              helpText="Total number of transactions scored in this session."
            />
            <PulseCell
              label="Shadow Runs"
              value={String(stats?.shadow_runs ?? 0)}
              helpText="Requests also evaluated by the shadow model for comparison."
            />
            <PulseCell
              label="Warnings"
              value={String(counts.warn ?? 0)}
              tone="warning"
              helpText="Events where drift crossed the warning threshold."
            />
            <PulseCell
              label="Errors"
              value={String(counts.error ?? 0)}
              tone="critical"
              helpText="Events where drift crossed the critical threshold."
            />
          </div>
        </div>
      </div>
      </TooltipProvider>

      <div className="px-1 py-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border-dim bg-[var(--surface-frost-weak)] p-1">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant="tab"
              active={filter === f}
              onClick={() => setFilter(f)}
              className="!h-8 !px-2.5 capitalize"
            >
              {f === 'all' ? `${FILTER_LABELS[f]} (${entries.length})` : `${FILTER_LABELS[f]}${counts[f] ? ` (${counts[f]})` : ''}`}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClear} className="gap-1.5 text-text-muted hover:text-text-primary">
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      <div className="card card-glass overflow-hidden divide-y divide-[var(--border-dim)]">
        {!hasTimeline ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="typo-body text-text-muted">No {filter === 'all' ? '' : FILTER_LABELS[filter].toLowerCase() + ' '}entries yet.</p>
            {filter !== 'all' ? (
              <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>
                Show all entries
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <TimelineSection title="Now" entries={grouped.now} nowMs={nowMs} />
            <TimelineSection title="Last 15m" entries={grouped.last15} nowMs={nowMs} />
            <TimelineSection title="Earlier" entries={grouped.earlier} nowMs={nowMs} />
          </>
        )}
      </div>
    </div>
  )
}

const PulseCell = ({ label, value, tone = 'default', helpText }) => {
  const toneClass = tone === 'warning'
    ? 'text-accent-amber'
    : tone === 'critical'
      ? 'text-accent-crimson'
      : 'text-text-primary'

  return (
    <div className="min-h-[110px] px-5 py-4 lg:px-6 lg:py-5 flex flex-col justify-center">
      <div className="flex items-center gap-1.5">
        <p className="typo-overline text-text-muted">{label}</p>
        {helpText ? <StatHint text={helpText} /> : null}
      </div>
      <p className={cn('typo-stat-md mt-1', toneClass)}>{value}</p>
    </div>
  )
}

const StatHint = ({ text }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        aria-label="Stat description"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-dimmed hover:text-text-secondary transition-colors"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-[220px]">
      {text}
    </TooltipContent>
  </Tooltip>
)

const TimelineSection = ({ title, entries, nowMs }) => {
  if (entries.length === 0) return null

  return (
    <section>
      <div className="px-4 py-2.5 bg-[var(--surface-frost-weak)] border-b border-[var(--border-dim)]">
        <p className="typo-overline text-text-muted">{title} ({entries.length})</p>
      </div>
      {entries.map((entry) => (
        <LogRow key={entry.id} entry={entry} nowMs={nowMs} />
      ))}
    </section>
  )
}

const TYPE_ICON = {
  error: <AlertCircle className="h-3.5 w-3.5 text-[var(--accent-crimson-vibrant)]" />,
  warn: <AlertTriangle className="h-3.5 w-3.5 text-[var(--accent-amber-vibrant)]" />,
  ok: <CheckCircle2 className="h-3.5 w-3.5 text-[var(--accent-mint-vibrant)]" />,
  info: <Info className="h-3.5 w-3.5 text-[var(--accent-steel-vibrant)]" />,
  system: <Settings className="h-3.5 w-3.5 text-text-muted" />,
}

const TYPE_LABEL = {
  error: { text: 'ERROR', bg: 'var(--status-critical-bg)', color: 'var(--status-critical-fg)' },
  warn: { text: 'WARN', bg: 'var(--status-warning-bg)', color: 'var(--status-warning-fg)' },
  ok: { text: 'OK', bg: 'rgba(82,149,123,0.12)', color: 'var(--accent-mint-vibrant)' },
  info: { text: 'INFO', bg: 'rgba(80,120,160,0.12)', color: 'var(--accent-steel-vibrant)' },
  system: { text: 'SYS', bg: 'rgba(100,100,100,0.10)', color: 'var(--text-muted)' },
}

const ROW_TONE = {
  error: {
    bg: 'var(--status-critical-bg)',
    border: 'var(--status-critical-border)',
    messageClass: 'text-[var(--status-critical-fg)]',
  },
  warn: {
    bg: 'var(--status-warning-bg)',
    border: 'var(--status-warning-border)',
    messageClass: 'text-[var(--status-warning-fg)]',
  },
  ok: {
    bg: 'rgba(82,149,123,0.08)',
    border: 'rgba(82,149,123,0.30)',
    messageClass: 'text-text-primary',
  },
  info: {
    bg: 'rgba(80,120,160,0.06)',
    border: 'rgba(80,120,160,0.22)',
    messageClass: 'text-text-primary',
  },
  system: {
    bg: 'rgba(100,100,100,0.04)',
    border: 'rgba(100,100,100,0.18)',
    messageClass: 'text-text-primary',
  },
}

const LogRow = ({ entry, nowMs }) => {
  const ts = entry.ts ? Date.parse(entry.ts) : NaN
  const timeLabel = Number.isFinite(ts)
    ? new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'startup'
  const ageLabel = Number.isFinite(ts) ? formatAge(nowMs - ts) : '—'
  const badge = TYPE_LABEL[entry.type] ?? TYPE_LABEL.system
  const tone = ROW_TONE[entry.type] ?? ROW_TONE.system
  const rowBg =
    entry.type === 'error' || entry.type === 'warn'
      ? tone.bg
      : 'transparent'

  return (
    <div
      className="group grid grid-cols-[24px_1fr_auto] gap-3 px-4 py-3.5 border-b border-[var(--border-dim)] border-l-2 last:border-b-0 hover:bg-[var(--surface-hover)]/45 transition-colors"
      style={{ backgroundColor: rowBg, borderLeftColor: tone.border }}
    >
      <div className="flex items-start justify-center pt-1">
        {TYPE_ICON[entry.type] ?? TYPE_ICON.system}
      </div>

      <div className="min-w-0">
        <p className={cn('typo-body', tone.messageClass)}>{entry.message}</p>
        {entry.note && <p className="typo-body-sm text-text-muted mt-0.5">{entry.note}</p>}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="typo-caption text-text-dimmed">{ageLabel}</span>
        <span className="typo-overline px-1.5 py-0.5 rounded-md" style={{ backgroundColor: badge.bg, color: badge.color }}>
          {badge.text}
        </span>
        <span className="typo-mono-sm text-text-muted w-16 text-right">{timeLabel}</span>
      </div>
    </div>
  )
}

function groupEntries(entries, nowMs) {
  const now = []
  const last15 = []
  const earlier = []

  entries.forEach((entry) => {
    const ts = entry.ts ? Date.parse(entry.ts) : NaN
    if (!Number.isFinite(ts)) {
      earlier.push(entry)
      return
    }

    const age = nowMs - ts
    if (age <= 2 * 60 * 1000) {
      now.push(entry)
    } else if (age <= 15 * 60 * 1000) {
      last15.push(entry)
    } else {
      earlier.push(entry)
    }
  })

  return { now, last15, earlier }
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
