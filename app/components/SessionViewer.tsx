"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentStatus } from "@/lib/types";
import { WORKER_URL } from "@/lib/constants";

interface SessionViewerProps {
  status: AgentStatus;
  liveViewUrl: string;
  screenshotUrl: string | null;
  completionMessage?: string;
  stepCount?: number;
  totalTimeMs?: number;
}

export default function SessionViewer({
  status,
  liveViewUrl,
  screenshotUrl,
  completionMessage,
  stepCount,
  totalTimeMs,
}: SessionViewerProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  // WebSocket screenshot stream fallback (only when no liveUrl)
  useEffect(() => {
    const hasLiveUrl = !!liveViewUrl;
    if (status !== "running" || hasLiveUrl) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        setConnected(false);
      }
      return;
    }

    const wsUrl = WORKER_URL.replace("http", "ws") + "/ws/screen";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      if (imgRef.current && event.data instanceof Blob) {
        const url = URL.createObjectURL(event.data);
        const oldUrl = imgRef.current.src;
        imgRef.current.src = url;
        if (oldUrl.startsWith("blob:")) {
          URL.revokeObjectURL(oldUrl);
        }
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [status, liveViewUrl]);

  const hasLiveUrl = !!liveViewUrl;
  const isIdle = status === "idle";
  const isRunning = status === "running";
  const isComplete = status === "complete";
  const isFailed = status === "failed";

  return (
    <div className="session-viewer-frame rounded-xl overflow-hidden relative aspect-video w-full">
      {/* Idle empty state */}
      {isIdle && (
        <div className="session-dot-grid absolute inset-0 flex flex-col items-center justify-center text-text-muted gap-3">
          <svg
            className="w-8 h-8 text-border-bright"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z"
            />
          </svg>
          <div className="text-center max-w-[18rem] px-2">
            <p className="text-xs font-medium text-text-secondary">
              Browser preview
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">
              The live browser session appears here while the agent runs so you can
              watch every action
            </p>
          </div>
        </div>
      )}

      {/* Running — Browser Use Cloud iframe */}
      {isRunning && hasLiveUrl && (
        <iframe
          src={liveViewUrl}
          className="absolute inset-0 w-full h-full border-0"
          allow="clipboard-read; clipboard-write"
        />
      )}

      {/* Running — WebSocket screenshot fallback */}
      {isRunning && !hasLiveUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            alt="Browser session"
            className="absolute inset-0 w-full h-full object-cover bg-black"
          />
          <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-background/90 backdrop-blur-sm px-2 py-1 rounded-md border border-border">
            <div
              className={`h-2 w-2 rounded-full ${
                connected ? "bg-success animate-pulse" : "bg-warning animate-pulse"
              }`}
            />
            <span className="text-[10px] font-medium text-text-secondary">
              {connected ? "Live" : "Connecting..."}
            </span>
          </div>
        </>
      )}

      {/* Completion overlay */}
      {(isComplete || isFailed) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface">
          <div
            className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl ${
              isComplete
                ? "bg-success/10 text-success"
                : "bg-error/10 text-error"
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
            <p className="text-base font-semibold text-foreground">
              {isComplete ? "Session complete" : "Session failed"}
            </p>
            {completionMessage && (
              <p className="text-sm text-text-secondary mt-1 max-w-md px-4 line-clamp-3">
                {completionMessage}
              </p>
            )}
          </div>
          {(stepCount !== undefined || totalTimeMs !== undefined) && (
            <div className="flex items-center gap-3 text-xs text-text-muted font-mono">
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
  );
}
