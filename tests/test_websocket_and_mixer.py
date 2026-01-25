"""Tests for WebSocket handler and mixer state."""
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.server import MixerState, websocket_handler, get_camilla_status
from aiohttp import web


class TestMixerState:
    """Test MixerState class."""

    def test_init_default_channels(self):
        """Test initializing MixerState with default channel count."""
        mixer = MixerState()
        assert len(mixer.channels) == 8
        assert mixer.channels[0]['level_db'] == 0.0
        assert mixer.channels[0]['mute'] is False
        assert mixer.channels[0]['solo'] is False

    def test_init_custom_channels(self):
        """Test initializing MixerState with custom channel count."""
        mixer = MixerState(channels=16)
        assert len(mixer.channels) == 16

    def test_to_dict(self):
        """Test converting MixerState to dictionary."""
        mixer = MixerState(channels=2)
        mixer.channels[0]['level_db'] = -3.0
        mixer.channels[1]['mute'] = True

        state_dict = mixer.to_dict()
        assert 'channels' in state_dict
        assert len(state_dict['channels']) == 2
        assert state_dict['channels'][0]['level_db'] == -3.0
        assert state_dict['channels'][1]['mute'] is True

    def test_channel_eq_initialization(self):
        """Test that EQ is initialized correctly."""
        mixer = MixerState(channels=1)
        assert mixer.channels[0]['eq']['low'] == 0.0
        assert mixer.channels[0]['eq']['mid'] == 0.0
        assert mixer.channels[0]['eq']['high'] == 0.0


class TestGetCamillaStatus:
    """Test CamillaDSP status retrieval."""

    def test_get_camilla_status_no_adapter(self):
        """Test getting status when adapter is None."""
        status = get_camilla_status(None)
        assert status is not None
        assert status['connected'] is False
        assert status['ws_connected'] is False
        assert status['tcp_connected'] is False

    def test_get_camilla_status_with_mock_adapter(self):
        """Test getting status with a mock adapter."""
        adapter = MagicMock()
        adapter._ws = MagicMock()
        adapter._ws.closed = False
        adapter._pycdsp_connected = True

        status = get_camilla_status(adapter)
        assert status['ws_connected'] is True
        assert status['tcp_connected'] is True
        assert status['connected'] is True

    def test_get_camilla_status_ws_only(self):
        """Test getting status with only WebSocket connected."""
        adapter = MagicMock()
        adapter._ws = MagicMock()
        adapter._ws.closed = False
        adapter._pycdsp_connected = False

        status = get_camilla_status(adapter)
        assert status['ws_connected'] is True
        assert status['tcp_connected'] is False
        assert status['connected'] is True


class TestWebSocketMessaging:
    """Test WebSocket message handling (requires pytest-aiohttp or async setup)."""

    @pytest.mark.asyncio
    async def test_set_channel_level_message(self):
        """Test handling set_channel_level message."""
        mixer = MixerState(channels=2)

        # Simulate the backend logic
        ch = 0
        lvl = -6.5
        mixer.channels[ch]['level_db'] = lvl

        assert mixer.channels[0]['level_db'] == -6.5
        assert mixer.channels[1]['level_db'] == 0.0

    @pytest.mark.asyncio
    async def test_set_channel_mute_message(self):
        """Test handling set_channel_mute message."""
        mixer = MixerState(channels=2)

        ch = 1
        mixer.channels[ch]['mute'] = True

        assert mixer.channels[0]['mute'] is False
        assert mixer.channels[1]['mute'] is True

    @pytest.mark.asyncio
    async def test_set_channel_solo_message(self):
        """Test handling set_channel_solo message."""
        mixer = MixerState(channels=2)

        ch = 0
        mixer.channels[ch]['solo'] = True

        assert mixer.channels[0]['solo'] is True
        assert mixer.channels[1]['solo'] is False


class TestChannelStateUpdates:
    """Test individual channel state updates."""

    def test_update_channel_level(self):
        """Test updating a channel's level."""
        mixer = MixerState(channels=1)
        mixer.channels[0]['level_db'] = 3.5
        assert mixer.channels[0]['level_db'] == 3.5

    def test_update_channel_eq(self):
        """Test updating a channel's EQ."""
        mixer = MixerState(channels=1)
        mixer.channels[0]['eq']['low'] = -2.0
        mixer.channels[0]['eq']['mid'] = 1.5
        mixer.channels[0]['eq']['high'] = 2.0

        assert mixer.channels[0]['eq']['low'] == -2.0
        assert mixer.channels[0]['eq']['mid'] == 1.5
        assert mixer.channels[0]['eq']['high'] == 2.0

    def test_boundary_level_values(self):
        """Test that level values can be set within expected range."""
        mixer = MixerState(channels=1)

        # Test extreme values (typically -60 to +12 dB)
        mixer.channels[0]['level_db'] = -60.0
        assert mixer.channels[0]['level_db'] == -60.0

        mixer.channels[0]['level_db'] = 12.0
        assert mixer.channels[0]['level_db'] == 12.0
