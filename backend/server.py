import asyncio
import json
import logging
import os
from aiohttp import web, WSMsgType
import yaml

ROOT = os.path.dirname(os.path.dirname(__file__))
FRONTEND_DIR = os.path.join(ROOT, 'frontend')
PRESETS_DIR = os.path.join(os.path.dirname(__file__), 'presets')
os.makedirs(PRESETS_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('server')

DEFAULT_CHANNELS = 8
AUTOSAVE_DEFAULT_ENABLED = os.getenv('AUTOSAVE_ENABLED', '1') not in ('0', 'false', 'False')
AUTOSAVE_DEFAULT_INTERVAL = float(os.getenv('AUTOSAVE_INTERVAL_SEC', '30'))


class MixerState:
    def __init__(self, channels=DEFAULT_CHANNELS):
        self.channels = []
        for i in range(channels):
            self.channels.append({
                'index': i,
                'level_db': 0.0,
                'mute': False,
                'solo': False,
                'eq': {'low': 0.0, 'mid': 0.0, 'high': 0.0}
            })

    def to_dict(self):
        return {'channels': self.channels}


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    app = request.app
    app['sockets'].append(ws)
    logger.info('WebSocket client connected')
    # send initial mixer state and initial levels so UI can render channels immediately
    try:
        await ws.send_json({'type': 'state', 'payload': app['mixer'].to_dict()})
        # send initial levels snapshot
        levels = []
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
                    ch = int(payload.get('channel', 0))
                    lvl = float(payload.get('level_db', 0.0))
                    if 0 <= ch < len(app['mixer'].channels):
                        app['mixer'].channels[ch]['level_db'] = lvl
                        # forward to camilla adapter (stub)
                        app['adapter'].set_level(ch, lvl)
                        # mark that state should be broadcast by the periodic broadcaster
                        app['state_needs_broadcast'] = True
                elif typ == 'set_channel_mute':
                    ch = int(payload.get('channel', 0))
                    m = bool(payload.get('mute', False))
                    if 0 <= ch < len(app['mixer'].channels):
                        app['mixer'].channels[ch]['mute'] = m
                        app['adapter'].set_mute(ch, m)
                        app['state_needs_broadcast'] = True
                elif typ == 'set_channel_solo':
                    ch = int(payload.get('channel', 0))
                    s = bool(payload.get('solo', False))
                    if 0 <= ch < len(app['mixer'].channels):
                        app['mixer'].channels[ch]['solo'] = s
                        app['adapter'].set_solo(ch, s)
                        app['state_needs_broadcast'] = True
                elif typ == 'subscribe_levels':
                    # client wants to receive levels periodically; handled by broadcaster
                    await ws.send_json({'type': 'subscribed_levels', 'payload': {'interval_ms': payload.get('interval_ms', 100)}})
                elif typ == 'save_preset':
                    name = payload.get('name', 'preset')
                    path = await app['presets'].save_preset(name, app['mixer'].to_dict())
                    await ws.send_json({'type': 'preset_saved', 'payload': {'path': path}})
                elif typ == 'load_preset':
                    name = payload.get('name')
                    state = await app['presets'].load_preset(name)
                    if state:
                        # replace mixer state
                        app['mixer'].channels = state.get('channels', app['mixer'].channels)
                        await broadcast_state(app)
                        await ws.send_json({'type': 'preset_loaded', 'payload': {'name': name}})
                    else:
                        await ws.send_json({'type': 'error', 'payload': 'preset not found'})
                elif typ == 'set_channel_eq':
                    ch = int(payload.get('channel', 0))
                    band = str(payload.get('band', 'mid')).lower()
                    val = float(payload.get('gain_db', 0.0))
                    if band not in ('low', 'mid', 'high'):
                        await ws.send_json({'type': 'error', 'payload': 'invalid eq band'})
                        continue
                    if 0 <= ch < len(app['mixer'].channels):
                        app['mixer'].channels[ch]['eq'][band] = val
                        # placeholder: adapter could forward to DSP if supported
                        app['state_needs_broadcast'] = True
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
            'eq': {'low': 0.0, 'mid': 0.0, 'high': 0.0}
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
    tcp_connected = getattr(adapter, '_pycdsp_connected', False)

    return {
        'connected': ws_connected or tcp_connected,
        'ws_connected': ws_connected,
        'tcp_connected': tcp_connected,
        'ws_url': adapter.url or '',
        'tcp_host': getattr(adapter, '_py_host', ''),
        'tcp_port': getattr(adapter, '_py_port', 0)
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


async def levels_broadcaster(app):
    # Simulate VU meters if adapter doesn't provide them
    while True:
        try:
            levels = []
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
            if app.get('state_needs_broadcast'):
                try:
                    await broadcast_state(app)
                except Exception:
                    logger.exception('failed broadcasting state')
                app['state_needs_broadcast'] = False

            # periodically broadcast CamillaDSP status (every 10 iterations = 2s)
            if not hasattr(app, '_camilla_status_counter'):
                app['_camilla_status_counter'] = 0
            app['_camilla_status_counter'] = (app['_camilla_status_counter'] + 1) % 10
            if app['_camilla_status_counter'] == 0:
                try:
                    await broadcast_camilla_status(app)
                except Exception:
                    logger.exception('failed broadcasting camilla status')
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception('error in levels broadcaster')

        await asyncio.sleep(0.2)


async def index(request):
    return web.FileResponse(os.path.join(FRONTEND_DIR, 'index.html'))


def create_app():
    app = web.Application()
    app['sockets'] = []
    app['mixer'] = MixerState(channels=DEFAULT_CHANNELS)
    # flag used to request a state broadcast from the periodic broadcaster
    app['state_needs_broadcast'] = False
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
        try:
            yobj = yaml.safe_load(raw_yaml)
        except Exception as e:
            raise web.HTTPBadRequest(text=f'yaml parse error: {e}')

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
            port = int(data.get('port', 1234))

            # Update adapter config (requires restart for full effect)
            adapter = app.get('adapter')
            if adapter:
                adapter.url = ws_url if ws_url else None
                adapter._py_host = host
                adapter._py_port = port
                logger.info(f'CamillaDSP config updated: ws_url={ws_url}, host={host}, port={port}')

            return web.json_response({'ws_url': ws_url, 'host': host, 'port': port, 'restart_required': True})
        except Exception as e:
            raise web.HTTPBadRequest(text=str(e))

    app.router.add_get('/api/camilla_config', get_camilla_config)
    app.router.add_post('/api/camilla_config', post_camilla_config)

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
    web.run_app(app, host='0.0.0.0', port=8080)


if __name__ == '__main__':
    main()
