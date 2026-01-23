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
        # Default ON unless explicitly disabled
        self._py_external_volume = os.environ.get('CAMILLA_EXTERNAL_VOLUME', '1') not in ('0', 'false', 'False', '')

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
                    # Map fader index back to mixer dest index
                    # server.py sends ch+1 for UI channel ch
                    mixer_dest = ch - 1
                    self._update_mixer_gain(mixer_dest, lv)

            except Exception:
                logger.exception('pycamilladsp set_level failed')
        msg = {"type": "set_channel_level", "payload": {"channel": channel, "level_db": level_db}}
        self._enqueue(msg)

    def _update_mixer_gain(self, dest_index: int, level_db: float):
        try:
            config = self._py_client.config.active()
            if not config:
                return
            
            mixers = config.get('mixers', {})
            updated = False
            
            for m_name, m_data in mixers.items():
                mapping = m_data.get('mapping', [])
                for entry in mapping:
                    if entry.get('dest') == dest_index:
                        sources = entry.get('sources', [])
                        for src in sources:
                            src['gain'] = level_db
                            updated = True
            
            if updated:
                self._py_client.config.set_active(config)
        except Exception:
            logger.exception('Failed to update mixer gain')

    def set_mute(self, channel: int, mute: bool):
        self.set_mutes([(channel, mute)])

    def set_mutes(self, items: list):
        """
        Batch update mutes.
        items: list of (channel, mute) tuples.
        """
        if self._py_client and self._py_connected:
            try:
                # Separate master and channels
                master_mute = None
                channel_mutes = {} # dest_index -> mute

                for ch, m in items:
                    ch = int(ch)
                    m = bool(m)
                    if ch == 0:
                        master_mute = m
                    else:
                        channel_mutes[ch - 1] = m

                # Apply master mute if present
                if master_mute is not None:
                    self._py_client.volume.set_main_mute(master_mute)

                # Apply channel mutes if present
                if channel_mutes:
                    self._update_mixer_mutes_batch(channel_mutes)

            except Exception:
                logger.exception('pycamilladsp set_mutes failed')

        # Enqueue messages
        for ch, m in items:
            msg = {"type": "set_channel_mute", "payload": {"channel": ch, "mute": bool(m)}}
            self._enqueue(msg)

    def _update_mixer_mutes_batch(self, mute_map: dict):
        """
        mute_map: { dest_index: mute_bool }
        """
        try:
            config = self._py_client.config.active()
            if not config:
                return
            
            mixers = config.get('mixers', {})
            updated = False
            
            for m_name, m_data in mixers.items():
                mapping = m_data.get('mapping', [])
                for entry in mapping:
                    dest = entry.get('dest')
                    if dest in mute_map:
                        target_mute = mute_map[dest]
                        if entry.get('mute') != target_mute:
                            entry['mute'] = target_mute
                            updated = True
            
            if updated:
                self._py_client.config.set_active(config)
        except Exception:
            logger.exception('Failed to update mixer mutes batch')

    def _update_mixer_mute(self, dest_index: int, mute: bool):
        self._update_mixer_mutes_batch({dest_index: mute})

    def set_filter_gain(self, filter_name: str, gain_db: float):
        """
        Update the gain of a specific filter in the active configuration.
        """
        if self._py_client and self._py_connected:
            try:
                config = self._py_client.config.active()
                if not config:
                    return
                
                filters = config.get('filters', {})
                updated = False
                
                if filter_name in filters:
                    flt = filters[filter_name]
                    # Check if it has parameters and gain
                    if 'parameters' in flt and 'gain' in flt['parameters']:
                        # Only update if changed to avoid unnecessary config reloads
                        if flt['parameters']['gain'] != gain_db:
                            flt['parameters']['gain'] = gain_db
                            updated = True
                
                if updated:
                    self._py_client.config.set_active(config)
            except Exception:
                logger.exception(f'Failed to update filter gain for {filter_name}')
        
        # Enqueue message for stub/logging
        msg = {"type": "set_filter_gain", "payload": {"filter": filter_name, "gain_db": gain_db}}
        self._enqueue(msg)

    def get_current_state(self):
        """Retrieve current state (master vol/mute and mixer gains/mutes) from CamillaDSP."""
        if not (self._py_client and self._py_connected):
            return None
        
        state = {'master': {}, 'channels': {}}
        try:
            # Master
            state['master']['level_db'] = self._py_client.volume.main_volume()
            state['master']['mute'] = self._py_client.volume.main_mute()
            
            # Channels
            config = self._py_client.config.active()
            if config:
                mixers = config.get('mixers', {})
                for m_name, m_data in mixers.items():
                    mapping = m_data.get('mapping', [])
                    for entry in mapping:
                        dest = entry.get('dest')
                        if isinstance(dest, int):
                            # Mute
                            mute = entry.get('mute', False)
                            # Gain
                            gain = 0.0
                            sources = entry.get('sources', [])
                            if sources:
                                gain = sources[0].get('gain', 0.0)
                            
                            state['channels'][dest] = {'level_db': gain, 'mute': mute}
                
                # Filters (EQ)
                filters = config.get('filters', {})
                for dest in list(state['channels'].keys()):
                    eq = {'gain': 0.0, 'low': 0.0, 'mid': 0.0, 'high': 0.0}
                    
                    gain_name = f'Gain_{dest}'
                    bass_name = f'Bass_{dest}'
                    mid_name = f'Mid_{dest}'
                    treble_name = f'Treble_{dest}'

                    if gain_name in filters:
                        eq['gain'] = filters[gain_name].get('parameters', {}).get('gain', 0.0)
                    if bass_name in filters:
                        eq['low'] = filters[bass_name].get('parameters', {}).get('gain', 0.0)
                    if mid_name in filters:
                        eq['mid'] = filters[mid_name].get('parameters', {}).get('gain', 0.0)
                    if treble_name in filters:
                        eq['high'] = filters[treble_name].get('parameters', {}).get('gain', 0.0)
                    
                    state['channels'][dest]['eq'] = eq
                
                logger.info(f"Retrieved state with EQ for {len(state['channels'])} channels")

        except Exception:
            logger.exception("Failed to get current state from CamillaDSP")
            return None
        return state

    def get_playback_levels(self):
        """Get current playback levels (RMS and Peak) from CamillaDSP."""
        if not (self._py_client and self._py_connected):
            return None
        try:
            # Get RMS and Peak for all playback channels
            rms = self._py_client.levels.playback_rms()
            peak = self._py_client.levels.playback_peak()
            return {'rms': rms, 'peak': peak}
        except Exception:
            return None

    def set_solo(self, channel: int, solo: bool):
        msg = {"type": "set_channel_solo", "payload": {"channel": channel, "solo": bool(solo)}}
        self._enqueue(msg)

    def load_preset(self, name: str):
        msg = {"type": "load_preset", "payload": {"name": name}}
        self._enqueue(msg)

    def save_preset(self, name: str):
        msg = {"type": "save_preset", "payload": {"name": name}}
        self._enqueue(msg)
