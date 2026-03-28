"""
Playwright action executor.

Wraps Playwright Page with high-level actions matching the Gemini tool declarations.
"""

import asyncio
import base64
import json
import logging
import os
from io import BytesIO

from google import genai
from google.genai import types
from PIL import Image
from playwright.async_api import Page

logger = logging.getLogger(__name__)

SCREENSHOT_QUALITY = 75
SCREENSHOT_MAX_WIDTH = 1280
SCREENSHOT_MAX_HEIGHT = 720


async def take_screenshot(page: Page) -> bytes:
    """Capture a JPEG screenshot, enforcing exactly 1280x720 output.

    Uses native JPEG capture for speed, but verifies and resizes if the
    output doesn't match expected dimensions (e.g. on HiDPI/Retina displays).
    Uses a 5-second timeout to prevent hanging on font loading in cloud browsers.
    """
    jpeg_bytes = await page.screenshot(
        type="jpeg", quality=SCREENSHOT_QUALITY, timeout=5000
    )
    img = Image.open(BytesIO(jpeg_bytes))
    w, h = img.size
    if (w, h) != (SCREENSHOT_MAX_WIDTH, SCREENSHOT_MAX_HEIGHT):
        img = img.resize(
            (SCREENSHOT_MAX_WIDTH, SCREENSHOT_MAX_HEIGHT), Image.LANCZOS
        )
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=SCREENSHOT_QUALITY)
        return buf.getvalue()
    return jpeg_bytes


async def verify_click_target(page: Page, expected_description: str) -> dict | None:
    """Take a screenshot and ask Gemini if the correct field is focused.

    Returns None on any failure so the caller always proceeds normally.
    """
    try:
        screenshot_bytes = await take_screenshot(page)
        b64 = base64.b64encode(screenshot_bytes).decode("utf-8")

        client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Content(
                    parts=[
                        types.Part.from_bytes(data=screenshot_bytes, mime_type="image/jpeg"),
                        types.Part.from_text(
                            f"I just clicked on an input field described as '{expected_description}'. "
                            "Looking at this screenshot, is the correct field focused/active? "
                            "Look for a blinking cursor, blue highlight, opened dropdown, or other focus indicators. "
                            "Respond ONLY with JSON (no markdown): "
                            '{"correct_field_focused": true/false, "what_is_focused": "description", '
                            '"suggested_x": integer or null, "suggested_y": integer or null}'
                        ),
                    ]
                )
            ],
        )

        text = response.text.strip()
        # Strip markdown fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        return json.loads(text)
    except Exception as e:
        logger.debug(f"Click verification failed (non-blocking): {e}")
        return None


async def _find_search_input(page: Page) -> object | None:
    """Try to find a visible search input on the page using Playwright selectors.

    Returns the first visible search-like input, or None.
    """
    selectors = [
        "input[type='search']",
        "input[name='q']",
        "input[name='search']",
        "input[placeholder*='earch' i]",
        "input[placeholder*='Search' i]",
        "input[aria-label*='earch' i]",
        "input#searchInput",
        "input#search",
        "input#searchboxinput",
        "input[role='searchbox']",
        "input[role='combobox']",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.is_visible(timeout=500):
                return loc
        except Exception:
            continue
    return None


async def execute_action(page: Page, name: str, args: dict) -> dict:
    """Execute a browser action and return the result."""
    try:
        if name == "navigate_to":
            url = args["url"]
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=10000)
            except Exception:
                # Page may still be usable even if domcontentloaded times out
                logger.info(f"Navigation to {url} timed out, continuing anyway")
            await asyncio.sleep(0.5)
            return {"status": "navigated", "url": url}

        elif name == "click_element":
            x = args.get("x", 0)
            y = args.get("y", 0)
            desc = args.get("description", "")
            # Clamp coordinates to viewport bounds to prevent clicking browser chrome
            x = max(0, min(int(x), SCREENSHOT_MAX_WIDTH - 1))
            y = max(0, min(int(y), SCREENSHOT_MAX_HEIGHT - 1))
            if y < 5:
                logger.warning(f"Click near top edge (y={y}), likely browser chrome — clamping to y=5")
                y = 5

            desc_lower = desc.lower()
            is_search_click = any(
                kw in desc_lower for kw in ("search", "query", "find", "lookup")
            )

            if is_search_click:
                # Try Playwright selector first — much more reliable than coordinates
                search_input = await _find_search_input(page)
                if search_input:
                    await search_input.click()
                    logger.info(f"Used Playwright selector for search input (instead of coords {x},{y})")
                    await asyncio.sleep(0.3)
                    return {"status": "clicked", "description": desc, "x": x, "y": y, "method": "selector"}

            await page.mouse.click(x, y)
            await asyncio.sleep(0.8)
            return {"status": "clicked", "description": desc, "x": x, "y": y}

        elif name == "type_text":
            text = args["text"]
            desc = args.get("description", "")
            x, y = args.get("x"), args.get("y")
            focused_via_selector = False

            # First, try to find a search input via Playwright selectors
            # This is far more reliable than coordinate-based clicking
            desc_lower = (desc or "").lower()
            is_search_typing = (
                any(kw in desc_lower for kw in ("search", "query", "find", "input"))
                or x is None
            )

            if is_search_typing:
                search_input = await _find_search_input(page)
                if search_input:
                    try:
                        await search_input.click()
                        await asyncio.sleep(0.2)
                        await search_input.fill("")
                        await search_input.type(text, delay=50)
                        await asyncio.sleep(0.5)
                        logger.info(f"Typed '{text}' via Playwright selector (reliable)")
                        return {"status": "typed", "text": text, "method": "selector"}
                    except Exception as e:
                        logger.info(f"Selector typing failed ({e}), falling back to coordinates")

            # Fallback: coordinate-based clicking + typing
            if x is not None and y is not None:
                x = max(0, min(int(x), SCREENSHOT_MAX_WIDTH - 1))
                y = max(5, min(int(y), SCREENSHOT_MAX_HEIGHT - 1))
                await page.mouse.click(x, y)
                await asyncio.sleep(0.3)

                # Triple-click to select all text in field
                await page.mouse.click(x, y, click_count=3)
                await asyncio.sleep(0.1)
            else:
                await page.keyboard.press("Control+a")
                await asyncio.sleep(0.1)
            # Delete selected text cleanly
            await page.keyboard.press("Backspace")
            await asyncio.sleep(0.2)
            await page.keyboard.type(text, delay=50)
            await asyncio.sleep(0.5)
            return {"status": "typed", "text": text}

        elif name == "press_key":
            key = args["key"]
            await page.keyboard.press(key)
            await asyncio.sleep(0.5)
            return {"status": "pressed", "key": key}

        elif name == "scroll_page":
            direction = args["direction"]
            pixels = args.get("pixels", 300)
            delta = pixels if direction == "down" else -pixels
            await page.mouse.wheel(0, delta)
            await asyncio.sleep(0.3)
            return {"status": "scrolled", "direction": direction, "pixels": pixels}

        elif name == "extract_text":
            desc = args.get("description", "")
            text = await page.inner_text("body")
            text = text[:15000] if len(text) > 15000 else text
            return {"status": "extracted", "description": desc, "text": text}

        elif name == "task_complete":
            success = args.get("success", True)
            result = args.get("result", "")
            return {"status": "done", "success": success, "result": result}

        else:
            return {"status": "error", "error": f"Unknown action: {name}"}

    except Exception as e:
        return {"status": "error", "error": str(e)}
