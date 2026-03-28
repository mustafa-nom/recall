"use client";

import { useRef, useCallback } from "react";
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

  const startRun = useCallback(
    async (task: string, model: string, maxSteps: number) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      options.onStatusChange("running");

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

          switch (event.type) {
            case "session_created":
              if (event.liveViewUrl) {
                options.onLiveViewUrl?.(event.liveViewUrl);
              }
              break;

            case "agent_started":
              options.onShortcutsApplied(event.shortcutsApplied);
              // Agent started may also carry liveViewUrl
              if ("liveViewUrl" in event && (event as Record<string, unknown>).liveViewUrl) {
                options.onLiveViewUrl?.((event as Record<string, unknown>).liveViewUrl as string);
              }
              break;

            case "step_progress":
              options.onStep({
                index: event.stepIndex,
                action: event.action.type,
                description: event.action.action,
                reasoning: event.action.reasoning,
                durationMs: event.timing.stepDurationMs,
                cumulativeTimeMs: event.timing.totalElapsedMs,
                shortcutApplied: event.shortcutApplied,
              });
              options.onTimingUpdate({
                totalElapsedMs: event.timing.totalElapsedMs,
                avgStepMs: event.timing.totalElapsedMs / (event.stepIndex + 1),
              });
              break;

            case "agent_completed":
              options.onTimingUpdate(event.timing);
              options.onUsageUpdate(event.usage);
              options.onComplete(event.success, event.message);
              options.onStatusChange(event.success ? "complete" : "failed");
              break;

            case "agent_error":
              options.onError(event.error);
              options.onStatusChange("failed");
              break;
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          options.onStatusChange("cancelled");
        } else {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          options.onError(message);
          options.onStatusChange("failed");
        }
      }
    },
    [options]
  );

  const cancelRun = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  return { startRun, cancelRun };
}
