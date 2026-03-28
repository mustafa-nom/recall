"""
WebSocket screenshot streamer.

Broadcasts JPEG screenshots from Playwright to all connected WebSocket clients.
"""

import asyncio
from fastapi import WebSocket


class ScreenshotStreamer:
    def __init__(self):
        self._clients: list[WebSocket] = []
        self._latest_frame: bytes | None = None
        self._lock = asyncio.Lock()

    def add_client(self, ws: WebSocket):
        self._clients.append(ws)

    def remove_client(self, ws: WebSocket):
        if ws in self._clients:
            self._clients.remove(ws)

    async def broadcast(self, jpeg_bytes: bytes):
        """Send a JPEG frame to all connected clients."""
        self._latest_frame = jpeg_bytes
        disconnected = []
        for ws in self._clients:
            try:
                await ws.send_bytes(jpeg_bytes)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.remove_client(ws)

    async def stop(self):
        """Close all client connections."""
        for ws in self._clients[:]:
            try:
                await ws.close()
            except Exception:
                pass
        self._clients.clear()
