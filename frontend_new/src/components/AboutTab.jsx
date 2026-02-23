import React from 'react'
import {
  Activity,
  BarChart2,
  Cpu,
  GitCommit,
  LineChart,
  RefreshCw,
  Server,
  Shield,
} from 'lucide-react'

const CAPABILITY_CARDS = [
  {
    name: 'Scoring API',
    icon: Server,
    detail: 'FastAPI inference endpoint with schema validation and policy actions.',
  },
  {
    name: 'Conformal Safety',
    icon: Shield,
    detail: 'Prediction sets and explicit coverage guarantees for uncertain traffic.',
  },
  {
    name: 'Drift Monitoring',
    icon: Activity,
    detail: 'PSI + KS drift signals with soft and hard threshold tracking.',
  },
  {
    name: 'Retrain Triggering',
    icon: GitCommit,
    detail: 'Automatic and manual retrain requests with cooldown and backlog limits.',
  },
  {
    name: 'Shadow Evaluation',
    icon: BarChart2,
    detail: 'Active vs shadow disagreement telemetry for safer promotions.',
  },
  {
    name: 'Model Registry',
    icon: Cpu,
    detail: 'Versioned active, shadow, and rollback pointers for safe model lifecycle.',
  },
  {
    name: 'Metrics Pipeline',
    icon: LineChart,
    detail: 'Prometheus-backed latency, drift, action, and disagreement telemetry.',
  },
  {
    name: 'Rollback Controls',
    icon: RefreshCw,
    detail: 'Controlled rollback path to the last known-good production model.',
  },
  {
    name: 'Ops Dashboards',
    icon: BarChart2,
    detail: 'Grafana dashboards for live observability and incident response.',
  },
]

const STACK_ROWS = [
  { layer: 'Backend', runtime: 'FastAPI + Python 3.12', role: 'REST API and service orchestration.' },
  { layer: 'Model', runtime: 'XGBoost + Isotonic calibration', role: 'Fraud scoring with calibrated confidence.' },
  { layer: 'Monitoring', runtime: 'Prometheus + Grafana', role: 'Metrics storage, dashboarding, and alerting.' },
  { layer: 'Frontend', runtime: 'React 18 + Vite + Tailwind', role: 'Operator console with live polling.' },
  { layer: 'Infrastructure', runtime: 'Docker Compose', role: 'Multi-service runtime orchestration.' },
]

export default function AboutTab({ stats, modelInfo, driftScore, coverageGuarantee }) {
  const modelVersion = stats?.model_version ?? modelInfo?.active?.model_id ?? 'N/A'
  const retrainCount = stats?.retrain_triggers ?? 0
  const driftPercent = driftScore != null ? `${(driftScore * 100).toFixed(1)}` : '—'
  const coveragePercent = coverageGuarantee != null ? `${(coverageGuarantee * 100).toFixed(1)}` : '—'
  const soft = modelInfo?.active?.drift_threshold_soft ?? 0.5
  const hard = modelInfo?.active?.drift_threshold_hard ?? 0.7
  const driftState = getDriftState(driftScore, soft, hard)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="typo-title text-text-primary">About</h1>
        <p className="typo-subtitle text-text-dimmed mt-1">System architecture and operational model</p>
      </div>

      <div className="card card-glass p-6">
        <div className="flex items-center gap-2.5 mb-3">
          <Shield className="h-4 w-4 text-accent-mint shrink-0" />
          <span className="typo-overline text-text-muted">Mission</span>
        </div>
        <h2 className="typo-body font-semibold text-text-primary text-[1.35rem] leading-tight">
          Reliable fraud decisions as production traffic shifts.
        </h2>
        <p className="typo-body-sm text-text-secondary mt-2 max-w-4xl leading-relaxed">
          DriftShield combines scoring, drift monitoring, observability, and retraining controls so teams can detect
          instability early and respond with clear, measurable guardrails.
        </p>
      </div>

      <div className="card card-glass grid grid-cols-4 divide-x divide-white/[0.07]">
        <StatCell label="Live Model Version" value={modelVersion} note="Current production model" mono />
        <StatCell label="Current Drift" value={driftPercent} unit="%" note={driftState.label} tone={driftState.tone} />
        <StatCell label="Coverage Guarantee" value={coveragePercent} unit="%" note="Conformal target" tone="stable" />
        <StatCell label="Retrain Triggers" value={String(retrainCount)} note="Total retrain events" />
      </div>

      <div className="card card-glass p-5 flex flex-col gap-4">
        <SectionHeading icon={BarChart2} label="Capability Grid" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {CAPABILITY_CARDS.map((capability) => (
            <div key={capability.name} className="panel-subtle rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <capability.icon className="h-4 w-4 text-accent-steel shrink-0" />
                <span className="typo-overline text-text-secondary">{capability.name}</span>
              </div>
              <p className="typo-body-sm text-text-muted leading-relaxed">{capability.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card card-glass p-5">
        <SectionHeading icon={Cpu} label="Technology Map" />
        <div className="mt-4 divide-y divide-[var(--border-dim)]">
          {STACK_ROWS.map((row) => (
            <div key={row.layer} className="py-3 first:pt-0 last:pb-0 md:grid md:grid-cols-[140px_280px_1fr] md:gap-3">
              <p className="typo-overline text-text-muted">{row.layer}</p>
              <p className="typo-body-sm font-semibold text-text-primary mt-1 md:mt-0">{row.runtime}</p>
              <p className="typo-body-sm text-text-secondary mt-1 md:mt-0">{row.role}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SectionHeading({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 text-accent-steel shrink-0" />
      <span className="typo-overline text-text-muted">{label}</span>
    </div>
  )
}

function StatCell({ label, value, unit, note, tone = 'default', mono = false }) {
  const toneClass = toneToClass(tone)
  return (
    <div className="px-5 py-4">
      <span className="typo-overline text-text-muted">{label}</span>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={mono ? `font-mono text-lg ${toneClass}` : `typo-stat-md ${toneClass}`}>{value}</span>
        {unit && <span className="typo-overline text-text-secondary">{unit}</span>}
      </div>
      <p className="typo-caption text-text-muted mt-1">{note}</p>
    </div>
  )
}

function toneToClass(tone) {
  if (tone === 'critical') return 'text-accent-crimson'
  if (tone === 'warning') return 'text-accent-amber'
  if (tone === 'stable') return 'text-accent-mint'
  return 'text-text-primary'
}

function getDriftState(driftScore, softLimit, hardLimit) {
  if (driftScore == null) return { label: 'Awaiting telemetry', tone: 'default' }

  const soft = softLimit <= 1 ? softLimit : softLimit / 100
  const hard = hardLimit <= 1 ? hardLimit : hardLimit / 100

  if (driftScore >= hard) return { label: 'Hard threshold breached', tone: 'critical' }
  if (driftScore >= soft) return { label: 'Soft threshold warning', tone: 'warning' }
  return { label: 'Within threshold', tone: 'stable' }
}
