import { connect, camillaStatus } from './socket.js';
import { initUI, initUIHandlers, renderMixer, applyState, updateLevels, applyAutosaveSettings, updateStatusBar } from './ui.js';

function init() {
  initUI();
  initUIHandlers();

  connect({
    onOpen: () => {
      updateStatusBar(true, camillaStatus.connected);
    },
    onClose: () => {
      updateStatusBar(false, false);
    },
    onState: (payload) => {
      const mixerEl = document.getElementById('mixer');
      if (!mixerEl || mixerEl.children.length === 0) {
        renderMixer(payload);
      }
      applyState(payload);
    },
    onLevels: (payload) => {
      updateLevels(payload.channels);
    },
    onAutosaveSettings: (payload) => {
      applyAutosaveSettings(payload);
    },
    onCamillaStatus: (payload) => {
      updateStatusBar(true, payload.connected);
    }
  });
}

window.addEventListener('load', init);
