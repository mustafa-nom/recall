"use client";

import { useRef, useCallback, useEffect } from "react";
import type { AgentStatus, AgentStep, Suggestion } from "@/lib/types";
import { WORKER_URL, OBSERVER_POLL_INTERVAL_MS } from "@/lib/constants";

interface UseObserverOptions {
  status: AgentStatus;
  task: string;
  steps: AgentStep[];
  onSuggestion: (suggestion: Suggestion) => void;
  onPostRunSuggestions: (suggestions: Suggestion[]) => void;
}

export function useObserver({
  status,
  task,
  steps,
  onSuggestion,
  onPostRunSuggestions,
}: UseObserverOptions) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenSuggestions = useRef<Set<string>>(new Set());
  const stepsRef = useRef<AgentStep[]>([]);
  const runStartRef = useRef<number>(0);

  // Ref for task so runPostRunAnalysis always reads the current value,
  // even when called from a stale closure.
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  // Keep steps ref up to date
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  // Real-time observer polling during run
  useEffect(() => {
    if (status === "running" && task) {
      runStartRef.current = Date.now();
      seenSuggestions.current.clear();

      const poll = async () => {
        try {
          const res = await fetch(`${WORKER_URL}/api/observe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task,
              steps: stepsRef.current.map((s) => ({
                index: s.index,
                action: { type: s.action, action: s.description },
                timing: { stepDurationMs: s.durationMs },
              })),
              previous_suggestions: Array.from(seenSuggestions.current),
            }),
          });

          if (!res.ok) return;
          const data = await res.json();

          if (data.hasSuggestion && data.suggestion) {
            const normalized = data.suggestion.toLowerCase().trim();
            if (!seenSuggestions.current.has(normalized)) {
              seenSuggestions.current.add(normalized);
              onSuggestion({
                id: data.id || crypto.randomUUID().slice(0, 8),
                suggestion: data.suggestion,
                how: data.how || "",
                when: data.when || "",
                category: data.category || "speed",
                estimatedImpact: undefined,
                targetSteps: undefined,
                timestamp: Date.now(),
                elapsedMs: Date.now() - runStartRef.current,
                source: "realtime",
              });
            }
          }
        } catch {
          // Observer failure is non-fatal
        }
      };

      // Immediate first poll, then continue on interval
      poll();
      intervalRef.current = setInterval(poll, OBSERVER_POLL_INTERVAL_MS);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [status, task, onSuggestion]);

  // Post-run analysis — uses taskRef to avoid stale closure
  const runPostRunAnalysis = useCallback(
    async (domain: string, success: boolean, totalTimeMs: number) => {
      const currentTask = taskRef.current;
      if (stepsRef.current.length === 0 || !currentTask) return;

      try {
        const res = await fetch(`${WORKER_URL}/api/observe/post-run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: currentTask,
            domain,
            all_steps: stepsRef.current.map((s) => ({
              stepIndex: s.index,
              action: { type: s.action, action: s.description },
              timing: {
                stepDurationMs: s.durationMs,
                totalElapsedMs: s.cumulativeTimeMs,
              },
            })),
            success,
            total_time_ms: totalTimeMs,
          }),
        });

        if (!res.ok) return;
        const data = await res.json();

        if (data.suggestions?.length > 0) {
          const newSuggestions: Suggestion[] = data.suggestions
            .filter((s: { suggestion: string }) => {
              const normalized = s.suggestion.toLowerCase().trim();
              return !seenSuggestions.current.has(normalized);
            })
            .map(
              (s: {
                id?: string;
                suggestion: string;
                how?: string;
                when?: string;
                category?: string;
                estimatedImpact?: string;
                targetSteps?: number[];
              }) => ({
                id: s.id || crypto.randomUUID().slice(0, 8),
                suggestion: s.suggestion,
                how: s.how || "",
                when: s.when || "",
                category: (s.category || "speed") as Suggestion["category"],
                estimatedImpact: s.estimatedImpact as
                  | Suggestion["estimatedImpact"]
                  | undefined,
                targetSteps: s.targetSteps,
                timestamp: Date.now(),
                elapsedMs: Date.now() - runStartRef.current,
                source: "post-run" as const,
              })
            );

          if (newSuggestions.length > 0) {
            onPostRunSuggestions(newSuggestions);
          }
        }
      } catch {
        // Post-run analysis failure is non-fatal
      }
    },
    [onPostRunSuggestions] // No task dependency — reads from taskRef
  );

  return { runPostRunAnalysis };
}
