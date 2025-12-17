import asyncio
import json
import logging
import os
from typing import Optional

import aiohttp

logger = logging.getLogger('camilla_adapter')


class CamillaAdapter:
    """Adapter that can connect to a CamillaGUI/CamillaDSP WebSocket endpoint.

    If environment variable `CAMILLA_WS_URL` is set, the adapter will attempt
    to connect to that WebSocket and forward control messages. Otherwise it
    operates in a local-logging (stub) mode.
    """
    def __init__(self, url: Optional[str] = None):
        self.url = url or os.environ.get('CAMILLA_WS_URL')
        self._session: Optional[aiohttp.ClientSession] = None
        self._ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self._task: Optional[asyncio.Task] = None
        self._queue: asyncio.Queue = asyncio.Queue()

    async def start(self):
        if not self.url:
            logger.info('CamillaAdapter running in stub mode (no CAMILLA_WS_URL)')
            return
        logger.info(f'CamillaAdapter connecting to {self.url}')
        self._session = aiohttp.ClientSession()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._ws:
            await self._ws.close()
        if self._session:
            await self._session.close()

    async def _run(self):
        assert self._session
        while True:
            try:
                async with self._session.ws_connect(self.url) as ws:
                    self._ws = ws
                    logger.info('Connected to CamillaGUI WebSocket')
                    # drain queue and send messages
                    while True:
                        msg = await self._queue.get()
                        try:
                            await ws.send_str(json.dumps(msg))
                        except Exception:
                            logger.exception('failed to send message')
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception('camilla adapter connection error, retrying in 2s')
                await asyncio.sleep(2)

    def _enqueue(self, msg: dict):
        # If running in stub mode, just log
        if not self.url:
            logger.info('Adapter (stub) would send: %s', json.dumps(msg))
            return
        # else push to queue
        try:
            self._queue.put_nowait(msg)
        except Exception:
            logger.exception('failed to enqueue message')

    def set_level(self, channel: int, level_db: float):
        msg = {"type": "set_channel_level", "payload": {"channel": channel, "level_db": level_db}}
        self._enqueue(msg)

    def set_mute(self, channel: int, mute: bool):
        msg = {"type": "set_channel_mute", "payload": {"channel": channel, "mute": bool(mute)}}
        self._enqueue(msg)

    def set_solo(self, channel: int, solo: bool):
        msg = {"type": "set_channel_solo", "payload": {"channel": channel, "solo": bool(solo)}}
        self._enqueue(msg)

    def load_preset(self, name: str):
        msg = {"type": "load_preset", "payload": {"name": name}}
        self._enqueue(msg)

    def save_preset(self, name: str):
        msg = {"type": "save_preset", "payload": {"name": name}}
        self._enqueue(msg)
