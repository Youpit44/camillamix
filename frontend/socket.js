const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
let ws;
let _sendTimer = null;
let _sendPending = null;
const SEND_THROTTLE_MS = 80;

export let camillaStatus = { connected: false, ws_connected: false, tcp_connected: false };

export function connect(callbacks) {
    ws = new WebSocket(WS_URL);
    ws.addEventListener('open', () => {
        if (callbacks.onOpen) callbacks.onOpen();
        send({ type: 'subscribe_levels', payload: { interval_ms: 200 } });
        send({ type: 'subscribe_spectrum', payload: { enabled: true } });
    })
    ws.addEventListener('message', (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'state') {
                if (callbacks.onState) callbacks.onState(msg.payload);
            } else if (msg.type === 'levels') {
                if (callbacks.onLevels) callbacks.onLevels(msg.payload);
            } else if (msg.type === 'autosave_settings') {
                if (callbacks.onAutosaveSettings) callbacks.onAutosaveSettings(msg.payload);
            } else if (msg.type === 'camilla_status') {
                camillaStatus = msg.payload;
                if (callbacks.onCamillaStatus) callbacks.onCamillaStatus(msg.payload);
            } else if (msg.type === 'spectrum') {
                if (callbacks.onSpectrum) callbacks.onSpectrum(msg.payload);
            }
        } catch (e) { console.error(e) }
    })
    ws.addEventListener('close', () => {
        if (callbacks.onClose) callbacks.onClose();
    })
}

export function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

export function sendThrottled(obj) {
    if (!obj) return;
    if (obj.type === 'set_channel_level') {
        _sendPending = obj;
        if (!_sendTimer) {
            _sendTimer = setTimeout(() => {
                if (_sendPending && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(_sendPending));
                _sendPending = null;
                _sendTimer = null;
            }, SEND_THROTTLE_MS);
        }
    } else {
        send(obj);
    }
}

export function maybeSend(vslider, obj) {
    const cb = document.getElementById('localDuringDrag');
    const localOnly = cb ? cb.checked : false;
    if (localOnly) {
        vslider._pendingSend = obj;
    } else {
        sendThrottled(obj);
    }
}