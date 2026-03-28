"use client";

import type { AgentStatus, Suggestion } from "@/lib/types";

interface SuggestionsPanelProps {
  suggestions: Suggestion[];
  status: AgentStatus;
}

function CategoryIcon({ category }: { category: string }) {
  if (category === "speed") {
    return (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
      </svg>
    );
  }
  if (category === "accuracy") {
    return (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    );
  }
  // cost
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

const CATEGORY_STYLES: Record<string, string> = {
  speed: "bg-accent/10 text-accent",
  accuracy: "bg-success/10 text-success",
  cost: "bg-warning/10 text-warning",
};

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const style = CATEGORY_STYLES[suggestion.category] || CATEGORY_STYLES.speed;

  return (
    <div className="step-card-enter p-3 rounded-lg border border-border bg-white">
      <div className="flex items-start gap-2">
        <div
          className={`h-5 w-5 rounded flex items-center justify-center shrink-0 ${style}`}
        >
          <CategoryIcon category={suggestion.category} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {suggestion.suggestion}
            </p>
            <span className="text-[10px] text-text-muted font-mono shrink-0">
              @ {(suggestion.elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            How: {suggestion.how}
          </p>
          {suggestion.when && (
            <p className="text-[10px] text-text-muted mt-1">
              When: {suggestion.when}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${style}`}
            >
              {suggestion.category}
            </span>
            {suggestion.estimatedImpact && (
              <span className="text-[10px] text-text-muted">
                {suggestion.estimatedImpact} impact
              </span>
            )}
            <span className="text-[10px] text-text-muted font-mono">
              {suggestion.source === "realtime" ? "live" : "post-run"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SuggestionsPanel({
  suggestions,
  status,
}: SuggestionsPanelProps) {
  const observerStatus =
    status === "running" ? "observing" : status === "idle" ? "idle" : "done";

  const count = suggestions.length;

  return (
    <div className="card flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
            Observer
          </h3>
          <div
            className={`h-2 w-2 rounded-full ${
              observerStatus === "idle"
                ? "bg-text-muted"
                : observerStatus === "observing"
                  ? "bg-accent animate-pulse"
                  : "bg-success"
            }`}
          />
        </div>
        {count > 0 && (
          <span className="text-[10px] font-mono text-text-muted">
            {count} {count === 1 ? "suggestion" : "suggestions"}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {count === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
            {status === "running" ? (
              <>
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse"
                      style={{ animationDelay: `${i * 0.16}s` }}
                    />
                  ))}
                </div>
                <p className="text-xs">Observer is watching...</p>
              </>
            ) : (
              <>
                <svg className="w-8 h-8 text-border-bright" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                </svg>
                <div className="text-center">
                  <p className="text-xs font-medium text-text-secondary">
                    {status === "idle" ? "Observer" : "No Suggestions"}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {status === "idle"
                      ? "AI observer watches runs and suggests faster shortcuts"
                      : "No improvements found for this run"}
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {suggestions.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} />
        ))}
      </div>
    </div>
  );
}
