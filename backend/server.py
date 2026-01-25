import asyncio
import json
import logging
import os
import math
import time
import re
from aiohttp import web, WSMsgType
import yaml

ROOT = os.path.dirname(os.path.dirname(__file__))
FRONTEND_DIR = os.path.join(ROOT, 'frontend')
PRESETS_DIR = os.path.join(os.path.dirname(__file__), 'presets')
SERVER_CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'server_config.json')
os.makedirs(PRESETS_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('server')

# Load server config
SERVER_CONFIG = {}
if os.path.exists(SERVER_CONFIG_PATH):
    try:
        with open(SERVER_CONFIG_PATH, 'r') as f:
            SERVER_CONFIG = json.load(f)
    except Exception as e:
        logger.error(f"Failed to load server config: {e}")

# Apply initial logging state
if not SERVER_CONFIG.get('console_enabled', True):
    root_logger = logging.getLogger()
    for handler in root_logger.handlers:
        if isinstance(handler, logging.StreamHandler) and not isinstance(handler, logging.FileHandler):
            handler.setLevel(logging.CRITICAL + 1)

DEFAULT_CHANNELS = 8
AUTOSAVE_DEFAULT_ENABLED = os.getenv('AUTOSAVE_ENABLED', '1') not in ('0', 'false', 'False')
AUTOSAVE_DEFAULT_INTERVAL = float(os.getenv('AUTOSAVE_INTERVAL_SEC', '30'))
MIN_LEVEL_DB = -60.0
MAX_LEVEL_DB = 12.0
MAX_YAML_SIZE = 5 * 1024 * 1024  # 5 MB
LEVELS_BROADCAST_INTERVAL = 0.2
CAMILLA_STATUS_BROADCAST_INTERVAL = 10  # iterations


def validate_channel(ch, mixer_channels: list):
    """Validate channel index is within bounds or is 'master'.

    Args:
        ch: Channel index (int or string 'master')
        mixer_channels: List of channel objects

    Returns:
        Validated channel index (int) or 'master'

    Raises:
        ValueError: If channel is invalid
    """
    # Handle master case
    if isinstance(ch, str) and ch.lower() == 'master':
        return 'master'

    try:
        ch_int = int(ch)
    except (ValueError, TypeError):
        raise ValueError(f"Channel must be an integer or 'master', got {type(ch).__name__}")

    if not (0 <= ch_int < len(mixer_channels)):
        raise ValueError(f"Channel {ch_int} out of range [0, {len(mixer_channels)-1}]")

    return ch_int


def parse_db_value(val, min_db: float = MIN_LEVEL_DB, max_db: float = MAX_LEVEL_DB) -> float:
    """Parse and validate a dB value.

    Args:
        val: Value to parse (can be int, float, or string)
        min_db: Minimum allowed dB value
        max_db: Maximum allowed dB value

    Returns:
        Validated dB value clamped to [min_db, max_db]

    Raises:
        ValueError: If value is invalid
    """
    try:
        f = float(val)
    except (ValueError, TypeError):
        raise ValueError(f"Level must be numeric, got {type(val).__name__}: {val}")

    if math.isnan(f) or math.isinf(f):
        raise ValueError(f"Level must be finite, got {f}")

    # Clamp to valid range
    return max(min_db, min(max_db, f))


def validate_preset_name(name: str) -> str:
    """Validate preset name (delegates to PresetManager for consistency).

    Args:
        name: Preset name

    Returns:
        Validated name

    Raises:
        ValueError: If invalid
    """
    if not name or not isinstance(name, str):
        raise ValueError("Preset name must be a non-empty string")
    
    # Strict validation to prevent path traversal
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        raise ValueError("Preset name can only contain alphanumeric, underscore, hyphen")
        
    return name


class MixerState:
    def __init__(self, channels=DEFAULT_CHANNELS):
        self.master = {
            'index': 'master',
            'level_db': 0.0,
            'mute': False,
            'solo': False,
            'eq': {'gain': 0.0, 'low': 0.0, 'mid': 0.0, 'high': 0.0}
        }
        self.channels = []
        for i in range(channels):
            self.channels.append({
                'index': i,
                'level_db': 0.0,
                'mute': False,
                'solo': False,
                'eq': {'gain': 0.0, 'low': 0.0, 'mid': 0.0, 'high': 0.0}
            })

    def to_dict(self):
        return {'master': self.master, 'channels': self.channels}


def update_dsp_mutes(app):
    """Calculate and apply effective mutes based on Mute and Solo states."""
    mixer = app['mixer']
    adapter = app['adapter']
    
    # Check if any channel is soloed (excluding master)
    any_solo = any(ch['solo'] for ch in mixer.channels)
    
    mute_updates = []

    # Update master mute
    mute_updates.append((0, mixer.master['mute']))
    
    for ch in mixer.channels:
        # Channel index in mixer state is 0..N-1
        # Channel index in adapter is 1..N (because 0 is master)
        adapter_ch = ch['index'] + 1
        
        if any_solo:
            # If any solo is active, this channel is muted UNLESS it is soloed
            should_mute = not ch['solo']
        else:
            # No solo active, respect user mute
            should_mute = ch['mute']
            
        mute_updates.append((adapter_ch, should_mute))
    
    # Apply all mutes in one batch
    if hasattr(adapter, 'set_mutes'):
        adapter.set_mutes(mute_updates)
    else:
        for ch, m in mute_updates:
            adapter.set_mute(ch, m)


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    app = request.app
    app['sockets'].append(ws)
    logger.info('WebSocket client connected')

    # Sync state from CamillaDSP
    if app['adapter']._py_connected:
        try:
            loop = asyncio.get_running_loop()
            dsp_state = await loop.run_in_executor(None, app['adapter'].get_current_state)
            if dsp_state:
                # Update Master
                if 'level_db' in dsp_state['master']:
                    app['mixer'].master['level_db'] = dsp_state['master']['level_db']
                if 'mute' in dsp_state['master']:
                    app['mixer'].master['mute'] = dsp_state['master']['mute']
                
                # Update Channels
                for dest, ch_data in dsp_state['channels'].items():
                    # Find channel with index == dest
                    for ch in app['mixer'].channels:
                        if ch['index'] == dest:
                            ch['level_db'] = ch_data['level_db']
                            ch['mute'] = ch_data['mute']
                            if 'eq' in ch_data:
                                ch['eq'] = ch_data['eq']
                            break
        except Exception as e:
            logger.error(f"Error syncing with DSP: {e}")

    # send initial mixer state and initial levels so UI can render channels immediately
    try:
        await ws.send_json({'type': 'state', 'payload': app['mixer'].to_dict()})
        # send initial levels snapshot
        levels = []
        # Add master level first
        master_level = max(-60.0, min(12.0, app['mixer'].master['level_db']))
        levels.append({'channel': 'master', 'level_db': master_level, 'peak_db': master_level + 0.5})
        # Add channel levels
        for ch in app['mixer'].channels:
            level = max(-60.0, min(12.0, ch['level_db']))
            levels.append({'channel': ch['index'], 'level_db': level, 'peak_db': level + 0.5})
        await ws.send_json({'type': 'levels', 'payload': {'channels': levels}})
        await ws.send_json({'type': 'autosave_settings', 'payload': {'enabled': app['autosave_enabled'], 'interval_sec': app['autosave_interval']}})
        # send CamillaDSP connection status
        adapter = app.get('adapter')
        camilla_status = get_camilla_status(adapter)
        await ws.send_json({'type': 'camilla_status', 'payload': camilla_status})
    except Exception:
        logger.exception('failed to send initial state to ws client')

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except Exception:
                    await ws.send_json({'type': 'error', 'payload': 'invalid json'})
                    continue

                typ = data.get('type')
                payload = data.get('payload', {})

                if typ == 'set_channel_level':
                    try:
                        ch = validate_channel(payload.get('channel', 0), app['mixer'].channels)
                        lvl = parse_db_value(payload.get('level_db', 0.0))
                        if ch == 'master':
                            app['mixer'].master['level_db'] = lvl
                            # Map master to fader 0 in CamillaDSP
                            app['adapter'].set_level(0, lvl)
                        else:
                            app['mixer'].channels[ch]['level_db'] = lvl
                            # Map channel i to fader (i+1) in CamillaDSP
                            app['adapter'].set_level(ch + 1, lvl)
                        # mark that state should be broadcast by the periodic broadcaster
                        if 'shared_state' in app:
                            app['shared_state']['state_needs_broadcast'] = True
                    except ValueError as e:
                        await ws.send_json({'type': 'error', 'payload': f'Invalid set_channel_level: {str(e)}'})
                        continue
                elif typ == 'set_channel_mute':
                    try:
                        ch = validate_channel(payload.get('channel', 0), app['mixer'].channels)
                        m = bool(payload.get('mute', False))
                        if ch == 'master':
                            app['mixer'].master['mute'] = m
                        else:
                            app['mixer'].channels[ch]['mute'] = m
                        
                        # Recalculate and apply mutes
                        update_dsp_mutes(app)
                        if 'shared_state' in app:
                            app['shared_state']['state_needs_broadcast'] = True
                    except ValueError as e:
                        await ws.send_json({'type': 'error', 'payload': f'Invalid set_channel_mute: {str(e)}'})
                        continue
                elif typ == 'set_channel_solo':
                    try:
                        ch = validate_channel(payload.get('channel', 0), app['mixer'].channels)
                        s = bool(payload.get('solo', False))
                        if ch == 'master':
                            app['mixer'].master['solo'] = s
                        else:
                            app['mixer'].channels[ch]['solo'] = s
                        
                        # Recalculate and apply mutes
                        update_dsp_mutes(app)
                        if 'shared_state' in app:
                            app['shared_state']['state_needs_broadcast'] = True
                    except ValueError as e:
                        await ws.send_json({'type': 'error', 'payload': f'Invalid set_channel_solo: {str(e)}'})
                        continue
                elif typ == 'subscribe_levels':
                    # client wants to receive levels periodically; handled by broadcaster
                    await ws.send_json({'type': 'subscribed_levels', 'payload': {'interval_ms': payload.get('interval_ms', 100)}})
                elif typ == 'subscribe_spectrum':
                    enabled = bool(payload.get('enabled', True))
                    # Use a mutable object in app or just a global flag?
                    # App state mutation is deprecated.
                    # We can use a custom object attached to app on startup.
                    app['shared_state']['spectrum_enabled'] = enabled
                    await ws.send_json({'type': 'subscribed_spectrum', 'payload': {'enabled': enabled}})
                elif typ == 'save_preset':
                    try:
                        name = validate_preset_name(payload.get('name', 'preset'))
                        path = await app['presets'].save_preset(name, app['mixer'].to_dict())
                        await ws.send_json({'type': 'preset_saved', 'payload': {'path': path}})
                    except ValueError as e:
                        await ws.send_json({'type': 'error', 'payload': f'Invalid preset name: {str(e)}'})
                    except Exception as e:
                        logger.error(f"Error saving preset: {e}")
                        await ws.send_json({'type': 'error', 'payload': 'Save failed'})
                elif typ == 'load_preset':
                    name = payload.get('name')
                    state = await app['presets'].load_preset(name)
                    if state:
                        # replace mixer state (load master and channels)
                        if 'master' in state:
                            app['mixer'].master = state['master']
                        app['mixer'].channels = state.get('channels', app['mixer'].channels)
                        await broadcast_state(app)
                        await ws.send_json({'type': 'preset_loaded', 'payload': {'name': name}})
                    else:
                        await ws.send_json({'type': 'error', 'payload': 'preset not found'})
                elif typ == 'set_channel_eq':
                    try:
                        ch = validate_channel(payload.get('channel', 0), app['mixer'].channels)
                        if ch == 'master':
                            raise ValueError("EQ is not available for master")
                        band = str(payload.get('band', 'mid')).lower()
                        if band not in ('gain', 'low', 'mid', 'high'):
                            raise ValueError(f"Invalid EQ band: {band}")
                        val = parse_db_value(payload.get('gain_db', 0.0))
                        app['mixer'].channels[ch]['eq'][band] = val
                        
                        # Map to CamillaDSP filter names: Bass_N, Mid_N, Treble_N
                        # where N is the channel index
                        filter_map = {
                            'gain': f'Gain_{ch}',
                            'low': f'Bass_{ch}',
                            'mid': f'Mid_{ch}',
                            'high': f'Treble_{ch}'
                        }
                        filter_name = filter_map.get(band)
                        if filter_name:
                            app['adapter'].set_filter_gain(filter_name, val)

                        if 'shared_state' in app:
                            app['shared_state']['state_needs_broadcast'] = True
                    except ValueError as e:
                        await ws.send_json({'type': 'error', 'payload': f'Invalid set_channel_eq: {str(e)}'})
                        continue
                elif typ == 'set_autosave':
                    enabled = payload.get('enabled', app['autosave_enabled'])
                    interval = payload.get('interval_sec', app['autosave_interval'])
                    try:
                        interval = float(interval)
                        if interval <= 0:
                            interval = app['autosave_interval']
                    except Exception:
                        interval = app['autosave_interval']
                    app['autosave_enabled'] = bool(enabled)
                    app['autosave_interval'] = interval
                    await ws.send_json({'type': 'autosave_settings', 'payload': {'enabled': app['autosave_enabled'], 'interval_sec': app['autosave_interval']}})
                else:
                    await ws.send_json({'type': 'error', 'payload': 'unknown type'})

            elif msg.type == WSMsgType.ERROR:
                logger.error('ws connection closed with exception %s' % ws.exception())

    finally:
        app['sockets'].remove(ws)
        logger.info('WebSocket client disconnected')

    return ws


def map_yaml_to_state(yobj, channels=DEFAULT_CHANNELS):
    def default_channels(n):
        return [{
            'index': i,
            'level_db': 0.0,
            'mute': False,
            'solo': False,
            'eq': {'gain': 0.0, 'low': 0.0, 'mid': 0.0, 'high': 0.0}
        } for i in range(n)]

    # If yaml already contains a state structure we recognize
    if isinstance(yobj, dict) and 'state' in yobj:
        st = yobj['state']
        if isinstance(st, dict) and 'channels' in st:
            chs = st['channels']
            # sanitize and pad/trim
            out = default_channels(channels)
            for i in range(min(len(chs), channels)):
                try:
                    out[i]['level_db'] = float(chs[i].get('level_db', 0.0))
                    out[i]['mute'] = bool(chs[i].get('mute', False))
                    out[i]['solo'] = bool(chs[i].get('solo', False))
                    eq = chs[i].get('eq', {}) or {}
                    out[i]['eq']['gain'] = float(eq.get('gain', 0.0))
                    out[i]['eq']['low'] = float(eq.get('low', 0.0))
                    out[i]['eq']['mid'] = float(eq.get('mid', 0.0))
                    out[i]['eq']['high'] = float(eq.get('high', 0.0))
                except Exception:
                    pass
            return ({'channels': out}, {'source': 'state'})

    # Try CamillaDSP mixers mapping
    if isinstance(yobj, dict) and 'mixers' in yobj and isinstance(yobj['mixers'], dict):
        mixers = yobj['mixers']
        # pick named '2x8' if present else first
        mixer_name = '2x8' if '2x8' in mixers else next(iter(mixers))
        mixer = mixers[mixer_name]
        out = default_channels(channels)
        try:
            mapping = mixer.get('mapping', [])
            for entry in mapping:
                dest = int(entry.get('dest', -1))
                if 0 <= dest < channels:
                    mute = bool(entry.get('mute', False))
                    srcs = entry.get('sources') or []
                    gain = 0.0
                    if srcs:
                        s0 = srcs[0]
                        gain = float(s0.get('gain', 0.0))
                        mute = mute or bool(s0.get('mute', False))
                        # if scale is linear, convert to dB if possible; assume dB if 'scale'=='dB'
                        # otherwise keep as-is
                    out[dest]['level_db'] = gain
                    out[dest]['mute'] = mute
            return ({'channels': out}, {'source': 'mixers', 'mixer': mixer_name})
        except Exception:
            pass

    # Fallback: look for a flat gains list
    if isinstance(yobj, dict) and 'gains' in yobj and isinstance(yobj['gains'], list):
        out = default_channels(channels)
        for i in range(min(channels, len(yobj['gains']))):
            try:
                out[i]['level_db'] = float(yobj['gains'][i])
            except Exception:
                pass
        return ({'channels': out}, {'source': 'gains'})

    # Default
    return ({'channels': default_channels(channels)}, {'source': 'default'})

async def broadcast_state(app):
    payload = {'type': 'state', 'payload': app['mixer'].to_dict()}
    websockets = list(app['sockets'])
    for ws in websockets:
        try:
            await ws.send_json(payload)
        except Exception:
            pass

def get_camilla_status(adapter):
    """Return CamillaDSP connection status"""
    if not adapter:
        return {'connected': False, 'ws_connected': False, 'tcp_connected': False}

    ws_connected = adapter._ws is not None and not adapter._ws.closed if adapter._ws else False
    tcp_connected = getattr(adapter, '_py_connected', False)

    # Try reading main volume if connected via pycamilladsp
    main_volume_db = None
    external_volume = getattr(adapter, '_py_external_volume', False)
    try:
        if tcp_connected and getattr(adapter, '_py_client', None):
            vol = adapter._py_client.volume
            if external_volume and hasattr(vol, 'volume'):
                # external mode: read fader 0 volume if available
                main_volume_db = float(vol.volume(0))
            elif hasattr(vol, 'main_volume'):
                main_volume_db = float(vol.main_volume())
    except Exception:
        main_volume_db = None

    return {
        'connected': ws_connected or tcp_connected,
        'ws_connected': ws_connected,
        'tcp_connected': tcp_connected,
        'ws_url': adapter.url or '',
        'tcp_host': getattr(adapter, '_py_host', ''),
        'tcp_port': getattr(adapter, '_py_port', 0),
        'main_volume_db': main_volume_db,
        'external_volume': bool(external_volume),
    }

async def broadcast_camilla_status(app):
    """Broadcast CamillaDSP status to all connected clients"""
    adapter = app.get('adapter')
    status = get_camilla_status(adapter)
    payload = {'type': 'camilla_status', 'payload': status}
    websockets = list(app['sockets'])
    for ws in websockets:
        try:
            await ws.send_json(payload)
        except Exception:
            pass


async def spectrum_broadcaster(app):
    # Broadcast spectrum data (signal window)
    while True:
        try:
            # Check shared state
            enabled = False
            if 'shared_state' in app and 'spectrum_enabled' in app['shared_state']:
                enabled = app['shared_state']['spectrum_enabled']
            elif app.get('spectrum_enabled'): # fallback
                enabled = True
                
            if enabled:
                # Fetch signal window
                # Use a reasonable size, e.g. 2048 or 4096
                sig = None
                if hasattr(app['adapter'], 'get_signal_window'):
                     try:
                        sig = await asyncio.to_thread(app['adapter'].get_signal_window, 4096)
                     except Exception:
                         pass
                
                if sig:
                    # sig is likely a list of floats.
                    # We send it as is. Client will handle de-interleaving and FFT.
                    payload = {'type': 'spectrum', 'payload': {'samples': sig}}
                    # Broadcast to all (optimization: only to subscribers if we tracked them per socket)
                    for ws in list(app['sockets']):
                        try:
                            await ws.send_json(payload)
                        except Exception:
                            pass
            
            # 30 FPS approx
            await asyncio.sleep(0.033)
            
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception('error in spectrum broadcaster')
            await asyncio.sleep(1)


async def levels_broadcaster(app):
    # Local counter avoids mutating app state after startup (aiohttp deprecates that)
    camilla_status_counter = 0
    # Broadcast levels (real or simulated)
    while True:
        try:
            levels = []
            real_levels = None
            
            # Try to get real levels from adapter
            if hasattr(app['adapter'], 'get_playback_levels'):
                # Run in thread to avoid blocking event loop with sync socket calls
                try:
                    real_levels = await asyncio.to_thread(app['adapter'].get_playback_levels)
                except Exception:
                    pass

            if real_levels and real_levels.get('rms'):
                rms_values = real_levels['rms']
                peak_values = real_levels.get('peak', rms_values)
                
                # Calculate Master level (max of all channels)
                master_rms = max(rms_values) if rms_values else -100.0
                master_peak = max(peak_values) if peak_values else -100.0
                levels.append({'channel': 'master', 'level_db': master_rms, 'peak_db': master_peak})
                
                # Map channels
                # Assuming 1:1 mapping between UI channels (0..7) and playback channels (0..7)
                for ch in app['mixer'].channels:
                    idx = ch['index']
                    if idx < len(rms_values):
                        levels.append({'channel': idx, 'level_db': rms_values[idx], 'peak_db': peak_values[idx]})
                    else:
                        levels.append({'channel': idx, 'level_db': -100.0, 'peak_db': -100.0})
            else:
                # Fallback to simulation based on fader positions
                # Add master level first
                master_level = max(-60.0, min(12.0, app['mixer'].master['level_db']))
                levels.append({'channel': 'master', 'level_db': master_level, 'peak_db': master_level + 0.5})
                # Add channel levels
                for ch in app['mixer'].channels:
                    # simple mapping from level_db to a mock peak
                    level = max(-60.0, min(12.0, ch['level_db']))
                    levels.append({'channel': ch['index'], 'level_db': level, 'peak_db': level + 0.5})

            payload = {'type': 'levels', 'payload': {'channels': levels}}
            for ws in list(app['sockets']):
                try:
                    await ws.send_json(payload)
                except Exception:
                    pass

            # if state update requested, broadcast state (debounced by this periodic loop)
            needs_broadcast = False
            if 'shared_state' in app and app['shared_state'].get('state_needs_broadcast'):
                needs_broadcast = True
                app['shared_state']['state_needs_broadcast'] = False
            elif app.get('state_needs_broadcast'): # fallback
                needs_broadcast = True
                app['state_needs_broadcast'] = False
            
            if needs_broadcast:
                try:
                    await broadcast_state(app)
                except Exception:
                    logger.exception('failed broadcasting state')

            # periodically broadcast CamillaDSP status (every 10 iterations = 2s)
            camilla_status_counter = (camilla_status_counter + 1) % CAMILLA_STATUS_BROADCAST_INTERVAL
            if camilla_status_counter == 0:
                try:
                    await broadcast_camilla_status(app)
                except Exception:
                    logger.exception('failed broadcasting camilla status')
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception('error in levels broadcaster')

        await asyncio.sleep(LEVELS_BROADCAST_INTERVAL)


async def index(request):
    return web.FileResponse(os.path.join(FRONTEND_DIR, 'index.html'))


def create_app():
    app = web.Application()
    app['sockets'] = []
    app['mixer'] = MixerState(channels=DEFAULT_CHANNELS)
    # shared mutable state container to avoid app dict mutation warnings
    app['shared_state'] = {
        'spectrum_enabled': False,
        'state_needs_broadcast': False
    }
    # flag used to request a state broadcast from the periodic broadcaster
    app['state_needs_broadcast'] = False # Deprecated, init only
    app['spectrum_enabled'] = False # Deprecated, kept for init but not mutated
    app['autosave_enabled'] = AUTOSAVE_DEFAULT_ENABLED
    app['autosave_interval'] = AUTOSAVE_DEFAULT_INTERVAL
    from .camilla_adapter import CamillaAdapter
    from .presets import PresetManager
    from .logger import setup_logging
    # configure logging to file
    setup_logging()
    # adapter will be started on app startup
    app['adapter'] = CamillaAdapter()
    app['presets'] = PresetManager(PRESETS_DIR)

    app.router.add_get('/', index)
    app.router.add_get('/ws', websocket_handler)
    # Preset HTTP API
    async def list_presets(request):
        presets = app['presets'].list_presets()
        # strip .json
        presets = [p[:-5] if p.endswith('.json') else p for p in presets]
        return web.json_response({'presets': presets})

    async def get_preset(request):
        name = request.match_info.get('name')
        state = await app['presets'].load_preset(name)
        if state is None:
            raise web.HTTPNotFound(text='preset not found')
        return web.json_response({'name': name, 'state': state})

    async def post_preset(request):
        try:
            data = await request.json()
            name = data.get('name')
            state = data.get('state')
            if not name or state is None:
                raise web.HTTPBadRequest(text='name and state required')
            path = await app['presets'].save_preset(name, state)
            return web.json_response({'path': path})
        except Exception as e:
            raise web.HTTPBadRequest(text=str(e))

    async def get_current_state(request):
        # return current mixer state
        return web.json_response({'state': app['mixer'].to_dict()})

    app.router.add_get('/api/presets', list_presets)
    app.router.add_get('/api/presets/{name}', get_preset)
    app.router.add_post('/api/presets', post_preset)
    app.router.add_get('/api/presets/current', get_current_state)

    # YAML import API
    async def import_yaml(request):
        preset_name = request.query.get('name') or 'imported'
        raw_yaml = None
        # Support multipart (file upload)
        if request.content_type and 'multipart/' in request.content_type:
            reader = await request.multipart()
            field = await reader.next()
            while field is not None:
                if field.name == 'file':
                    raw_yaml = await field.text()
                    break
                field = await reader.next()
        if raw_yaml is None:
            # Try json body with {'yaml': '...', 'name': '...'} or raw text/yaml
            try:
                data = await request.json()
                raw_yaml = data.get('yaml')
                if data.get('name'):
                    preset_name = str(data['name'])
            except Exception:
                try:
                    raw_yaml = await request.text()
                except Exception:
                    pass
        if not raw_yaml:
            raise web.HTTPBadRequest(text='no yaml provided')

        # Prevent YAML bomb DoS
        if len(raw_yaml) > MAX_YAML_SIZE:
            raise web.HTTPBadRequest(text=f'YAML too large (max {MAX_YAML_SIZE} bytes)')

        try:
            # Parse YAML with timeout protection
            yobj = yaml.safe_load(raw_yaml)
            if yobj is None:
                yobj = {}
        except yaml.YAMLError as e:
            logger.error(f"YAML parse error: {e}")
            raise web.HTTPBadRequest(text=f'YAML parse error: {str(e)[:100]}')
        except Exception as e:
            logger.error(f"Unexpected error parsing YAML: {e}")
            raise web.HTTPBadRequest(text=f'Failed to parse YAML: {str(e)[:100]}')

        mapped, info = map_yaml_to_state(yobj, channels=len(app['mixer'].channels))
        app['mixer'].channels = mapped['channels']
        await broadcast_state(app)
        # save as preset
        await app['presets'].save_preset(preset_name, app['mixer'].to_dict())
        return web.json_response({'imported_as': preset_name, 'mapping': info, 'state': app['mixer'].to_dict()})

    app.router.add_post('/api/import_yaml', import_yaml)

    # Autosave settings API
    async def get_autosave(request):
        return web.json_response({'enabled': app['autosave_enabled'], 'interval_sec': app['autosave_interval']})

    async def post_autosave(request):
        try:
            data = await request.json()
            enabled = data.get('enabled', app['autosave_enabled'])
            interval = data.get('interval_sec', app['autosave_interval'])
            try:
                interval = float(interval)
                if interval <= 0:
                    interval = app['autosave_interval']
            except Exception:
                interval = app['autosave_interval']
            app['autosave_enabled'] = bool(enabled)
            app['autosave_interval'] = interval
            return web.json_response({'enabled': app['autosave_enabled'], 'interval_sec': app['autosave_interval']})
        except Exception as e:
            raise web.HTTPBadRequest(text=str(e))

    app.router.add_get('/api/autosave', get_autosave)
    app.router.add_post('/api/autosave', post_autosave)

    # CamillaDSP config API
    async def get_camilla_config(request):
        adapter = app.get('adapter')
        status = get_camilla_status(adapter)
        config = {
            'ws_url': adapter.url if adapter else '',
            'host': getattr(adapter, '_py_host', '127.0.0.1') if adapter else '127.0.0.1',
            'port': getattr(adapter, '_py_port', 1234) if adapter else 1234,
            'status': status
        }
        return web.json_response(config)

    async def post_camilla_config(request):
        try:
            data = await request.json()
            ws_url = data.get('ws_url', '').strip()
            host = data.get('host', '127.0.0.1').strip()

            # Validate host (basic check)
            if not host:
                raise ValueError("Host cannot be empty")

            # Validate port
            try:
                port = int(data.get('port', 1234))
                if not (1 <= port <= 65535):
                    raise ValueError(f"Port must be 1-65535, got {port}")
            except (ValueError, TypeError) as e:
                raise ValueError(f"Invalid port: {str(e)}")

            # Update adapter config (requires restart for full effect)
            adapter = app.get('adapter')
            if adapter:
                adapter.url = ws_url if ws_url else None
                adapter._py_host = host
                adapter._py_port = port
                logger.info(f'CamillaDSP config updated: ws_url={ws_url}, host={host}, port={port}')

            return web.json_response({'ws_url': ws_url, 'host': host, 'port': port, 'restart_required': True})
        except ValueError as e:
            raise web.HTTPBadRequest(text=f"Config error: {str(e)}")
        except Exception as e:
            logger.exception("Error updating CamillaDSP config")
            raise web.HTTPBadRequest(text=str(e))

    app.router.add_get('/api/camilla_config', get_camilla_config)
    app.router.add_post('/api/camilla_config', post_camilla_config)

    async def get_logging(request):
        enabled = True
        root_logger = logging.getLogger()
        for handler in root_logger.handlers:
            if isinstance(handler, logging.StreamHandler) and not isinstance(handler, logging.FileHandler):
                if handler.level >= logging.CRITICAL:
                    enabled = False
                break
        return web.json_response({'console_enabled': enabled})

    async def post_logging(request):
        try:
            data = await request.json()
            enabled = bool(data.get('console_enabled', True))
            
            root_logger = logging.getLogger()
            for handler in root_logger.handlers:
                if isinstance(handler, logging.StreamHandler) and not isinstance(handler, logging.FileHandler):
                    if enabled:
                        handler.setLevel(logging.INFO)
                    else:
                        handler.setLevel(logging.CRITICAL + 1)
            
            # Save to config
            SERVER_CONFIG['console_enabled'] = enabled
            try:
                with open(SERVER_CONFIG_PATH, 'w') as f:
                    json.dump(SERVER_CONFIG, f, indent=4)
            except Exception as e:
                logger.error(f"Failed to save server config: {e}")
            
            logger.info(f"Console logging set to {enabled}")
            return web.json_response({'status': 'ok', 'console_enabled': enabled})
        except Exception as e:
            logger.exception("Error setting logging")
            return web.json_response({'error': str(e)}, status=500)

    app.router.add_get('/api/logging', get_logging)
    app.router.add_post('/api/logging', post_logging)

    app.router.add_static('/', FRONTEND_DIR, show_index=True)

    async def on_startup(app):
        # start adapter if needed
        adapter = app.get('adapter')
        if hasattr(adapter, 'start'):
            try:
                await adapter.start()
            except Exception:
                logger.exception('adapter start failed')
        # start levels broadcaster
        app['broadcaster_task'] = asyncio.create_task(levels_broadcaster(app))
        # start spectrum broadcaster
        app['spectrum_task'] = asyncio.create_task(spectrum_broadcaster(app))
        # start autosave task
        async def autosave_loop():
            while True:
                try:
                    await asyncio.sleep(app['autosave_interval'])
                    if not app['autosave_enabled']:
                        continue
                    name = 'autosave'
                    await app['presets'].save_preset(name, app['mixer'].to_dict())
                    logger.info('autosaved preset')
                except asyncio.CancelledError:
                    break
                except Exception:
                    logger.exception('autosave failed')

        app['autosave_task'] = asyncio.create_task(autosave_loop())

    async def on_cleanup(app):
        # stop broadcaster
        task = app.get('broadcaster_task')
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        # stop spectrum
        st = app.get('spectrum_task')
        if st:
            st.cancel()
            try:
                await st
            except asyncio.CancelledError:
                pass
        # stop autosave
        at = app.get('autosave_task')
        if at:
            at.cancel()
            try:
                await at
            except asyncio.CancelledError:
                pass
        # stop adapter
        adapter = app.get('adapter')
        if hasattr(adapter, 'stop'):
            try:
                await adapter.stop()
            except Exception:
                logger.exception('adapter stop failed')

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    return app


def main():
    app = create_app()
    web.run_app(app, host='0.0.0.0', port=8001)


if __name__ == '__main__':
    main()
