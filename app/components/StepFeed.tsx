"use client";

import { useEffect, useRef } from "react";
import type { AgentStatus, AgentStep } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StepFeedProps {
  steps: AgentStep[];
  status: AgentStatus;
}

const ACTION_COLORS: Record<string, string> = {
  navigate: "bg-accent/10 text-accent",
  click: "bg-success/10 text-success",
  type: "bg-warning/10 text-warning",
  scroll: "bg-text-secondary/10 text-text-secondary",
  press_key: "bg-accent/10 text-accent",
  extract: "bg-success/10 text-success",
  task_complete: "bg-success/10 text-success",
  unknown: "bg-surface-raised text-text-muted",
};

function capitalize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StepCard({
  step,
  isLatest,
}: {
  step: AgentStep;
  isLatest: boolean;
}) {
  return (
    <div
      className={`step-card-enter flex gap-3 p-3 rounded-lg border transition-all ${
        isLatest
          ? "border-accent/40 shadow-md shadow-accent/5 bg-white"
          : "border-border bg-white"
      }`}
    >
      {/* Step number */}
      <div
        className={`h-7 w-7 rounded-md flex items-center justify-center text-xs font-semibold shrink-0 ${
          isLatest
            ? "bg-accent/10 text-accent border border-accent/30"
            : "bg-surface-raised text-text-secondary border border-border"
        }`}
      >
        {step.index + 1}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                ACTION_COLORS[step.action] || ACTION_COLORS.unknown
              }`}
            >
              {capitalize(step.action)}
            </span>
            {step.shortcutApplied && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-light text-accent">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                </svg>
                shortcut
              </span>
            )}
          </div>
          {/* Dual timing: step duration | cumulative */}
          <span className="text-[10px] text-text-muted font-mono shrink-0">
            {formatMs(step.durationMs)}{" "}
            <span className="text-border-bright">|</span>{" "}
            {formatMs(step.cumulativeTimeMs)}
          </span>
        </div>
        <p className="text-sm text-text-secondary truncate">
          {step.description}
        </p>
        {step.reasoning && (
          <p className="text-xs text-text-muted mt-1 line-clamp-2">
            {step.reasoning}
          </p>
        )}
      </div>
    </div>
  );
}

export function AgentStepsPanelHeader({
  stepCount,
  className,
}: {
  stepCount: number;
  className?: string;
}) {
  return (
    <div className={cn("panel-header-row min-w-0", className)}>
      <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
        Agent Steps
      </h3>
      {stepCount > 0 && (
        <span className="text-[10px] font-mono text-text-muted">
          {stepCount} {stepCount === 1 ? "step" : "steps"}
        </span>
      )}
    </div>
  );
}

interface StepFeedPropsWithHeader extends StepFeedProps {
  /** When true, title row is omitted (rendered in AgentTab shared header row). */
  hideHeader?: boolean;
}

export default function StepFeed({
  steps,
  status,
  hideHeader = false,
}: StepFeedPropsWithHeader) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {!hideHeader && (
        <AgentStepsPanelHeader
          stepCount={steps.length}
          className="border-b border-border"
        />
      )}

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {steps.length === 0 && status === "idle" && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
            <svg className="w-8 h-8 text-border-bright" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" />
            </svg>
            <div className="text-center">
              <p className="text-xs font-medium text-text-secondary">Agent Steps</p>
              <p className="text-[11px] text-text-muted mt-0.5">Each action the agent takes will be logged here</p>
            </div>
          </div>
        )}

        {steps.length === 0 && status === "running" && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse"
                  style={{ animationDelay: `${i * 0.16}s` }}
                />
              ))}
            </div>
            <p className="text-xs">Agent is working...</p>
          </div>
        )}

        {steps.map((step, i) => (
          <StepCard
            key={step.index}
            step={step}
            isLatest={i === steps.length - 1 && status === "running"}
          />
        ))}

        {status === "running" && steps.length > 0 && (
          <div className="flex items-center justify-center gap-1 py-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-1 w-1 rounded-full bg-accent animate-pulse"
                style={{ animationDelay: `${i * 0.16}s` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
