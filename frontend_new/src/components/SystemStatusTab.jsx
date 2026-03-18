import React, { useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Database,
  GitBranch,
  Hourglass,
  Info,
  Layers,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from './ui/button'
import {
  CHART_AXIS_TICK,
  CHART_COMMON,
  CHART_GRID_STROKE,
  ChartCard,
  ChartStatePane,
  CustomTooltip,
  formatModelVersion,
  LINE_COLORS,
  getDriftStatusMeta,
  StatusBadge,
} from './shared'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const TELEMETRY_STALE_THRESHOLD_SECONDS = 12

const NO_DATA = '—'

/* ── Formatting helpers ────────────────────────────────────────────── */

const asFixed = (value, digits = 4) => {
  const n = Number(value)
  if (value == null || Number.isNaN(n)) return NO_DATA
  return n.toFixed(digits)
}

const asInt = (value) => {
  const n = Number(value)
  if (value == null || Number.isNaN(n)) return NO_DATA
  return String(Math.round(n))
}

const fmtAge = (seconds) => {
  if (seconds == null || Number.isNaN(Number(seconds))) return null
  const s = Math.round(Number(seconds))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`
  return `${Math.floor(s / 3600)}h ago`
}

const fmtTs = (ts) => {
  if (!ts) return NO_DATA
  try { return new Date(Number(ts) * 1000).toLocaleString() } catch { return NO_DATA }
}

/* ── Layout primitives ─────────────────────────────────────────────── */

const SectionLabel = ({ children }) => (
  <div className="flex items-center gap-2 mt-6 mb-2">
    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
      {children}
    </span>
    <div className="flex-1 h-px bg-border/40" />
  </div>
)

const PanelCard = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-border/60 bg-card/70 backdrop-blur-sm p-4 ${className}`}>
    {children}
  </div>
)

const CardHeader = ({ icon: Icon, title, badge, action }) => (
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2">
      {Icon && <Icon size={14} className="text-muted-foreground" />}
      <span className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">{title}</span>
      {badge && <span className="ml-1">{badge}</span>}
    </div>
    {action}
  </div>
)

const KVPair = ({ label, value, mono = true }) => (
  <div className="flex items-center justify-between gap-4 py-[3px]">
    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{label}</span>
    <span className={`text-[11px] font-medium truncate text-right ${mono ? 'font-mono' : ''}`}>
      {value ?? NO_DATA}
    </span>
  </div>
)

/* ── Drift warmup progress bar ─────────────────────────────────────── */

