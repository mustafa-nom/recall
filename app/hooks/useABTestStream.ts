"use client";

import { useRef, useCallback } from "react";
import type { ABTestStatus, ABResult, ABSSEEvent, AgentStep } from "@/lib/types";
import { parseSSEStream } from "@/lib/sse-client";

interface UseABTestStreamOptions {
  onStatusChange: (status: ABTestStatus) => void;
  onBaselineStep: (step: AgentStep) => void;
  onTrainedStep: (step: AgentStep) => void;
  onBaselineComplete: (metrics: {
    steps: number;
    timeMs: number;
    success: boolean;
    message: string;
  }) => void;
  onTrainedComplete: (metrics: {
    steps: number;
    timeMs: number;
    success: boolean;
    message: string;
  }) => void;
  onResult: (result: ABResult) => void;
  onError: (error: string) => void;
}

export function useABTestStream(options: UseABTestStreamOptions) {
  const abortRef = useRef<AbortController | null>(null);

  const startTest = useCallback(
    async (
      shortcutId: string,
      task: string,
      model: string,
      maxSteps: number
    ) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      options.onStatusChange("baseline_running");

      try {
        const res = await fetch("/api/run-ab-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shortcutId, task, model, maxSteps }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        for await (const event of parseSSEStream<ABSSEEvent>(res)) {
          if (controller.signal.aborted) break;

          switch (event.type) {
            case "ab_started":
              break;

            case "ab_baseline_started":
              options.onStatusChange("baseline_running");
              break;

            case "ab_baseline_step":
              options.onBaselineStep({
                index: event.stepIndex,
                action: event.action.type,
                description: event.action.action,
                reasoning: event.action.reasoning,
                durationMs: event.timing.stepDurationMs,
                cumulativeTimeMs: event.timing.totalElapsedMs,
              });
              break;

            case "ab_baseline_completed":
              options.onBaselineComplete({
                steps: event.steps,
                timeMs: event.timeMs,
                success: event.success,
                message: event.message,
              });
              options.onStatusChange("trained_running");
              break;

            case "ab_trained_started":
              options.onStatusChange("trained_running");
              break;

            case "ab_trained_step":
              options.onTrainedStep({
                index: event.stepIndex,
                action: event.action.type,
                description: event.action.action,
                reasoning: event.action.reasoning,
                durationMs: event.timing.stepDurationMs,
                cumulativeTimeMs: event.timing.totalElapsedMs,
              });
              break;

            case "ab_trained_completed":
              options.onTrainedComplete({
                steps: event.steps,
                timeMs: event.timeMs,
                success: event.success,
                message: event.message,
              });
              break;

            case "ab_result":
              options.onResult({
                baselineSteps: event.baselineSteps,
                baselineTimeMs: event.baselineTimeMs,
                baselineSuccess: event.baselineSuccess,
                trainedSteps: event.trainedSteps,
                trainedTimeMs: event.trainedTimeMs,
                trainedSuccess: event.trainedSuccess,
                winner: event.winner,
                improvementPct: event.improvementPct,
                stepsSaved: event.stepsSaved,
                timeSavedMs: event.timeSavedMs,
              });
              options.onStatusChange("complete");
              break;
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          options.onStatusChange("idle");
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

  const cancelTest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  return { startTest, cancelTest };
}
