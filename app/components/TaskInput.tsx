"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentStatus } from "@/lib/types";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { RecallMark } from "@/components/RecallMark";

interface TaskInputProps {
  status: AgentStatus;
  maxSteps: number;
  onMaxStepsChange: (steps: number) => void;
  onRun: (task: string) => void;
  onCancel: () => void;
  onReset: () => void;
  onSwitchToSidePanel?: () => void;
  initialExpanded?: boolean;
}

const MAX_CHARS = 1000;

export const PLACEHOLDER_SUGGESTIONS = [
  "Compare flight prices from SF to Tokyo on Google Flights...",
  "Find the top-rated Italian restaurant in Manhattan on Google Maps...",
  "Search GitHub for the most starred AI agent frameworks...",
  "Find the latest multi-modal AI paper on arxiv...",
  "Look up the best noise-canceling headphones on Amazon...",
  "Find today's trending TypeScript repos on GitHub...",
];

export default function TaskInput({
  status,
  maxSteps,
  onMaxStepsChange,
  onRun,
  onCancel,
  onReset,
  onSwitchToSidePanel,
  initialExpanded = false,
}: TaskInputProps) {
  const [task, setTask] = useState("");
  const [expanded, setExpanded] = useState(initialExpanded);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholderVisible, setPlaceholderVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRunning = status === "running";
  const isDone = status === "complete" || status === "failed";

  const handleSubmit = useCallback(() => {
    const trimmed = task.trim();
    if (!trimmed || isRunning) return;
    onRun(trimmed);
  }, [task, isRunning, onRun]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Same as clicking Run; skip while IME is composing (e.g. Japanese input)
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape" && !isRunning) {
      setSettingsOpen(false);
      setExpanded(false);
    }
    // Tab key to accept current suggestion
    if (e.key === "Tab" && !task && expanded) {
      e.preventDefault();
      setTask(PLACEHOLDER_SUGGESTIONS[placeholderIndex]);
    }
  };

  // Rotate placeholder suggestions
  useEffect(() => {
    if (task || !expanded) return;

    const interval = setInterval(() => {
      setPlaceholderVisible(false);
      setTimeout(() => {
        setPlaceholderIndex((i) => (i + 1) % PLACEHOLDER_SUGGESTIONS.length);
        setPlaceholderVisible(true);
      }, 200);
    }, 3500);

    return () => clearInterval(interval);
  }, [task, expanded]);

  // Click-outside to collapse (ignore clicks inside popovers rendered in portals)
  useEffect(() => {
    if (!expanded) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't collapse if clicking inside the container or any popover portal
      if (containerRef.current?.contains(target)) return;
      if ((target as Element).closest?.("[data-slot='popover-content']")) return;
      if (isRunning) return;
      setSettingsOpen(false);
      setExpanded(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded, isRunning]);

  // Auto-focus input on expand
  useEffect(() => {
    if (expanded) {
      const timer = setTimeout(() => inputRef.current?.focus(), 320);
      return () => clearTimeout(timer);
    }
  }, [expanded]);

  // Force expand when running
  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  const containerClass = [
    "task-input-container",
    expanded ? "task-expanded" : "task-collapsed",
    isRunning ? "task-running" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={containerRef}
      className={containerClass}
      onMouseEnter={() => {
        if (!expanded) setExpanded(true);
      }}
    >
      {/* Collapsed icon */}
      <div className="task-input-icon" aria-hidden={expanded}>
        <RecallMark className="h-4 w-8 text-accent shrink-0" aria-hidden />
      </div>

      {/* Expanded bar */}
      <div className="task-input-bar">
        {/* Settings icon with shadcn popover */}
        <div className="shrink-0">
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                settingsOpen
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:bg-surface-raised hover:text-foreground"
              }`}
              aria-label="Run settings"
              tabIndex={expanded ? 0 : -1}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
            </PopoverTrigger>
            <PopoverContent side="top" sideOffset={12} align="start" className="w-56">
              <PopoverHeader>
                <PopoverTitle>Run Settings</PopoverTitle>
              </PopoverHeader>
              <div className="flex flex-col gap-3 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Max Steps</span>
                  <span className="text-xs font-mono font-medium">
                    {maxSteps}
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={maxSteps}
                  onChange={(e) => onMaxStepsChange(Number(e.target.value))}
                  className="settings-slider"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>5</span>
                  <span>100</span>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Input area with rotating placeholder */}
        <div className="flex-1 min-w-0 relative">
          <input
            ref={inputRef}
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={handleKeyDown}
            placeholder=""
            disabled={isRunning}
            tabIndex={expanded ? 0 : -1}
            aria-label="Task description"
            className="w-full bg-transparent text-sm text-foreground outline-none disabled:opacity-40 disabled:cursor-not-allowed"
          />
          {/* Custom animated placeholder with inline Tab badge */}
          {!task && (
            <div className="absolute inset-0 flex items-center pointer-events-none select-none">
              <span
                className={`text-sm text-text-muted transition-opacity duration-200 inline-flex items-center gap-2 ${
                  placeholderVisible ? "opacity-100" : "opacity-0"
                }`}
              >
                {PLACEHOLDER_SUGGESTIONS[placeholderIndex]}
                {expanded && <span className="tab-badge">Tab</span>}
              </span>
            </div>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isDone && (
            <button
              onClick={onReset}
              className="text-[11px] font-medium text-text-secondary hover:text-foreground transition-colors px-2 py-1 rounded"
              tabIndex={expanded ? 0 : -1}
            >
              Reset
            </button>
          )}

          {/* Side panel toggle */}
          {onSwitchToSidePanel && (
            <button
              onClick={onSwitchToSidePanel}
              className="w-8 h-8 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
              aria-label="Switch to side panel"
              title="Switch to side panel"
              tabIndex={expanded ? 0 : -1}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </button>
          )}

          {isRunning ? (
            <button
              onClick={onCancel}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-error/10 text-error hover:bg-error/20 active:scale-95 transition-all"
              aria-label="Cancel running task"
              tabIndex={expanded ? 0 : -1}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!task.trim()}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-accent text-white hover:bg-accent-dim active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Run agent"
              tabIndex={expanded ? 0 : -1}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
