import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  Cpu,
  GitCommit,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Shield,
  Sun,
} from 'lucide-react'
import { cn } from './lib/utils'
import { apiClient } from './api/client'
import { usePrometheusMetrics } from './hooks/usePrometheusMetrics'
import ErrorBoundary from './components/ErrorBoundary'
import OverviewTab from './components/OverviewTab'
import OperationsTab from './components/OperationsTab'
import LogsTab from './components/LogsTab'
import TestPanel from './components/TestPanel'
import AboutTab from './components/AboutTab'
import GrafanaPanel from './components/GrafanaPanel'
import { Button } from './components/ui/button'
import { useToast } from './components/ToastProvider'
import { getDriftStatusMeta, StatusBadge } from './components/shared'

const STALE_THRESHOLD_SECONDS = 12
const THEME_KEY = 'drift-shield-theme'

const NAV_TABS = [
  { key: 'OVERVIEW', label: 'Overview' },
  { key: 'OPERATIONS', label: 'Monitoring' },
  { key: 'LOGS', label: 'Activity' },
  { key: 'GRAFANA', label: 'Grafana' },
  { key: 'TEST', label: 'Testing' },
  { key: 'ABOUT', label: 'About' },
]

const VALID_TABS = new Set(NAV_TABS.map((tab) => tab.key))

function getTabFromURL() {
  const tab = new URLSearchParams(window.location.search).get('tab')?.toUpperCase()
  return tab && VALID_TABS.has(tab) ? tab : 'OVERVIEW'
}

function getStoredTheme() {
  const current = localStorage.getItem(THEME_KEY)
  if (current) return current

  const legacy = localStorage.getItem('ds-theme')
  if (legacy) {
    localStorage.setItem(THEME_KEY, legacy)
    return legacy
  }

  return 'dark'
}


function SidebarRow({ label, value, valueClassName }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="typo-body-sm text-text-muted">{label}</span>
      <span className={cn('typo-body-sm font-medium text-text-primary tabular-nums', valueClassName)}>{value}</span>
    </div>
  )
}

