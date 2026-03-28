export const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8000";

export const APP_NAME = "Recall";
export const APP_DESCRIPTION =
  "A self-improving browser agent that learns from experience";

export const DEFAULT_MODEL = "gemini-2.5-flash-native-audio-latest"; // Only model supporting bidiGenerateContent + tools
export const DEFAULT_MAX_STEPS = 30;

export const OBSERVER_POLL_INTERVAL_MS = 10_000; // 10 seconds
export const SCREENSHOT_STREAM_FPS = 2;
