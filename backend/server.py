import asyncio
import json
import logging
import os
from aiohttp import web, WSMsgType

ROOT = os.path.dirname(os.path.dirname(__file__))
FRONTEND_DIR = os.path.join(ROOT, 'frontend')
PRESETS_DIR = os.path.join(os.path.dirname(__file__), 'presets')
os.makedirs(PRESETS_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('server')

DEFAULT_CHANNELS = 8


class MixerState:
    def __init__(self, channels=DEFAULT_CHANNELS):
        self.channels = []
        for i in range(channels):
            self.channels.append({
                'index': i,
                'level_db': 0.0,
                'mute': False,
                'solo': False,
                'eq': {'low': 0.0, 'high': 0.0}
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
                else:
                    await ws.send_json({'type': 'error', 'payload': 'unknown type'})

            elif msg.type == WSMsgType.ERROR:
                logger.error('ws connection closed with exception %s' % ws.exception())

    finally:
        app['sockets'].remove(ws)
        logger.info('WebSocket client disconnected')

    return ws


async def broadcast_state(app):
    payload = {'type': 'state', 'payload': app['mixer'].to_dict()}
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
                    await asyncio.sleep(10)
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
