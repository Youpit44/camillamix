import asyncio
import json
import logging
import os
from typing import Optional

import aiohttp

try:
    # pycamilladsp official client
    from camilladsp import CamillaClient
except Exception:  # pragma: no cover - optional dep
    CamillaClient = None

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
        # optional pycamilladsp client (direct CamillaDSP websocket)
        self._py_client: Optional['CamillaClient'] = None
        self._py_connected = False
        self._py_host = os.environ.get('CAMILLA_HOST', '127.0.0.1')
        self._py_port = int(os.environ.get('CAMILLA_PORT', '1234'))
        # Use external volume integration (Loudness without Volume filter)
        self._py_external_volume = os.environ.get('CAMILLA_EXTERNAL_VOLUME', '0') not in ('0', 'false', 'False', '')

    async def start(self):
        # Try to initialize pycamilladsp CamillaClient if available
        if CamillaClient:
            try:
                self._py_client = CamillaClient(self._py_host, self._py_port)
                self._py_client.connect()
                self._py_connected = True
                logger.info('Connected to CamillaDSP via pycamilladsp CamillaClient (%s:%s)', self._py_host, self._py_port)
            except Exception:
                logger.exception('Failed to connect to CamillaDSP via pycamilladsp CamillaClient')
                self._py_client = None
                self._py_connected = False
        else:
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
        if self._py_client and self._py_connected:
            try:
                self._py_client.disconnect()
            except Exception:
                logger.exception('Failed to disconnect pycamilladsp client')
            self._py_connected = False

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
        # if pycamilladsp CamillaClient is connected, use official API
        if self._py_client and self._py_connected:
            try:
                ch = int(channel)
                lv = float(level_db)
                # For master, use explicit main API (more reliable than fader=0)
                if ch == 0:
                    if self._py_external_volume and hasattr(self._py_client.volume, 'set_volume_external'):
                        # External volume mode (e.g., loudness with external control)
                        self._py_client.volume.set_volume_external(0, lv)
                    else:
                        self._py_client.volume.set_main_volume(lv)
                else:
                    # Only control Aux faders if they exist; many configs have up to 4
                    # We avoid mapping UI channels to Aux faders to prevent confusion.
                    # If you really want to map to Aux faders 1..4, uncomment next line.
                    # self._py_client.volume.set_volume(ch, lv)
                    pass
            except Exception:
                logger.exception('pycamilladsp set_main_volume/set_volume failed')
        msg = {"type": "set_channel_level", "payload": {"channel": channel, "level_db": level_db}}
        self._enqueue(msg)

    def set_mute(self, channel: int, mute: bool):
        if self._py_client and self._py_connected:
            try:
                ch = int(channel)
                m = bool(mute)
                if ch == 0:
                    self._py_client.volume.set_main_mute(m)
                else:
                    # See note above: avoid mapping UI channels to Aux faders by default
                    # self._py_client.volume.set_mute(ch, m)
                    pass
            except Exception:
                logger.exception('pycamilladsp set_main_mute/set_mute failed')
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
