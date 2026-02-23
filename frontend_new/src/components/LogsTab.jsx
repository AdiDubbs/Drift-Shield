import React, { useState, useEffect, useRef, useCallback } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Settings, Trash2, Copy, Check } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

// Static system entries seeded at session start
const SESSION_START = new Date().toISOString()
const SYSTEM_ENTRIES = [
  { id: 'sys-0', type: 'system', message: 'Model drift monitor polling', note: 'Every 5 s', ts: SESSION_START },
  { id: 'sys-1', type: 'system', message: 'Conformal prediction calibrated', note: 'On startup', ts: SESSION_START },
  { id: 'sys-2', type: 'system', message: 'Prometheus metrics endpoint active', note: '/metrics', ts: SESSION_START },
]

const FILTERS = ['all', 'error', 'warn', 'info', 'system']

export default function LogsTab({ stats, driftScore, modelInfo }) {
  const [entries, setEntries] = useState(SYSTEM_ENTRIES)
  const [filter, setFilter] = useState('all')
  const [copied, setCopied] = useState(false)

  // Track previous prop values to avoid duplicate entries
  const prevRef = useRef({ driftScore: null, totalRequests: null, retrainTriggers: null, modelId: null })

  const addEntry = useCallback((entry) => {
    setEntries((prev) => [{ ...entry, id: `${entry.type}-${Date.now()}-${Math.random()}` }, ...prev])
  }, [])

  // Append new events only when values actually change
  useEffect(() => {
    const prev = prevRef.current

    if (modelInfo?.active?.model_id && modelInfo.active.model_id !== prev.modelId) {
      addEntry({ type: 'info', message: `Active model loaded: ${modelInfo.active.model_id}`, ts: new Date().toISOString() })
      prevRef.current.modelId = modelInfo.active.model_id
    }

    if (stats?.total_requests != null && stats.total_requests !== prev.totalRequests) {
      addEntry({ type: 'info', message: `Request count updated: ${stats.total_requests.toLocaleString()} total`, ts: new Date().toISOString() })
      prevRef.current.totalRequests = stats.total_requests
    }

    if (stats?.retrain_triggers != null && stats.retrain_triggers !== prev.retrainTriggers && stats.retrain_triggers > 0) {
      addEntry({ type: 'warn', message: `Retrain triggered (${stats.retrain_triggers} total)`, ts: new Date().toISOString() })
      prevRef.current.retrainTriggers = stats.retrain_triggers
    }

    if (driftScore != null && driftScore !== prev.driftScore) {
      const pct = (driftScore * 100).toFixed(1)
      if (driftScore >= 0.7) {
        addEntry({ type: 'error', message: `Hard drift threshold breached — score ${pct}%`, ts: new Date().toISOString() })
      } else if (driftScore >= 0.5) {
        addEntry({ type: 'warn', message: `Soft drift threshold exceeded — score ${pct}%`, ts: new Date().toISOString() })
      } else if (prev.driftScore == null || (prev.driftScore >= 0.5 && driftScore < 0.5)) {
        addEntry({ type: 'ok', message: `Drift within bounds — score ${pct}%`, ts: new Date().toISOString() })
      }
      prevRef.current.driftScore = driftScore
    }
  }, [stats, driftScore, modelInfo, addEntry])

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.type === filter)

  const handleClear = () => setEntries(SYSTEM_ENTRIES)

  const handleCopy = () => {
    const text = filtered
      .map((e) => `[${e.ts ? new Date(e.ts).toLocaleTimeString('en-US', { hour12: false }) : 'startup'}] [${e.type.toUpperCase()}] ${e.message}${e.note ? ` — ${e.note}` : ''}`)
      .join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const driftStatus = driftScore >= 0.7 ? 'ALERT' : driftScore >= 0.5 ? 'WARN' : 'NOMINAL'
  const driftStatusColor =
    driftScore >= 0.7 ? { bg: 'rgba(152,96,96,0.12)', color: 'var(--accent-crimson-vibrant)' } :
    driftScore >= 0.5 ? { bg: 'rgba(180,140,80,0.12)', color: 'var(--accent-amber-vibrant)' } :
    { bg: 'rgba(82,149,123,0.12)', color: 'var(--accent-mint-vibrant)' }

  const counts = entries.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="typo-title text-text-primary">Activity Log</h1>
        <p className="typo-subtitle text-text-dimmed mt-1">System events and drift monitoring timeline</p>
      </div>

      <div className="card card-glass grid grid-cols-4 divide-x divide-white/[0.07]">
        <StatPill label="Total requests" value={stats?.total_requests?.toLocaleString() ?? '0'} />
        <StatPill label="Retrain triggers" value={stats?.retrain_triggers ?? '0'} />
        <StatPill label="Shadow runs" value={stats?.shadow_runs ?? '0'} />
        <div className="flex flex-col gap-1 px-5 py-4">
          <span className="typo-overline text-text-muted">Drift score</span>
          <div className="flex items-baseline gap-2">
            <span
              className="typo-stat-md"
              style={{ color: driftStatusColor.color }}
            >
              {`${((driftScore ?? 0) * 100).toFixed(1)}%`}
            </span>
            <span
              className="typo-overline px-1.5 py-0.5 rounded-md"
              style={{ backgroundColor: driftStatusColor.bg, color: driftStatusColor.color }}
            >
              {driftStatus}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-0.5 rounded-full border border-border-dim bg-secondary p-0.5">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant="tab"
              active={filter === f}
              onClick={() => setFilter(f)}
              className="!px-3 !py-1 capitalize"
            >
              {f === 'all' ? `All (${entries.length})` : `${f}${counts[f] ? ` (${counts[f]})` : ''}`}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
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

      <div className="card card-glass divide-y divide-[var(--border-dim)]">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center p-8 typo-body text-text-muted">
            No {filter === 'all' ? '' : filter + ' '}entries.
          </div>
        ) : filtered.map((entry) => (
          <LogRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}

const StatPill = ({ label, value, valueClass }) => (
  <div className="flex flex-col gap-1 px-5 py-4">
    <span className="typo-overline text-text-muted">{label}</span>
    <span className={cn('typo-stat-md', valueClass ?? 'text-text-primary')}>
      {value}
    </span>
  </div>
)

const TYPE_ICON = {
  error: <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--accent-crimson-vibrant)]" />,
  warn:  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--accent-amber-vibrant)]" />,
  ok:    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--accent-mint-vibrant)]" />,
  info:  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--accent-steel-vibrant)]" />,
  system:<Settings className="h-3.5 w-3.5 shrink-0 mt-0.5 text-text-muted" />,
}

