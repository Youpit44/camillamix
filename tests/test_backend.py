import asyncio
import os
from backend.presets import PresetManager


def test_save_and_load(tmp_path):
    pm = PresetManager(str(tmp_path))
    state = {'channels': [{'index':0,'level_db':-3.0}]}
    path = asyncio.get_event_loop().run_until_complete(pm.save_preset('test', state))
    loaded = asyncio.get_event_loop().run_until_complete(pm.load_preset('test'))
    assert loaded is not None
    assert loaded['channels'][0]['level_db'] == -3.0
