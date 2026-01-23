"""Tests for PresetManager functionality."""
import asyncio
import json
import os
import pytest
from backend.presets import PresetManager


@pytest.fixture
def preset_manager(tmp_path):
    """Create a PresetManager with a temporary directory."""
    return PresetManager(str(tmp_path))


@pytest.mark.asyncio
async def test_save_and_load_preset(preset_manager):
    """Test saving and loading a preset."""
    state = {
        'channels': [
            {'index': 0, 'level_db': -3.0, 'mute': False, 'solo': False, 'eq': {'low': 0.0, 'mid': 0.0, 'high': 0.0}},
            {'index': 1, 'level_db': 2.5, 'mute': True, 'solo': False, 'eq': {'low': 1.0, 'mid': -2.0, 'high': 0.5}},
        ]
    }

    # Save preset
    path = await preset_manager.save_preset('test_preset', state)
    assert os.path.exists(path)

    # Load preset
    loaded = await preset_manager.load_preset('test_preset')
    assert loaded is not None
    assert len(loaded['channels']) == 2
    assert loaded['channels'][0]['level_db'] == -3.0
    assert loaded['channels'][1]['mute'] is True
    assert loaded['channels'][1]['eq']['mid'] == -2.0


@pytest.mark.asyncio
async def test_list_presets(preset_manager):
    """Test listing saved presets."""
    state1 = {'channels': [{'index': 0, 'level_db': 0.0}]}
    state2 = {'channels': [{'index': 0, 'level_db': -6.0}]}

    await preset_manager.save_preset('preset1', state1)
    await preset_manager.save_preset('preset2', state2)

    presets = preset_manager.list_presets()
    assert len(presets) == 2
    assert 'preset1.json' in presets
    assert 'preset2.json' in presets


@pytest.mark.asyncio
async def test_load_nonexistent_preset(preset_manager):
    """Test loading a preset that doesn't exist."""
    loaded = await preset_manager.load_preset('nonexistent')
    assert loaded is None


@pytest.mark.asyncio
async def test_preset_atomic_write(preset_manager):
    """Test that preset saves are atomic (file consistency)."""
    state = {'channels': [{'index': 0, 'level_db': 5.5}]}
    path = await preset_manager.save_preset('atomic_test', state)

    # Verify file content is valid JSON
    with open(path, 'r') as f:
        data = json.load(f)

    assert data['version'] == 1
    assert data['state']['channels'][0]['level_db'] == 5.5


@pytest.mark.asyncio
async def test_overwrite_preset(preset_manager):
    """Test overwriting an existing preset."""
    state1 = {'channels': [{'index': 0, 'level_db': 0.0}]}
    state2 = {'channels': [{'index': 0, 'level_db': 12.0}]}

    await preset_manager.save_preset('overwrite_me', state1)
    loaded1 = await preset_manager.load_preset('overwrite_me')
    assert loaded1['channels'][0]['level_db'] == 0.0

    await preset_manager.save_preset('overwrite_me', state2)
    loaded2 = await preset_manager.load_preset('overwrite_me')
    assert loaded2['channels'][0]['level_db'] == 12.0
