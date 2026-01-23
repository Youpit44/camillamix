import json
import os
import asyncio
import logging
import pathlib
import re

logger = logging.getLogger('presets')

MAX_PRESET_NAME = 64

class PresetManager:
    def __init__(self, presets_dir):
        self.presets_dir = presets_dir
        os.makedirs(self.presets_dir, exist_ok=True)

    def _validate_preset_name(self, name: str) -> str:
        """Validate and sanitize preset name to prevent path traversal.

        Args:
            name: Preset name to validate

        Returns:
            Sanitized name

        Raises:
            ValueError: If name is invalid
        """
        if not name or not isinstance(name, str):
            raise ValueError("Preset name must be a non-empty string")

        if len(name) > MAX_PRESET_NAME:
            raise ValueError(f"Preset name too long (max {MAX_PRESET_NAME} chars)")

        # Extract only the filename part (no path separators)
        safe_name = pathlib.Path(name).name
        if not safe_name or safe_name.startswith('.'):
            raise ValueError("Invalid preset name: contains path separators or hidden files")

        # Only allow alphanumeric, underscore, hyphen
        if not re.match(r'^[a-zA-Z0-9_-]+$', safe_name):
            raise ValueError("Preset name can only contain alphanumeric, underscore, hyphen")

        return safe_name

    async def save_preset(self, name: str, state: dict) -> str:
        """Save a preset with atomic write.

        Args:
            name: Preset name (validated)
            state: Mixer state dict

        Returns:
            Path to saved preset

        Raises:
            ValueError: If name is invalid
            IOError: If save fails
        """
        safe_name = self._validate_preset_name(name)
        filename = f"{safe_name}.json"
        path = os.path.join(self.presets_dir, filename)

        # Verify path is still within presets_dir (defense in depth)
        try:
            real_path = pathlib.Path(path).resolve()
            presets_path = pathlib.Path(self.presets_dir).resolve()
            if not str(real_path).startswith(str(presets_path)):
                raise ValueError("Path traversal attempt detected")
        except Exception as e:
            logger.error(f"Path validation failed for {name}: {e}")
            raise

        # ensure atomic write
        tmp = path + '.tmp'
        try:
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump({'version': 1, 'state': state}, f, indent=2, ensure_ascii=False)
            os.replace(tmp, path)
            logger.info(f"Preset saved: {safe_name}")
            return path
        except Exception as e:
            # Clean up temp file on error
            if os.path.exists(tmp):
                try:
                    os.unlink(tmp)
                except Exception:
                    pass
            logger.error(f"Failed to save preset {name}: {e}")
            raise

    async def load_preset(self, name: str) -> dict:
        """Load a preset with error handling.

        Args:
            name: Preset name

        Returns:
            Mixer state dict or None if not found
        """
        try:
            safe_name = self._validate_preset_name(name)
        except ValueError as e:
            logger.warning(f"Invalid preset name {name}: {e}")
            return None

        filename = f"{safe_name}.json"
        path = os.path.join(self.presets_dir, filename)

        if not os.path.exists(path):
            return None

        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            if not isinstance(data, dict):
                logger.warning(f"Preset {name} has invalid format (not dict)")
                return None

            state = data.get('state')
            if not isinstance(state, dict):
                logger.warning(f"Preset {name} state is invalid")
                return None

            logger.info(f"Preset loaded: {safe_name}")
            return state

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse preset {name}: {e}")
            return None
        except IOError as e:
            logger.error(f"Failed to read preset {name}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error loading preset {name}: {e}")
            return None

    def list_presets(self) -> list:
        """List all presets.

        Returns:
            List of preset names (without .json extension)
        """
        try:
            return [p[:-5] for p in os.listdir(self.presets_dir) if p.endswith('.json')]
        except Exception as e:
            logger.error(f"Failed to list presets: {e}")
            return []
