import React, { useState } from 'react'
import { Send, RotateCcw, AlertTriangle, CheckCircle, ChevronRight, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/utils'
import { apiClient } from '../api/client'
import { Button } from './ui/button'


const FIELD_GROUPS = [
  {
    label: 'Transaction',
    fields: [
      { key: 'TransactionAmt', label: 'Amount ($)', type: 'number' },
      { key: 'dist1', label: 'Distance', type: 'number' },
    ],
  },
  {
    label: 'Match Flags',
    fields: [
      { key: 'M1', label: 'M1', type: 'select', options: ['T', 'F'] },
      { key: 'M2', label: 'M2', type: 'select', options: ['T', 'F'] },
      { key: 'M3', label: 'M3', type: 'select', options: ['T', 'F'] },
    ],
  },
]

const MODEL_BASE_FEATURES = {
  V1: 0.0, V2: 0.0, V3: 0.0, V4: 0.0, V5: 0.0, V6: 0.0, V7: 0.0,
  V8: 0.0, V9: 0.0, V10: 0.0, V11: 0.0, V12: 0.0, V13: 0.0, V14: 0.0,
  V15: 0.0, V16: 0.0, V17: 0.0, V18: 0.0, V19: 0.0, V20: 0.0, V21: 0.0,
  V22: 0.0, V23: 0.0, V24: 0.0, V25: 0.0, V26: 0.0, V27: 0.0, V28: 0.0,
  Amount: 100.5,
}

const DEFAULT_TX = {
  TransactionAmt: 100.5,
  dist1: 0,
  M1: 'T', M2: 'T', M3: 'T',
}


const PRESETS = [
  {
    label: 'Low Risk',
    tx: { ...DEFAULT_TX },
  },
  {
    label: 'High Value',
    tx: { ...DEFAULT_TX, TransactionAmt: 4999.99 },
  },
  {
    label: 'Distance Spike',
    tx: { ...DEFAULT_TX, dist1: 320 },
  },
  {
    label: 'Flag Mismatch',
    tx: { ...DEFAULT_TX, M1: 'F', M2: 'F', M3: 'F' },
  },
]

const NUMERIC_FIELDS = new Set(['TransactionAmt', 'dist1'])
const ADVANCED_OVERRIDE_FIELDS = [
  { key: 'Amount', label: 'Amount override', hint: 'Overrides mapped Amount feature.' },
  { key: 'V4', label: 'V4 override', hint: 'Distance proxy feature.' },
  { key: 'V10', label: 'V10 override', hint: 'M1 flag-derived feature.' },
  { key: 'V14', label: 'V14 override', hint: 'M2 flag-derived feature.' },
  { key: 'V17', label: 'V17 override', hint: 'M3 flag-derived feature.' },
]

export default function TestPanel() {
  const [features, setFeatures] = useState(DEFAULT_TX)
  const [overridesOpen, setOverridesOpen] = useState(false)
  const [overrides, setOverrides] = useState({})
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])

  const handleChange = (key, value) => {
    if (NUMERIC_FIELDS.has(key)) {
      setFeatures((prev) => ({ ...prev, [key]: value === '' ? '' : Number(value) }))
      return
    }
    setFeatures((prev) => ({ ...prev, [key]: value }))
  }

  const toModelPayload = (tx) => {
    const amount = Number(tx.TransactionAmt)
    const dist = Number(tx.dist1)
    const mapped = {
      ...MODEL_BASE_FEATURES,
      Amount: Number.isFinite(amount) ? amount : MODEL_BASE_FEATURES.Amount,
      V4: Number.isFinite(dist) ? dist / 100 : 0,
      V10: tx.M1 === 'F' ? 1.0 : 0.0,
      V14: tx.M2 === 'F' ? -1.0 : 0.0,
      V17: tx.M3 === 'F' ? 1.0 : 0.0,
    }
    const merged = { ...mapped }
    Object.entries(overrides).forEach(([key, raw]) => {
      const parsed = Number(raw)
      if (raw !== '' && Number.isFinite(parsed)) {
        merged[key] = parsed
      }
    })
    return merged
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const payload = toModelPayload(features)
      const res = await apiClient.predict(payload)
      setResult(res)
      setHistory((prev) => [
        { ts: new Date(), result: res, amt: features.TransactionAmt },
        ...prev.slice(0, 4),
      ])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const resetFeatures = () => {
    setFeatures(DEFAULT_TX)
    setOverrides({})
    setOverridesOpen(false)
    setResult(null)
    setError(null)
  }

  const action = result?.action_code ?? ''
  const hasDefinitivePrediction = typeof result?.prediction === 'string' && result.prediction.length > 0
  const isFallbackOrAbstain = action === 'ACTION_FALLBACK' || action === 'ACTION_ABSTAIN' || !hasDefinitivePrediction
  const isFraud = result?.prediction === 1 || String(result?.prediction ?? '').toLowerCase() === 'fraud'
  const hasFraudProbability = typeof result?.p_fraud === 'number' && Number.isFinite(result.p_fraud)
  const pFraud = result?.p_fraud ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="typo-title text-text-primary">Transaction Testing</h1>
        <p className="typo-subtitle text-text-dimmed mt-1">Submit a transaction to get a live fraud prediction</p>
        <p className="typo-caption text-text-dimmed mt-2">
          Start with basic inputs. Expand advanced controls only when you need precise feature overrides.
        </p>
      </div>

      <div className={cn('grid gap-8', result || error ? 'grid-cols-[1fr_400px]' : 'grid-cols-1')}>
        <div className="card card-glass p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="typo-overline text-text-secondary">Transaction Features</h2>
            <Button onClick={resetFeatures} variant="secondary" size="sm" className="gap-1.5">
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="typo-overline text-text-muted shrink-0">Preset:</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { setFeatures(p.tx); setResult(null); setError(null) }}
                  className="rounded-full border border-border-dim bg-[var(--surface-frost-weak)] min-h-11 px-3.5 typo-body-sm text-text-secondary hover:text-text-primary hover:border-border-medium transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6 max-h-[540px] overflow-y-auto scrollbar-thin pr-1">
            {FIELD_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="typo-overline text-text-muted mb-3 pb-1.5 border-b border-border-dim">{group.label}</p>
                <div className="grid grid-cols-3 gap-x-4 gap-y-4">
                  {group.fields.map(({ key, label, type, options }) => (
                    <div key={key} className="space-y-1.5">
                      <label htmlFor={`tx-field-${key}`} className="typo-overline text-text-muted">{label}</label>
                      {type === 'select' ? (
                        <select
                          id={`tx-field-${key}`}
                          value={features[key]}
                          onChange={(e) => handleChange(key, e.target.value)}
                          className="w-full rounded-md border border-border-dim bg-background px-2.5 py-1.5 typo-body text-text-primary outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)] transition-colors"
                        >
                          {options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          id={`tx-field-${key}`}
                          type={type}
                          value={features[key]}
                          onChange={(e) => handleChange(key, e.target.value)}
                          className="w-full rounded-md border border-border-dim bg-background px-2.5 py-1.5 typo-body text-text-primary placeholder-[var(--text-muted)] outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)] transition-colors"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="rounded-xl border border-border-dim bg-[var(--surface-frost-weak)] p-3">
              <button
                type="button"
                onClick={() => setOverridesOpen((v) => !v)}
                className="w-full min-h-11 flex items-center justify-between gap-2"
                aria-expanded={overridesOpen}
                aria-controls="advanced-overrides-panel"
              >
                <span className="typo-overline text-text-secondary">Advanced model feature overrides</span>
                {overridesOpen ? <ChevronUp className="h-4 w-4 text-text-muted" /> : <ChevronDown className="h-4 w-4 text-text-muted" />}
              </button>
              <p className="typo-caption text-text-dimmed mt-1">
                Overrides can force edge-case simulations and may increase drift/retrain pressure.
              </p>
              {overridesOpen ? (
                <div id="advanced-overrides-panel" className="mt-3 space-y-3">
                  {ADVANCED_OVERRIDE_FIELDS.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <label htmlFor={`override-field-${field.key}`} className="typo-overline text-text-muted">{field.label}</label>
                      <input
                        id={`override-field-${field.key}`}
                        type="number"
                        value={overrides[field.key] ?? ''}
                        onChange={(e) => setOverrides((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        className="w-full rounded-md border border-border-dim bg-background px-2.5 py-1.5 typo-body text-text-primary placeholder-[var(--text-muted)] outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)] transition-colors"
                        placeholder="Leave blank to use mapped value"
                      />
                      <p className="typo-caption text-text-dimmed">{field.hint}</p>
                    </div>
                  ))}
                  <div className="flex justify-end">
                    <Button variant="secondary" size="sm" onClick={() => setOverrides({})}>
                      Clear overrides
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Predicting…
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Run Prediction
              </>
            )}
          </Button>
        </div>

        {(result || error) && <div className="space-y-5">
          {error && (
            <div className="card card-glass border-crimson bg-crimson-subtle p-4 typo-body text-accent-crimson">
              <div className="flex items-center gap-2 mb-1 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Prediction failed
              </div>
              <p className="typo-body-sm opacity-80">{error}</p>
              <div className="mt-3">
                <Button variant="secondary" size="sm" onClick={handleSubmit} disabled={loading}>
                  Retry prediction
                </Button>
              </div>
            </div>
          )}

          {result && (
            <>
              <div className={cn(
                'card card-glass p-6 text-center space-y-2',
                isFallbackOrAbstain
                  ? 'border-amber bg-amber-subtle'
                  : isFraud
                    ? 'border-crimson bg-crimson-subtle'
                    : 'border-mint bg-mint-subtle'
              )}>
                {isFallbackOrAbstain
                  ? <AlertTriangle className="h-7 w-7 text-accent-amber mx-auto" />
                  : isFraud
                    ? <AlertTriangle className="h-7 w-7 text-accent-crimson mx-auto" />
                    : <CheckCircle className="h-7 w-7 text-accent-mint mx-auto" />
                }
                <p className={cn(
                  'typo-title',
                  isFallbackOrAbstain
                    ? 'text-accent-amber'
                    : isFraud
                      ? 'text-accent-crimson'
                      : 'text-accent-mint'
                )}>
                  {isFallbackOrAbstain ? 'No Definitive Prediction' : isFraud ? 'Fraud Detected' : 'Legitimate'}
                </p>
                <p className="typo-body-sm text-text-muted">{result.action_code ?? 'PASS'}</p>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="typo-overline text-text-muted">Fraud probability</span>
                    <span className="typo-overline font-semibold" style={{
                      color: pFraud >= 0.7 ? 'var(--accent-crimson-vibrant)' : pFraud >= 0.4 ? 'var(--accent-amber-vibrant)' : 'var(--accent-mint-vibrant)'
                    }}>
                      {hasFraudProbability ? `${(pFraud * 100).toFixed(2)}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[var(--surface)]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(pFraud * 100, 100)}%`,
                        backgroundColor: pFraud >= 0.7 ? 'var(--accent-crimson-vibrant)' : pFraud >= 0.4 ? 'var(--accent-amber-vibrant)' : 'var(--accent-mint-vibrant)',
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="card card-glass divide-y divide-[var(--border-dim)]">
                <ResultRow label="Coverage" value={result.coverage != null ? `${(result.coverage * 100).toFixed(1)}%` : '—'} />
                <ResultRow label="Model Version" value={result.model_version ?? '—'} />
                {result.prediction_set && (
                  <ResultRow
                    label="Prediction Set"
                    value={result.prediction_set.join(' · ')}
                    valueClass={result.prediction_set.length > 1 ? 'text-accent-amber' : 'text-accent-mint'}
                  />
                )}
              </div>

              {result.drift && (
                <div className="card card-glass p-5 space-y-3">
                  <p className="typo-overline text-text-muted">Drift Signal</p>
                  <ResultRow label="Score" value={`${((result.drift.drift_score ?? 0) * 100).toFixed(1)}%`} />
                  <ResultRow label="Soft drift" value={result.drift.soft_drift ? 'Yes' : 'No'} />
                  <ResultRow label="Hard drift" value={result.drift.hard_drift ? 'Yes' : 'No'} />
                  {result.drift.top_drifted_features?.length > 0 && (
                    <div className="mt-2">
                      <p className="typo-overline text-text-muted mb-1.5">Top drifted features</p>
                      <div className="flex flex-wrap gap-1">
                        {result.drift.top_drifted_features.map((f) => (
                          <span key={f} className="rounded border border-steel bg-steel-subtle px-1.5 py-0.5 typo-caption text-accent-steel">{f}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {result.reasons?.length > 0 && (
                <div className="card card-glass p-5 space-y-3">
                  <p className="typo-overline text-text-muted">Decision Reasons</p>
                  <ul className="space-y-2">
                    {result.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 typo-body-sm text-text-muted">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5 text-text-dimmed" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {history.length > 0 && (
            <div className="card card-glass divide-y divide-[var(--border-dim)]">
              <div className="px-4 py-2.5">
                <p className="typo-overline text-text-muted flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Recent predictions
                </p>
              </div>
              {history.map((h, i) => {
                const hFraud = h.result?.prediction === 1 || String(h.result?.prediction ?? '').toLowerCase() === 'fraud'
                const hHasP = typeof h.result?.p_fraud === 'number' && Number.isFinite(h.result.p_fraud)
                const hP = h.result?.p_fraud ?? 0
                return (
                  <div key={i} className="flex items-center justify-between px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{
                        backgroundColor: hFraud ? 'var(--accent-crimson-vibrant)' : 'var(--accent-mint-vibrant)'
                      }} />
                      <span className="typo-body-sm text-text-muted">${Number(h.amt).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="typo-mono-sm" style={{
                        color: hFraud ? 'var(--accent-crimson-vibrant)' : 'var(--accent-mint-vibrant)'
                      }}>
                        {hHasP ? `${(hP * 100).toFixed(1)}%` : 'N/A'}
                      </span>
                      <span className="typo-mono-sm text-text-dimmed">
                        {h.ts.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>}
      </div>
    </div>
  )
}

const ResultRow = ({ label, value, valueClass }) => (
  <div className="flex items-center justify-between px-4 py-3">
    <span className="typo-body-sm text-text-muted">{label}</span>
    <span className={cn('typo-body text-text-primary', valueClass)}>{value}</span>
  </div>
)