const TYPE_LABEL = {
  error: { text: 'ERROR',  bg: 'rgba(152,96,96,0.12)',   color: 'var(--accent-crimson-vibrant)' },
  warn:  { text: 'WARN',   bg: 'rgba(180,140,80,0.12)',  color: 'var(--accent-amber-vibrant)' },
  ok:    { text: 'OK',     bg: 'rgba(82,149,123,0.12)',  color: 'var(--accent-mint-vibrant)' },
  info:  { text: 'INFO',   bg: 'rgba(80,120,160,0.12)',  color: 'var(--accent-steel-vibrant)' },
  system:{ text: 'SYS',   bg: 'rgba(100,100,100,0.10)', color: 'var(--text-muted)' },
}

const LogRow = ({ entry }) => {
  const ts = entry.ts
    ? new Date(entry.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'startup'
  const badge = TYPE_LABEL[entry.type] ?? TYPE_LABEL.system
  const rowTint = (
    entry.type === 'error' ? 'rgba(152,96,96,0.095)'
      : entry.type === 'warn' ? 'rgba(180,140,80,0.08)'
      : entry.type === 'ok' ? 'rgba(82,149,123,0.08)'
      : entry.type === 'info' ? 'rgba(80,120,160,0.08)'
      : 'rgba(100,100,100,0.06)'
  )

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-highlight,rgba(255,255,255,0.03))] transition-colors"
      style={{ backgroundColor: rowTint }}
    >
      {TYPE_ICON[entry.type] ?? TYPE_ICON.system}
      <div className="min-w-0 flex-1">
        <p className="typo-body text-text-primary">{entry.message}</p>
        {entry.note && <p className="typo-body-sm text-text-muted mt-0.5">{entry.note}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="typo-overline px-1.5 py-0.5 rounded-md"
          style={{ backgroundColor: badge.bg, color: badge.color }}
        >
          {badge.text}
        </span>
        <span className="typo-mono-sm text-text-muted w-16 text-right">{ts}</span>
      </div>
    </div>
  )
}
