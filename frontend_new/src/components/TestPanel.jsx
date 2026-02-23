import React, { useState } from 'react'
import { Send, RotateCcw, AlertTriangle, CheckCircle, ChevronRight, Clock } from 'lucide-react'
import { cn } from '../lib/utils'
import { apiClient } from '../api/client'
import { Button } from './ui/button'


const FIELD_GROUPS = [
  {
    label: 'Transaction',
    fields: [
      { key: 'TransactionAmt', label: 'Amount ($)', type: 'number' },
      { key: 'ProductCD', label: 'Product Code', type: 'select', options: ['W', 'H', 'C', 'S', 'R'] },
      { key: 'card4', label: 'Card Network', type: 'select', options: ['visa', 'mastercard', 'discover', 'american express'] },
      { key: 'card6', label: 'Card Type', type: 'select', options: ['debit', 'credit', 'charge card'] },
    ],
  },
  {
    label: 'Identity',
    fields: [
      { key: 'P_emaildomain', label: 'Purchaser Email', type: 'text' },
      { key: 'R_emaildomain', label: 'Recipient Email', type: 'text' },
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
  ProductCD: 'W',
  card4: 'visa',
  card6: 'debit',
  P_emaildomain: 'gmail.com',
  R_emaildomain: 'gmail.com',
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
    tx: { ...DEFAULT_TX, TransactionAmt: 4999.99, card6: 'credit', dist1: 180 },
  },
  {
    label: 'Email Mismatch',
    tx: { ...DEFAULT_TX, P_emaildomain: 'protonmail.com', R_emaildomain: 'yahoo.com', M1: 'F', M2: 'F' },
  },
  {
    label: 'Suspicious',
    tx: { ...DEFAULT_TX, TransactionAmt: 1499, dist1: 320, M3: 'F', card4: 'discover' },
  },
]


export default function TestPanel() {
  const [features, setFeatures] = useState(DEFAULT_TX)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])

  const handleChange = (key, value) => {
    setFeatures((prev) => ({ ...prev, [key]: isNaN(Number(value)) || value === '' ? value : Number(value) }))
  }

  const toModelPayload = (tx) => {
    const amount = Number(tx.TransactionAmt)
    const dist = Number(tx.dist1)
    return {
      ...MODEL_BASE_FEATURES,
      Amount: Number.isFinite(amount) ? amount : MODEL_BASE_FEATURES.Amount,
      V4: Number.isFinite(dist) ? dist / 100 : 0,
      V10: tx.M1 === 'F' ? 1.0 : 0.0,
      V14: tx.M2 === 'F' ? -1.0 : 0.0,
      V17: tx.M3 === 'F' ? 1.0 : 0.0,
    }
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

  const resetFeatures = () => { setFeatures(DEFAULT_TX); setResult(null); setError(null) }

  const isFraud = result?.prediction === 1 || result?.prediction === 'fraud'
  const pFraud = result?.p_fraud ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="typo-title text-text-primary">Transaction Testing</h1>
        <p className="typo-subtitle text-text-dimmed mt-1">Submit a transaction to get a live fraud prediction</p>
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
                  onClick={() => { setFeatures(p.tx); setResult(null); setError(null) }}
                  className="rounded-full border border-border-dim bg-[var(--surface-frost-weak)] px-2.5 py-1 typo-body-sm text-text-secondary hover:text-text-primary hover:border-border-medium transition-colors"
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
                      <label className="typo-overline text-text-muted">{label}</label>
                      {type === 'select' ? (
                        <select
                          value={features[key]}
                          onChange={(e) => handleChange(key, e.target.value)}
                          className="w-full rounded-md border border-border-dim bg-background px-2.5 py-1.5 typo-body text-text-primary outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)] transition-colors"
                        >
                          {options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
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
            </div>
          )}

          {result && (
            <>
              <div className={cn(
                'card card-glass p-6 text-center space-y-2',
                isFraud ? 'border-crimson bg-crimson-subtle' : 'border-mint bg-mint-subtle'
              )}>
                {isFraud
                  ? <AlertTriangle className="h-7 w-7 text-accent-crimson mx-auto" />
                  : <CheckCircle className="h-7 w-7 text-accent-mint mx-auto" />
                }
                <p className={cn('typo-title', isFraud ? 'text-accent-crimson' : 'text-accent-mint')}>
                  {isFraud ? 'Fraud Detected' : 'Legitimate'}
                </p>
                <p className="typo-body-sm text-text-muted">{result.action_code ?? 'PASS'}</p>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="typo-overline text-text-muted">Fraud probability</span>
                    <span className="typo-overline font-semibold" style={{
                      color: pFraud >= 0.7 ? 'var(--accent-crimson-vibrant)' : pFraud >= 0.4 ? 'var(--accent-amber-vibrant)' : 'var(--accent-mint-vibrant)'
                    }}>
                      {(pFraud * 100).toFixed(2)}%
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
                const hFraud = h.result?.prediction === 1 || h.result?.prediction === 'fraud'
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
                        {(hP * 100).toFixed(1)}%
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
