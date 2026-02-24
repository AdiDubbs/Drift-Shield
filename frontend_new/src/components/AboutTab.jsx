import React from "react";
import { Cpu, GitBranch, Info, Layers, LineChart, Server } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export default function AboutTab({ stats, modelInfo, driftScore }) {
  const activeVersion =
    stats?.model_version ?? modelInfo?.active?.version ?? "N/A";
  const shadowVersion = modelInfo?.shadow?.version ?? null;
  const shadowEnabled = Boolean(modelInfo?.shadow?.enabled && shadowVersion);

  const soft = modelInfo?.active?.drift_threshold_soft ?? 0.5;
  const hard = modelInfo?.active?.drift_threshold_hard ?? 0.7;

  const coverage =
    modelInfo?.active?.coverage != null
      ? modelInfo.active.coverage
      : modelInfo?.active?.alpha != null
        ? 1 - modelInfo.active.alpha
        : null;

  const alpha =
    modelInfo?.active?.alpha != null
      ? modelInfo.active.alpha
      : coverage != null
        ? 1 - coverage
        : null;

  const driftPercent =
    driftScore != null ? `${(driftScore * 100).toFixed(1)}%` : "—";
  const coverageValue =
    coverage != null ? `${(coverage * 100).toFixed(1)}%` : "Not set";
  const alphaValue = alpha != null ? `${(alpha * 100).toFixed(1)}%` : "Not set";

  const stackGroups = [
    {
      name: "Serving",
      icon: Server,
      purpose: "API surface and request handling",
      helpText: "Handles inbound requests, schema validation, and response contracts.",
      stack: ["FastAPI", "Uvicorn", "Pydantic"],
      details: "Endpoints: /predict, /dashboard/stats",
    },
    {
      name: "Modeling",
      icon: Cpu,
      purpose: "Inference and uncertainty controls",
      helpText: "Runs predictions with uncertainty calibration and decision policy logic.",
      stack: ["XGBoost", "Conformal Prediction", "Policy Rules"],
      details: `Coverage ${coverageValue} (alpha ${alphaValue}), soft/hard drift ${(
        soft * 100
      ).toFixed(0)}% / ${(hard * 100).toFixed(0)}%`,
    },
    {
      name: "Observability",
      icon: LineChart,
      purpose: "Monitoring and diagnostics",
      helpText: "Tracks runtime health, drift, latency, and disagreement metrics.",
      stack: ["Prometheus", "Grafana", "Event Timeline"],
      details: "Signals: drift, latency, shadow disagreement",
    },
    {
      name: "Governance",
      icon: GitBranch,
      purpose: "Model lifecycle and release safety",
      helpText: "Controls active/shadow promotion, retrain triggers, and rollback safety.",
      stack: ["Active/Shadow Routing", "Retrain Queue", "Rollback Pointer"],
      details: `Active ${activeVersion} | Shadow ${
        shadowEnabled ? shadowVersion : "Disabled"
      }`,
    },
  ];

  return (
    <TooltipProvider delayDuration={180}>
      <div className="space-y-5">
        <div>
          <h1 className="typo-title text-text-primary">About</h1>
          <p className="typo-subtitle text-text-dimmed mt-1.5">
            System architecture and model governance overview
          </p>
        </div>

        <div className="card card-glass grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 xl:divide-x divide-[var(--border-dim)]">
          <ModelKpi
            label="Active Model"
            value={activeVersion}
            note="Currently serving production traffic"
            helpText="Version currently handling live traffic."
            mono
          />
          <ModelKpi
            label="Shadow Model"
            value={shadowEnabled ? shadowVersion : "Disabled"}
            note={
              shadowEnabled
                ? "Evaluated alongside active model"
                : "No shadow version loaded"
            }
            helpText="Candidate model scored in parallel for safe comparison."
            mono
          />
          <ModelKpi
            label="Coverage Target"
            value={coverageValue}
            note={`Conformal alpha: ${alphaValue}`}
            helpText="Desired prediction-set coverage from conformal calibration."
            accent="text-accent-mint"
          />
          <ModelKpi
            label="Current Drift"
            value={driftPercent}
            note="Live drift score"
            helpText="Current feature-distribution shift versus the reference baseline."
            accent="text-accent-steel"
          />
        </div>
        <div className="card card-glass p-6 lg:p-6">
          <div className="flex items-center gap-2.5 mb-3">
            <Layers className="h-4 w-4 text-accent-steel shrink-0" />
            <span className="typo-overline text-text-muted">Tech Stack</span>
          </div>
          <p className="typo-caption text-text-dimmed mb-4">
            Core layers used in the live scoring workflow.
          </p>

          <div className="rounded-xl border border-[var(--border-dim)] overflow-hidden mt-3 grid grid-cols-1 md:grid-cols-2 md:divide-x divide-[var(--border-dim)]">
            {stackGroups.map((group, idx) => {
              const mobileBorder = idx < stackGroups.length - 1 ? "border-b" : "";
              const desktopBorder = idx < 2 ? "md:border-b" : "md:border-b-0";

              return (
                <section
                  key={group.name}
                  className={`flex h-full flex-col px-6 py-5 lg:px-6 lg:py-6 border-[var(--border-dim)] bg-[linear-gradient(180deg,rgba(255,255,255,0.01),rgba(255,255,255,0))] ${mobileBorder} ${desktopBorder}`}
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-frost-weak)] border border-[var(--border-dim)]">
                      <group.icon className="h-3.5 w-3.5 text-accent-steel" />
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="typo-overline text-text-secondary">
                        {group.name}
                      </span>
                      {group.helpText ? <KpiHint text={group.helpText} /> : null}
                    </div>
                  </div>
                  <p className="typo-body-sm text-text-primary mb-3">
                    {group.purpose}
                  </p>
                  <div className="flex flex-wrap gap-2.5 mb-5">
                    {group.stack.map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center rounded-full border border-[var(--border-dim)] bg-[var(--surface-frost-weak)] px-2.5 py-1 typo-caption text-text-secondary"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                  <p className="typo-caption text-text-dimmed pt-2">
                    {group.details}
                  </p>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ModelKpi({
  label,
  value,
  note,
  helpText,
  mono = false,
  accent = "text-text-primary",
}) {
  return (
    <div className="px-5 py-4 lg:px-6 lg:py-5">
      <div className="flex items-center gap-1.5">
        <span className="typo-overline text-text-muted">{label}</span>
        {helpText ? <KpiHint text={helpText} /> : null}
      </div>
      <div className="mt-1">
        <span
          className={
            mono ? `font-mono text-lg ${accent}` : `typo-stat-md ${accent}`
          }
        >
          {value}
        </span>
      </div>
      <p className="typo-caption text-text-dimmed mt-1">{note}</p>
    </div>
  );
}

function KpiHint({ text }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="KPI description"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-dimmed hover:text-text-secondary transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px]">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
