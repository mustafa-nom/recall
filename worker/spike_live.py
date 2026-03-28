"""
Gemini Live API + Playwright Browser Agent Spike

Validates the core loop:
  1. Open Playwright browser
  2. Connect to Gemini Live API via WebSocket
  3. Send JPEG screenshot
  4. Receive tool_call action
  5. Execute with Playwright
  6. Send tool_response + new screenshot
  7. Repeat until task_complete or max steps

Usage:
  python spike_live.py "go to hacker news and find the top story"
  python spike_live.py "search google for weather in new york"
"""

import asyncio
import json
import os
import sys
import time
from io import BytesIO

from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image
from playwright.async_api import async_playwright

load_dotenv()

API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = "gemini-2.5-flash-native-audio-latest"
MAX_STEPS = 30
SCREENSHOT_QUALITY = 75
SCREENSHOT_MAX_WIDTH = 1280
SCREENSHOT_MAX_HEIGHT = 720


# --- Tool Declarations ---

navigate_tool = types.FunctionDeclaration(
    name="navigate_to",
    description="Navigate the browser to a specific URL",
    parameters={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "The URL to navigate to"},
        },
        "required": ["url"],
    },
)

click_tool = types.FunctionDeclaration(
    name="click_element",
    description="Click on an element described by its visual appearance or text content on the page",
    parameters={
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": "Description of the element to click (e.g. 'the search button', 'the login link')",
            },
            "x": {
                "type": "integer",
                "description": "X coordinate in pixels to click at",
            },
            "y": {
                "type": "integer",
                "description": "Y coordinate in pixels to click at",
            },
        },
        "required": ["description", "x", "y"],
    },
)

type_tool = types.FunctionDeclaration(
    name="type_text",
    description="Type text into the currently focused element or a described element",
    parameters={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "The text to type"},
            "description": {
                "type": "string",
                "description": "Optional: description of the input field to click first before typing",
            },
            "x": {
                "type": "integer",
                "description": "Optional: X coordinate to click before typing",
            },
            "y": {
                "type": "integer",
                "description": "Optional: Y coordinate to click before typing",
            },
        },
        "required": ["text"],
    },
)

press_key_tool = types.FunctionDeclaration(
    name="press_key",
    description="Press a keyboard key (e.g. Enter, Tab, Escape, Backspace, ArrowDown)",
    parameters={
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "Key to press (e.g. 'Enter', 'Tab', 'Escape', 'Backspace')",
            },
        },
        "required": ["key"],
    },
)

scroll_tool = types.FunctionDeclaration(
    name="scroll_page",
    description="Scroll the page up or down",
    parameters={
        "type": "object",
        "properties": {
            "direction": {
                "type": "string",
                "enum": ["up", "down"],
                "description": "Direction to scroll",
            },
            "pixels": {
                "type": "integer",
                "description": "Number of pixels to scroll (default 300)",
            },
        },
        "required": ["direction"],
    },
)

extract_tool = types.FunctionDeclaration(
    name="extract_text",
    description="Extract and return visible text from the page or a specific element",
    parameters={
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": "What text to extract (e.g. 'the page title', 'the price', 'the first result')",
            },
        },
        "required": ["description"],
    },
)

done_tool = types.FunctionDeclaration(
    name="task_complete",
    description="Signal that the task is complete. Call this when you have accomplished the user's goal.",
    parameters={
        "type": "object",
        "properties": {
            "success": {
                "type": "boolean",
                "description": "Whether the task was completed successfully",
            },
            "result": {
                "type": "string",
                "description": "Summary of what was accomplished or the extracted result",
            },
        },
        "required": ["success", "result"],
    },
)

ALL_TOOLS = [
    navigate_tool,
    click_tool,
    type_tool,
    press_key_tool,
    scroll_tool,
    extract_tool,
    done_tool,
]

SYSTEM_PROMPT = """You are a browser automation agent. You see screenshots of a web browser and use tools to interact with web pages to accomplish the user's goal.

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
10. Coordinates are relative to the 1280x720 viewport shown in the screenshot."""


