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
        # optional pycamilladsp client
        self._pycdsp = None
        self._pycdsp_connected = False
        self._py_host = os.environ.get('CAMILLA_HOST', '127.0.0.1')
        self._py_port = int(os.environ.get('CAMILLA_PORT', '1234'))

    async def start(self):
        # Try to initialize pycamilladsp if available
        try:
            import pycamilladsp as pycdsp  # type: ignore
            self._pycdsp = pycdsp
            logger.info('pycamilladsp available; trying TCP %s:%s', self._py_host, self._py_port)
            try:
                self._pycdsp.connect(self._py_host, self._py_port)
                self._pycdsp_connected = True
                logger.info('Connected to CamillaDSP via pycamilladsp')
            except Exception:
                logger.exception('Failed to connect to CamillaDSP via pycamilladsp')
        except Exception:
            logger.info('pycamilladsp not installed; skipping direct CamillaDSP control')

        if not self.url:
            logger.info('CamillaAdapter running in stub/py mode (no CAMILLA_WS_URL)')
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
        # if pycamilladsp is connected, try to set gain
        if self._pycdsp and self._pycdsp_connected:
            try:
                # pycamilladsp has setvolume(channel, value) or similar; use generic command
                # fallback to sending a command dict if API differs
                if hasattr(self._pycdsp, 'set_gain'):
                    self._pycdsp.set_gain(channel, level_db)
                elif hasattr(self._pycdsp, 'setvolume'):
                    self._pycdsp.setvolume(channel, level_db)
                else:
                    # attempt generic RPC if exposed
                    pass
            except Exception:
                logger.exception('pycamilladsp set_level failed')
        msg = {"type": "set_channel_level", "payload": {"channel": channel, "level_db": level_db}}
        self._enqueue(msg)

    def set_mute(self, channel: int, mute: bool):
        if self._pycdsp and self._pycdsp_connected:
            try:
                if hasattr(self._pycdsp, 'set_mute'):
                    self._pycdsp.set_mute(channel, bool(mute))
            except Exception:
                logger.exception('pycamilladsp set_mute failed')
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
