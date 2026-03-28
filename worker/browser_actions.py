"""
Playwright action executor.

Wraps Playwright Page with high-level actions matching the Gemini tool declarations.
"""

import asyncio
from io import BytesIO
from PIL import Image
from playwright.async_api import Page

SCREENSHOT_QUALITY = 75
SCREENSHOT_MAX_WIDTH = 1280
SCREENSHOT_MAX_HEIGHT = 720


async def take_screenshot(page: Page) -> bytes:
    """Capture a JPEG screenshot, resized to fit within max dimensions."""
    png_bytes = await page.screenshot(type="png")
    img = Image.open(BytesIO(png_bytes))

    w, h = img.size
    if w > SCREENSHOT_MAX_WIDTH or h > SCREENSHOT_MAX_HEIGHT:
        ratio = min(SCREENSHOT_MAX_WIDTH / w, SCREENSHOT_MAX_HEIGHT / h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=SCREENSHOT_QUALITY)
    return buf.getvalue()


async def execute_action(page: Page, name: str, args: dict) -> dict:
    """Execute a browser action and return the result."""
    try:
        if name == "navigate_to":
            url = args["url"]
            await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            return {"status": "navigated", "url": url}

        elif name == "click_element":
            x = args.get("x", 0)
            y = args.get("y", 0)
            desc = args.get("description", "")
            await page.mouse.click(x, y)
            await asyncio.sleep(1.0)
            return {"status": "clicked", "description": desc, "x": x, "y": y}

        elif name == "type_text":
            text = args["text"]
            x, y = args.get("x"), args.get("y")
            if x is not None and y is not None:
                await page.mouse.click(x, y)
                await asyncio.sleep(0.3)
            await page.keyboard.type(text, delay=50)
            return {"status": "typed", "text": text}

        elif name == "press_key":
            key = args["key"]
            await page.keyboard.press(key)
            await asyncio.sleep(1.0)
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
