"use client";

import { useState, useCallback } from "react";
import TaskInput from "./TaskInput";
import SidePanel from "./SidePanel";
import SessionViewer from "./SessionViewer";
import StatsBar from "./StatsBar";
import StepFeed from "./StepFeed";
import SuggestionsPanel from "./SuggestionsPanel";
import type {
  AgentStatus,
  AgentStep,
  AgentTiming,
  AgentUsage,
  Suggestion,
} from "@/lib/types";
import { DEFAULT_MODEL, DEFAULT_MAX_STEPS } from "@/lib/constants";
import { useAgentStream } from "@/hooks/useAgentStream";
import { useObserver } from "@/hooks/useObserver";

interface AgentTabProps {
  onStatusChange?: (status: AgentStatus) => void;
}

export default function AgentTab({ onStatusChange }: AgentTabProps) {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [task, setTask] = useState("");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [timing, setTiming] = useState<AgentTiming>({
    totalElapsedMs: 0,
    avgStepMs: 0,
  });
  const [usage, setUsage] = useState<AgentUsage>({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
  const [maxSteps, setMaxSteps] = useState(DEFAULT_MAX_STEPS);
  const [panelMode, setPanelMode] = useState<"bottom" | "side">("bottom");
  const [bottomBarExpanded, setBottomBarExpanded] = useState(false);
  const [shortcutsApplied, setShortcutsApplied] = useState(0);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [liveViewUrl, setLiveViewUrl] = useState("");

  // Observer hook
  const handleSuggestion = useCallback((suggestion: Suggestion) => {
    setSuggestions((prev) => [...prev, suggestion]);
  }, []);

  const handlePostRunSuggestions = useCallback(
    (newSuggestions: Suggestion[]) => {
      setSuggestions((prev) => [...prev, ...newSuggestions]);
    },
    []
  );

  const { runPostRunAnalysis } = useObserver({
    status,
    task,
    steps,
    onSuggestion: handleSuggestion,
    onPostRunSuggestions: handlePostRunSuggestions,
  });

  const updateStatus = useCallback(
    (newStatus: AgentStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    },
    [onStatusChange]
  );

  const { startRun, cancelRun } = useAgentStream({
    onStatusChange: (newStatus) => {
      updateStatus(newStatus);
      if (newStatus === "complete" || newStatus === "failed") {
        const domain = extractDomain(task, steps);
        runPostRunAnalysis(
          domain,
          newStatus === "complete",
          timing.totalElapsedMs
        );
      }
    },
    onStep: (step) => setSteps((prev) => [...prev, step]),
    onTimingUpdate: setTiming,
    onUsageUpdate: setUsage,
    onShortcutsApplied: setShortcutsApplied,
    onLiveViewUrl: setLiveViewUrl,
    onScreenshot: setScreenshotUrl,
    onComplete: (success, msg) => {
      setMessage({ type: success ? "success" : "error", text: msg });
    },
    onError: (error) => {
      setMessage({ type: "error", text: error });
    },
  });

  const handleRun = useCallback(
    (taskText: string) => {
      setTask(taskText);
      setSteps([]);
      setSuggestions([]);
      setMessage(null);
      setScreenshotUrl(null);
      setLiveViewUrl("");
      setShortcutsApplied(0);
      setTiming({ totalElapsedMs: 0, avgStepMs: 0 });
      setUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
      startRun(taskText, DEFAULT_MODEL, maxSteps);
    },
    [startRun, maxSteps]
  );

  const handleCancel = useCallback(() => {
    cancelRun();
  }, [cancelRun]);

  const handleReset = useCallback(() => {
    updateStatus("idle");
    setTask("");
    setSteps([]);
    setSuggestions([]);
    setMessage(null);
    setScreenshotUrl(null);
    setLiveViewUrl("");
    setShortcutsApplied(0);
    setTiming({ totalElapsedMs: 0, avgStepMs: 0 });
    setUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  }, [updateStatus]);

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full bg-background overflow-hidden relative">
      {status === "running" && <div className="running-bar absolute top-0 left-0 right-0 z-50" />}

      {/* Top Status Bar */}
      <StatsBar
        steps={steps.length}
        timing={timing}
        usage={usage}
        shortcutsApplied={shortcutsApplied}
        suggestions={suggestions.length}
        status={status}
      />

      {/* Optional Message Overlay */}
      {message && status !== "complete" && status !== "failed" && (
        <div
          className={`px-4 py-2 border-b border-border text-sm ${
            message.type === "success"
              ? "bg-success/5 text-success"
              : "bg-error/5 text-error"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Main Content Area + optional SidePanel */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* 2-column layout: Browser left, Feeds right */}
        <div className="flex-1 min-h-0 flex divide-x divide-border overflow-hidden">
          {/* Left Column (50%): Browser Preview */}
          <div className="w-1/2 flex flex-col h-full min-h-0 min-w-0 bg-surface">
            <SessionViewer
              status={status}
              liveViewUrl={liveViewUrl}
              screenshotUrl={screenshotUrl}
              completionMessage={message?.text}
              stepCount={steps.length}
              totalTimeMs={timing.totalElapsedMs}
            />
          </div>

          {/* Right Column (50%): Feeds stacked */}
          <div className="w-1/2 flex flex-col h-full min-h-0 min-w-0 divide-y divide-border overflow-hidden">
            <div className="flex-1 min-h-0 bg-surface flex flex-col overflow-hidden">
              <StepFeed steps={steps} status={status} />
            </div>
            <div className="flex-1 min-h-0 bg-surface flex flex-col overflow-hidden">
              <SuggestionsPanel suggestions={suggestions} status={status} />
            </div>
          </div>
        </div>

        {/* Side panel */}
        {panelMode === "side" && (
          <SidePanel
            status={status}
            maxSteps={maxSteps}
            onMaxStepsChange={setMaxSteps}
            onRun={handleRun}
            onCancel={handleCancel}
            onReset={handleReset}
            onSwitchToBottom={() => {
              setBottomBarExpanded(true);
              setPanelMode("bottom");
            }}
            onClose={() => {
              setBottomBarExpanded(false);
              setPanelMode("bottom");
            }}
          />
        )}
      </div>

      {/* Floating morphing task input (only in bottom mode) */}
      {panelMode === "bottom" && (
        <TaskInput
          key={`bottom-${bottomBarExpanded}`}
          initialExpanded={bottomBarExpanded}
          status={status}
          maxSteps={maxSteps}
          onMaxStepsChange={setMaxSteps}
          onRun={handleRun}
          onCancel={handleCancel}
          onReset={handleReset}
          onSwitchToSidePanel={() => setPanelMode("side")}
        />
      )}
    </div>
  );
}

function extractDomain(task: string, steps?: AgentStep[]): string {
  // 1. Try to extract from agent's navigate actions (most accurate)
  if (steps?.length) {
    for (const step of steps) {
      if (step.action === "navigate" && step.description) {
        const navUrlMatch = step.description.match(
          /https?:\/\/(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/
        );
        if (navUrlMatch) return navUrlMatch[1];
      }
    }
  }

  // 2. Try to extract URL from the task text
  const urlMatch = task.match(
    /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/
  );
  if (urlMatch) return urlMatch[1];

  // 3. Match common site keywords
  const sites: Record<string, string> = {
    "google flights": "google.com/flights",
    "google maps": "maps.google.com",
    google: "google.com",
    amazon: "amazon.com",
    github: "github.com",
    youtube: "youtube.com",
    reddit: "reddit.com",
    wikipedia: "wikipedia.org",
    arxiv: "arxiv.org",
    twitter: "twitter.com",
    linkedin: "linkedin.com",
    stackoverflow: "stackoverflow.com",
    "stack overflow": "stackoverflow.com",
  };

  const lower = task.toLowerCase();
  for (const [keyword, domain] of Object.entries(sites)) {
    if (lower.includes(keyword)) return domain;
  }

  return "unknown";
}
