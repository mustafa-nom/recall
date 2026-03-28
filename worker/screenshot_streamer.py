"""
WebSocket screenshot streamer.

Broadcasts JPEG screenshots from Playwright to all connected WebSocket clients.
Captures at full resolution (1280x720) for agent/observer use, and downscales
on-the-fly for WebSocket streaming to keep the preview smooth.
"""

import asyncio
from io import BytesIO

from fastapi import WebSocket
from PIL import Image
from playwright.async_api import Page

STREAM_MAX_WIDTH = 960
STREAM_MAX_HEIGHT = 540
STREAM_QUALITY = 55


def _downscale_for_stream(jpeg_bytes: bytes) -> bytes:
    """Downscale a full-res JPEG to stream resolution for WebSocket clients."""
    img = Image.open(BytesIO(jpeg_bytes))
    w, h = img.size
    if w > STREAM_MAX_WIDTH or h > STREAM_MAX_HEIGHT:
        ratio = min(STREAM_MAX_WIDTH / w, STREAM_MAX_HEIGHT / h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.BILINEAR)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=STREAM_QUALITY)
    return buf.getvalue()


class ScreenshotStreamer:
    def __init__(self):
        self._clients: list[WebSocket] = []
        self._latest_frame: bytes | None = None
        self._page: Page | None = None
        self._capture_task: asyncio.Task | None = None
        self._capture_interval: float = 0.08  # ~12 FPS target

    def add_client(self, ws: WebSocket):
        self._clients.append(ws)

    def remove_client(self, ws: WebSocket):
        if ws in self._clients:
            self._clients.remove(ws)

    async def broadcast(self, jpeg_bytes: bytes):
        """Send a downscaled JPEG frame to all connected WebSocket clients.

        Stores the full-res frame in _latest_frame for observer/agent use.
        """
        self._latest_frame = jpeg_bytes  # Always full-res
        if not self._clients:
            return
        # Downscale once for all WebSocket clients
        stream_frame = _downscale_for_stream(jpeg_bytes)
        disconnected = []
        async def _send(ws: WebSocket):
            try:
                await ws.send_bytes(stream_frame)
            except Exception:
                disconnected.append(ws)
        await asyncio.gather(*[_send(ws) for ws in self._clients])
        for ws in disconnected:
            self.remove_client(ws)

    def get_latest_frame(self) -> bytes | None:
        """Return the most recent full-resolution screenshot frame."""
        return self._latest_frame

    def start_capture_loop(self, page: Page, take_screenshot_fn):
        """Start a background loop that captures and broadcasts screenshots."""
        self._page = page
        if self._capture_task and not self._capture_task.done():
            return  # Already running
        self._capture_task = asyncio.create_task(
            self._capture_loop(take_screenshot_fn)
        )

    def stop_capture_loop(self):
        """Stop the background capture loop."""
        if self._capture_task and not self._capture_task.done():
            self._capture_task.cancel()
        self._capture_task = None
        self._page = None

    async def _capture_loop(self, take_screenshot_fn):
        """Continuously capture full-res screenshots. Downscale for WebSocket in broadcast()."""
        try:
            while True:
                if self._page and self._clients:
                    try:
                        screenshot = await take_screenshot_fn(self._page)
                        await self.broadcast(screenshot)
                    except Exception:
                        pass  # Page may be navigating
                await asyncio.sleep(self._capture_interval)
        except asyncio.CancelledError:
            pass

    async def stop(self):
        """Stop capture loop and close all client connections."""
        self.stop_capture_loop()
        for ws in self._clients[:]:
            try:
                await ws.close()
            except Exception:
                pass
        self._clients.clear()
