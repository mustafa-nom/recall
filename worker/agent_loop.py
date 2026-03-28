"""
Gemini Live API Agent Loop.

Async generator that yields SSE events as the agent executes a browser task.
Uses Browser Use Cloud for live browser preview when API key is available,
falls back to local Playwright otherwise.
"""

import asyncio
import os
import time
from collections import Counter
from typing import AsyncGenerator

import httpx
from google import genai
from google.genai import types
from playwright.async_api import async_playwright

from browser_actions import execute_action, take_screenshot
from screenshot_streamer import ScreenshotStreamer

# --- Tool Declarations ---

TOOL_DECLARATIONS = [
    types.FunctionDeclaration(
        name="navigate_to",
        description="Navigate the browser to a specific URL",
        parameters={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The URL to navigate to"},
            },
            "required": ["url"],
        },
    ),
    types.FunctionDeclaration(
        name="click_element",
        description="Click on an element described by its visual appearance or text content on the page",
        parameters={
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "Description of the element to click",
                },
                "x": {"type": "integer", "description": "X coordinate in pixels"},
                "y": {"type": "integer", "description": "Y coordinate in pixels"},
            },
            "required": ["description", "x", "y"],
        },
    ),
    types.FunctionDeclaration(
        name="type_text",
        description="Type text into the currently focused element or a described element",
        parameters={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The text to type"},
                "description": {
                    "type": "string",
                    "description": "Optional: description of the input field to click first",
                },
                "x": {"type": "integer", "description": "Optional: X coordinate to click before typing"},
                "y": {"type": "integer", "description": "Optional: Y coordinate to click before typing"},
            },
            "required": ["text"],
        },
    ),
    types.FunctionDeclaration(
        name="press_key",
        description="Press a keyboard key (e.g. Enter, Tab, Escape, Backspace, ArrowDown)",
        parameters={
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Key to press"},
            },
            "required": ["key"],
        },
    ),
    types.FunctionDeclaration(
        name="scroll_page",
        description="Scroll the page up or down",
        parameters={
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["up", "down"]},
                "pixels": {"type": "integer", "description": "Pixels to scroll (default 300)"},
            },
            "required": ["direction"],
        },
    ),
    types.FunctionDeclaration(
        name="extract_text",
        description="Extract and return visible text from the page or a specific element",
        parameters={
            "type": "object",
            "properties": {
                "description": {"type": "string", "description": "What text to extract"},
            },
            "required": ["description"],
        },
    ),
    types.FunctionDeclaration(
        name="task_complete",
        description="Signal that the task is complete",
        parameters={
            "type": "object",
            "properties": {
                "success": {"type": "boolean", "description": "Whether task succeeded"},
                "result": {"type": "string", "description": "Summary of result"},
            },
            "required": ["success", "result"],
        },
    ),
]

BASE_SYSTEM_PROMPT = """You are a browser automation agent. You see screenshots of a web browser and use tools to interact with web pages to accomplish the user's goal.

Rules:
1. Analyze each screenshot carefully before deciding on an action.
2. Use navigate_to for going to URLs directly — this is the fastest approach.
3. Use click_element with x,y coordinates based on what you see in the screenshot.
4. Use type_text to enter text into input fields. Click the field first if needed.
5. Use press_key for keyboard shortcuts (Enter to submit, Tab to move focus, etc.).
6. Use scroll_page if you need to see content below/above the visible area.
7. Use extract_text to read specific information from the page.
8. Call task_complete when you've achieved the goal or determined it cannot be done.
9. Be efficient — take the most direct path to complete the task.
10. NEVER repeat the same action more than twice. If an action didn't work the first time, try a completely different approach.
11. If a website isn't loading or responding as expected, try alternatives: a different URL, a search engine query, or a different site entirely.
12. If you've attempted the same approach 3 times without progress, call task_complete with success=false and explain what went wrong.
13. Prefer direct URLs over multi-step navigation (e.g., go to google.com/maps directly instead of navigating through google.com).
14. When typing into input fields on complex websites (Google Flights, Maps, etc.), always click the field first to ensure focus, then type. Existing text in the field will be automatically cleared.
15. After navigating to a new page, look at the screenshot carefully to confirm elements are visible and the page has loaded before interacting.
16. Coordinates are relative to the 1280x720 viewport shown in the screenshot."""


def build_system_prompt(shortcuts: list[str]) -> str:
    """Build system prompt with optional shortcut injections."""
    prompt = BASE_SYSTEM_PROMPT
    if shortcuts:
        prompt += "\n\nLEARNED OPTIMIZATIONS (apply these when relevant):\n"
        for i, shortcut in enumerate(shortcuts, 1):
            prompt += f"{i}. {shortcut}\n"
    return prompt


