"""aiohttp server exposing REST endpoints and a WebSocket for the web UI.

Replaces FastAPI implementation to avoid FastAPI dependency.
Serves static files from ui_web/ and exposes:
 - GET  /api/presets
 - POST /api/presets
 - DELETE /api/presets/{name}
 - WS   /ws/ui
"""
import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Set

from aiohttp import web

from .client import CamillaClient
from .presets import load_presets, set_preset, remove_preset
from .logger import log_change

logger = logging.getLogger("camillamix.api")
logger.setLevel(logging.INFO)

ROOT_DIR = Path(__file__).parent
UI_DIR = str(ROOT_DIR / "ui_web")


class ConnectionManager:
    def __init__(self):
        self.active: Set[web.WebSocketResponse] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: web.WebSocketResponse):
        async with self._lock:
            self.active.add(ws)

    async def disconnect(self, ws: web.WebSocketResponse):
        async with self._lock:
            self.active.discard(ws)

    async def broadcast(self, message: dict):
        data = json.dumps(message)
        async with self._lock:
            for ws in list(self.active):
                try:
                    await ws.send_str(data)
                except Exception:
                    await self.disconnect(ws)


manager = ConnectionManager()
camilla = CamillaClient()


async def index(request):
    idx = Path(UI_DIR) / "index.html"
    if idx.exists():
        return web.FileResponse(path=str(idx))
    # fallback minimal html
    html = """<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/static/styles.css"></head><body><div id="app"></div>
<script src="/static/app.js"></script></body></html>"""
    return web.Response(text=html, content_type="text/html")


async def api_get_presets(request):
    return web.json_response(load_presets())


async def api_set_preset(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    name = body.get("name")
    data = body.get("data")
    if not name or data is None:
        return web.json_response({"error": "invalid"}, status=400)
    set_preset(name, data)
    log_change(user="ui", action="set_preset", details={"name": name})
    return web.json_response({"ok": True})


async def api_delete_preset(request):
    name = request.match_info.get("name")
    remove_preset(name)
    log_change(user="ui", action="delete_preset", details={"name": name})
    return web.json_response({"ok": True})


async def websocket_ui(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    await manager.connect(ws)
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    m = json.loads(msg.data)
                except Exception:
                    continue
                if m.get("type") == "control":
                    ch = m.get("channel")
                    ctl = m.get("control")
                    val = m.get("value")
                    asyncio.create_task(camilla.send_control(ch, ctl, val))
                    log_change(user="ui", action="control", details={"channel": ch, "control": ctl, "value": val})
            elif msg.type == web.WSMsgType.ERROR:
                logger.warning("WebSocket error: %s", ws.exception())
    finally:
        await manager.disconnect(ws)
    return ws


async def on_startup(app):
    await camilla.connect()
    camilla.subscribe_meters(lambda m: asyncio.create_task(manager.broadcast({"type": "meters", **m})))


async def on_cleanup(app):
    await camilla.disconnect()


def create_app():
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/api/presets", api_get_presets)
    app.router.add_post("/api/presets", api_set_preset)
    app.router.add_delete("/api/presets/{name}", api_delete_preset)
    app.router.add_get("/ws/ui", websocket_ui)
    # static files
    if os.path.isdir(UI_DIR):
        app.router.add_static("/static", UI_DIR, show_index=False)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    web.run_app(create_app(), host="0.0.0.0", port=port)
# ...existing code...
