// --- SSE Event Types (contract between Python worker and frontend) ---

export type AgentStatus =
  | "idle"
  | "running"
  | "complete"
  | "failed"
  | "cancelled";

export type ActionType =
  | "navigate"
  | "click"
  | "type"
  | "scroll"
  | "press_key"
  | "extract"
  | "task_complete"
  | "unknown";

export interface AgentStep {
  index: number;
  action: ActionType;
  description: string;
  reasoning?: string;
  screenshotUrl?: string;
  durationMs: number;
  cumulativeTimeMs: number;
  tokensUsed?: number;
  shortcutApplied?: string; // ID of Hub shortcut used for this step
}

export interface AgentTiming {
  totalElapsedMs: number;
  avgStepMs: number;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// SSE Event payloads

export interface SessionCreatedEvent {
  type: "session_created";
  sessionId: string;
  liveViewUrl: string;
}

export interface AgentStartedEvent {
  type: "agent_started";
  task: string;
  model: string;
  shortcutsApplied: number;
}

export interface StepProgressEvent {
  type: "step_progress";
  stepIndex: number;
  action: {
    type: ActionType;
    action: string;
    reasoning?: string;
  };
  timing: {
    stepDurationMs: number;
    totalElapsedMs: number;
  };
  shortcutApplied?: string;
}

export interface AgentCompletedEvent {
  type: "agent_completed";
  success: boolean;
  message: string;
  totalActions: number;
  timing: AgentTiming;
  usage: AgentUsage;
}

export interface AgentErrorEvent {
  type: "agent_error";
  error: string;
  stepIndex?: number;
}

export type SSEEvent =
  | SessionCreatedEvent
  | AgentStartedEvent
  | StepProgressEvent
  | AgentCompletedEvent
  | AgentErrorEvent;

// --- A/B Test SSE Event Types ---

export type ABTestStatus =
  | "idle"
  | "baseline_running"
  | "trained_running"
  | "complete"
  | "failed";

export interface ABStartedEvent {
  type: "ab_started";
  task: string;
}

export interface ABBaselineStartedEvent {
  type: "ab_baseline_started";
}

export interface ABBaselineStepEvent {
  type: "ab_baseline_step";
  stepIndex: number;
  action: { type: ActionType; action: string; reasoning?: string };
  timing: { stepDurationMs: number; totalElapsedMs: number };
}

export interface ABBaselineCompletedEvent {
  type: "ab_baseline_completed";
  steps: number;
  timeMs: number;
  success: boolean;
  message: string;
}

export interface ABTrainedStartedEvent {
  type: "ab_trained_started";
}

export interface ABTrainedStepEvent {
  type: "ab_trained_step";
  stepIndex: number;
  action: { type: ActionType; action: string; reasoning?: string };
  timing: { stepDurationMs: number; totalElapsedMs: number };
}

export interface ABTrainedCompletedEvent {
  type: "ab_trained_completed";
  steps: number;
  timeMs: number;
  success: boolean;
  message: string;
}

export interface ABResultEvent extends ABResult {
  type: "ab_result";
}

export type ABSSEEvent =
  | ABStartedEvent
  | ABBaselineStartedEvent
  | ABBaselineStepEvent
  | ABBaselineCompletedEvent
  | ABTrainedStartedEvent
  | ABTrainedStepEvent
  | ABTrainedCompletedEvent
  | ABResultEvent;

// --- Observer Types ---

export type SuggestionCategory = "speed" | "accuracy" | "cost";
export type SuggestionImpact = "high" | "medium" | "low";

export interface Suggestion {
  id: string;
  suggestion: string;
  how: string;
  when: string;
  category: SuggestionCategory;
  estimatedImpact?: SuggestionImpact;
  targetSteps?: number[];
  timestamp: number;
  elapsedMs: number;
  source: "realtime" | "post-run";
}

export type ObserverStatus = "idle" | "observing" | "analyzing" | "done";

// --- Hub Types ---

export interface ABResult {
  baselineSteps: number;
  baselineTimeMs: number;
  baselineSuccess: boolean;
  trainedSteps: number;
  trainedTimeMs: number;
  trainedSuccess: boolean;
  winner: "baseline" | "trained" | "tie";
  improvementPct: number;
  stepsSaved: number;
  timeSavedMs: number;
}

export interface HubShortcut {
  id: string;
  taskPattern: string;
  suggestion: string;
  how: string;
  when: string;
  category: SuggestionCategory;
  siteDomain: string;
  estimatedImpact: SuggestionImpact;
  runCount: number;
  successAssociations: number;
  sourceRunId?: string;
  createdAt: string;
  updatedAt: string;
  status?: "pending" | "verified" | "rejected";
  abResult?: ABResult;
  relevance?: number;
}

export interface HubStats {
  totalShortcuts: number;
  categories: { speed: number; accuracy: number; cost: number };
  topShortcut?: HubShortcut;
}

// --- Run Types ---

export interface Run {
  id: string;
  task: string;
  model: string;
  status: AgentStatus;
  steps: AgentStep[];
  totalTimeMs: number;
  totalTokens: number;
  success: boolean;
  shortcutsApplied: string[];
  createdAt: string;
}