function Header({ activeTab, onTabChange, connected, theme, onToggleTheme }) {
  const handleTabKeyDown = (event, currentKey) => {
    const keys = NAV_TABS.map((tab) => tab.key)
    const index = keys.indexOf(currentKey)
    if (index < 0) return

    let nextKey = null
    if (event.key === 'ArrowRight') nextKey = keys[(index + 1) % keys.length]
    if (event.key === 'ArrowLeft') nextKey = keys[(index - 1 + keys.length) % keys.length]
    if (event.key === 'Home') nextKey = keys[0]
    if (event.key === 'End') nextKey = keys[keys.length - 1]
    if (!nextKey) return

    event.preventDefault()
    onTabChange(nextKey)
    const tablist = event.currentTarget.closest('[role="tablist"]')
    const nextTab = tablist?.querySelector(`[data-tab-key="${nextKey}"]`)
    nextTab?.focus()
  }

  return (
    <header
      className="sticky top-0 z-40 border-b bg-[var(--surface-frost-strong)]/90 backdrop-blur-xl"
      style={{ borderColor: 'var(--border-shell)' }}
    >
      <div className="flex items-center gap-3 px-4 xl:px-6 h-[57px]">
        <div className="flex items-center gap-3 shrink-0">
          <div className="brand-mark">
            <Shield className="h-4 w-4" />
          </div>
          <h1 className="typo-brand text-text-primary">
            Drift<span className="font-semibold text-text-secondary">Shield</span>
          </h1>
        </div>

        <nav className="hidden lg:flex items-center gap-0 h-full ml-2" role="tablist" aria-label="Primary navigation tabs">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls="main-tabpanel"
              tabIndex={activeTab === tab.key ? 0 : -1}
              data-tab-key={tab.key}
              onClick={() => onTabChange(tab.key)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.key)}
              className={cn(
                'relative px-4 h-full typo-body font-medium transition-colors duration-150',
                activeTab === tab.key
                  ? 'text-text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 ml-auto">
          <div className="hidden sm:flex items-center gap-1.5">
            <span
              className="shrink-0 h-2 w-2 rounded-full"
              style={{ background: connected ? 'var(--accent-mint-vibrant)' : 'var(--accent-amber-vibrant)' }}
            />
            <span className="typo-body-sm font-medium text-text-muted">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <Button
            variant="icon"
            size="icon"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div
        className="block lg:hidden border-t overflow-x-auto scrollbar-thin"
        style={{ borderColor: 'var(--border-shell)' }}
        role="tablist"
        aria-label="Primary navigation tabs"
      >
        <div className="flex items-center">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls="main-tabpanel"
              tabIndex={activeTab === tab.key ? 0 : -1}
              data-tab-key={tab.key}
              onClick={() => onTabChange(tab.key)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.key)}
              className={cn(
                'relative shrink-0 px-4 py-2.5 typo-body font-medium transition-colors duration-150',
                activeTab === tab.key
                  ? 'text-text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}

function SidebarIconRail({ issuesCount, connected, prometheusConnected, hasModel, onRetrain, isRetraining, onToggleSidebar }) {
  const statusTone = connected && prometheusConnected
    ? 'text-[var(--accent-mint-vibrant)]'
    : 'text-[var(--accent-amber-vibrant)]'
  const systemStatusLabel = connected && prometheusConnected
    ? 'System status healthy'
    : 'System status needs attention'
  const modelStatusLabel = hasModel ? 'Model bundle loaded' : 'Model bundle pending'

  return (
    <div className="flex h-full min-w-[64px] flex-col items-center gap-2.5 px-2 py-3">
      <Button
        variant="icon"
        size="icon"
        onClick={onToggleSidebar}
        aria-label="Expand sidebar"
        className="rounded-xl"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </Button>

      <div
        className={cn('relative h-11 w-11 rounded-xl border border-border-dim panel-subtle flex items-center justify-center', statusTone)}
        role="img"
        aria-label={systemStatusLabel}
      >
        <Activity className="h-4 w-4" />
        {issuesCount > 0 && (
          <span className="absolute -right-1 -top-1 h-4 min-w-4 px-1 rounded-full bg-[var(--accent-crimson-vibrant)] typo-caption leading-4 text-white text-center">
            {issuesCount}
          </span>
        )}
      </div>

      <div
        className={cn(
          'h-11 w-11 rounded-xl border border-border-dim panel-subtle flex items-center justify-center',
          hasModel ? 'text-[var(--accent-steel-vibrant)]' : 'text-text-dimmed'
        )}
        role="img"
        aria-label={modelStatusLabel}
      >
        <Cpu className="h-4 w-4" />
      </div>

      <div className="h-px w-6 bg-[var(--border-dim)] mt-0.5" />

      <div className="mt-auto">
        <Button
          variant="icon"
          size="icon"
          onClick={onRetrain}
          disabled={isRetraining}
          aria-label={isRetraining ? 'Retrain in progress' : 'Trigger retrain'}
          className="rounded-xl"
        >
          {isRetraining ? <RefreshCw className="h-4 w-4 animate-spin" /> : <GitCommit className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

function Sidebar({
  stats,
  modelInfo,
  driftScore,
  coverageGuarantee,
  connected,
  prometheusConnected,
  staleSeconds,
  onRetrain,
  isRetraining,
  onToggleSidebar,
}) {
  const soft = modelInfo?.active?.drift_threshold_soft ?? 0.5
  const hard = modelInfo?.active?.drift_threshold_hard ?? 0.7

  const issues = [
    !connected && 'Scoring API offline',
    !prometheusConnected && 'Prometheus pipeline delayed',
    staleSeconds != null && staleSeconds > STALE_THRESHOLD_SECONDS && `Telemetry stale (${Math.round(staleSeconds)}s)`,
    driftScore >= hard && 'Hard drift threshold breached',
  ].filter(Boolean)

  const driftTone =
    driftScore >= hard
      ? 'var(--accent-crimson-vibrant)'
      : driftScore >= soft
        ? 'var(--accent-amber-vibrant)'
        : 'var(--accent-steel-vibrant)'
  const driftStatus = getDriftStatusMeta(driftScore ?? 0, soft, hard)

  const telemetryState =
    staleSeconds == null
      ? 'Awaiting'
      : staleSeconds > STALE_THRESHOLD_SECONDS
        ? `Stale (${Math.round(staleSeconds)}s)`
        : `${Math.round(staleSeconds)}s`

  return (
    <div className="flex flex-col gap-4">
      <div className="card card-glass p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-text-secondary" />
            <span className="typo-overline text-text-secondary">System</span>
          </div>
          <Button
            variant="icon"
            size="icon"
            onClick={onToggleSidebar}
            aria-label="Collapse sidebar"
            className="rounded-lg"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <SidebarRow label="Scoring API" value={connected ? 'Online' : 'Offline'} valueClassName={connected ? 'text-[var(--accent-mint-vibrant)]' : 'text-[var(--accent-crimson-vibrant)]'} />
          <SidebarRow label="Metrics" value={prometheusConnected ? 'Live' : 'Delayed'} valueClassName={prometheusConnected ? 'text-[var(--accent-mint-vibrant)]' : 'text-[var(--accent-amber-vibrant)]'} />
          <SidebarRow label="Telemetry" value={telemetryState} valueClassName={staleSeconds != null && staleSeconds > STALE_THRESHOLD_SECONDS ? 'text-[var(--accent-amber-vibrant)]' : ''} />
          <SidebarRow
            label="Open issues"
            value={String(issues.length)}
            valueClassName={issues.length > 0 ? 'text-[var(--accent-crimson-vibrant)]' : 'text-[var(--accent-mint-vibrant)]'}
          />
        </div>

        {issues.length > 0 ? (
          <div className="pt-2 border-t border-border-dim space-y-1.5">
            {issues.slice(0, 2).map((issue) => (
              <div key={issue} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 rounded-full shrink-0 bg-[var(--accent-crimson-vibrant)]" />
                <p className="typo-caption text-text-muted leading-relaxed">{issue}</p>
              </div>
            ))}
            {issues.length > 2 && (
              <p className="typo-caption text-text-dimmed">+{issues.length - 2} more</p>
            )}
          </div>
        ) : (
          <p className="pt-1 typo-caption text-text-dimmed">No active issues.</p>
        )}
      </div>

      <div className="card card-glass p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-text-secondary" />
          <span className="typo-overline text-text-secondary">Model & Risk</span>
        </div>

        <SidebarRow label="Model" value={stats?.model_version ?? modelInfo?.active?.version ?? '—'} valueClassName="font-mono" />
        <SidebarRow label="Drift score" value={`${((driftScore ?? 0) * 100).toFixed(1)}%`} valueClassName="font-mono" />
        <div className="flex items-center justify-between">
          <span className="typo-body-sm text-text-muted">Drift state</span>
          <StatusBadge status={driftStatus} />
        </div>
        <div className="h-1.5 rounded-full bg-[var(--surface)]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min((driftScore ?? 0) * 100, 100)}%`,
              backgroundColor: driftTone,
            }}
          />
        </div>
        <SidebarRow label="Coverage" value={coverageGuarantee != null ? `${(coverageGuarantee * 100).toFixed(1)}%` : '—'} valueClassName="text-[var(--accent-mint-vibrant)] font-mono" />
        <SidebarRow label="Soft / Hard" value={`${(soft * 100).toFixed(0)}% / ${(hard * 100).toFixed(0)}%`} valueClassName="font-mono" />
        <p className="typo-caption text-text-dimmed">
          Crossing the hard threshold increases retrain pressure and can shift actions to fallback/monitor.
        </p>
      </div>

      <div className="card card-glass p-4 space-y-3">
        <div className="flex items-center gap-2">
          <GitCommit className="h-3.5 w-3.5 text-text-secondary" />
          <span className="typo-overline text-text-secondary">Actions</span>
        </div>
        <SidebarRow label="Retrains" value={String(stats?.retrain_triggers ?? 0)} />
        <SidebarRow label="Shadow runs" value={String(stats?.shadow_runs ?? 0)} />
        <SidebarRow label="Last sync" value={telemetryState} />
        <Button onClick={onRetrain} disabled={isRetraining} className="w-full mt-1">
          {isRetraining ? (
            <><RefreshCw className="h-4 w-4 animate-spin" />Requesting…</>
          ) : (
            <><GitCommit className="h-4 w-4" />Trigger Retrain</>
          )}
        </Button>
      </div>
    </div>
  )
}

export default function App() {
  const { pushToast } = useToast()
  const [activeTab, setActiveTab] = useState(getTabFromURL)
  const [theme, setTheme] = useState(() => getStoredTheme())
  const [stats, setStats] = useState(null)
  const [modelInfo, setModelInfo] = useState(null)
  const [coverageGuarantee, setCoverageGuarantee] = useState(null)
  const [isRetraining, setIsRetraining] = useState(false)
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [timeRange, setTimeRange] = useState('15m')
  const [rps, setRps] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const prevRequestsRef = useRef(null)
  const prevTimeRef = useRef(null)
  const rpsWindowRef = useRef([])
  const pollControllerRef = useRef(null)

  useEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-theme', theme)
    html.classList.toggle('dark', theme === 'dark')
    html.classList.toggle('light', theme === 'light')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    const onPop = () => setActiveTab(getTabFromURL())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const setTab = (tab) => {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab.toLowerCase())
    window.history.pushState({}, '', url)
  }

  useEffect(() => {
    const poll = async () => {
      if (pollControllerRef.current) {
        pollControllerRef.current.abort()
      }
      const controller = new AbortController()
      pollControllerRef.current = controller
      try {
        const [dashboardStats, info] = await Promise.all([
          apiClient.getDashboardStats({ signal: controller.signal }),
          apiClient.getModelInfo({ signal: controller.signal }).catch(() => null),
        ])

        setStats(dashboardStats)

        if (info) {
          setModelInfo(info)

          if (info.active?.alpha != null) {
            setCoverageGuarantee(1 - info.active.alpha)
          } else if (info.active?.coverage != null) {
            setCoverageGuarantee(info.active.coverage)
          }
        }

        const now = Date.now()
        const total = dashboardStats?.total_requests ?? 0

        if (prevRequestsRef.current != null && prevTimeRef.current != null) {
          const dt = (now - prevTimeRef.current) / 1000
          const rawRps = dt > 0 ? Math.max(0, (total - prevRequestsRef.current) / dt) : 0
          rpsWindowRef.current = [...rpsWindowRef.current, rawRps].slice(-6)
          const avgRps = rpsWindowRef.current.reduce((sum, value) => sum + value, 0) / rpsWindowRef.current.length
          setRps(avgRps)
        }

        prevRequestsRef.current = total
        prevTimeRef.current = now
        setConnected(true)
        setLastUpdate(now)
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) {
          return
        }
        setConnected(false)
      }
    }

    poll()
    const interval = setInterval(poll, 5000)
    return () => {
      clearInterval(interval)
      if (pollControllerRef.current) {
        pollControllerRef.current.abort()
      }
    }
  }, [])

  const metrics = usePrometheusMetrics({ timeRange, enabled: true })
  const driftScore = stats?.drift_score ?? metrics.currentMetrics.driftScore ?? 0
  const soft = modelInfo?.active?.drift_threshold_soft ?? 0.5
  const hard = modelInfo?.active?.drift_threshold_hard ?? 0.7

  const staleSeconds = useMemo(() => {
    if (!lastUpdate) return null
    return (Date.now() - lastUpdate) / 1000
  }, [lastUpdate, stats])

  const issuesCount = [
    !connected,
    !metrics.prometheusConnected,
    staleSeconds != null && staleSeconds > STALE_THRESHOLD_SECONDS,
    driftScore >= hard,
  ].filter(Boolean).length

  const handleRetrain = async () => {
    setIsRetraining(true)
    try {
      await apiClient.triggerRetrain()
      pushToast({
        tone: 'success',
        title: 'Retrain queued',
        description: 'Manual retrain request was accepted by the API.',
      })
    } catch (error) {
      pushToast({
        tone: 'error',
        title: 'Retrain failed',
        description: error?.message || 'Unable to queue retrain request.',
      })
    } finally {
      setIsRetraining(false)
    }
  }

  const tabContent = {
    OVERVIEW: (
      <ErrorBoundary>
        <OverviewTab
          stats={stats}
          metrics={metrics}
          driftScore={driftScore}
          coverageGuarantee={coverageGuarantee}
          rps={rps}
          timeRange={timeRange}
          setTimeRange={setTimeRange}
          driftWarning={soft}
          driftCritical={hard}
        />
      </ErrorBoundary>
    ),
    OPERATIONS: (
      <ErrorBoundary>
        <OperationsTab
          metrics={metrics}
          timeRange={timeRange}
          setTimeRange={setTimeRange}
          driftWarning={soft}
          driftCritical={hard}
        />
      </ErrorBoundary>
    ),
    LOGS: (
      <ErrorBoundary>
        <LogsTab
          stats={stats}
          driftScore={driftScore}
          modelInfo={modelInfo}
          driftWarning={soft}
          driftCritical={hard}
        />
      </ErrorBoundary>
    ),
    GRAFANA: (
      <ErrorBoundary>
        <GrafanaPanel />
      </ErrorBoundary>
    ),
    TEST: (
      <ErrorBoundary>
        <TestPanel />
      </ErrorBoundary>
    ),
    ABOUT: (
      <ErrorBoundary>
        <AboutTab
          stats={stats}
          modelInfo={modelInfo}
          driftScore={driftScore}
          coverageGuarantee={coverageGuarantee}
        />
      </ErrorBoundary>
    ),
  }
  const activeTabLabel = NAV_TABS.find((tab) => tab.key === activeTab)?.label ?? 'Overview'

  return (
    <div className={cn('flex min-h-screen flex-col bg-background text-foreground', theme)}>
      <div className="mesh-bg" />

      <Header
        activeTab={activeTab}
        onTabChange={setTab}
        connected={connected}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      />

      <div className="flex flex-1 min-h-0">
        <motion.aside
          className="hidden xl:flex xl:flex-col shrink-0 border-r overflow-hidden"
          style={{ borderColor: 'var(--border-shell)', position: 'sticky', top: 57, height: 'calc(100vh - 57px)', overflowY: 'auto' }}
          animate={{ width: sidebarCollapsed ? 64 : 272 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {sidebarCollapsed ? (
            <SidebarIconRail
              issuesCount={issuesCount}
              connected={connected}
              prometheusConnected={metrics.prometheusConnected}
              hasModel={Boolean(stats?.model_version ?? modelInfo?.active?.version)}
              onRetrain={handleRetrain}
              isRetraining={isRetraining}
              onToggleSidebar={() => setSidebarCollapsed(false)}
            />
          ) : (
            <motion.div
              className="flex-1 p-4 min-w-[272px]"
              animate={{ opacity: sidebarCollapsed ? 0 : 1 }}
              transition={{ duration: 0.15 }}
            >
              <Sidebar
                stats={stats}
                modelInfo={modelInfo}
                driftScore={driftScore}
                coverageGuarantee={coverageGuarantee}
                connected={connected}
                prometheusConnected={metrics.prometheusConnected}
                staleSeconds={staleSeconds}
                onRetrain={handleRetrain}
                isRetraining={isRetraining}
                onToggleSidebar={() => setSidebarCollapsed(true)}
              />
            </motion.div>
          )}
        </motion.aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 px-4 py-4 xl:px-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                id="main-tabpanel"
                role="tabpanel"
                aria-label={`${activeTabLabel} panel`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {tabContent[activeTab]}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