ACTION_TYPE_MAP = {
    "navigate_to": "navigate",
    "click_element": "click",
    "type_text": "type",
    "press_key": "press_key",
    "scroll_page": "scroll",
    "extract_text": "extract",
    "task_complete": "task_complete",
}


async def _create_cloud_browser() -> tuple[str, str] | None:
    """Create a Browser Use Cloud session. Returns (live_url, cdp_url) or None."""
    api_key = os.environ.get("BROWSER_USE_API_KEY", "")
    if not api_key:
        return None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.browser-use.com/api/v2/browsers",
                headers={"X-Browser-Use-API-Key": api_key},
                json={
                    "browser_screen_width": 1280,
                    "browser_screen_height": 720,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            return (data.get("liveUrl", ""), data.get("cdpUrl", ""))
    except Exception as e:
        print(f"[browser-use] Cloud session failed: {e}, falling back to local")
        return None


class GeminiLiveAgent:
    def __init__(
        self,
        api_key: str,
        model: str = "gemini-2.5-flash-native-audio-latest",
        max_steps: int = 30,
        shortcuts: list[str] | None = None,
        streamer: ScreenshotStreamer | None = None,
    ):
        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.max_steps = max_steps
        self.shortcuts = shortcuts or []
        self.streamer = streamer

    async def run(self, task: str) -> AsyncGenerator[dict, None]:
        """Execute the agent loop, yielding SSE events."""
        start_time = time.time()
        step_count = 0
        total_tokens = 0
        live_url = ""
        use_cloud = False

        async with async_playwright() as pw:
            # Try Browser Use Cloud first, fall back to local
            cloud = await _create_cloud_browser()
            if cloud:
                live_url, cdp_url = cloud
                use_cloud = True
                print(f"[browser-use] Cloud session created, liveUrl: {live_url[:60]}...")
                browser = await pw.chromium.connect_over_cdp(cdp_url)
                contexts = browser.contexts
                if contexts and contexts[0].pages:
                    page = contexts[0].pages[0]
                else:
                    page = await browser.new_page()
                # Set viewport on existing page
                await page.set_viewport_size({"width": 1280, "height": 720})
            else:
                browser = await pw.chromium.launch(headless=True)
                page = await browser.new_page(viewport={"width": 1280, "height": 720})

            await page.goto("about:blank")

            system_prompt = build_system_prompt(self.shortcuts)

            config = types.LiveConnectConfig(
                response_modalities=["AUDIO"],
                system_instruction=system_prompt,
                tools=[types.Tool(function_declarations=TOOL_DECLARATIONS)],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name="Puck"
                        )
                    )
                ),
            )

            # Agent started event
            yield {
                "type": "agent_started",
                "task": task,
                "model": self.model,
                "shortcutsApplied": len(self.shortcuts),
                "liveViewUrl": live_url,
            }

            try:
                async with self.client.aio.live.connect(
                    model=self.model, config=config
                ) as session:
                    # Initial screenshot + task
                    screenshot = await take_screenshot(page)
                    if self.streamer and not use_cloud:
                        await self.streamer.broadcast(screenshot)

                    await session.send_client_content(
                        turns=types.Content(
                            role="user",
                            parts=[
                                types.Part(text=f"Goal: {task}"),
                                types.Part(
                                    inline_data=types.Blob(
                                        data=screenshot, mime_type="image/jpeg"
                                    )
                                ),
                            ],
                        ),
                        turn_complete=True,
                    )

                    task_done = False
                    final_message = ""
                    final_success = False
                    action_history: list[str] = []  # Track action signatures for loop detection
                    loop_terminated = False

                    for step in range(self.max_steps):
                        step_start = time.time()

                        async for message in session.receive():
                            if message.tool_call:
                                function_responses = []

                                for fc in message.tool_call.function_calls:
                                    args = dict(fc.args) if fc.args else {}
                                    action_type = ACTION_TYPE_MAP.get(
                                        fc.name, "unknown"
                                    )

                                    result = await execute_action(
                                        page, fc.name, args
                                    )
                                    step_duration = int(
                                        (time.time() - step_start) * 1000
                                    )
                                    elapsed = int(
                                        (time.time() - start_time) * 1000
                                    )

                                    # Build description
                                    if fc.name == "navigate_to":
                                        desc = f"Navigate to {args.get('url', '')}"
                                    elif fc.name == "click_element":
                                        desc = f"Click '{args.get('description', '')}' at ({args.get('x')}, {args.get('y')})"
                                    elif fc.name == "type_text":
                                        desc = f"Type '{args.get('text', '')}'"
                                    elif fc.name == "press_key":
                                        desc = f"Press {args.get('key', '')}"
                                    elif fc.name == "scroll_page":
                                        desc = f"Scroll {args.get('direction', '')} {args.get('pixels', 300)}px"
                                    elif fc.name == "extract_text":
                                        desc = f"Extract: {args.get('description', '')}"
                                    elif fc.name == "task_complete":
                                        desc = args.get("result", "Task complete")
                                    else:
                                        desc = f"{fc.name}({args})"

                                    yield {
                                        "type": "step_progress",
                                        "stepIndex": step_count,
                                        "action": {
                                            "type": action_type,
                                            "action": desc,
                                            "reasoning": None,
                                        },
                                        "timing": {
                                            "stepDurationMs": step_duration,
                                            "totalElapsedMs": elapsed,
                                        },
                                    }

                                    step_count += 1

                                    # Loop detection: track action signatures
                                    if fc.name != "task_complete":
                                        sig = f"{fc.name}:{sorted(args.items())}"
                                        action_history.append(sig)

                                    if fc.name == "task_complete":
                                        task_done = True
                                        final_success = result.get(
                                            "success", True
                                        )
                                        final_message = result.get(
                                            "result", "Task completed"
                                        )

                                    function_responses.append(
                                        types.FunctionResponse(
                                            name=fc.name,
                                            id=fc.id,
                                            response=result,
                                        )
                                    )

                                await session.send_tool_response(
                                    function_responses=function_responses
                                )

                                if task_done:
                                    break

                                # Loop detection: check recent actions for repetition
                                loop_warning = ""
                                if len(action_history) >= 5:
                                    recent = action_history[-5:]
                                    counts = Counter(recent)
                                    most_common_sig, most_common_count = counts.most_common(1)[0]
                                    if most_common_count >= 5:
                                        # Hard terminate — agent is hopelessly stuck
                                        loop_terminated = True
                                        task_done = True
                                        final_success = False
                                        final_message = "Agent stuck in repeated loop — terminated"
                                        print(f"[loop-detect] Hard termination: '{most_common_sig}' repeated {most_common_count}x")
                                        break
                                    elif most_common_count >= 3:
                                        # Warn the agent to change approach
                                        loop_warning = (
                                            "\n\nWARNING: You are repeating the same action multiple times and it is not working. "
                                            "You MUST try a completely different strategy NOW. Consider: a different URL, "
                                            "a different search engine, or a different approach entirely. "
                                            "If you cannot make progress, call task_complete with success=false."
                                        )
                                        print(f"[loop-detect] Warning injected: '{most_common_sig}' repeated {most_common_count}x")

                                try:
                                    await page.wait_for_load_state("networkidle", timeout=3000)
                                except Exception:
                                    pass
                                await asyncio.sleep(0.5)
                                screenshot = await take_screenshot(page)
                                if self.streamer and not use_cloud:
                                    await self.streamer.broadcast(screenshot)

                                screenshot_text = "Here is the updated screenshot after the action."
                                if loop_warning:
                                    screenshot_text += loop_warning

                                await session.send_client_content(
                                    turns=types.Content(
                                        role="user",
                                        parts=[
                                            types.Part(
                                                text=screenshot_text
                                            ),
                                            types.Part(
                                                inline_data=types.Blob(
                                                    data=screenshot,
                                                    mime_type="image/jpeg",
                                                )
                                            ),
                                        ],
                                    ),
                                    turn_complete=True,
                                )
                                break

                            if message.text:
                                pass

                            if (
                                message.server_content
                                and message.server_content.turn_complete
                            ):
                                break

                        if task_done:
                            break

                    total_time = int((time.time() - start_time) * 1000)
                    yield {
                        "type": "agent_completed",
                        "success": final_success if task_done else False,
                        "message": final_message
                        if task_done
                        else f"Max steps ({self.max_steps}) reached",
                        "totalActions": step_count,
                        "timing": {
                            "totalElapsedMs": total_time,
                            "avgStepMs": total_time // max(step_count, 1),
                        },
                        "usage": {
                            "inputTokens": 0,
                            "outputTokens": 0,
                            "totalTokens": total_tokens,
                        },
                    }

            except Exception as e:
                yield {
                    "type": "agent_error",
                    "error": str(e),
                    "stepIndex": step_count,
                }

            finally:
                await browser.close()
