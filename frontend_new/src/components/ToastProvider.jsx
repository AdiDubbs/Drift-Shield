import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react'
import { cn } from '../lib/utils'

const ToastContext = createContext(null)

const ICON_BY_TONE = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
}

const TONE_CLASS = {
  success: 'border-mint bg-mint-subtle text-accent-mint',
  info: 'border-steel bg-steel-subtle text-accent-steel',
  warning: 'border-amber bg-amber-subtle text-accent-amber',
  error: 'border-crimson bg-crimson-subtle text-accent-crimson',
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback((toast) => {
    const id = `${Date.now()}-${Math.random()}`
    const durationMs = toast.durationMs ?? 3200
    setToasts((prev) => [...prev, { ...toast, id }].slice(-5))
    window.setTimeout(() => dismissToast(id), durationMs)
  }, [dismissToast])

  const value = useMemo(() => ({ pushToast, dismissToast }), [pushToast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((toast) => {
          const tone = toast.tone || 'info'
          const Icon = ICON_BY_TONE[tone] || ICON_BY_TONE.info
          return (
            <div
              key={toast.id}
              className={cn(
                'pointer-events-auto rounded-xl border px-3 py-2 shadow-lg backdrop-blur',
                TONE_CLASS[tone] || TONE_CLASS.info
              )}
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  {toast.title ? <p className="typo-body-sm font-semibold">{toast.title}</p> : null}
                  {toast.description ? <p className="typo-caption opacity-90">{toast.description}</p> : null}
                </div>
                <button
                  type="button"
                  className="rounded p-0.5 opacity-70 hover:opacity-100"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Dismiss notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used inside ToastProvider')
  }
  return ctx
}
