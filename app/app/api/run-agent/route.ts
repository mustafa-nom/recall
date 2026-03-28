import { NextRequest } from "next/server";

const WORKER_URL = process.env.WORKER_URL || "http://127.0.0.1:8000";

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Query Hub for relevant shortcuts before running agent
  let shortcuts: string[] = [];
  try {
    const hubRes = await fetch(
      `${WORKER_URL}/api/hub/query?task=${encodeURIComponent(body.task)}`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (hubRes.ok) {
      const hubData = await hubRes.json();
      shortcuts = (hubData.shortcuts || []).map(
        (s: { suggestion: string; how: string; when: string; category: string }) =>
          `[${s.category}] ${s.suggestion}\n   How: ${s.how}\n   When: ${s.when}`
      );
    }
  } catch {
    // Hub query failure is non-fatal — run without shortcuts
  }

  // Proxy to Python worker with shortcuts injected
  const workerRes = await fetch(`${WORKER_URL}/api/run-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, shortcuts }),
  });

  if (!workerRes.ok || !workerRes.body) {
    return new Response(
      JSON.stringify({ error: "Worker unavailable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Pipe the SSE stream back to the client
  return new Response(workerRes.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
