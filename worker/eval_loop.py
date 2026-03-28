"""
A/B Evaluation Loop.

Runs the same task twice sequentially:
  1. Baseline — no shortcuts injected
  2. Trained  — with the shortcut injected into the system prompt

Yields SSE events for both phases, then a final ab_result with comparison.
"""

import os
import time
from typing import AsyncGenerator

from agent_loop import GeminiLiveAgent
from screenshot_streamer import ScreenshotStreamer


def _compute_ab_result(
    baseline: dict,
    trained: dict,
) -> dict:
    """Compare baseline vs trained metrics and determine winner."""
    b_steps = baseline["steps"]
    b_time = baseline["timeMs"]
    b_success = baseline["success"]

    t_steps = trained["steps"]
    t_time = trained["timeMs"]
    t_success = trained["success"]

    steps_saved = b_steps - t_steps
    time_saved = b_time - t_time

    # Improvement percentage (time-based)
    if b_time > 0 and b_success:
        improvement_pct = round((1 - t_time / b_time) * 100)
    else:
        improvement_pct = 0

    # Determine winner
    # Rule 1: Success trumps all
    if t_success and not b_success:
        winner = "trained"
    elif b_success and not t_success:
        winner = "baseline"
    elif not b_success and not t_success:
        winner = "tie"
    else:
        # Both succeeded — compare on time with 10% margin
        time_ratio = t_time / max(b_time, 1)
        step_ratio = t_steps / max(b_steps, 1)

        if time_ratio < 0.90 or step_ratio < 0.90:
            winner = "trained"
        elif time_ratio > 1.10 or step_ratio > 1.10:
            winner = "baseline"
        else:
            winner = "tie"

    return {
        "baselineSteps": b_steps,
        "baselineTimeMs": b_time,
        "baselineSuccess": b_success,
        "trainedSteps": t_steps,
        "trainedTimeMs": t_time,
        "trainedSuccess": t_success,
        "winner": winner,
        "improvementPct": max(improvement_pct, 0),
        "stepsSaved": max(steps_saved, 0),
        "timeSavedMs": max(time_saved, 0),
    }


async def run_ab_test(
    task: str,
    shortcut_text: str,
    model: str = "gemini-2.5-flash-native-audio-latest",
    max_steps: int = 30,
    api_key: str | None = None,
    streamer: ScreenshotStreamer | None = None,
) -> AsyncGenerator[dict, None]:
    """Run A/B test: baseline (no shortcut) then trained (with shortcut)."""

    api_key = api_key or os.environ["GEMINI_API_KEY"]

    yield {"type": "ab_started", "task": task}

    # --- Phase 1: Baseline ---
    yield {"type": "ab_baseline_started"}

    baseline_agent = GeminiLiveAgent(
        api_key=api_key,
        model=model,
        max_steps=max_steps,
        shortcuts=[],
        streamer=streamer,
    )

    baseline_steps = 0
    baseline_time = 0
    baseline_success = False
    baseline_message = ""

    async for event in baseline_agent.run(task):
        if event["type"] == "step_progress":
            baseline_steps += 1
            yield {
                "type": "ab_baseline_step",
                "stepIndex": event["stepIndex"],
                "action": event["action"],
                "timing": event["timing"],
            }
        elif event["type"] == "agent_completed":
            baseline_time = event["timing"]["totalElapsedMs"]
            baseline_success = event["success"]
            baseline_message = event.get("message", "")
            yield {
                "type": "ab_baseline_completed",
                "steps": baseline_steps,
                "timeMs": baseline_time,
                "success": baseline_success,
                "message": baseline_message,
            }
        elif event["type"] == "agent_error":
            baseline_success = False
            baseline_message = event.get("error", "Agent error")
            yield {
                "type": "ab_baseline_completed",
                "steps": baseline_steps,
                "timeMs": int((time.time()) * 1000) - baseline_time if baseline_time else 0,
                "success": False,
                "message": baseline_message,
            }
        # Skip agent_started — we emit our own ab_baseline_started

    # --- Phase 2: Trained ---
    yield {"type": "ab_trained_started"}

    trained_agent = GeminiLiveAgent(
        api_key=api_key,
        model=model,
        max_steps=max_steps,
        shortcuts=[shortcut_text],
        streamer=streamer,
    )

    trained_steps = 0
    trained_time = 0
    trained_success = False
    trained_message = ""

    async for event in trained_agent.run(task):
        if event["type"] == "step_progress":
            trained_steps += 1
            yield {
                "type": "ab_trained_step",
                "stepIndex": event["stepIndex"],
                "action": event["action"],
                "timing": event["timing"],
            }
        elif event["type"] == "agent_completed":
            trained_time = event["timing"]["totalElapsedMs"]
            trained_success = event["success"]
            trained_message = event.get("message", "")
            yield {
                "type": "ab_trained_completed",
                "steps": trained_steps,
                "timeMs": trained_time,
                "success": trained_success,
                "message": trained_message,
            }
        elif event["type"] == "agent_error":
            trained_success = False
            trained_message = event.get("error", "Agent error")
            yield {
                "type": "ab_trained_completed",
                "steps": trained_steps,
                "timeMs": 0,
                "success": False,
                "message": trained_message,
            }

    # --- Phase 3: Compare ---
    baseline_metrics = {
        "steps": baseline_steps,
        "timeMs": baseline_time,
        "success": baseline_success,
    }
    trained_metrics = {
        "steps": trained_steps,
        "timeMs": trained_time,
        "success": trained_success,
    }

    ab_result = _compute_ab_result(baseline_metrics, trained_metrics)
    yield {"type": "ab_result", **ab_result}