async def take_screenshot(page) -> bytes:
    """Capture a JPEG screenshot, resized to fit within max dimensions."""
    png_bytes = await page.screenshot(type="png")
    img = Image.open(BytesIO(png_bytes))

    # Resize if needed
    w, h = img.size
    if w > SCREENSHOT_MAX_WIDTH or h > SCREENSHOT_MAX_HEIGHT:
        ratio = min(SCREENSHOT_MAX_WIDTH / w, SCREENSHOT_MAX_HEIGHT / h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    # Convert to JPEG
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=SCREENSHOT_QUALITY)
    return buf.getvalue()


async def execute_action(page, fc) -> dict:
    """Execute a tool call and return the result."""
    name = fc.name
    args = dict(fc.args) if fc.args else {}

    try:
        if name == "navigate_to":
            url = args["url"]
            print(f"    → Navigating to {url}")
            await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            return {"status": "navigated", "url": url}

        elif name == "click_element":
            x, y = args.get("x", 0), args.get("y", 0)
            desc = args.get("description", "")
            print(f"    → Clicking '{desc}' at ({x}, {y})")
            await page.mouse.click(x, y)
            await asyncio.sleep(0.5)  # Wait for click effect
            return {"status": "clicked", "description": desc, "x": x, "y": y}

        elif name == "type_text":
            text = args["text"]
            desc = args.get("description", "")
            x, y = args.get("x"), args.get("y")
            if x is not None and y is not None:
                print(f"    → Clicking ({x}, {y}) then typing '{text}'")
                await page.mouse.click(x, y)
                await asyncio.sleep(0.3)
            else:
                print(f"    → Typing '{text}'")
            await page.keyboard.type(text, delay=50)
            return {"status": "typed", "text": text}

        elif name == "press_key":
            key = args["key"]
            print(f"    → Pressing {key}")
            await page.keyboard.press(key)
            await asyncio.sleep(0.5)
            return {"status": "pressed", "key": key}

        elif name == "scroll_page":
            direction = args["direction"]
            pixels = args.get("pixels", 300)
            delta = pixels if direction == "down" else -pixels
            print(f"    → Scrolling {direction} {pixels}px")
            await page.mouse.wheel(0, delta)
            await asyncio.sleep(0.3)
            return {"status": "scrolled", "direction": direction, "pixels": pixels}

        elif name == "extract_text":
            desc = args.get("description", "")
            print(f"    → Extracting text: '{desc}'")
            text = await page.inner_text("body")
            # Truncate to avoid overwhelming the model
            text = text[:2000] if len(text) > 2000 else text
            return {"status": "extracted", "text": text}

        elif name == "task_complete":
            success = args.get("success", True)
            result = args.get("result", "")
            print(f"    → Task complete: success={success}, result='{result}'")
            return {"status": "done", "success": success, "result": result}

        else:
            return {"status": "error", "error": f"Unknown tool: {name}"}

    except Exception as e:
        print(f"    ✗ Error executing {name}: {e}")
        return {"status": "error", "error": str(e)}


