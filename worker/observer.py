"""
Dual Observer — Real-Time + Post-Run Analysis

Real-time: Called every ~10s during agent run with latest screenshot + recent steps.
Post-run: Called after run completes with full step log for deeper analysis.

Both use Gemini 2.5 Pro (standard generateContent, not Live API).
"""

import base64
import json
import logging
import os
import uuid
from typing import Optional

from google import genai
from google.genai import types
from pydantic import BaseModel

logger = logging.getLogger(__name__)

OBSERVER_MODEL = "gemini-2.5-flash"

# --- Observer Prompts ---

REALTIME_PROMPT = """You are an expert browser automation coach watching an AI agent perform a web task in real-time.

You are seeing a screenshot of the current browser state along with the agent's recent actions.

Your job: identify ONE specific, actionable optimization the agent could use RIGHT NOW or in future runs of similar tasks. You should almost ALWAYS find something to suggest — there is nearly always a faster path, a shortcut, or a better strategy.

Focus on:
- **Keyboard shortcuts**: Ctrl+L (address bar), Ctrl+F (find on page), Tab (cycle fields), Enter (submit), Ctrl+A (select all)
- **Direct URLs**: If the agent is navigating through menus to reach a page that has a known direct URL
- **Batching**: Multiple sequential clicks that could be one action
- **Wasted steps**: Unnecessary scrolling, redundant page scans, clicking when typing would be faster
- **Smarter strategies**: Using search instead of browsing, using URL parameters, using site-specific features
- **Page state observations**: If you see the page hasn't loaded fully, elements are missing, or the agent is looking at the wrong area
- **Alternative approaches**: A completely different way to accomplish the same goal faster

Rules:
- Default to hasSuggestion: true — only set false if the agent is genuinely optimal
- Reference specific steps from the action log
- Be precise: "Use Ctrl+L then type the URL" not "navigate more efficiently"
- Consider both immediate improvements and tips for future similar runs

Respond in JSON:
{
  "hasSuggestion": true/false,
  "suggestion": "Brief title (max 10 words)",
  "how": "Specific actionable instruction",
  "when": "Reference to specific step or moment",
  "category": "speed" or "accuracy"
}"""

POST_RUN_PROMPT = """You are an expert browser automation analyst reviewing a completed agent run.

You have the full action log from start to finish. Analyze the run for:

1. **Inefficient sequences**: Steps that could be combined or eliminated
2. **Missed shortcuts**: Keyboard shortcuts, direct URLs, or faster navigation paths
3. **Failure patterns**: Steps that failed and why, with alternatives
4. **Optimal path**: The ideal sequence of actions for this task
5. **Generalizable tips**: Advice that would help on similar tasks/sites

For each suggestion, estimate impact:
- "high": Would save 3+ steps or 10+ seconds
- "medium": Would save 1-2 steps or 5-10 seconds
- "low": Minor optimization

Respond in JSON:
{
  "suggestions": [
    {
      "suggestion": "Brief title",
      "how": "Specific actionable instruction",
      "when": "When to apply this",
      "category": "speed" or "accuracy" or "cost",
      "estimatedImpact": "high" or "medium" or "low",
      "targetSteps": [2, 3, 4]
    }
  ]
}

Return at most 3 suggestions, ordered by impact.

IMPORTANT:
- If the run FAILED or hit the step limit, you MUST return at least 1-2 suggestions about what went wrong and how to fix it. Focus on failure patterns, stuck loops, and alternative strategies.
- If the run SUCCEEDED but took many steps, suggest optimizations to reduce steps.
- Only return an empty suggestions array if the run succeeded AND was already near-optimal."""


# --- Request Models ---


class ObserveRequest(BaseModel):
    task: str
    steps: list[dict]
    screenshot_base64: Optional[str] = None
    previous_suggestions: list[str] = []


class PostRunObserveRequest(BaseModel):
    task: str
    domain: str
    all_steps: list[dict]
    success: bool
    total_time_ms: int


# --- Observer Functions ---


