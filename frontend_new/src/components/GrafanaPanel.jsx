import React, { useState, useRef } from 'react'
import { ExternalLink, RefreshCw, AlertTriangle, Copy, Check } from 'lucide-react'
import { Button } from './ui/button'

const GRAFANA_BASE_URL = import.meta.env.VITE_GRAFANA_URL || 'http://localhost:3000'
const GRAFANA_DASHBOARD_URL =
  import.meta.env.VITE_GRAFANA_DASHBOARD_URL
  || `${GRAFANA_BASE_URL}/d/afe3285cd4xkwc/drift-shield?orgId=1&from=now-15m&to=now&timezone=browser&refresh=5s`

export default function GrafanaPanel() {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)
  const iframeRef = useRef(null)

  const retry = () => {
    setError(false)
    setLoaded(false)
    // Re-mount iframe by forcing a src reset
    if (iframeRef.current) iframeRef.current.src = GRAFANA_DASHBOARD_URL
  }

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(GRAFANA_DASHBOARD_URL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // onLoad fires even for login redirects — detect if the iframe landed on
  // a page that looks like a Grafana auth wall by checking the title after load.
  // We can't read cross-origin content, so we just mark as loaded and let the
  // error state handle genuine network failures.
  const handleLoad = () => setLoaded(true)
  const handleError = () => { setLoaded(true); setError(true) }

  return (
    <div className="flex flex-col space-y-6" style={{ height: 'calc(100vh - 112px)' }}>
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <h1 className="typo-title text-text-primary">Grafana</h1>
          <p className="typo-subtitle text-text-dimmed mt-1">Live dashboard embedded from your Grafana instance</p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button variant="secondary" size="sm" asChild>
            <a href={GRAFANA_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              Open in new tab
            </a>
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-2 rounded-md border border-border-dim bg-[var(--surface-frost-weak)] px-3 py-1.5 min-w-0">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: loaded && !error ? 'var(--accent-mint-vibrant)' : error ? 'var(--accent-crimson-vibrant)' : 'var(--accent-amber-vibrant)' }} />
          <span className="typo-mono-sm text-text-muted truncate">{GRAFANA_DASHBOARD_URL}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleCopyUrl} className="gap-1.5 shrink-0">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy URL'}
        </Button>
      </div>

      <div className="card card-glass flex-1 min-h-0 overflow-hidden">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-8">
            <AlertTriangle className="h-10 w-10 opacity-60" style={{ color: 'var(--accent-amber-vibrant)' }} />
            <div className="space-y-1">
              <p className="typo-body text-text-primary">Unable to load Grafana</p>
              <p className="typo-body-sm text-text-muted">
                Grafana may not be running at <span className="font-mono">{GRAFANA_DASHBOARD_URL}</span>.
              </p>
              <p className="typo-body-sm text-text-dimmed mt-2 max-w-sm">
                If Grafana has <span className="font-mono">X-Frame-Options: DENY</span> or <span className="font-mono">SAMEORIGIN</span> set,
                the browser will block embedding regardless — use "Open in new tab" instead.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={retry} variant="secondary" size="sm" className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
              <Button variant="default" size="sm" asChild>
                <a href={GRAFANA_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Grafana
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative h-full w-full">
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-frost-strong)] z-10">
                <div className="flex items-center gap-2 typo-body text-text-muted">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading Grafana…
                </div>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={GRAFANA_DASHBOARD_URL}
              className="h-full w-full border-0 rounded-[inherit]"
              onLoad={handleLoad}
              onError={handleError}
              title="Grafana Dashboard"
            />
          </div>
        )}
      </div>
    </div>
  )
}
