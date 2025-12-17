import json
import os
import asyncio


class PresetManager:
    def __init__(self, presets_dir):
        self.presets_dir = presets_dir
        os.makedirs(self.presets_dir, exist_ok=True)

    async def save_preset(self, name, state):
        filename = f"{name}.json"
        path = os.path.join(self.presets_dir, filename)
        # ensure atomic write
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'version': 1, 'state': state}, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
        return path

    async def load_preset(self, name):
        filename = f"{name}.json"
        path = os.path.join(self.presets_dir, filename)
        if not os.path.exists(path):
            return None
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('state')

    def list_presets(self):
        return [p for p in os.listdir(self.presets_dir) if p.endswith('.json')]
