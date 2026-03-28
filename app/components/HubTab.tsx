"use client";

import { useState, useEffect, useCallback } from "react";
import type { HubShortcut, HubStats, ABResult, ABTestStatus, AgentStep } from "@/lib/types";
import { WORKER_URL, DEFAULT_MODEL, DEFAULT_MAX_STEPS } from "@/lib/constants";
import { useABTestStream } from "@/hooks/useABTestStream";

export default function HubTab({ active }: { active?: boolean }) {
  const [shortcuts, setShortcuts] = useState<HubShortcut[]>([]);
  const [stats, setStats] = useState<HubStats | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HubShortcut | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  useEffect(() => {
    fetchShortcuts();
    fetchStats();
  }, []);

  // Re-fetch when tab becomes active (picks up new suggestions from completed runs)
  useEffect(() => {
    if (active) {
      fetchShortcuts();
      fetchStats();
    }
  }, [active]);

  async function fetchShortcuts() {
    try {
      const res = await fetch(`${WORKER_URL}/api/hub/shortcuts`);
      if (res.ok) {
        const data = await res.json();
        setShortcuts(data.shortcuts || []);
      }
    } catch {
      // Worker may not be running yet
    } finally {
      setLoading(false);
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch(`${WORKER_URL}/api/hub/stats`);
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {
      // Worker may not be running yet
    }
  }

  const matchesFilters = (s: HubShortcut) => {
    const matchesSearch = !search.trim() ||
      s.suggestion.toLowerCase().includes(search.toLowerCase()) ||
      s.taskPattern.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || s.category === categoryFilter;
    return matchesSearch && matchesCategory;
  };

  const filtered = shortcuts.filter(matchesFilters);

  if (selected) {
    return <ShortcutDetail shortcut={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="flex flex-col h-full p-5 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">Agent Hub</h2>
          <span className="text-xs text-text-muted font-mono">
            {filtered.length} {filtered.length === 1 ? "shortcut" : "shortcuts"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {(["speed", "accuracy", "cost"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-semibold transition-all cursor-pointer ${
                categoryFilter === cat
                  ? CATEGORY_STYLES[cat] + " ring-1 ring-current"
                  : categoryFilter
                    ? "bg-surface-raised text-text-muted opacity-50 hover:opacity-100"
                    : CATEGORY_STYLES[cat]
              }`}
            >
              <CategoryIcon category={cat} className="w-3 h-3" />
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search shortcuts by task or suggestion..."
          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-border-bright bg-background input-inset focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* Shortcut cards */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-text-muted">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-2 w-2 rounded-full bg-accent animate-pulse" style={{ animationDelay: `${i * 0.16}s` }} />
              ))}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="session-dot-grid flex flex-col items-center justify-center h-40 rounded-xl text-text-muted gap-2">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
            </svg>
            <p className="text-xs font-medium text-text-secondary">No shortcuts yet</p>
            <p className="text-[11px] text-text-muted">Run your first task to start learning</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((shortcut) => (
              <ShortcutCard key={shortcut.id} shortcut={shortcut} onClick={() => setSelected(shortcut)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Category Badge with SVG icon ---

function CategoryIcon({ category, className = "w-3 h-3" }: { category: string; className?: string }) {
  if (category === "speed") {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
      </svg>
    );
  }
  if (category === "accuracy") {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

const CATEGORY_STYLES: Record<string, string> = {
  speed: "bg-accent/10 text-accent",
  accuracy: "bg-success/10 text-success",
  cost: "bg-warning/10 text-warning",
};

function CategoryBadge({ category, count }: { category: string; count: number }) {
  const style = CATEGORY_STYLES[category] || "";
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-semibold ${style}`}>
      <CategoryIcon category={category} className="w-3 h-3" />
      {label} {count}
    </span>
  );
}

function displayDomain(domain: string): string {
  if (!domain || domain === "unknown") return "";
  return domain;
}

// --- Shortcut Card ---

function ShortcutCard({ shortcut, onClick }: { shortcut: HubShortcut; onClick: () => void }) {
  const impactStyle: Record<string, string> = {
    high: "text-success",
    medium: "text-warning",
    low: "text-text-muted",
  };

  const domain = displayDomain(shortcut.siteDomain);

  return (
    <button
      onClick={onClick}
      className="card p-4 flex flex-col gap-2 hover:shadow-md hover:border-accent/30 transition-all text-left cursor-pointer group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-accent transition-colors">
          {shortcut.suggestion}
        </p>
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${CATEGORY_STYLES[shortcut.category] || ""}`}>
          <CategoryIcon category={shortcut.category} className="w-2.5 h-2.5" />
          {shortcut.category}
        </span>
      </div>

      <p className="text-xs text-text-secondary line-clamp-2">{shortcut.how}</p>

      {shortcut.when && (
        <p className="text-[10px] text-text-muted line-clamp-1">When: {shortcut.when}</p>
      )}

      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border">
        {domain && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary font-mono">
            {domain}
          </span>
        )}
        {shortcut.abResult ? (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            shortcut.abResult.winner === "trained" ? "bg-success/10 text-success" :
            shortcut.abResult.winner === "baseline" ? "bg-error/10 text-error" :
            "bg-surface-raised text-text-muted"
          }`}>
            {shortcut.abResult.winner === "trained" ? "Verified" : shortcut.abResult.winner === "baseline" ? "Failed" : "Tie"}
          </span>
        ) : (
          <span className={`text-[10px] font-medium ${impactStyle[shortcut.estimatedImpact] || ""}`}>
            {shortcut.estimatedImpact} impact
          </span>
        )}
        <span className="text-[10px] text-text-muted font-mono ml-auto">
          {shortcut.runCount} {shortcut.runCount === 1 ? "run" : "runs"}
        </span>
        <svg className="w-3.5 h-3.5 text-text-muted group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </button>
  );
}

function formatStepDelta(stepsSaved: number): string | undefined {
  if (stepsSaved === 0) return undefined;
  if (stepsSaved > 0) return `${stepsSaved} fewer`;
  return `${-stepsSaved} more`;
}

function formatTimeDelta(timeSavedMs: number): string | undefined {
  if (timeSavedMs === 0) return undefined;
  const s = Math.abs(timeSavedMs) / 1000;
  if (timeSavedMs > 0) return `${s.toFixed(1)}s faster`;
  return `${s.toFixed(1)}s slower`;
}

function formatStepDeltaSummary(stepsSaved: number): string {
  if (stepsSaved === 0) return "Same";
  if (stepsSaved > 0) return `${stepsSaved} fewer`;
  return `${-stepsSaved} more`;
}

function formatTimeDeltaSummary(timeSavedMs: number): string {
  if (timeSavedMs === 0) return "Same";
  const s = Math.abs(timeSavedMs) / 1000;
  if (timeSavedMs > 0) return `${s.toFixed(1)}s faster`;
  return `${s.toFixed(1)}s slower`;
}

/** Human-readable summary when the trained agent wins an A/B run. */
function trainedWinSummary(ab: ABResult): string {
  if (!ab.baselineSuccess && ab.trainedSuccess) {
    return "Trained agent won — completed the task while baseline did not.";
  }
  const faster = ab.improvementPct > 0 ? `${ab.improvementPct}% faster` : null;
  const fewerSteps =
    ab.stepsSaved > 0
      ? `${ab.stepsSaved} fewer step${ab.stepsSaved === 1 ? "" : "s"}`
      : null;
  if (faster && fewerSteps) {
    return `Trained agent won — ${faster}, ${fewerSteps}.`;
  }
  if (faster) {
    return `Trained agent won — ${faster}.`;
  }
  if (fewerSteps) {
    const slower = ab.improvementPct < 0 ? ` (${-ab.improvementPct}% longer)` : "";
    return `Trained agent won — ${fewerSteps}${slower}.`;
  }
  return "Trained agent won — see comparison below.";
}

// --- Detail View ---

function ShortcutDetail({ shortcut, onBack }: { shortcut: HubShortcut; onBack: () => void }) {
  const [abResult, setAbResult] = useState<ABResult | undefined>(shortcut.abResult);
  const [abStatus, setAbStatus] = useState<ABTestStatus>("idle");
  const [baselineSteps, setBaselineSteps] = useState<AgentStep[]>([]);
  const [trainedSteps, setTrainedSteps] = useState<AgentStep[]>([]);
  const [baselineMetrics, setBaselineMetrics] = useState<{ steps: number; timeMs: number; success: boolean } | null>(null);
  const [trainedMetrics, setTrainedMetrics] = useState<{ steps: number; timeMs: number; success: boolean } | null>(null);
  const [abError, setAbError] = useState<string | null>(null);

  const { startTest, cancelTest } = useABTestStream({
    onStatusChange: setAbStatus,
    onBaselineStep: useCallback((step: AgentStep) => setBaselineSteps((prev) => [...prev, step]), []),
    onTrainedStep: useCallback((step: AgentStep) => setTrainedSteps((prev) => [...prev, step]), []),
    onBaselineComplete: useCallback((m: { steps: number; timeMs: number; success: boolean; message: string }) => setBaselineMetrics(m), []),
    onTrainedComplete: useCallback((m: { steps: number; timeMs: number; success: boolean; message: string }) => setTrainedMetrics(m), []),
    onResult: useCallback((result: ABResult) => setAbResult(result), []),
    onError: useCallback((err: string) => setAbError(err), []),
  });

  function handleRunTest() {
    setAbResult(undefined);
    setBaselineSteps([]);
    setTrainedSteps([]);
    setBaselineMetrics(null);
    setTrainedMetrics(null);
    setAbError(null);
    const task = shortcut.taskPattern || "Complete the task";
    startTest(shortcut.id, task, DEFAULT_MODEL, DEFAULT_MAX_STEPS);
  }

  const ab = abResult;
  const hasAB = !!ab;
  const isRunning = abStatus === "baseline_running" || abStatus === "trained_running";
  const domain = displayDomain(shortcut.siteDomain);
  const abRecoveryWin =
    !!ab && !ab.baselineSuccess && ab.trainedSuccess && ab.winner === "trained";

  return (
    <div className="flex flex-col h-full p-5 gap-5 overflow-y-auto animate-slide-in">
      {/* Back button */}
      <button
        onClick={() => { cancelTest(); onBack(); }}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-foreground transition-colors self-start"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        Back to Hub
      </button>

      {/* Shortcut header — task pattern as title */}
      <div className="card p-6">
        {shortcut.taskPattern && (
          <div className="mb-4 pb-4 border-b border-border">
            <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide">
              Task Pattern
            </span>
            <p className="text-base font-semibold text-foreground mt-1">
              {shortcut.taskPattern}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${CATEGORY_STYLES[shortcut.category] || ""}`}>
            <CategoryIcon category={shortcut.category} className="w-3 h-3" />
            {shortcut.category}
          </span>
          {domain && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary font-mono">
              {domain}
            </span>
          )}
          {(shortcut.status === "verified" || (ab && ab.winner === "trained")) && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-success/10 text-success flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Verified
            </span>
          )}
        </div>

        <h2 className="text-lg font-semibold text-foreground">{shortcut.suggestion}</h2>

        <div className="mt-3 space-y-1.5">
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-foreground">How:</span> {shortcut.how}
          </p>
          {shortcut.when && (
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-foreground">When:</span> {shortcut.when}
            </p>
          )}
        </div>

        <div className="flex items-center gap-6 mt-4 pt-4 border-t border-border">
          <StatChip label="Runs" value={shortcut.runCount} />
          <StatChip label="Impact" value={shortcut.estimatedImpact} />
          <StatChip label="Success" value={shortcut.successAssociations} />
          {shortcut.createdAt && (
            <StatChip
              label="Created"
              value={new Date(parseInt(shortcut.createdAt) * 1000).toLocaleDateString()}
            />
          )}
        </div>
      </div>

      {/* A/B Test Results */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
            A/B Comparison
          </h3>
          {hasAB && !isRunning && (
            <button
              onClick={handleRunTest}
              className="text-[10px] font-medium px-2.5 py-1 rounded-md border border-border text-text-secondary hover:text-foreground hover:border-accent/30 transition-all"
            >
              Re-run Test
            </button>
          )}
        </div>

        {/* Live progress during test */}
        {isRunning && (
          <div className="space-y-4 animate-slide-in">
            {/* Phase indicator */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${abStatus === "baseline_running" ? "bg-accent animate-pulse" : baselineMetrics ? "bg-success" : "bg-border"}`} />
                <span className={`text-xs font-medium ${abStatus === "baseline_running" ? "text-accent" : baselineMetrics ? "text-success" : "text-text-muted"}`}>
                  Baseline {baselineMetrics ? `(${baselineMetrics.steps} steps, ${(baselineMetrics.timeMs / 1000).toFixed(1)}s)` : abStatus === "baseline_running" ? `(${baselineSteps.length} steps...)` : ""}
                </span>
              </div>
              <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${abStatus === "trained_running" ? "bg-accent animate-pulse" : trainedMetrics ? "bg-success" : "bg-border"}`} />
                <span className={`text-xs font-medium ${abStatus === "trained_running" ? "text-accent" : trainedMetrics ? "text-success" : "text-text-muted"}`}>
                  Trained {trainedMetrics ? `(${trainedMetrics.steps} steps, ${(trainedMetrics.timeMs / 1000).toFixed(1)}s)` : abStatus === "trained_running" ? `(${trainedSteps.length} steps...)` : ""}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{
                  width: abStatus === "baseline_running"
                    ? `${Math.min(50, (baselineSteps.length / DEFAULT_MAX_STEPS) * 50)}%`
                    : `${50 + Math.min(50, (trainedSteps.length / DEFAULT_MAX_STEPS) * 50)}%`,
                }}
              />
            </div>

            {/* Live step feed (last 3 steps) */}
            <div className="space-y-1.5">
              {(abStatus === "baseline_running" ? baselineSteps : trainedSteps).slice(-3).map((step, i) => (
                <div key={`${step.index}-${i}`} className="flex items-center gap-2 text-xs text-text-secondary animate-slide-in">
                  <span className="text-[10px] font-mono text-text-muted w-4 text-right">{step.index + 1}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    step.action === "navigate" ? "bg-accent/10 text-accent" :
                    step.action === "click" ? "bg-success/10 text-success" :
                    step.action === "type" ? "bg-warning/10 text-warning" :
                    "bg-surface-raised text-text-muted"
                  }`}>{step.action}</span>
                  <span className="truncate">{step.description}</span>
                </div>
              ))}
            </div>

            <button
              onClick={cancelTest}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-error/30 text-error hover:bg-error/5 transition-all self-start"
            >
              Cancel Test
            </button>
          </div>
        )}

        {/* Error state */}
        {abStatus === "failed" && abError && !hasAB && (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <div className="px-4 py-3 rounded-lg bg-error/5 border border-error/20 text-error text-sm w-full">
              A/B test failed: {abError}
            </div>
            <button
              onClick={handleRunTest}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent-dim active:scale-[0.98] transition-all"
            >
              Retry A/B Test
            </button>
          </div>
        )}

        {/* Completed results */}
        {hasAB && !isRunning ? (
          <>
            <div
              className={`px-4 py-3 rounded-lg mb-4 text-sm font-medium ${
                ab.winner === "trained"
                  ? "bg-success/5 border border-success/20 text-success"
                  : ab.winner === "baseline"
                    ? "bg-error/5 border border-error/20 text-error"
                    : "bg-surface border border-border text-text-secondary"
              }`}
            >
              {ab.winner === "trained" ? (
                <>{trainedWinSummary(ab)}</>
              ) : ab.winner === "baseline" ? (
                <>Baseline agent performed better on this task</>
              ) : (
                <>Results were inconclusive — performance was similar</>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-2 w-2 rounded-full bg-text-muted" />
                  <span className="text-xs font-semibold text-text-secondary uppercase">Baseline</span>
                </div>
                <div className="space-y-3">
                  <ComparisonMetric label="Steps" value={ab.baselineSteps} isWorse={ab.baselineSteps > ab.trainedSteps} />
                  <ComparisonMetric label="Time" value={`${(ab.baselineTimeMs / 1000).toFixed(1)}s`} isWorse={ab.baselineTimeMs > ab.trainedTimeMs} />
                  <ComparisonMetric label="Success" value={ab.baselineSuccess ? "Yes" : "No"} isWorse={!ab.baselineSuccess && ab.trainedSuccess} />
                </div>
              </div>
              <div className="rounded-lg border-2 border-accent/30 bg-accent/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-2 w-2 rounded-full bg-accent" />
                  <span className="text-xs font-semibold text-accent uppercase">Trained</span>
                  {ab.winner === "trained" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-semibold ml-auto">Winner</span>
                  )}
                </div>
                <div className="space-y-3">
                  <ComparisonMetric
                    label="Steps"
                    value={ab.trainedSteps}
                    isBetter={ab.trainedSteps < ab.baselineSteps}
                    delta={formatStepDelta(ab.stepsSaved)}
                  />
                  <ComparisonMetric
                    label="Time"
                    value={`${(ab.trainedTimeMs / 1000).toFixed(1)}s`}
                    isBetter={ab.trainedTimeMs < ab.baselineTimeMs}
                    delta={formatTimeDelta(ab.timeSavedMs)}
                  />
                  <ComparisonMetric label="Success" value={ab.trainedSuccess ? "Yes" : "No"} isBetter={ab.trainedSuccess && !ab.baselineSuccess} />
                </div>
              </div>
            </div>

            {ab.winner === "trained" && (
              abRecoveryWin ? (
                <div className="mt-4 rounded-lg bg-success/5 border border-success/20 px-4 py-3 text-sm text-text-secondary text-center">
                  Baseline did not finish successfully, so time and step &quot;savings&quot; are not comparable.
                  The shortcut still proved its value by completing the task.
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-success/5 border border-success/20 p-3 text-center">
                    <p className="text-[10px] text-text-muted uppercase">Step Δ (vs baseline)</p>
                    <p
                      className={`text-lg font-semibold stat-value ${
                        ab.stepsSaved > 0 ? "text-success" : ab.stepsSaved < 0 ? "text-warning" : "text-foreground"
                      }`}
                    >
                      {formatStepDeltaSummary(ab.stepsSaved)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-success/5 border border-success/20 p-3 text-center">
                    <p className="text-[10px] text-text-muted uppercase">Time Δ (vs baseline)</p>
                    <p
                      className={`text-lg font-semibold stat-value ${
                        ab.timeSavedMs > 0 ? "text-success" : ab.timeSavedMs < 0 ? "text-warning" : "text-foreground"
                      }`}
                    >
                      {formatTimeDeltaSummary(ab.timeSavedMs)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-success/5 border border-success/20 p-3 text-center">
                    <p className="text-[10px] text-text-muted uppercase">Runtime vs baseline</p>
                    <p
                      className={`text-lg font-semibold stat-value ${
                        ab.improvementPct > 0 ? "text-success" : ab.improvementPct < 0 ? "text-warning" : "text-foreground"
                      }`}
                    >
                      {ab.improvementPct > 0 ? "+" : ""}
                      {ab.improvementPct}%
                    </p>
                  </div>
                </div>
              )
            )}
          </>
        ) : !isRunning && abStatus !== "failed" ? (
          <div className="flex flex-col items-center justify-center py-8 text-text-muted gap-4">
            <svg className="w-10 h-10 text-border-bright" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
            <div className="text-center max-w-md">
              <p className="text-sm font-medium text-text-secondary">No A/B test results yet</p>
              <p className="text-xs text-text-muted mt-1">
                This optimization was discovered by the AI observer. To verify it works, an A/B test compares a baseline agent (no optimization) vs a trained agent (with this shortcut applied).
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 w-full max-w-sm mt-2">
              <div className="rounded-lg bg-surface border border-border p-2.5 text-center">
                <p className="text-[10px] text-text-muted uppercase">Steps</p>
                <p className="text-xs font-medium text-text-secondary mt-0.5">Fewer actions?</p>
              </div>
              <div className="rounded-lg bg-surface border border-border p-2.5 text-center">
                <p className="text-[10px] text-text-muted uppercase">Time</p>
                <p className="text-xs font-medium text-text-secondary mt-0.5">Faster completion?</p>
              </div>
              <div className="rounded-lg bg-surface border border-border p-2.5 text-center">
                <p className="text-[10px] text-text-muted uppercase">Success</p>
                <p className="text-xs font-medium text-text-secondary mt-0.5">More reliable?</p>
              </div>
            </div>
            <button
              onClick={handleRunTest}
              className="mt-2 px-4 py-2 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent-dim active:scale-[0.98] transition-all"
            >
              Run A/B Test
            </button>
          </div>
        ) : null}
      </div>

      {/* Context injection preview */}
      <div className="card p-6">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">
          Optimization Injected as Context
        </h3>
        <div className="bg-surface rounded-lg p-4 font-mono text-xs text-text-secondary leading-relaxed">
          <span className="text-accent font-semibold">[{shortcut.category}]</span>{" "}
          {shortcut.suggestion}
          <br />
          <span className="text-text-muted">   How:</span> {shortcut.how}
          {shortcut.when && (
            <>
              <br />
              <span className="text-text-muted">   When:</span> {shortcut.when}
            </>
          )}
          {shortcut.runCount > 1 && (
            <>
              <br />
              <span className="text-text-muted">   Confidence:</span> Used in {shortcut.runCount} runs
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-text-muted uppercase">{label}</span>
      <span className="text-sm font-semibold stat-value">{value}</span>
    </div>
  );
}

function ComparisonMetric({ label, value, isBetter, isWorse, delta }: {
  label: string; value: string | number; isBetter?: boolean; isWorse?: boolean; delta?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`text-sm font-semibold stat-value ${isBetter ? "text-success" : isWorse ? "text-error" : "text-foreground"}`}>
          {value}
        </span>
        {delta && <span className="text-[10px] font-mono text-success">{delta}</span>}
      </div>
    </div>
  );
}
