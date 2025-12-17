"""CamillaDSP client adapter (stub/prototype).

Provides a simple async client interface to connect to a CamillaDSP instance.
For the prototype this module simulates meter events when no real backend is configured.
"""
import asyncio
import json
import logging
import random
from typing import Callable, Optional

logger = logging.getLogger(__name__)


class CamillaClient:
    def __init__(self, host: str = "localhost", port: int = 5555, use_ws: bool = True):
        self.host = host
        self.port = port
        self.use_ws = use_ws
        self._meter_task: Optional[asyncio.Task] = None
        self._meter_cb: Optional[Callable[[dict], None]] = None
        self._running = False

    async def connect(self):
        # In a real implementation, open WebSocket/HTTP connection here.
        logger.info("CamillaClient.connect() (stub) host=%s port=%s", self.host, self.port)
        self._running = True

    async def disconnect(self):
        self._running = False
        if self._meter_task:
            self._meter_task.cancel()

    async def send_control(self, channel: int, control: str, value):
        # Send control to CamillaDSP (volume, treble, bass, etc.)
        payload = {"channel": channel, "control": control, "value": value}
        logger.info("send_control: %s", json.dumps(payload))
        # In prototype, just log — a real client would forward to remote API.

    def subscribe_meters(self, callback: Callable[[dict], None], channels: int = 8, interval: float = 0.2):
        """Start emitting simulated meter data to callback.

        Callback receives dict: {"meters": [0.0..1.0, ...]}
        """
        self._meter_cb = callback

        async def _emit_loop():
            try:
                while self._running:
                    meters = [random.random() for _ in range(channels)]
                    try:
                        callback({"meters": meters})
                    except Exception:
                        logger.exception("meter callback failed")
                    await asyncio.sleep(interval)
            except asyncio.CancelledError:
                return

        if not self._meter_task or self._meter_task.done():
            self._meter_task = asyncio.create_task(_emit_loop())


__all__ = ["CamillaClient"]