def _get_client() -> genai.Client:
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


async def observe_realtime(req: ObserveRequest) -> dict:
    """Analyze a single screenshot + recent steps for real-time coaching."""
    client = _get_client()

    # Format recent steps as text
    steps_text = ""
    for s in req.steps[-10:]:  # Last 10 steps
        action = s.get("action", {})
        steps_text += f"  Step {s.get('index', '?')}: [{action.get('type', '?')}] {action.get('action', '')}\n"

    # Previous suggestions for dedup
    prev_text = ""
    if req.previous_suggestions:
        prev_text = "\n\nAlready suggested (do NOT repeat these):\n"
        for s in req.previous_suggestions:
            prev_text += f"  - {s}\n"

    # Build content parts
    if steps_text:
        prompt_text = f"Task: {req.task}\n\nRecent agent actions:\n{steps_text}{prev_text}\n\nAnalyze the actions and screenshot above. Find an optimization."
    else:
        prompt_text = f"Task: {req.task}\n\nThe agent is just starting this task. Based on the task and the current browser screenshot, suggest the best strategy or shortcut to accomplish this efficiently.{prev_text}"

    parts: list[types.Part] = [
        types.Part(text=prompt_text),
    ]

    # Include screenshot if available
    if req.screenshot_base64:
        screenshot_bytes = base64.b64decode(req.screenshot_base64)
        parts.append(
            types.Part(
                inline_data=types.Blob(
                    data=screenshot_bytes, mime_type="image/jpeg"
                )
            )
        )

    try:
        response = await client.aio.models.generate_content(
            model=OBSERVER_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=parts,
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=REALTIME_PROMPT,
                temperature=0.3,
                response_mime_type="application/json",
            ),
        )
    except Exception as e:
        logger.warning(f"[realtime-observer] Gemini API error: {e}")
        return {"hasSuggestion": False, "error": str(e)}

    try:
        result = json.loads(response.text)
    except (json.JSONDecodeError, AttributeError):
        result = {"hasSuggestion": False}

    if result.get("hasSuggestion"):
        result["id"] = str(uuid.uuid4())[:8]
        result["source"] = "realtime"

    return result


async def observe_post_run(req: PostRunObserveRequest) -> dict:
    """Deep analysis of a completed run."""
    client = _get_client()

    # Format full step log
    steps_text = ""
    for s in req.all_steps:
        action = s.get("action", {})
        timing = s.get("timing", {})
        steps_text += (
            f"  Step {s.get('stepIndex', '?')}: "
            f"[{action.get('type', '?')}] {action.get('action', '')} "
            f"({timing.get('stepDurationMs', '?')}ms)\n"
        )

    status_note = ""
    if not req.success:
        status_note = "\n\n*** THIS RUN FAILED. You MUST provide suggestions for what went wrong and how to improve. ***\n"
    elif len(req.all_steps) >= 15:
        status_note = "\n\n*** This run took many steps. Look for repetition and inefficiency. ***\n"

    summary = (
        f"Task: {req.task}\n"
        f"Domain: {req.domain}\n"
        f"Success: {req.success}\n"
        f"Total time: {req.total_time_ms}ms\n"
        f"Total steps: {len(req.all_steps)}\n"
        f"{status_note}\n"
        f"Full action log:\n{steps_text}"
    )

    try:
        response = await client.aio.models.generate_content(
            model=OBSERVER_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[types.Part(text=summary)],
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=POST_RUN_PROMPT,
                temperature=0.3,
                response_mime_type="application/json",
            ),
        )
    except Exception as e:
        logger.warning(f"[post-run-observer] Gemini API error: {e}")
        return {"suggestions": [], "error": str(e)}

    try:
        result = json.loads(response.text)
    except (json.JSONDecodeError, AttributeError):
        result = {"suggestions": []}

    # Add IDs and source
    for s in result.get("suggestions", []):
        s["id"] = str(uuid.uuid4())[:8]
        s["source"] = "post-run"

    return result
