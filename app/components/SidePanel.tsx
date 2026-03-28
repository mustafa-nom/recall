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
import { PLACEHOLDER_SUGGESTIONS } from "./TaskInput";

interface SidePanelProps {
  status: AgentStatus;
  maxSteps: number;
  onMaxStepsChange: (steps: number) => void;
  onRun: (task: string) => void;
  onCancel: () => void;
  onReset: () => void;
  onSwitchToBottom: () => void;
  onClose: () => void;
}

const MAX_CHARS = 1000;

const HERO_TAGLINES = [
  "Automate any browser task",
  "Extract data from any site",
  "Get results, hands-free",
  "Browse smarter, not harder",
];

// Pick 3 suggestions from the shared list
const QUICK_SUGGESTIONS = PLACEHOLDER_SUGGESTIONS.slice(0, 3).map((s) =>
  s.replace(/\.\.\.$/,  "")
);

export default function SidePanel({
  status,
  maxSteps,
  onMaxStepsChange,
  onRun,
  onCancel,
  onReset,
  onSwitchToBottom,
  onClose,
}: SidePanelProps) {
  const [task, setTask] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [taglineVisible, setTaglineVisible] = useState(true);
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
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      handleSubmit();
    }
  };

  // Rotate hero taglines
  useEffect(() => {
    const interval = setInterval(() => {
      setTaglineVisible(false);
      setTimeout(() => {
        setTaglineIndex((i) => (i + 1) % HERO_TAGLINES.length);
        setTaglineVisible(true);
      }, 250);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="side-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Recall</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onSwitchToBottom}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
            aria-label="Switch to bottom bar"
            title="Switch to bottom bar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="17" x2="21" y2="17" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
            aria-label="Close panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Centered tagline */}
      <div className="flex-1 flex items-center justify-center px-5">
        <span
          className={`text-lg font-semibold text-accent text-center transition-opacity duration-300 ${
            taglineVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {HERO_TAGLINES[taglineIndex]}
        </span>
      </div>

      {/* Bottom section: suggestions + input */}
      <div className="px-4 pb-4 mt-auto">
        {/* Quick suggestions right above input */}
        <div className="flex flex-col gap-0.5 mb-3">
          {QUICK_SUGGESTIONS.map((suggestion, i) => (
            <button
              key={i}
              onClick={() => {
                setTask(suggestion);
                inputRef.current?.focus();
              }}
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
            >
              <svg className="mt-0.5 shrink-0 text-text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              <span>{suggestion}</span>
            </button>
          ))}
        </div>

        {/* Input box with controls inside */}
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-3 pt-2.5 pb-1.5">
            <input
              ref={inputRef}
              type="text"
              value={task}
              onChange={(e) => setTask(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={handleKeyDown}
              placeholder="Enter a task..."
              disabled={isRunning}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-text-muted outline-none disabled:opacity-40 disabled:cursor-not-allowed"
            />
          </div>
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-1">
              <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                <PopoverTrigger
                  className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                    settingsOpen
                      ? "bg-accent/10 text-accent"
                      : "text-text-secondary hover:bg-surface-raised hover:text-foreground"
                  }`}
                  aria-label="Run settings"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                      <span className="text-xs font-mono font-medium">{maxSteps}</span>
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
              {isDone && (
                <button
                  onClick={onReset}
                  className="text-[11px] font-medium text-text-secondary hover:text-foreground transition-colors px-2 py-1 rounded"
                >
                  Reset
                </button>
              )}
            </div>
            {isRunning ? (
              <button
                onClick={onCancel}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-error/10 text-error hover:bg-error/20 active:scale-95 transition-all"
                aria-label="Cancel running task"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!task.trim()}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-accent text-white hover:bg-accent-dim active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Run agent"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
