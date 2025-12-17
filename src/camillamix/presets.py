import json
from pathlib import Path
from typing import Dict, Any

PRESETS_FILE = Path(__file__).resolve().parent.parent.joinpath("presets.json")


def load_presets() -> Dict[str, Any]:
    if PRESETS_FILE.exists():
        try:
            return json.loads(PRESETS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_presets(presets: Dict[str, Any]):
    PRESETS_FILE.write_text(json.dumps(presets, indent=2), encoding="utf-8")


def set_preset(name: str, data: Dict[str, Any]):
    presets = load_presets()
    presets[name] = data
    save_presets(presets)


def remove_preset(name: str):
    presets = load_presets()
    if name in presets:
        del presets[name]
        save_presets(presets)


__all__ = ["load_presets", "save_presets", "set_preset", "remove_preset"]
