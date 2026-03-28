"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AgentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { WORKER_URL } from "@/lib/constants";

interface SessionViewerProps {
  status: AgentStatus;
  /** Browser Use Cloud live embed URL (when set, iframe is used instead of WS stream) */
  liveViewUrl: string;
  completionMessage?: string;
  stepCount?: number;
  totalTimeMs?: number;
  /** When true, title row is omitted (rendered in AgentTab shared header row). */
  hideHeader?: boolean;
}

/** Shared with AgentTab top row — must stay in sync with AgentStepsPanelHeader height */
export function BrowserPreviewPanelHeader({
  status,
  className,
}: {
  status: AgentStatus;
  className?: string;
}) {
  const isRunning = status === "running";
  const isComplete = status === "complete";
  const isFailed = status === "failed";

  return (
    <div className={cn("panel-header-row min-w-0", className)}>
      <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
        Browser preview
      </h3>
      <div className="flex items-center gap-1.5 rounded border border-border bg-surface-raised px-2 py-0.5">
        <div
          className={`h-2 w-2 rounded-full ${
            isRunning
              ? "bg-accent animate-pulse"
              : isComplete
                ? "bg-success"
                : isFailed
                  ? "bg-error"
                  : "bg-text-muted opacity-50"
          }`}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
          {status}
        </span>
      </div>
    </div>
  );
}

/** Matches worker Playwright viewport — scale iframe to fit without cropping sides */
const LIVE_VIEWPORT_W = 1280;
const LIVE_VIEWPORT_H = 720;

/** Timeout (ms) before giving up on the iframe and falling back to WS stream */
const IFRAME_LOAD_TIMEOUT = 8000;

function ContainedLiveIframe({
  src,
  onLoad,
  onTimeout,
}: {
  src: string;
  onLoad: () => void;
  onTimeout: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const update = () => {
      const { width: rw, height: rh } = el.getBoundingClientRect();
      if (rw <= 0 || rh <= 0) return;
      setScale(Math.min(rw / LIVE_VIEWPORT_W, rh / LIVE_VIEWPORT_H));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Timeout fallback — if iframe hasn't loaded, signal parent
  useEffect(() => {
    const timer = setTimeout(onTimeout, IFRAME_LOAD_TIMEOUT);
    return () => clearTimeout(timer);
  }, [onTimeout]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-1 overflow-hidden bg-surface-raised"
    >
      <iframe
        src={src}
        title="Browser Use live session"
        className="pointer-events-auto absolute left-1/2 top-1/2 block border-0"
        style={{
          width: LIVE_VIEWPORT_W,
          height: LIVE_VIEWPORT_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
        allow="clipboard-read; clipboard-write"
        onLoad={onLoad}
      />
    </div>
  );
}

function PreviewLoading({ label }: { label: string }) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-raised session-dot-grid"
      role="status"
      aria-live="polite"
    >
      <div
        className="h-10 w-10 rounded-full border-2 border-border border-t-accent animate-spin"
        aria-hidden
      />
      <p className="text-[11px] font-medium text-text-secondary">{label}</p>
    </div>
  );
}

export default function SessionViewer({
  status,
  liveViewUrl,
  completionMessage,
  stepCount,
  totalTimeMs,
  hideHeader = false,
}: SessionViewerProps) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [iframeTimedOut, setIframeTimedOut] = useState(false);

  const isIdle = status === "idle";
  const isRunning = status === "running";
  const isComplete = status === "complete";
  const isFailed = status === "failed";
  const hasLiveUrl = !!liveViewUrl;

  // Reset iframe readiness when URL or run changes
  useEffect(() => {
    setIframeReady(false);
    setIframeTimedOut(false);
  }, [liveViewUrl, status]);

  const handleIframeTimeout = useCallback(() => {
    if (!iframeReady) {
      setIframeTimedOut(true);
    }
  }, [iframeReady]);

  // WebSocket JPEG stream — ALWAYS connect when running (as primary or fallback)
  useEffect(() => {
    if (status !== "running") {
      setFrameUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setConnected(false);
      return;
    }

    setFrameUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setConnected(false);

    const wsUrl = WORKER_URL.replace("http", "ws") + "/ws/screen";
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof Blob) {
        setFrameUrl((prev) => {
          const next = URL.createObjectURL(event.data);
          if (prev) URL.revokeObjectURL(prev);
          return next;
        });
      }
    };

    return () => {
      ws.close();
      setConnected(false);
    };
  }, [status]);

  // Priority: iframe (Browser Use Cloud) > WebSocket stream
  // Show WS stream only while iframe is loading, or if no live URL at all
  const showIframe = isRunning && hasLiveUrl;
  const showStreamImg = isRunning && !!frameUrl && (!hasLiveUrl || (!iframeReady && !iframeTimedOut));

  const showLoading = isRunning && !hasLiveUrl && !frameUrl;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {!hideHeader && (
        <BrowserPreviewPanelHeader
          status={status}
          className="border-b border-border"
        />
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-raised">
        {isIdle && (
          <div className="session-dot-grid absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-16 h-12 rounded-lg border-2 border-border-bright border-dashed flex items-center justify-center">
              <svg
                className="w-6 h-6 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z"
                />
              </svg>
            </div>
            <p className="text-xs font-medium text-text-secondary">
              Browser preview
            </p>
            <p className="text-[11px] text-text-muted max-w-xs text-center">
              Enter a task and hit Run to watch the agent work in real time
            </p>
          </div>
        )}

        {showLoading && <PreviewLoading label="Loading browser stream…" />}

        {/* WebSocket stream — shown as fallback while iframe loads, or as primary */}
        {showStreamImg && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={frameUrl!}
            alt=""
            role="presentation"
            className="absolute inset-0 z-1 h-full w-full bg-black object-contain object-center"
          />
        )}

        {/* Browser Use Cloud iframe — primary view, overlays stream */}
        {showIframe && (
          <ContainedLiveIframe
            key={liveViewUrl}
            src={liveViewUrl}
            onLoad={() => setIframeReady(true)}
            onTimeout={handleIframeTimeout}
          />
        )}

        {/* Live badge */}
        {isRunning && (iframeReady || (!hasLiveUrl && connected)) && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-background/90 backdrop-blur-sm px-2 py-1 rounded-md border border-border z-20">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] font-medium text-text-secondary">Live</span>
          </div>
        )}

        {(isComplete || isFailed) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface z-10">
            <div
              className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl ${
                isComplete
                  ? "bg-success/10 text-success border border-success/20"
                  : "bg-error/10 text-error border border-error/20"
              }`}
            >
              {isComplete ? (
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : (
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground uppercase tracking-wide">
                {isComplete ? "Session complete" : "Session failed"}
              </p>
              {completionMessage && (
                <p className="text-xs text-text-secondary mt-1.5 max-w-md px-4 line-clamp-3">
                  {completionMessage}
                </p>
              )}
            </div>
            {(stepCount !== undefined || totalTimeMs !== undefined) && (
              <div className="flex items-center gap-2 text-[11px] text-text-muted font-mono mt-1">
                {stepCount !== undefined && <span>{stepCount} steps</span>}
                {stepCount !== undefined && totalTimeMs !== undefined && <span>·</span>}
                {totalTimeMs !== undefined && (
                  <span>{(totalTimeMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
