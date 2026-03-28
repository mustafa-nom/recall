"use client";

import { useRef, useCallback, useEffect } from "react";
import type {
  AgentStatus,
  AgentStep,
  AgentTiming,
  AgentUsage,
  SSEEvent,
} from "@/lib/types";
import { parseSSEStream } from "@/lib/sse-client";

interface UseAgentStreamOptions {
  onStatusChange: (status: AgentStatus) => void;
  onStep: (step: AgentStep) => void;
  onTimingUpdate: (timing: AgentTiming) => void;
  onUsageUpdate: (usage: AgentUsage) => void;
  onShortcutsApplied: (count: number) => void;
  onLiveViewUrl?: (url: string) => void;
  onScreenshot?: (url: string) => void;
  onComplete: (success: boolean, message: string) => void;
  onError: (error: string) => void;
}

export function useAgentStream(options: UseAgentStreamOptions) {
  const abortRef = useRef<AbortController | null>(null);

  // Keep options in a ref so the long-running SSE loop always reads
  // the latest callbacks, avoiding stale closure bugs.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const startRun = useCallback(
    async (task: string, model: string, maxSteps: number) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      optionsRef.current.onStatusChange("running");

      try {
        const res = await fetch("/api/run-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, model, maxSteps }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        for await (const event of parseSSEStream<SSEEvent>(res)) {
          if (controller.signal.aborted) break;

          const opts = optionsRef.current;

          switch (event.type) {
            case "session_created":
              if (event.liveViewUrl) {
                opts.onLiveViewUrl?.(event.liveViewUrl);
              }
              break;

            case "agent_started":
              opts.onShortcutsApplied(event.shortcutsApplied);
              if ("liveViewUrl" in event && (event as Record<string, unknown>).liveViewUrl) {
                opts.onLiveViewUrl?.((event as Record<string, unknown>).liveViewUrl as string);
              }
              break;

            case "step_progress":
              opts.onStep({
                index: event.stepIndex,
                action: event.action.type,
                description: event.action.action,
                reasoning: event.action.reasoning,
                durationMs: event.timing.stepDurationMs,
                cumulativeTimeMs: event.timing.totalElapsedMs,
                shortcutApplied: event.shortcutApplied,
              });
              opts.onTimingUpdate({
                totalElapsedMs: event.timing.totalElapsedMs,
                avgStepMs: event.timing.totalElapsedMs / (event.stepIndex + 1),
              });
              break;

            case "agent_completed":
              opts.onTimingUpdate(event.timing);
              opts.onUsageUpdate(event.usage);
              opts.onComplete(event.success, event.message);
              opts.onStatusChange(event.success ? "complete" : "failed");
              break;

            case "agent_error":
              opts.onError(event.error);
              opts.onStatusChange("failed");
              break;
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          optionsRef.current.onStatusChange("cancelled");
        } else {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          optionsRef.current.onError(message);
          optionsRef.current.onStatusChange("failed");
        }
      }
    },
    [] // Stable identity — reads from optionsRef.current
  );

  const cancelRun = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  return { startRun, cancelRun };
}
