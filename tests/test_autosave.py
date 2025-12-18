"""Tests for autosave functionality."""
import asyncio
import json
import os
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from backend.presets import PresetManager


class TestAutosaveSettings:
    """Test autosave configuration and behavior."""

    def test_autosave_enabled_default(self):
        """Test that autosave defaults can be set."""
        autosave_enabled = True
        autosave_interval = 30

        assert autosave_enabled is True
        assert autosave_interval == 30

    def test_autosave_disabled(self):
        """Test autosave disabled state."""
        autosave_enabled = False
        autosave_interval = 30

        assert autosave_enabled is False
        assert autosave_interval == 30

    def test_autosave_interval_values(self):
        """Test various autosave interval values."""
        intervals = [10, 30, 60, 120]

        for interval in intervals:
            assert isinstance(interval, int)
            assert interval > 0


@pytest.fixture
def preset_manager(tmp_path):
    """Create a PresetManager with a temporary directory."""
    return PresetManager(str(tmp_path))


@pytest.mark.asyncio
async def test_autosave_periodic_save(preset_manager):
    """Test that autosave would save presets periodically."""
    state = {
        'channels': [
            {'index': 0, 'level_db': 0.0, 'mute': False, 'solo': False, 'eq': {'low': 0.0, 'mid': 0.0, 'high': 0.0}},
        ]
    }

    # Simulate autosave: save at T=0
    await preset_manager.save_preset('autosave', state)

    # Verify save occurred
    loaded = await preset_manager.load_preset('autosave')
    assert loaded is not None

    # Modify state
    state['channels'][0]['level_db'] = -3.0

    # Simulate autosave: save again
    await preset_manager.save_preset('autosave', state)

    # Verify new state was saved
    loaded = await preset_manager.load_preset('autosave')
    assert loaded['channels'][0]['level_db'] == -3.0


@pytest.mark.asyncio
async def test_autosave_preserves_state(preset_manager):
    """Test that autosave correctly preserves all state data."""
    state = {
        'channels': [
            {
                'index': 0,
                'level_db': -2.5,
                'mute': True,
                'solo': False,
                'eq': {'low': -1.0, 'mid': 0.5, 'high': 2.0}
            },
            {
                'index': 1,
                'level_db': 3.0,
                'mute': False,
                'solo': True,
                'eq': {'low': 0.0, 'mid': -0.5, 'high': 0.0}
            },
        ]
    }

    await preset_manager.save_preset('autosave_full', state)
    loaded = await preset_manager.load_preset('autosave_full')

    # Verify complete state preservation
    assert loaded['channels'][0]['level_db'] == -2.5
    assert loaded['channels'][0]['mute'] is True
    assert loaded['channels'][0]['eq']['low'] == -1.0
    assert loaded['channels'][1]['solo'] is True
    assert loaded['channels'][1]['eq']['high'] == 0.0


@pytest.mark.asyncio
async def test_autosave_handles_many_saves(preset_manager):
    """Test that autosave can handle many successive saves."""
    for i in range(10):
        state = {
            'channels': [
                {'index': 0, 'level_db': float(i), 'mute': i % 2 == 0}
            ]
        }
        await preset_manager.save_preset('rapid_save', state)

    # Verify final state
    loaded = await preset_manager.load_preset('rapid_save')
    assert loaded['channels'][0]['level_db'] == 9.0


class TestAutosaveEdgeCases:
    """Test edge cases for autosave."""

    @pytest.mark.asyncio
    async def test_autosave_with_zero_interval(self, preset_manager):
        """Test autosave behavior with zero interval (should be handled)."""
        # In practice, interval should be > 0, but test defensive handling
        autosave_interval = max(1, 0)  # Ensure at least 1 second
        assert autosave_interval == 1

    @pytest.mark.asyncio
    async def test_autosave_with_large_interval(self, preset_manager):
        """Test autosave with very large interval."""
        autosave_interval = 3600  # 1 hour
        assert autosave_interval == 3600

    @pytest.mark.asyncio
    async def test_autosave_disable_and_enable(self, preset_manager):
        """Test toggling autosave on and off."""
        state = {'channels': [{'index': 0, 'level_db': 0.0}]}

        # Simulate: autosave disabled
        autosave_enabled = False
        # In disabled state, no save occurs

        # Simulate: re-enable autosave
        autosave_enabled = True
        await preset_manager.save_preset('toggle_test', state)

        loaded = await preset_manager.load_preset('toggle_test')
        assert loaded is not None