const WarmupBar = ({ collected, needed }) => {
  const pct = Math.min(100, Math.round((collected / Math.max(1, needed)) * 100))
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-muted-foreground/60 mb-1">
        <span>Warmup</span>
        <span>{collected} / {needed} samples</span>
      </div>
      <div className="h-1 w-full rounded-full bg-muted/40">
        <div
          className="h-1 rounded-full bg-primary/60 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/* ── Inline pill for stale/live indicator ──────────────────────────── */

const StalePill = ({ isStale }) => (
  <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
    isStale
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
      : 'bg-green-500/10 border-green-500/30 text-green-400'
  }`}>
    {isStale ? 'Stale' : 'Live'}
  </span>
)

/* ══════════════════════════════════════════════════════════════════ */

export default function SystemStatusTab({
  stats,
  modelInfo,
  systemStatus,
  metrics,
  staleSeconds,
  driftScore,
  driftReady,
  driftWarning,
  driftCritical,
}) {
  const [showPolicy, setShowPolicy] = useState(false)

  if (!systemStatus && !stats && !modelInfo) {
    return <ChartStatePane state={{ loading: true }} />
  }

  /* ── Staleness ─────────────────────────────────────────────────── */
  const isStale = staleSeconds != null && staleSeconds > TELEMETRY_STALE_THRESHOLD_SECONDS
  const snapshotAge = fmtAge(staleSeconds)

  /* ── Model info aliases ────────────────────────────────────────── */
  const activeVersion = systemStatus?.models?.active_version ?? modelInfo?.active?.version
  const shadowVersion = systemStatus?.models?.shadow_version ?? modelInfo?.shadow?.version
  const activeSchema  = modelInfo?.active?.schema_version ?? systemStatus?.schema_version
  const shadowSchema  = modelInfo?.shadow?.schema_version

  // active_stats is already the eval dict; shadow_stats is the full candidate report
  const activeEval = systemStatus?.models?.active_stats ?? {}
  const shadowRaw  = systemStatus?.models?.shadow_stats ?? {}
  const shadowEval = shadowRaw?.candidate_eval ?? shadowRaw?.active_eval ?? shadowRaw

  /* ── Drift detector ────────────────────────────────────────────── */
  const driftActive      = systemStatus?.drift?.active ?? {}
  const softThr          = driftWarning  ?? modelInfo?.active?.drift_threshold_soft  ?? 0.5
  const hardThr          = driftCritical ?? modelInfo?.active?.drift_threshold_hard  ?? 0.7
  const driftMeta        = getDriftStatusMeta(driftScore ?? 0, softThr, hardThr)
  const samplesCollected = driftActive.samples_collected  ?? 0
  const samplesUntilRdy  = driftActive.samples_until_ready ?? 0
  const samplesNeeded    = samplesCollected + samplesUntilRdy

  /* ── Retraining ────────────────────────────────────────────────── */
  const retraining  = systemStatus?.retraining ?? {}
  const lastRetrain = retraining.last_retrain   ?? {}
  const lastPromote = retraining.last_promotion ?? {}

  /* ── Promotion policy ──────────────────────────────────────────── */
  const promotionPolicy = systemStatus?.promotion_policy ?? {}

  /* ── Promotion checklist (derived) ────────────────────────────── */
  const hasShadow   = Boolean(shadowVersion)
  const shadowAuc   = Number(shadowEval?.auc_roc ?? -1)
  const activeAuc   = Number(activeEval?.auc_roc  ?? -1)
  const shadowBeats = hasShadow && activeAuc >= 0 && shadowAuc >= 0 && shadowAuc >= activeAuc
  const labeledCount = Number(activeEval?.test_size ?? activeEval?.n_labeled ?? 0)

  const checklistItems = [
    {
      key: 'drift_ready',
      label: 'Drift detector warmed up',
      ok: Boolean(driftReady),
      tooltip: 'At least 100 samples collected in the current scoring window',
    },
    {
      key: 'shadow_loaded',
      label: 'Shadow model loaded',
      ok: hasShadow,
      tooltip: 'A candidate model is registered as the shadow',
    },
    {
      key: 'shadow_beats_active',
      label: 'Shadow AUC ≥ active AUC',
      ok: shadowBeats,
      tooltip: 'Shadow model AUC-ROC equals or exceeds the active model',
    },
    {
      key: 'enough_labeled',
      label: 'Labeled eval samples present',
      ok: labeledCount >= 50,
      tooltip: 'Active model evaluation report has ≥ 50 labeled samples',
    },
  ]

  const readyCount = checklistItems.filter((c) => c.ok).length

  /* ── Drift history chart ───────────────────────────────────────── */
  const driftScoreData = metrics?.driftScoreData ?? []
  const driftChartData = driftScoreData.map((p) => ({ ...p, drift: p.value }))

  /* ══════════ RENDER ════════════════════════════════════════════════ */

  return (
    <div className="space-y-1 pb-8">

      {/* Page header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground/90">System Status</h2>
          <p className="text-[11px] text-muted-foreground/60">
            {isStale
              ? `⚠ Data stale — snapshot ${snapshotAge}`
              : snapshotAge
              ? `Snapshot ${snapshotAge}`
              : 'Live'}
          </p>
        </div>
        <StalePill isStale={isStale} />
      </div>

      {/* ════ SECTION 1 — Models & Runtime ═════════════════════════════ */}
      <SectionLabel>Models &amp; Runtime</SectionLabel>

      <div className="grid grid-cols-2 gap-3">
        {/* Active model */}
        <PanelCard>
          <CardHeader icon={ShieldCheck} title="Active Model" />
          <div className="space-y-0">
            <KVPair label="Version"   value={formatModelVersion(activeVersion)} />
            <KVPair label="Schema"    value={activeSchema != null ? `v${activeSchema}` : NO_DATA} />
            <KVPair label="Soft thr." value={softThr != null ? softThr.toFixed(2) : NO_DATA} />
            <KVPair label="Hard thr." value={hardThr != null ? hardThr.toFixed(2) : NO_DATA} />
          </div>
        </PanelCard>

        {/* Shadow model */}
        <PanelCard>
          <CardHeader
            icon={Layers}
            title="Shadow Model"
            badge={!hasShadow && (
              <span className="text-[10px] text-muted-foreground/50 italic">none</span>
            )}
          />
          {hasShadow ? (
            <div className="space-y-0">
              <KVPair label="Version" value={formatModelVersion(shadowVersion)} />
              <KVPair label="Schema"  value={shadowSchema != null ? `v${shadowSchema}` : NO_DATA} />
              <KVPair label="AUC"     value={asFixed(shadowEval?.auc_roc, 4)} />
              <KVPair label="F1"      value={asFixed(shadowEval?.f1, 4)} />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/50 mt-1">No shadow model loaded.</p>
          )}
        </PanelCard>
      </div>

      {/* Drift detector */}
      <PanelCard className="mt-3">
        <CardHeader
          icon={Activity}
          title="Drift Detector"
          badge={<StatusBadge status={driftMeta} />}
        />
        <div className="grid grid-cols-2 gap-x-6 gap-y-0">
          <KVPair label="Score"      value={driftReady ? asFixed(driftScore, 3) : 'warming up'} mono={driftReady} />
          <KVPair label="Window"     value={driftActive.window_size   != null ? `${driftActive.window_size} samples`  : NO_DATA} />
          <KVPair label="Stride"     value={driftActive.stride        != null ? `${driftActive.stride} samples`       : NO_DATA} />
          <KVPair label="Top feature" value={driftActive.last_top_drifted_features?.[0] ?? NO_DATA} mono={false} />
        </div>
        {!driftReady && (
          <WarmupBar
            collected={samplesCollected}
            needed={Math.max(samplesCollected, samplesNeeded)}
          />
        )}
      </PanelCard>

      {/* ════ SECTION 2 — Model Quality ════════════════════════════════ */}
      <SectionLabel>Model Quality</SectionLabel>

      <PanelCard>
        <CardHeader icon={Database} title="Evaluation Metrics" />
        <div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
          {/* Headers */}
          <div className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wide text-left pb-1">Metric</div>
          <div className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wide text-center pb-1">Active</div>
          <div className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wide text-center pb-1">Shadow</div>

          {/* AUC-ROC */}
          <div className="text-[11px] text-muted-foreground py-0.5">AUC-ROC</div>
          <div className="text-[11px] font-mono font-medium text-center py-0.5">{asFixed(activeEval?.auc_roc)}</div>
          <div className="text-[11px] font-mono font-medium text-center py-0.5">{hasShadow ? asFixed(shadowEval?.auc_roc) : NO_DATA}</div>

          {/* Precision */}
          <div className="text-[11px] text-muted-foreground py-0.5">Precision</div>
          <div className="text-[11px] font-mono font-medium text-center py-0.5">{asFixed(activeEval?.precision)}</div>
          <div className="text-[11px] font-mono font-medium text-center py-0.5">{hasShadow ? asFixed(shadowEval?.precision) : NO_DATA}</div>

          {/* Recall */}
          <div className="text-[11px] text-muted-foreground py-0.5">Recall</div>
          <div className="text-[11px] font-mono font-medium text-center py-0.5">{asFixed(activeEval?.recall)}</div>
          <div className="text-[11px] font-mono font-medium text-center py-0.5">{hasShadow ? asFixed(shadowEval?.recall) : NO_DATA}</div>

          {/* F1 */}
          <div className="text-[11px] text-muted-foreground py-0.5">F1</div>
          <div className="text-[11px] font-mono font-medium text-center py-0.5">{asFixed(activeEval?.f1)}</div>
          <div className="text-[11px] font-mono font-medium text-center py-0.5">{hasShadow ? asFixed(shadowEval?.f1) : NO_DATA}</div>
        </div>
      </PanelCard>

      {/* ════ SECTION 3 — Retraining & Promotion ═══════════════════════ */}
      <SectionLabel>Retraining &amp; Promotion</SectionLabel>

      {/* Retrain queue */}
      <PanelCard>
        <CardHeader icon={RefreshCw} title="Retrain Queue" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-0">
          <KVPair label="Pending"   value={asInt(retraining.pending_count)} />
          <KVPair label="Active"    value={retraining.is_active ? 'yes' : 'no'} mono={false} />
          <KVPair label="Cooldown"  value={retraining.cooldown_seconds != null ? `${retraining.cooldown_seconds}s` : NO_DATA} />
          <KVPair label="Max queue" value={asInt(retraining.max_pending)} />
        </div>
      </PanelCard>

      {/* Promotion readiness + collapsible policy */}
      <PanelCard>
        <CardHeader
          icon={GitBranch}
          title="Promotion Readiness"
          badge={
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              readyCount === checklistItems.length
                ? 'bg-green-500/15 text-green-400'
                : 'bg-amber-500/15 text-amber-400'
            }`}>
              {readyCount}/{checklistItems.length}
            </span>
          }
          action={
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setShowPolicy((v) => !v)}
              title={showPolicy ? 'Hide promotion policy' : 'Show promotion policy'}
            >
              <Settings2 size={11} />
            </Button>
          }
        />

        <div className="space-y-2">
          {checklistItems.map(({ key, label, ok, tooltip }) => (
            <div key={key} className="flex items-center gap-2">
              {ok
                ? <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                : <Hourglass    size={12} className="text-amber-400 shrink-0" />}
              <span className="text-[11px] text-foreground/80 flex-1">{label}</span>
              {tooltip && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info size={10} className="text-muted-foreground/40 cursor-help shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs max-w-[220px]">{tooltip}</TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}
        </div>

        {showPolicy && (
          <div className="border-t border-border/40 pt-3 mt-3 space-y-0">
            <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wide mb-2">
              Promotion Policy
            </p>
            <KVPair
              label="Auto-promote"
              value={promotionPolicy.auto_promote != null
                ? (promotionPolicy.auto_promote ? 'enabled' : 'disabled')
                : NO_DATA}
              mono={false}
            />
            <KVPair label="Min AUC delta"      value={asFixed(promotionPolicy.min_auc_delta, 3)} />
            <KVPair label="Min F1 delta"       value={asFixed(promotionPolicy.min_f1_delta, 3)} />
            <KVPair
              label="Max cost increase"
              value={promotionPolicy.max_cost_increase != null
                ? `${(promotionPolicy.max_cost_increase * 100).toFixed(1)}%`
                : NO_DATA}
            />
            <KVPair
              label="Cooldown"
              value={promotionPolicy.cooldown_seconds != null
                ? `${promotionPolicy.cooldown_seconds}s`
                : NO_DATA}
            />
          </div>
        )}
      </PanelCard>

      {/* ════ SECTION 4 — Lifecycle ════════════════════════════════════ */}
      <SectionLabel>Lifecycle</SectionLabel>

      <div className="grid grid-cols-2 gap-3">
        <PanelCard>
          <div className="flex items-center gap-1.5 mb-2">
            <RefreshCw size={12} className="text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Last Retrain
            </span>
          </div>
          <p className="text-[11px] font-mono text-foreground/80">
            {fmtTs(lastRetrain?.completed_at_unix ?? lastRetrain?.created_at_unix ?? lastRetrain?.ts)}
          </p>
        </PanelCard>
        <PanelCard>
          <div className="flex items-center gap-1.5 mb-2">
            <GitBranch size={12} className="text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Last Promote
            </span>
          </div>
          <p className="text-[11px] font-mono text-foreground/80">
            {fmtTs(lastPromote?.promoted_at_unix ?? lastPromote?.created_at_unix ?? lastPromote?.ts)}
          </p>
        </PanelCard>
      </div>

      {/* ════ SECTION 5 — Drift Score History ══════════════════════════ */}
      <SectionLabel>Drift Score History</SectionLabel>

      {driftChartData.length > 0 ? (
        <ChartCard title="Drift Score">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={driftChartData} {...CHART_COMMON}>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 1]} tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={28} />
              <RechartsTooltip content={<CustomTooltip />} />
              <ReferenceLine y={softThr} stroke={LINE_COLORS.amber}   strokeDasharray="4 2" strokeOpacity={0.6} />
              <ReferenceLine y={hardThr} stroke={LINE_COLORS.crimson}  strokeDasharray="4 2" strokeOpacity={0.6} />
              <Line
                type="monotone"
                dataKey="drift"
                stroke={LINE_COLORS.steel}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                name="Drift"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      ) : (
        <ChartStatePane
          state={driftReady
            ? (metrics?.chartStates?.drift ?? {})
            : { warmup: true }}
        />
      )}

    </div>
  )
}
