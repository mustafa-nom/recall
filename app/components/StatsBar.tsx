"use client";

import type { AgentStatus, AgentTiming, AgentUsage } from "@/lib/types";

interface StatsBarProps {
  /** Number of browser/tool actions recorded this run */
  steps: number;
  /** Configured per-run cap (same value sent to the worker) */
  maxSteps: number;
  timing: AgentTiming;
  usage: AgentUsage;
  shortcutsApplied: number;
  suggestions: number;
  status: AgentStatus;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatPill({
  label,
  value,
  sub,
  icon,
  title,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  title?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center py-2.5 px-2 text-center"
      title={title}
    >
      <div className="flex items-center gap-1 mb-0.5">
        <div className="text-text-muted opacity-70 scale-75">{icon}</div>
        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[15px] font-bold text-foreground">{value}</span>
        {sub && (
          <span className="text-[10px] text-text-muted font-mono">{sub}</span>
        )}
      </div>
    </div>
  );
}

export default function StatsBar({
  steps,
  maxSteps,
  timing,
  shortcutsApplied,
  suggestions,
  status,
}: StatsBarProps) {
  const isActive = status === "running" || status === "complete" || status === "failed";

  return (
    <div className={`grid grid-cols-5 divide-x divide-border w-full border-b border-border border-t bg-surface shrink-0 ${isActive ? "animate-slide-in" : ""}`}>
      <StatPill
        label="Actions"
        title={
          isActive
            ? `First number: browser actions taken. "${maxSteps} turns" is the run budget (agent loop limit), not an action quota.`
            : undefined
        }
        value={isActive ? steps : "—"}
        sub={isActive ? `${maxSteps} turns` : undefined}
        icon={
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
          </svg>
        }
      />
      <StatPill
        label="Time"
        value={isActive ? formatMs(timing.totalElapsedMs) : "—"}
        icon={
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        }
      />
      <StatPill
        label="Avg Step"
        value={steps > 0 ? formatMs(timing.avgStepMs) : "—"}
        icon={
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
        }
      />
      <StatPill
        label="Shortcuts"
        value={isActive ? shortcutsApplied : "—"}
        icon={
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
          </svg>
        }
      />
      <StatPill
        label="Suggestions"
        value={isActive ? suggestions : "—"}
        icon={
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
        }
      />
    </div>
  );
}
