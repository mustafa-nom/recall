"use client";

import { useState, useCallback } from "react";
import TaskInput from "./TaskInput";
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
  const [shortcutsApplied, setShortcutsApplied] = useState(0);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [liveViewUrl, setLiveViewUrl] = useState("");
  const [latestScreenshotB64] = useState<string | null>(null);

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
    latestScreenshot: latestScreenshotB64,
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
    <div className="flex flex-col h-full">
      {status === "running" && <div className="running-bar" />}

      <div className="flex flex-1 overflow-hidden p-5">
        <div className="flex flex-col flex-1 gap-4 min-w-0 pb-6">
          <SessionViewer
            status={status}
            liveViewUrl={liveViewUrl}
            screenshotUrl={screenshotUrl}
            completionMessage={message?.text}
            stepCount={steps.length}
            totalTimeMs={timing.totalElapsedMs}
          />

          <StatsBar
            steps={steps.length}
            timing={timing}
            usage={usage}
            shortcutsApplied={shortcutsApplied}
            suggestions={suggestions.length}
            status={status}
          />

          {message && status !== "complete" && status !== "failed" && (
            <div
              className={`animate-slide-in px-4 py-2.5 rounded-lg border-l-4 text-sm ${
                message.type === "success"
                  ? "bg-success/5 border-success text-success"
                  : "bg-error/5 border-error text-error"
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="flex flex-1 gap-4 min-h-[300px]">
            <div className="flex-[3] min-w-0 overflow-hidden">
              <StepFeed steps={steps} status={status} />
            </div>
            <div className="flex-[2] min-w-0 overflow-hidden">
              <SuggestionsPanel suggestions={suggestions} status={status} />
            </div>
          </div>
        </div>
      </div>

      {/* Floating morphing task input */}
      <TaskInput
        status={status}
        maxSteps={maxSteps}
        onMaxStepsChange={setMaxSteps}
        onRun={handleRun}
        onCancel={handleCancel}
        onReset={handleReset}
      />
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
