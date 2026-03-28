"""
Recall Worker — FastAPI backend for Gemini Live API browser agent.

Endpoints:
  POST /api/run-agent    — Run agent, returns SSE stream
  POST /api/observe      — Real-time observer analysis
  POST /api/observe/post-run — Post-run deep analysis
  GET  /api/hub/shortcuts — List all Hub shortcuts
  GET  /api/hub/stats     — Hub aggregate stats
  GET  /api/hub/search    — Semantic search shortcuts
  WS   /ws/screen         — Live screenshot stream
"""

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv()

from agent_loop import GeminiLiveAgent
from chroma_store import (
    store_suggestion,
    query_suggestions,
    list_all_shortcuts,
    get_stats,
    search_shortcuts,
    get_shortcut_by_id,
    update_shortcut_ab_result,
)
from observer import (
    ObserveRequest,
    PostRunObserveRequest,
    observe_realtime,
    observe_post_run,
)
from eval_loop import run_ab_test
from screenshot_streamer import ScreenshotStreamer

# Global screenshot streamer (shared between agent and WebSocket clients)
streamer = ScreenshotStreamer()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await streamer.stop()


app = FastAPI(title="Recall Worker", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Models ---


class RunAgentRequest(BaseModel):
    task: str
    model: str = "gemini-2.5-flash-native-audio-latest"
    maxSteps: int = 30
    shortcuts: list[str] = []


class RunABTestRequest(BaseModel):
    shortcutId: str
    task: str
    model: str = "gemini-2.5-flash-native-audio-latest"
    maxSteps: int = 30


# --- SSE Helpers ---


def sse_event(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# --- Endpoints ---


@app.post("/api/run-agent")
async def run_agent(req: RunAgentRequest):
    """Run the Gemini Live browser agent. Returns an SSE stream."""

    async def event_stream():
        agent = GeminiLiveAgent(
            api_key=os.environ["GEMINI_API_KEY"],
            model=req.model,
            max_steps=req.maxSteps,
            shortcuts=req.shortcuts,
            streamer=streamer,
        )

        session_id = f"recall-{int(time.time())}"

        # Session created
        yield sse_event(
            {
                "type": "session_created",
                "sessionId": session_id,
                "liveViewUrl": "",
            }
        )

        try:
            async for event in agent.run(req.task):
                yield sse_event(event)
        except Exception as e:
            yield sse_event(
                {
                    "type": "agent_error",
                    "error": str(e),
                    "stepIndex": None,
                }
            )

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.websocket("/ws/screen")
async def websocket_screen(websocket: WebSocket):
    """Stream live browser screenshots to the frontend."""
    await websocket.accept()
    streamer.add_client(websocket)
    try:
        while True:
            # Keep connection alive, wait for disconnect
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        streamer.remove_client(websocket)


# --- Observer endpoints ---


@app.post("/api/observe")
async def observe(req: ObserveRequest):
    """Real-time observer — analyze screenshot + recent steps during a run."""
    result = await observe_realtime(req)
    return result


@app.post("/api/observe/post-run")
async def observe_after_run(req: PostRunObserveRequest):
    """Post-run observer — deep analysis of a completed run. Auto-stores suggestions in Hub."""
    result = await observe_post_run(req)

    # Auto-store suggestions in ChromaDB
    stored = []
    for s in result.get("suggestions", []):
        try:
            store_result = store_suggestion(
                task_pattern=req.task,
                suggestion=s.get("suggestion", ""),
                how=s.get("how", ""),
                when=s.get("when", ""),
                category=s.get("category", "speed"),
                site_domain=req.domain,
                estimated_impact=s.get("estimatedImpact", "medium"),
            )
            stored.append(store_result)
        except Exception:
            pass  # Storage failure is non-fatal

    result["stored"] = stored
    return result


# --- Hub endpoints (Phase 3/4 — stubs for now) ---


@app.get("/api/hub/shortcuts")
async def hub_list_shortcuts(category: str = "", domain: str = ""):
    """List all Hub shortcuts."""
    shortcuts = list_all_shortcuts(
        category=category or None,
        domain=domain or None,
    )
    return {"shortcuts": shortcuts}


@app.get("/api/hub/stats")
async def hub_stats():
    """Get aggregate Hub stats."""
    return get_stats()


@app.get("/api/hub/search")
async def hub_search(q: str = ""):
    """Semantic search for shortcuts."""
    if not q.strip():
        return {"shortcuts": list_all_shortcuts()}
    results = search_shortcuts(q)
    return {"shortcuts": results}


@app.get("/api/hub/query")
async def hub_query_for_task(task: str = ""):
    """Query relevant shortcuts for a given task (used before agent runs)."""
    if not task.strip():
        return {"shortcuts": []}
    results = query_suggestions(task, top_k=5)
    return {"shortcuts": results}


# --- A/B Test endpoint ---


@app.post("/api/run-ab-test")
async def run_ab_test_endpoint(req: RunABTestRequest):
    """Run an A/B test for a shortcut. Returns an SSE stream."""
    shortcut = get_shortcut_by_id(req.shortcutId)
    if not shortcut:
        return {"error": "Shortcut not found"}, 404

    # Format shortcut as injection text
    shortcut_text = (
        f"[{shortcut['category']}] {shortcut['suggestion']}\n"
        f"   How: {shortcut['how']}\n"
        f"   When: {shortcut['when']}"
    )

    async def event_stream():
        ab_result = None
        async for event in run_ab_test(
            task=req.task,
            shortcut_text=shortcut_text,
            model=req.model,
            max_steps=req.maxSteps,
            streamer=streamer,
        ):
            if event.get("type") == "ab_result":
                ab_result = event
            yield sse_event(event)

        # Persist AB result on the shortcut
        if ab_result:
            result_data = {k: v for k, v in ab_result.items() if k != "type"}
            update_shortcut_ab_result(req.shortcutId, result_data)

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# --- Health check ---


@app.get("/health")
async def health():
    return {"status": "ok", "model": "recall-worker"}