async def run_agent(goal: str):
    """Main agent loop: Gemini Live API + Playwright."""
    if not API_KEY:
        print("ERROR: Set GEMINI_API_KEY environment variable")
        sys.exit(1)

    client = genai.Client(api_key=API_KEY)

    print(f"\n{'='*60}")
    print(f"  RECALL SPIKE — Gemini Live API + Playwright")
    print(f"  Model: {MODEL}")
    print(f"  Goal: {goal}")
    print(f"{'='*60}\n")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        await page.goto("about:blank")

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=SYSTEM_PROMPT,
            tools=[types.Tool(function_declarations=ALL_TOOLS)],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck")
                )
            ),
        )

        metrics = {
            "steps": 0,
            "start_time": time.time(),
            "tool_calls": [],
            "errors": 0,
        }

        print(f"[init] Connecting to Gemini Live API...")
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            print(f"[init] Connected! Taking initial screenshot...")

            # Send initial goal with screenshot
            screenshot = await take_screenshot(page)
            print(f"[init] Screenshot: {len(screenshot)} bytes")

            await session.send_client_content(
                turns=types.Content(
                    role="user",
                    parts=[
                        types.Part(text=f"Goal: {goal}"),
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
            resumption_handle = None

            for step in range(MAX_STEPS):
                step_start = time.time()
                print(f"\n[step {step + 1}/{MAX_STEPS}] Waiting for model response...")

                # Collect the model's response
                async for message in session.receive():
                    # Handle GoAway
                    if hasattr(message, "go_away") and message.go_away:
                        time_left = getattr(message.go_away, "time_left", "unknown")
                        print(f"  ⚠ GoAway received, time left: {time_left}")

                    # Capture session resumption handle
                    if (
                        message.server_content
                        and hasattr(
                            message.server_content, "session_resumption_update"
                        )
                        and message.server_content.session_resumption_update
                    ):
                        resumption_handle = (
                            message.server_content.session_resumption_update.new_handle
                        )

                    # Handle tool calls
                    if message.tool_call:
                        function_responses = []

                        for fc in message.tool_call.function_calls:
                            metrics["steps"] += 1
                            call_start = time.time()
                            print(
                                f"  [tool] {fc.name}({json.dumps(dict(fc.args) if fc.args else {})})"
                            )

                            result = await execute_action(page, fc)
                            call_duration = time.time() - call_start

                            metrics["tool_calls"].append(
                                {
                                    "name": fc.name,
                                    "args": dict(fc.args) if fc.args else {},
                                    "result": result,
                                    "duration_ms": int(call_duration * 1000),
                                }
                            )

                            if result.get("status") == "error":
                                metrics["errors"] += 1

                            if fc.name == "task_complete":
                                task_done = True

                            function_responses.append(
                                types.FunctionResponse(
                                    name=fc.name,
                                    id=fc.id,
                                    response=result,
                                )
                            )

                        # Send tool responses
                        await session.send_tool_response(
                            function_responses=function_responses
                        )

                        if task_done:
                            break

                        # Wait for action to take effect, then send new screenshot
                        await asyncio.sleep(0.5)
                        screenshot = await take_screenshot(page)

                        await session.send_client_content(
                            turns=types.Content(
                                role="user",
                                parts=[
                                    types.Part(
                                        text="Here is the updated screenshot after the action."
                                    ),
                                    types.Part(
                                        inline_data=types.Blob(
                                            data=screenshot, mime_type="image/jpeg"
                                        )
                                    ),
                                ],
                            ),
                            turn_complete=True,
                        )
                        break  # Go to next step

                    # Handle text output (model thinking aloud)
                    if message.text:
                        print(f"  [text] {message.text}")

                    # Handle turn completion without tool call
                    if (
                        message.server_content
                        and message.server_content.turn_complete
                    ):
                        print(f"  [turn] Turn complete (no tool call)")
                        break

                step_duration = time.time() - step_start
                print(f"  [timing] Step took {step_duration:.2f}s")

                if task_done:
                    break

        # Print summary
        total_time = time.time() - metrics["start_time"]
        print(f"\n{'='*60}")
        print(f"  SPIKE RESULTS")
        print(f"{'='*60}")
        print(f"  Total steps:    {metrics['steps']}")
        print(f"  Total time:     {total_time:.2f}s")
        print(f"  Errors:         {metrics['errors']}")
        print(f"  Task completed: {task_done}")
        if metrics["tool_calls"]:
            avg_latency = sum(
                tc["duration_ms"] for tc in metrics["tool_calls"]
            ) / len(metrics["tool_calls"])
            print(f"  Avg latency:    {avg_latency:.0f}ms per action")
        print(f"\n  Tool call log:")
        for i, tc in enumerate(metrics["tool_calls"]):
            status = tc["result"].get("status", "unknown")
            print(f"    {i+1}. {tc['name']} → {status} ({tc['duration_ms']}ms)")
        print(f"{'='*60}\n")

        await browser.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python spike_live.py <task>")
        print('Example: python spike_live.py "go to hacker news and find the top story"')
        sys.exit(1)

    goal = " ".join(sys.argv[1:])
    asyncio.run(run_agent(goal))
