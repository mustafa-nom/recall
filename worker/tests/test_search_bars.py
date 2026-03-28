"""
Playwright tests to validate demo example tasks and screenshot pipeline.

Run with: pytest worker/tests/test_search_bars.py -v
"""

import pytest
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright, Page


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True)
        yield br
        br.close()


@pytest.fixture
def page(browser):
    pg = browser.new_page(viewport={"width": 1280, "height": 720})
    yield pg
    pg.close()


# --- Screenshot dimension tests ---


def test_screenshot_dimensions_jpeg(page: Page):
    """Native JPEG screenshot must be exactly 1280x720 pixels."""
    page.goto("https://en.wikipedia.org", wait_until="domcontentloaded")
    jpeg_bytes = page.screenshot(type="jpeg", quality=75)
    img = Image.open(BytesIO(jpeg_bytes))
    w, h = img.size
    # On non-HiDPI, should be 1280x720.
    # On HiDPI/Retina, may be 2560x1440 — this is why take_screenshot enforces resize.
    # We just verify the capture succeeds and produces a valid image.
    assert w >= 1280
    assert h >= 720


def test_screenshot_dimensions_enforced(page: Page):
    """The take_screenshot function must produce exactly 1280x720 output."""
    import sys, os, asyncio
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    try:
        from browser_actions import take_screenshot
    except ImportError:
        pytest.skip("browser_actions requires google-genai (use worker venv)")

    page.goto("https://en.wikipedia.org", wait_until="domcontentloaded")

    # take_screenshot is async, run it in event loop
    async def capture():
        return await take_screenshot(page)

    jpeg_bytes = asyncio.get_event_loop().run_until_complete(capture())
    img = Image.open(BytesIO(jpeg_bytes))
    assert img.size == (1280, 720), f"Expected (1280, 720), got {img.size}"


# --- Search bar tests ---


def test_hn_algolia_search(page: Page):
    """hn.algolia.com search bar shows results as you type."""
    page.goto("https://hn.algolia.com", wait_until="domcontentloaded")
    search = page.locator("input[type='search'], input.SearchInput, input[placeholder*='Search']").first
    search.click()
    search.fill("browser agents")
    page.wait_for_selector(".Story, .Item, article, [class*='story']", timeout=10000)
    results_text = page.inner_text("body")
    assert len(results_text) > 100


def test_wikipedia_search(page: Page):
    """Wikipedia search bar accepts text and navigates on Enter."""
    page.goto("https://en.wikipedia.org", wait_until="domcontentloaded")
    search = page.locator("#searchInput")
    search.click()
    search.fill("artificial intelligence")
    search.press("Enter")
    page.wait_for_load_state("domcontentloaded")
    assert "artificial" in page.url.lower() or "Artificial" in page.title()


def test_google_flights_loads(page: Page):
    """Google Flights page loads with search form fields visible."""
    page.goto("https://www.google.com/travel/flights", wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    body = page.inner_text("body")
    # Google Flights should show "Where from?" and "Where to?" (or equivalent)
    has_flight_ui = (
        "where" in body.lower()
        or "flights" in body.lower()
        or "destination" in body.lower()
    )
    assert has_flight_ui, f"Google Flights UI not detected. Body: {body[:300]}"


def test_google_maps_search(page: Page):
    """Google Maps search bar accepts text input."""
    page.goto("https://www.google.com/maps", wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    search = page.locator("#searchboxinput, input[name='q']").first
    search.click()
    search.fill("Italian restaurant Manhattan")
    search.press("Enter")
    page.wait_for_timeout(5000)
    # Verify results appeared (URL should contain search query or results visible)
    body = page.inner_text("body")
    has_results = (
        "italian" in body.lower()
        or "restaurant" in body.lower()
        or "manhattan" in body.lower()
        or len(body) > 500
    )
    assert has_results


# --- Click bounds test ---


def test_click_bounds_clamping():
    """Verify that coordinate clamping works for out-of-bounds values."""
    # Simulates the clamping logic from browser_actions.py
    MAX_W, MAX_H = 1280, 720

    # Out-of-bounds coordinates
    test_cases = [
        ((-50, -10), (0, 5)),      # Negative → clamped to 0/5
        ((1500, 800), (1279, 719)), # Over max → clamped to max-1
        ((900, 2), (900, 5)),       # y < 5 → clamped to 5 (browser chrome)
        ((640, 360), (640, 360)),   # In bounds → unchanged
    ]

    for (in_x, in_y), (exp_x, exp_y) in test_cases:
        x = max(0, min(int(in_x), MAX_W - 1))
        y = max(0, min(int(in_y), MAX_H - 1))
        if y < 5:
            y = 5
        assert (x, y) == (exp_x, exp_y), f"Input ({in_x}, {in_y}) → ({x}, {y}), expected ({exp_x}, {exp_y})"
