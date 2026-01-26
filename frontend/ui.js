import { send, sendThrottled, maybeSend, camillaStatus } from './socket.js';
import { dbg, setDebugEnabled, ensureDebugOverlay, getDebugEnabled, log, setConsoleEnabled, getConsoleEnabled } from './utils.js';
import { createSpectrumVisualizer } from './visualizer.js';

let autosaveEnabled = false;
let autosaveInterval = 30;
let masterSpectrum = null;
let updateCamillaStatusUI_Callback = null;

const domCache = {
    masterLevel: null,
    channels: {}
};

export function updateStatusBar(wsConnected, camillaConnected) {
    const wsLed = document.getElementById('wsStatusLed');
    const wsText = document.getElementById('wsStatusText');
    const camillaLed = document.getElementById('camillaStatusLed');
    const camillaText = document.getElementById('camillaStatusText');
    const camillaVol = document.getElementById('camillaStatusVol');

    if (wsLed && wsText) {
        wsLed.className = wsConnected ? 'status-led connected' : 'status-led disconnected';
        wsText.className = wsConnected ? 'status-text connected' : 'status-text disconnected';
        wsText.textContent = wsConnected ? 'WebSocket' : 'WebSocket';
    }

    if (camillaLed && camillaText) {
        camillaLed.className = camillaConnected ? 'status-led connected' : 'status-led disconnected';
        camillaText.className = camillaConnected ? 'status-text connected' : 'status-text disconnected';
        let label = 'CamillaDSP';
        if (camillaVol && camillaStatus) {
            const v = camillaStatus.main_volume_db;
            const isExt = camillaStatus.external_volume;
            if (typeof v === 'number' && !Number.isNaN(v)) {
                camillaVol.textContent = ` ${v.toFixed(1)} dB` + (isExt ? ' (ext)' : '');
            } else {
                camillaVol.textContent = '';
            }
        }
        camillaText.textContent = label;
    }

    if (updateCamillaStatusUI_Callback) {
        updateCamillaStatusUI_Callback(camillaStatus);
    }
}

function createKnob(label, initialValue, min, max, color, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'knob-wrap';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '4px';
    wrap.style.margin = '6px 0';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '42');
    svg.setAttribute('height', '42');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.style.cursor = 'pointer';
    svg.style.userSelect = 'none';

    const outerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    outerCircle.setAttribute('cx', '24');
    outerCircle.setAttribute('cy', '24');
    outerCircle.setAttribute('r', '20');
    outerCircle.setAttribute('fill', '#1a1a1a');
    outerCircle.setAttribute('stroke', '#333');
    outerCircle.setAttribute('stroke-width', '2');
    svg.appendChild(outerCircle);

    const arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arcPath.setAttribute('fill', 'none');
    arcPath.setAttribute('stroke', color);
    arcPath.setAttribute('stroke-width', '3');
    arcPath.setAttribute('stroke-linecap', 'round');
    svg.appendChild(arcPath);

    const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    indicator.setAttribute('x1', '24');
    indicator.setAttribute('y1', '24');
    indicator.setAttribute('x2', '24');
    indicator.setAttribute('y2', '10');
    indicator.setAttribute('stroke', '#fff');
    indicator.setAttribute('stroke-width', '2.5');
    indicator.setAttribute('stroke-linecap', 'round');
    svg.appendChild(indicator);

    const centerDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerDot.setAttribute('cx', '24');
    centerDot.setAttribute('cy', '24');
    centerDot.setAttribute('r', '3');
    centerDot.setAttribute('fill', '#555');
    svg.appendChild(centerDot);

    wrap.appendChild(svg);

    const lblEl = document.createElement('div');
    lblEl.className = 'knob-label';
    lblEl.style.fontSize = '10px';
    lblEl.style.color = '#999';
    lblEl.style.fontWeight = '600';
    lblEl.style.textTransform = 'uppercase';
    lblEl.textContent = label;
    wrap.appendChild(lblEl);

    const valueEl = document.createElement('div');
    valueEl.className = 'knob-value';
    valueEl.style.fontSize = '11px';
    valueEl.style.color = color;
    valueEl.style.fontWeight = '700';
    wrap.appendChild(valueEl);

    let currentValue = initialValue;
    const range = max - min;
    const startAngle = -135;
    const endAngle = 135;
    const angleRange = endAngle - startAngle;

    function updateKnob() {
        const pct = (currentValue - min) / range;
        const angle = startAngle + pct * angleRange;
        const rad = (angle * Math.PI) / 180;

        const cx = 24,
            cy = 24;
        const x2 = cx + 14 * Math.sin(rad);
        const y2 = cy - 14 * Math.cos(rad);
        indicator.setAttribute('x2', x2);
        indicator.setAttribute('y2', y2);

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = rad;
        const r = 17;
        const x1 = cx + r * Math.sin(startRad);
        const y1 = cy - r * Math.cos(startRad);
        const x2arc = cx + r * Math.sin(endRad);
        const y2arc = cy - r * Math.cos(endRad);
        const largeArc = (angle - startAngle) > 180 ? 1 : 0;
        const pathD = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2arc} ${y2arc}`;
        arcPath.setAttribute('d', pathD);

        valueEl.textContent = currentValue.toFixed(1) + ' dB';
    }

    updateKnob();

    let dragging = false;
    let startY = 0;
    let startVal = 0;

    function onPointerDown(e) {
        e.preventDefault();
        dragging = true;
        startY = e.clientY;
        startVal = currentValue;
        svg.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
        if (!dragging) return;
        const dy = startY - e.clientY;
        const sensitivity = 0.5;
        const delta = dy * sensitivity;
        currentValue = Math.max(min, Math.min(max, startVal + delta));
        updateKnob();
        if (onChange) onChange(currentValue);
    }

    function onPointerUp(e) {
        if (!dragging) return;
        dragging = false;
        svg.releasePointerCapture(e.pointerId);
    }

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);

    wrap._setValue = function(val) {
        currentValue = Math.max(min, Math.min(max, val));
        updateKnob();
    };
    wrap._getValue = function() { return currentValue; };

    return wrap;
}

function createMasterSection() {
    const c = document.createElement('div');
    c.className = 'channel master-channel';
    c.id = 'master-section';

    const header = document.createElement('div');
    header.className = 'channel-header';
    header.innerHTML = '<span class="ch-icon">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="12" cy="12" r="9" fill="none" stroke="#f39c12" stroke-width="2"/>' +
        '<path d="M12 6v6l4 4" stroke="#f39c12" stroke-width="2" stroke-linecap="round"/>' +
        '</svg></span> MASTER';
    c.appendChild(header);

    const mainWrap = document.createElement('div');
    mainWrap.style.display = 'flex';
    mainWrap.style.gap = '12px';
    mainWrap.style.alignItems = 'flex-end';
    mainWrap.style.justifyContent = 'center';

    const leftCol = document.createElement('div');
    leftCol.style.display = 'flex';
    leftCol.style.flexDirection = 'column';
    leftCol.style.alignItems = 'center';
    leftCol.style.gap = '10px';

    const vu = document.createElement('div');
    vu.className = 'vu';
    const vum = document.createElement('div');
    vum.className = 'vumeter';
    vum.id = 'master-vumeter';
    const level = document.createElement('div');
    level.className = 'level';
    vum.appendChild(level);
    vu.appendChild(vum);
    leftCol.appendChild(vu);

    const spacer = document.createElement('div');
    spacer.style.height = '46px';
    leftCol.appendChild(spacer);

    const faderWrap = document.createElement('div');
    faderWrap.className = 'fader-wrapper';
    const vslider = document.createElement('div');
    vslider.className = 'vslider';
    vslider.id = 'master-slider';
    vslider.innerHTML = '<div class="track"></div><div class="fill"></div><div class="thumb"></div>';
    vslider.style.width = vslider.style.width || '28px';
    vslider.style.height = vslider.style.height || '220px';
    const valueLabel = document.createElement('div');
    valueLabel.className = 'valuelabel';
    valueLabel.id = 'master-value';
    faderWrap.appendChild(vslider);
    faderWrap.appendChild(valueLabel);
    leftCol.appendChild(faderWrap);

    const fill = vslider.querySelector('.fill');
    const thumb = vslider.querySelector('.thumb');
    const track = vslider.querySelector('.track');
    track.style.position = track.style.position || 'absolute';
    track.style.left = track.style.left || '50%';
    track.style.transform = track.style.transform || 'translateX(-50%)';
    track.style.top = track.style.top || '8px';
    track.style.bottom = track.style.bottom || '8px';
    track.style.width = track.style.width || '8px';
    fill.style.position = fill.style.position || 'absolute';
    fill.style.left = fill.style.left || '50%';
    fill.style.transform = fill.style.transform || 'translateX(-50%)';
    fill.style.bottom = fill.style.bottom || '8px';
    fill.style.width = fill.style.width || '8px';
    thumb.style.position = thumb.style.position || 'absolute';
    thumb.style.left = thumb.style.left || '50%';
    thumb.style.transform = thumb.style.transform || 'translateX(-50%)';
    thumb.style.width = thumb.style.width || '28px';
    thumb.style.height = thumb.style.height || '14px';
    const min = -60,
        max = 12,
        range = max - min;

    function getRectWithFallback(el) {
        const r = el.getBoundingClientRect();
        if (r && r.height > 0) return r;
        let topAcc = 0;
        let node = el;
        while (node) {
            topAcc += node.offsetTop || 0;
            node = node.offsetParent;
        }
        const scrollY = window.scrollY || window.pageYOffset || 0;
        const top = topAcc - scrollY;
        const h = el.clientHeight || parseInt(getComputedStyle(el).height) || 220;
        return { top: top, bottom: top + h, height: h, left: 0, right: 0 };
    }

    vslider._setValue = function(v) {
        const pct = Math.max(0, Math.min(1, (v - min) / range));
        fill.style.height = (pct * 100) + '%';
        const rect = getRectWithFallback(this);
        const trackTop = 8;
        const trackBottom = rect.height - 8;
        const trackH = Math.max(8, trackBottom - trackTop);
        const thumbCenter = trackTop + (1 - pct) * trackH;
        const th = thumb.offsetHeight || parseInt(thumb.style.height) || 14;
        const ty = (thumbCenter - th / 2);
        thumb.style.transform = 'translate(-50%, ' + (ty) + 'px)';
        valueLabel.textContent = Math.round(v * 10) / 10 + ' dB';
    };

    let activePointer = null;

    function pointerToValue(clientY) {
        const rect = getRectWithFallback(vslider);
        const trackTop = rect.top + 8;
        const trackBottom = rect.bottom - 8;
        const h = Math.max(8, trackBottom - trackTop);
        let pos = clientY - trackTop;
        pos = Math.max(0, Math.min(h, pos));
        const pct = 1 - (pos / h);
        const value = min + pct * range;
        return { value, pct };
    }

    function onPointerDown(ev) {
        ev.preventDefault();
        activePointer = ev.pointerId;
        try { if (vslider.setPointerCapture) vslider.setPointerCapture(ev.pointerId); } catch (e) {}
        try { if (thumb.setPointerCapture) thumb.setPointerCapture(ev.pointerId); } catch (e) {}

        function onPointerMove(e) {
            if (activePointer !== e.pointerId) return;
            let pv = pointerToValue(e.clientY);
            const { value } = pv;
            vslider._setValue(value);
            sendThrottled({ type: 'set_channel_level', payload: { channel: 'master', level_db: parseFloat(value) } });
        }

        function onPointerUp(e) {
            if (activePointer !== e.pointerId) return;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            try { if (vslider.releasePointerCapture) vslider.releasePointerCapture(e.pointerId); } catch (e) {}
            try { if (thumb.releasePointerCapture) thumb.releasePointerCapture(e.pointerId); } catch (e) {}
            activePointer = null;
        }
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        const pv0 = pointerToValue(ev.clientY);
        vslider._setValue(pv0.value);
    }
    vslider.addEventListener('pointerdown', onPointerDown);
    thumb.addEventListener('pointerdown', onPointerDown);

    mainWrap.appendChild(leftCol);

    const rightCol = document.createElement('div');
    rightCol.style.display = 'flex';
    rightCol.style.flexDirection = 'column';
    rightCol.style.alignItems = 'center';
    rightCol.style.justifyContent = 'flex-end';
    rightCol.style.gap = '8px';

    const masterKnob = createKnob('LEVEL', 0, -60, 12, '#f39c12', (val) => {
        if (vslider && vslider._setValue) vslider._setValue(val);
        sendThrottled({ type: 'set_channel_level', payload: { channel: 'master', level_db: parseFloat(val) } });
    });
    masterKnob.style.margin = '0';
    rightCol.appendChild(masterKnob);

    mainWrap.appendChild(rightCol);
    c.appendChild(mainWrap);

    return c;
}

function createChannelElement(i, state) {
    const c = document.createElement('div');
    c.className = 'channel';
    c.id = 'ch-' + i;
    const header = document.createElement('div');
    header.className = 'channel-header';
    header.innerHTML = '<span class="ch-icon">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M3 10v4h4l5 5V5L7 10H3z" fill="#cfcfcf"/> ' +
        '<path d="M16.5 8.5a4.5 4.5 0 010 7" stroke="#9ed3c6" stroke-width="1.2" fill="none" stroke-linecap="round"/> ' +
        '</svg></span> CH ' + (i + 1);
    c.appendChild(header);

    const mainWrap = document.createElement('div');
    mainWrap.style.display = 'flex';
    mainWrap.style.gap = '12px';
    mainWrap.style.alignItems = 'flex-end';
    mainWrap.style.justifyContent = 'center';

    const leftCol = document.createElement('div');
    leftCol.style.display = 'flex';
    leftCol.style.flexDirection = 'column';
    leftCol.style.alignItems = 'center';
    leftCol.style.gap = '10px';

    const vu = document.createElement('div');
    vu.className = 'vu';
    const vum = document.createElement('div');
    vum.className = 'vumeter';
    const level = document.createElement('div');
    level.className = 'level';
    vum.appendChild(level);
    vu.appendChild(vum);
    leftCol.appendChild(vu);

    const topButtons = document.createElement('div');
    topButtons.style.display = 'flex';
    topButtons.style.gap = '6px';
    topButtons.style.margin = '6px 0 2px 0';

    const mute = document.createElement('button');
    mute.className = 'btn small icon';
    mute.title = 'Mute';
    mute.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 10v4h4l5 5V5L7 10H3z" fill="#ddd"/><line x1="18" y1="6" x2="6" y2="18" stroke="#c0392b" stroke-width="2" stroke-linecap="round"/></svg>';
    if (state.mute) mute.classList.add('state-on');
    mute.onclick = () => {
        state.mute = !state.mute;
        if (state.mute) mute.classList.add('state-on');
        else mute.classList.remove('state-on');
        send({ type: 'set_channel_mute', payload: { channel: i, mute: !!state.mute } })
    }
    topButtons.appendChild(mute);

    const solo = document.createElement('button');
    solo.className = 'btn small icon';
    solo.title = 'Solo';
    solo.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 4a8 8 0 100 16 8 8 0 000-16z" fill="#ddd"/><circle cx="12" cy="12" r="3" fill="#16a085"/></svg>';
    if (state.solo) solo.classList.add('state-solo');
    solo.onclick = () => {
        state.solo = !state.solo;
        if (state.solo) solo.classList.add('state-solo');
        else solo.classList.remove('state-solo');
        send({ type: 'set_channel_solo', payload: { channel: i, solo: !!state.solo } })
    }
    topButtons.appendChild(solo);

    leftCol.appendChild(topButtons);

    const faderWrap = document.createElement('div');
    faderWrap.className = 'fader-wrapper';
    const vslider = document.createElement('div');
    vslider.className = 'vslider';
    vslider.innerHTML = '<div class="track"></div><div class="fill"></div><div class="thumb"></div>';
    vslider.style.width = vslider.style.width || '28px';
    vslider.style.height = vslider.style.height || '220px';
    const valueLabel = document.createElement('div');
    valueLabel.className = 'valuelabel';
    faderWrap.appendChild(vslider);
    faderWrap.appendChild(valueLabel);
    leftCol.appendChild(faderWrap);

    mainWrap.appendChild(leftCol);

    const rightCol = document.createElement('div');
    rightCol.style.display = 'flex';
    rightCol.style.flexDirection = 'column';
    rightCol.style.alignItems = 'center';
    rightCol.style.justifyContent = 'flex-end';
    rightCol.style.gap = '8px';

    const fill = vslider.querySelector('.fill');
    const thumb = vslider.querySelector('.thumb');
    const track = vslider.querySelector('.track');
    track.style.position = track.style.position || 'absolute';
    track.style.left = track.style.left || '50%';
    track.style.transform = track.style.transform || 'translateX(-50%)';
    track.style.top = track.style.top || '8px';
    track.style.bottom = track.style.bottom || '8px';
    track.style.width = track.style.width || '8px';
    fill.style.position = fill.style.position || 'absolute';
    fill.style.left = fill.style.left || '50%';
    fill.style.transform = fill.style.transform || 'translateX(-50%)';
    fill.style.bottom = fill.style.bottom || '8px';
    fill.style.width = fill.style.width || '8px';
    thumb.style.position = thumb.style.position || 'absolute';
    thumb.style.left = thumb.style.left || '50%';
    thumb.style.transform = thumb.style.transform || 'translateX(-50%)';
    thumb.style.width = thumb.style.width || '28px';
    thumb.style.height = thumb.style.height || '14px';
    const min = -60,
        max = 12,
        range = max - min;

    function getRectWithFallback(el) {
        const r = el.getBoundingClientRect();
        if (r && r.height > 0) return r;
        let topAcc = 0;
        let node = el;
        while (node) {
            topAcc += node.offsetTop || 0;
            node = node.offsetParent;
        }
        const scrollY = window.scrollY || window.pageYOffset || 0;
        const top = topAcc - scrollY;
        const h = el.clientHeight || parseInt(getComputedStyle(el).height) || 220;
        return { top: top, bottom: top + h, height: h, left: 0, right: 0 };
    }

    vslider._setValue = function(v) {
        const pct = Math.max(0, Math.min(1, (v - min) / range));
        fill.style.height = (pct * 100) + '%';
        const rect = getRectWithFallback(this);
        const trackTop = 8;
        const trackBottom = rect.height - 8;
        const trackH = Math.max(8, trackBottom - trackTop);
        const thumbCenter = trackTop + (1 - pct) * trackH;
        const th = thumb.offsetHeight || parseInt(thumb.style.height) || 14;
        const ty = (thumbCenter - th / 2);
        thumb.style.transform = 'translate(-50%, ' + (ty) + 'px)';
        valueLabel.textContent = Math.round(v * 10) / 10 + ' dB';
    };

    let activePointer = null;

    function pointerToValue(clientY) {
        const rect = getRectWithFallback(vslider);
        const trackTop = rect.top + 8;
        const trackBottom = rect.bottom - 8;
        const h = Math.max(8, trackBottom - trackTop);
        let pos = clientY - trackTop;
        pos = Math.max(0, Math.min(h, pos));
        const pct = 1 - (pos / h);
        const value = min + pct * range;
        return { value, pct };
    }

    function onPointerDown(ev) {
        ev.preventDefault();
        activePointer = ev.pointerId;
        dbg('pointerdown ch' + i + ' y=' + ev.clientY + ' id=' + ev.pointerId);
        try { if (vslider.setPointerCapture) vslider.setPointerCapture(ev.pointerId); } catch (e) {}
        try { if (thumb.setPointerCapture) thumb.setPointerCapture(ev.pointerId); } catch (e) {}

        function onPointerMove(e) {
            if (activePointer !== e.pointerId) return;
            let pv = pointerToValue(e.clientY);
            try {
                const r = getRectWithFallback(vslider);
                if (r.height <= 0 && vslider._dragState) {
                    const ds = vslider._dragState;
                    const dy = e.clientY - ds.startY;
                    let newPct = ds.startPct - (dy / ds.trackH);
                    newPct = Math.max(0, Math.min(1, newPct));
                    const value = min + newPct * range;
                    pv = { value: value, pct: newPct };
                }
            } catch (e) { /* ignore */ }
            dbg('move ch' + i + ' y=' + e.clientY + ' pct=' + Math.round(pv.pct * 100) + ' val=' + pv.value.toFixed(2));
            const { value, pct } = pv;
            vslider._setValue(value);
            maybeSend(vslider, { type: 'set_channel_level', payload: { channel: i, level_db: parseFloat(value) } });
        }

        function onPointerUp(e) {
            if (activePointer !== e.pointerId) return;
            dbg('pointerup ch' + i + ' id=' + e.pointerId);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            try { if (vslider.releasePointerCapture) vslider.releasePointerCapture(e.pointerId); } catch (e) {}
            try { if (thumb.releasePointerCapture) thumb.releasePointerCapture(e.pointerId); } catch (e) {}
            activePointer = null;
            if (vslider._pendingSend) {
                send(vslider._pendingSend);
                vslider._pendingSend = null;
            }
            vslider._dragState = null;
        }
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        const pv0 = pointerToValue(ev.clientY);
        vslider._setValue(pv0.value);
        send({ type: 'set_channel_level', payload: { channel: i, level_db: parseFloat(pv0.value) } })
        try {
            const r = getRectWithFallback(vslider);
            const trackH = Math.max(8, (r.height - 16));
            const startPct = pv0.pct;
            vslider._dragState = { startY: ev.clientY, startPct: startPct, trackH: trackH };
        } catch (e) { vslider._dragState = null }
    }
    vslider.addEventListener('pointerdown', onPointerDown);
    thumb.addEventListener('pointerdown', onPointerDown);

    function onMouseDown(ev) {
        ev.preventDefault();

        function onMove(e) {
            const pv = pointerToValue(e.clientY);
            const { value } = pv;
            vslider._setValue(value);
            sendThrottled({ type: 'set_channel_level', payload: { channel: i, level_db: parseFloat(value) } });
        }

        function onUp(e) {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }
        onMove(ev);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }
    vslider.addEventListener('mousedown', onMouseDown);
    thumb.addEventListener('mousedown', onMouseDown);

    const knobsCol = document.createElement('div');
    knobsCol.style.display = 'flex';
    knobsCol.style.flexDirection = 'column';
    knobsCol.style.gap = '6px';
    knobsCol.style.alignItems = 'center';

    let eqGainVal = (state.eq && state.eq.gain) || 0.0;
    const gainKnob = createKnob('GAIN', eqGainVal, -12, 12, '#9ed3c6', (val) => {
        sendThrottled({ type: 'set_channel_eq', payload: { channel: i, band: 'gain', gain_db: val } });
    });
    gainKnob.style.margin = '0';
    gainKnob.classList.add('knob-gain');
    knobsCol.appendChild(gainKnob);

    let eqHiVal = (state.eq && state.eq.high) || 0.0;
    const hiKnob = createKnob('HI', eqHiVal, -12, 12, '#f1c40f', (val) => {
        send({ type: 'set_channel_eq', payload: { channel: i, band: 'high', gain_db: val } });
    });
    hiKnob.style.margin = '0';
    hiKnob.classList.add('knob-hi');
    knobsCol.appendChild(hiKnob);

    let eqMidVal = (state.eq && state.eq.mid) || 0.0;
    const midKnob = createKnob('MID', eqMidVal, -12, 12, '#3498db', (val) => {
        send({ type: 'set_channel_eq', payload: { channel: i, band: 'mid', gain_db: val } });
    });
    midKnob.style.margin = '0';
    midKnob.classList.add('knob-mid');
    knobsCol.appendChild(midKnob);

    let eqLoVal = (state.eq && state.eq.low) || 0.0;
    const loKnob = createKnob('LO', eqLoVal, -12, 12, '#e74c3c', (val) => {
        send({ type: 'set_channel_eq', payload: { channel: i, band: 'low', gain_db: val } });
    });
    loKnob.style.margin = '0';
    loKnob.classList.add('knob-lo');
    knobsCol.appendChild(loKnob);

    rightCol.appendChild(knobsCol);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn';
    resetBtn.textContent = 'RST';
    resetBtn.style.marginTop = '8px';
    resetBtn.style.width = '60px';
    resetBtn.onclick = () => {
        send({ type: 'set_channel_level', payload: { channel: i, level_db: 0 } })
        send({ type: 'set_channel_mute', payload: { channel: i, mute: false } })
        send({ type: 'set_channel_solo', payload: { channel: i, solo: false } })
        send({ type: 'set_channel_eq', payload: { channel: i, band: 'gain', gain_db: 0 } });
        send({ type: 'set_channel_eq', payload: { channel: i, band: 'high', gain_db: 0 } });
        send({ type: 'set_channel_eq', payload: { channel: i, band: 'mid', gain_db: 0 } });
        send({ type: 'set_channel_eq', payload: { channel: i, band: 'low', gain_db: 0 } });
    }
    rightCol.appendChild(resetBtn);

    mainWrap.appendChild(rightCol);
    c.appendChild(mainWrap);

    return c;
}

export function renderMixer(state) {
    const container = document.getElementById('mixer');
    container.innerHTML = '';
    domCache.channels = {};

    (state.channels || []).forEach((ch, i) => {
        const el = createChannelElement(i, ch);
        container.appendChild(el);

        const levelEl = el.querySelector('.vumeter .level');
        if (levelEl) {
            domCache.channels[i] = levelEl;
        }

        const vslider = el.querySelector('.vslider');
        if (vslider && typeof vslider._setValue === 'function') {
            requestAnimationFrame(() => vslider._setValue(ch.level_db || 0));
        }
    })

    const masterLevelEl = document.querySelector('#master-vumeter .level');
    if (masterLevelEl) {
        domCache.masterLevel = masterLevelEl;
    }
}

export function applyState(state) {
    const anySolo = (state.channels || []).some(c => c.solo);

    if (state.master) {
        const masterSlider = document.querySelector('#master-slider');
        if (masterSlider && typeof masterSlider._setValue === 'function') {
            if (!masterSlider._dragState) masterSlider._setValue(state.master.level_db || 0);
        }
    }
    (state.channels || []).forEach((ch, i) => {
        const el = document.getElementById('ch-' + i);
        if (!el) return;
        const vslider = el.querySelector('.vslider');
        if (vslider && typeof vslider._setValue === 'function') {
            if (!vslider._dragState) vslider._setValue(ch.level_db || 0);
        }

        if (ch.eq) {
            const gainKnob = el.querySelector('.knob-gain');
            if (gainKnob && typeof gainKnob._setValue === 'function') gainKnob._setValue(ch.eq.gain || 0);

            const hiKnob = el.querySelector('.knob-hi');
            if (hiKnob && typeof hiKnob._setValue === 'function') hiKnob._setValue(ch.eq.high || 0);

            const midKnob = el.querySelector('.knob-mid');
            if (midKnob && typeof midKnob._setValue === 'function') midKnob._setValue(ch.eq.mid || 0);

            const loKnob = el.querySelector('.knob-lo');
            if (loKnob && typeof loKnob._setValue === 'function') loKnob._setValue(ch.eq.low || 0);
        }

        const muteBtn = el.querySelector('.btn.small');
        if (muteBtn) {
            const isMuted = ch.mute || (anySolo && !ch.solo);
            if (isMuted) muteBtn.classList.add('state-on');
            else muteBtn.classList.remove('state-on');
        }
        const btns = el.querySelectorAll('.btn.small');
        if (btns.length >= 2) {
            const soloBtn = btns[1];
            if (ch.solo) soloBtn.classList.add('state-solo');
            else soloBtn.classList.remove('state-solo');
        }
    })
}

export function updateLevels(levels) {
    levels.forEach(l => {
        let levelEl;
        if (l.channel === 'master') {
            if (!domCache.masterLevel) {
                domCache.masterLevel = document.querySelector('#master-vumeter .level');
            }
            levelEl = domCache.masterLevel;
        } else {
            levelEl = domCache.channels[l.channel];
            if (!levelEl) {
                levelEl = document.querySelector('#ch-' + l.channel + ' .vumeter .level');
                if (levelEl) domCache.channels[l.channel] = levelEl;
            }
        }

        if (levelEl) {
            // Scale -80dB to 0dB to make meter look fuller
            const v = Math.max(-80, l.level_db);
            const pct = Math.min(100, Math.max(0, ((v + 80) / 80) * 100));
            levelEl.style.height = pct + '%';
        }
    })

    try {
        const master = levels.find(l => l.channel === 'master');
        if (master && masterSpectrum && typeof masterSpectrum.update === 'function') {
            masterSpectrum.update(master.level_db);
        }
    } catch (e) { console.error(e) }
}

export function applyAutosaveSettings(settings) {
    if (!settings) return;
    autosaveEnabled = !!settings.enabled;
    if (typeof settings.interval_sec === 'number') autosaveInterval = settings.interval_sec;
    const chk = document.getElementById('autoSaveEnable');
    const inp = document.getElementById('autoSaveInterval');
    if (chk) chk.checked = autosaveEnabled;
    if (inp && !Number.isNaN(autosaveInterval)) inp.value = autosaveInterval;
}

export async function refreshPresetList() {
    try {
        const res = await fetch('/api/presets');
        const data = await res.json();
        const sel = document.getElementById('presetList');
        if (sel) {
            sel.innerHTML = '';
            (data.presets || []).forEach(p => {
                const o = document.createElement('option');
                o.value = p;
                o.textContent = p;
                sel.appendChild(o)
            })
        }
    } catch (e) { console.error(e) }
}

function updatePresetSelect(sel) {
    fetch('/api/presets').then(r => r.json()).then(data => {
        sel.innerHTML = '';
        (data.presets || []).forEach(p => {
            const o = document.createElement('option');
            o.value = p;
            o.textContent = p;
            sel.appendChild(o);
        });
    }).catch(e => console.error(e));
}

export function openOptionsModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.minWidth = '400px';

    const title = document.createElement('h2');
    title.textContent = 'Options & Presets';
    modal.appendChild(title);

    const presetSec = document.createElement('div');
    presetSec.className = 'modal-section';
    presetSec.style.flexDirection = 'column';
    presetSec.style.alignItems = 'stretch';
    const presetTitle = document.createElement('div');
    presetTitle.textContent = 'Gestion des presets';
    presetTitle.style.fontWeight = '700';
    presetTitle.style.marginBottom = '6px';
    presetSec.appendChild(presetTitle);

    const presetRow1 = document.createElement('div');
    presetRow1.style.display = 'flex';
    presetRow1.style.gap = '8px';
    presetRow1.style.marginBottom = '6px';
    const btnSavePreset = document.createElement('button');
    btnSavePreset.className = 'btn';
    btnSavePreset.textContent = 'Sauvegarder';
    const selectPreset = document.createElement('select');
    selectPreset.id = 'presetListModal';
    selectPreset.style.display = 'inline-block';
    selectPreset.style.flex = '1';
    updatePresetSelect(selectPreset);
    const btnLoadPreset = document.createElement('button');
    btnLoadPreset.className = 'btn';
    btnLoadPreset.textContent = 'Charger';
    presetRow1.appendChild(btnSavePreset);
    presetRow1.appendChild(selectPreset);
    presetRow1.appendChild(btnLoadPreset);
    presetSec.appendChild(presetRow1);

    const presetRow2 = document.createElement('div');
    presetRow2.style.display = 'flex';
    presetRow2.style.gap = '8px';
    presetRow2.style.marginBottom = '6px';
    const btnReset = document.createElement('button');
    btnReset.className = 'btn secondary';
    btnReset.textContent = 'Réinitialiser tous';
    presetRow2.appendChild(btnReset);
    presetSec.appendChild(presetRow2);

    const presetRow3 = document.createElement('div');
    presetRow3.style.display = 'flex';
    presetRow3.style.gap = '8px';
    presetRow3.style.alignItems = 'center';
    const btnExport = document.createElement('button');
    btnExport.className = 'btn';
    btnExport.textContent = 'Exporter JSON';
    const btnImport = document.createElement('button');
    btnImport.className = 'btn';
    btnImport.textContent = 'Importer JSON';
    const btnImportYaml = document.createElement('button');
    btnImportYaml.className = 'btn';
    btnImportYaml.textContent = 'Importer YAML';
    presetRow3.appendChild(btnExport);
    presetRow3.appendChild(btnImport);
    presetRow3.appendChild(btnImportYaml);
    presetSec.appendChild(presetRow3);
    modal.appendChild(presetSec);

    const sep1 = document.createElement('hr');
    sep1.style.border = 'none';
    sep1.style.borderTop = '1px solid #333';
    sep1.style.margin = '12px 0';
    modal.appendChild(sep1);

    const settingsTitle = document.createElement('div');
    settingsTitle.textContent = 'Paramètres';
    settingsTitle.style.fontWeight = '700';
    settingsTitle.style.marginBottom = '8px';
    modal.appendChild(settingsTitle);

    const autosaveSec = document.createElement('div');
    autosaveSec.className = 'modal-section';
    const autoChk = document.createElement('input');
    autoChk.type = 'checkbox';
    autoChk.id = 'optAutoEnable';
    const autoLbl = document.createElement('label');
    autoLbl.htmlFor = 'optAutoEnable';
    autoLbl.textContent = 'Autosave';
    const autoInp = document.createElement('input');
    autoInp.type = 'number';
    autoInp.min = '5';
    autoInp.step = '1';
    autoInp.id = 'optAutoInterval';
    autoInp.title = 'Intervalle (s)';
    autosaveSec.appendChild(autoChk);
    autosaveSec.appendChild(autoLbl);
    autosaveSec.appendChild(autoInp);
    modal.appendChild(autosaveSec);

    // -- Visualizer Settings --
    const vizSec = document.createElement('div');
    vizSec.className = 'modal-section';

    const vizTitle = document.createElement('div');
    vizTitle.textContent = 'Visualisation:';
    vizTitle.style.color = '#ddd';
    vizTitle.style.fontSize = '13px';
    vizTitle.style.marginRight = '8px';

    const vizSelect = document.createElement('select');
    vizSelect.id = 'optVizMode';
    vizSelect.style.padding = '4px';
    vizSelect.style.borderRadius = '4px';
    vizSelect.style.background = '#0f0f0f';
    vizSelect.style.color = '#eee';
    vizSelect.style.border = '1px solid #333';

    const opts = [
        { val: 'spectrum', text: 'Spectrum (Barres)' },
        { val: 'waveform', text: 'Waveform (Graphique)' },
        { val: 'off', text: 'Désactivé' }
    ];
    opts.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.val;
        opt.textContent = o.text;
        vizSelect.appendChild(opt);
    });

    // Default or current value (if stored/global)
    // We'll rely on global 'masterSpectrum' to set/get
    if (masterSpectrum && typeof masterSpectrum.setMode === 'function') {
        // We don't have a direct getState, but we can assume default 'spectrum'
        // Or specific handling in loadOptions
    }

    vizSelect.addEventListener('change', (e) => {
        if (masterSpectrum && typeof masterSpectrum.setMode === 'function') {
            masterSpectrum.setMode(e.target.value);
            // Optionally save this preference to localStorage?
            localStorage.setItem('vizMode', e.target.value);
        }
    });

    // Init from localStorage
    const savedMode = localStorage.getItem('vizMode');
    if (savedMode) {
        vizSelect.value = savedMode;
        if (masterSpectrum) masterSpectrum.setMode(savedMode);
    }

    vizSec.appendChild(vizTitle);
    vizSec.appendChild(vizSelect);
    modal.appendChild(vizSec);
    // -- End Viz Settings --

    const dbgSec = document.createElement('div');
    dbgSec.className = 'modal-section';
    const dbgChk = document.createElement('input');
    dbgChk.type = 'checkbox';
    dbgChk.id = 'optDebug';
    const dbgLbl = document.createElement('label');
    dbgLbl.htmlFor = 'optDebug';
    dbgLbl.textContent = 'Afficher overlay debug';
    dbgSec.appendChild(dbgChk);
    dbgSec.appendChild(dbgLbl);

    const consoleChk = document.createElement('input');
    consoleChk.type = 'checkbox';
    consoleChk.id = 'optConsole';
    const consoleLbl = document.createElement('label');
    consoleLbl.htmlFor = 'optConsole';
    consoleLbl.textContent = 'Logs serveur (bash)';
    consoleLbl.style.marginLeft = '12px';
    dbgSec.appendChild(consoleChk);
    dbgSec.appendChild(consoleLbl);

    modal.appendChild(dbgSec);

    const localSec = document.createElement('div');
    localSec.className = 'modal-section';
    const localChk = document.createElement('input');
    localChk.type = 'checkbox';
    localChk.id = 'optLocalDuringDrag';
    const localLbl = document.createElement('label');
    localLbl.htmlFor = 'optLocalDuringDrag';
    localLbl.textContent = 'Mode local pendant drag';
    localSec.appendChild(localChk);
    localSec.appendChild(localLbl);
    modal.appendChild(localSec);

    const sep2 = document.createElement('hr');
    sep2.style.border = 'none';
    sep2.style.borderTop = '1px solid #333';
    sep2.style.margin = '12px 0';
    modal.appendChild(sep2);

    const camillaTitle = document.createElement('div');
    camillaTitle.textContent = 'Configuration CamillaDSP';
    camillaTitle.style.fontWeight = '700';
    camillaTitle.style.marginBottom = '8px';
    modal.appendChild(camillaTitle);

    const camWsSec = document.createElement('div');
    camWsSec.className = 'modal-section';
    camWsSec.style.flexDirection = 'column';
    camWsSec.style.alignItems = 'stretch';
    const wsLbl = document.createElement('label');
    wsLbl.textContent = 'WebSocket URL (CamillaGUI):';
    wsLbl.style.fontSize = '12px';
    wsLbl.style.marginBottom = '4px';
    const wsInp = document.createElement('input');
    wsInp.type = 'text';
    wsInp.id = 'optCamillaWsUrl';
    wsInp.placeholder = 'ws://localhost:1234/ws';
    wsInp.style.width = '100%';
    wsInp.style.padding = '6px';
    wsInp.style.borderRadius = '6px';
    wsInp.style.border = '1px solid #333';
    wsInp.style.background = '#0f0f0f';
    wsInp.style.color = '#eee';
    camWsSec.appendChild(wsLbl);
    camWsSec.appendChild(wsInp);
    modal.appendChild(camWsSec);

    const camTcpSec = document.createElement('div');
    camTcpSec.className = 'modal-section';
    const hostLbl = document.createElement('label');
    hostLbl.textContent = 'TCP Host:';
    hostLbl.style.fontSize = '12px';
    const hostInp = document.createElement('input');
    hostInp.type = 'text';
    hostInp.id = 'optCamillaHost';
    hostInp.placeholder = '127.0.0.1';
    hostInp.style.width = '120px';
    const portLbl = document.createElement('label');
    portLbl.textContent = 'Port:';
    portLbl.style.fontSize = '12px';
    portLbl.style.marginLeft = '8px';
    const portInp = document.createElement('input');
    portInp.type = 'number';
    portInp.id = 'optCamillaPort';
    portInp.placeholder = '1234';
    portInp.min = '1';
    portInp.max = '65535';
    portInp.style.width = '80px';
    camTcpSec.appendChild(hostLbl);
    camTcpSec.appendChild(hostInp);
    camTcpSec.appendChild(portLbl);
    camTcpSec.appendChild(portInp);
    modal.appendChild(camTcpSec);

    const camBtnSec = document.createElement('div');
    camBtnSec.className = 'modal-section';
    const btnSaveCamilla = document.createElement('button');
    btnSaveCamilla.className = 'btn';
    btnSaveCamilla.textContent = 'Appliquer config CamillaDSP';

    const statusLed = document.createElement('div');
    statusLed.id = 'camillaStatusLed';
    statusLed.style.display = 'inline-block';
    statusLed.style.width = '12px';
    statusLed.style.height = '12px';
    statusLed.style.borderRadius = '50%';
    statusLed.style.marginLeft = '12px';
    statusLed.style.boxShadow = '0 0 4px rgba(0,0,0,0.4)';
    statusLed.style.border = '1px solid #333';
    statusLed.style.transition = 'background-color 0.3s';

    const statusText = document.createElement('span');
    statusText.id = 'camillaStatusText';
    statusText.style.marginLeft = '8px';
    statusText.style.fontSize = '11px';
    statusText.style.color = '#999';

    function updateCamillaStatusUI(status) {
        if (status.connected) {
            statusLed.style.backgroundColor = '#2ecc71';
            statusLed.style.boxShadow = '0 0 8px #2ecc71';
            let parts = [];
            if (status.ws_connected) parts.push('WS');
            if (status.tcp_connected) parts.push('TCP');
            const vol = (typeof status.main_volume_db === 'number' && !Number.isNaN(status.main_volume_db)) ?
                ` | Vol ${status.main_volume_db.toFixed(1)} dB${status.external_volume ? ' (ext)' : ''}` :
                '';
            statusText.textContent = 'Connecté (' + parts.join('+') + ')' + vol;
            statusText.style.color = '#2ecc71';
        } else {
            statusLed.style.backgroundColor = '#e74c3c';
            statusLed.style.boxShadow = '0 0 8px #e74c3c';
            statusText.textContent = 'Déconnecté';
            statusText.style.color = '#e74c3c';
        }
    }

    updateCamillaStatusUI(camillaStatus);
    updateCamillaStatusUI_Callback = updateCamillaStatusUI;

    camBtnSec.appendChild(btnSaveCamilla);
    camBtnSec.appendChild(statusLed);
    camBtnSec.appendChild(statusText);
    modal.appendChild(camBtnSec);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const btnClose = document.createElement('button');
    btnClose.className = 'btn';
    btnClose.textContent = 'Fermer';
    actions.appendChild(btnClose);
    modal.appendChild(actions);

    backdrop.appendChild(modal);

    btnClose.addEventListener('click', () => {
        backdrop.remove();
        updateCamillaStatusUI_Callback = null;
    });
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            backdrop.remove();
            updateCamillaStatusUI_Callback = null;
        }
    });

    btnSavePreset.addEventListener('click', () => {
        const name = prompt('Nom du preset:', 'preset_' + Date.now());
        if (name) {
            send({ type: 'save_preset', payload: { name: name } });
            setTimeout(() => {
                refreshPresetList();
                updatePresetSelect(selectPreset);
            }, 300);
        }
    });

    btnLoadPreset.addEventListener('click', () => {
        const name = selectPreset.value;
        if (name) send({ type: 'load_preset', payload: { name: name } });
    });

    btnReset.addEventListener('click', () => {
        const el = document.getElementById('mixer');
        const items = el.querySelectorAll('.channel');
        items.forEach((chEl, idx) => {
            send({ type: 'set_channel_level', payload: { channel: idx, level_db: 0 } });
            send({ type: 'set_channel_mute', payload: { channel: idx, mute: false } });
            send({ type: 'set_channel_solo', payload: { channel: idx, solo: false } });
        });
    });

    btnExport.addEventListener('click', async() => {
        try {
            const res = await fetch('/api/presets/current');
            const data = await res.json();
            const blob = new Blob([JSON.stringify(data.state, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'camillamixer-state.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) { console.error(e); }
    });

    btnImport.addEventListener('click', () => {
        const inp = document.getElementById('importFile');
        if (inp) inp.click();
    });

    btnImportYaml.addEventListener('click', () => {
        const inp = document.getElementById('importYaml');
        if (inp) inp.click();
    });

    autoChk.addEventListener('change', () => {
        const enabled = autoChk.checked;
        const intervalVal = parseFloat(autoInp.value) || autosaveInterval;
        send({ type: 'set_autosave', payload: { enabled, interval_sec: intervalVal } });
    });
    autoInp.addEventListener('change', () => {
        const v = parseFloat(autoInp.value);
        if (Number.isFinite(v) && v > 0) {
            send({ type: 'set_autosave', payload: { enabled: autoChk.checked, interval_sec: v } });
        }
    });
    dbgChk.addEventListener('change', () => { setDebugEnabled(dbgChk.checked); });
    consoleChk.addEventListener('change', async() => {
        try {
            await fetch('/api/logging', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ console_enabled: consoleChk.checked })
            });
        } catch (e) { console.error(e); }
    });
    localChk.addEventListener('change', () => {
        const localBox = document.getElementById('localDuringDrag');
        if (localBox) localBox.checked = localChk.checked;
    });

    btnSaveCamilla.addEventListener('click', async() => {
        const wsUrl = wsInp.value.trim();
        const host = hostInp.value.trim() || '127.0.0.1';
        const port = parseInt(portInp.value) || 1234;
        try {
            const res = await fetch('/api/camilla_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ws_url: wsUrl, host: host, port: port })
            });
            if (!res.ok) throw new Error('Config failed: ' + res.statusText);
            const data = await res.json();
            alert('Configuration CamillaDSP appliquée. Redémarrage du backend requis pour effet complet.');
            log('CamillaDSP config:', data);
        } catch (e) {
            alert('Erreur config CamillaDSP: ' + e.message);
            console.error(e);
        }
    });

    autoChk.checked = !!autosaveEnabled;
    autoInp.value = autosaveInterval;
    dbgChk.checked = !!getDebugEnabled();
    fetch('/api/logging').then(r => r.json()).then(d => { consoleChk.checked = d.console_enabled; }).catch(e => console.error(e));
    const localBox = document.getElementById('localDuringDrag');
    localChk.checked = localBox ? !!localBox.checked : false;

    fetch('/api/camilla_config').then(r => r.json()).then(data => {
        if (data.ws_url) wsInp.value = data.ws_url;
        if (data.host) hostInp.value = data.host;
        if (data.port) portInp.value = data.port;
        if (data.status) updateCamillaStatusUI(data.status);
    }).catch(e => console.error('Failed to load CamillaDSP config:', e));

    document.body.appendChild(backdrop);
}

export function initUIHandlers() {
    const importFile = document.getElementById('importFile');
    if (importFile) {
        importFile.addEventListener('change', async(ev) => {
            const f = ev.target.files[0];
            if (!f) return;
            const txt = await f.text();
            try {
                const obj = JSON.parse(txt);
                const name = prompt('Nom du preset:', 'import_' + Date.now());
                if (name) {
                    await fetch('/api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, state: obj }) });
                    setTimeout(refreshPresetList, 200);
                }
                ev.target.value = '';
            } catch (e) {
                alert('JSON invalide');
                console.error(e);
            }
        });
    }

    const importYaml = document.getElementById('importYaml');
    if (importYaml) {
        importYaml.addEventListener('change', async(ev) => {
            const f = ev.target.files[0];
            if (!f) return;
            const txt = await f.text();
            const name = prompt('Nom du preset:', f.name.replace(/\.(yml|yaml)$/i, '') || ('yaml_' + Date.now()));
            if (name) {
                try {
                    const formData = new FormData();
                    formData.append('file', new Blob([txt], { type: 'text/yaml' }), f.name);
                    const url = '/api/import_yaml?name=' + encodeURIComponent(name);
                    const res = await fetch(url, { method: 'POST', body: formData });
                    if (!res.ok) throw new Error('Import échoué: ' + res.statusText);
                    const data = await res.json();
                    log('YAML importé:', data.mapping);
                    setTimeout(refreshPresetList, 300);
                } catch (e) {
                    alert('Erreur import YAML: ' + e.message);
                    console.error(e);
                }
            }
            ev.target.value = '';
        });
    }
}

export function updateSpectrum(payload) {
    if (masterSpectrum && typeof masterSpectrum.receiveData === 'function') {
        masterSpectrum.receiveData(payload);
    }
}

export function initUI() {
    // Spectrum Visualizer
    const spectrumContainer = document.getElementById('spectrumContainer');
    if (spectrumContainer) {
        const spectrum = createSpectrumVisualizer(64);
        spectrumContainer.appendChild(spectrum.element);
        masterSpectrum = spectrum;

        // Restore saved mode
        const savedMode = localStorage.getItem('vizMode');
        if (savedMode && spectrum.setMode) {
            spectrum.setMode(savedMode);
        }
    }

    // Controls (Options button)
    const controls = document.getElementById('controls');
    if (controls) {
        const optBtn = document.createElement('button');
        optBtn.className = 'btn';
        optBtn.textContent = 'Options';
        optBtn.addEventListener('click', openOptionsModal);
        controls.appendChild(optBtn);

        // hidden checkbox for localDuringDrag
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.id = 'localDuringDrag';
        chk.style.display = 'none';
        controls.appendChild(chk);
    }

    // Debug Overlay
    if (getDebugEnabled()) ensureDebugOverlay();

    // Master Section
    const masterContainer = document.getElementById('master');
    if (masterContainer) {
        masterContainer.innerHTML = '';
        const masterSection = createMasterSection();
        masterContainer.appendChild(masterSection);
        // Initialize master slider
        const masterSlider = document.getElementById('master-slider');
        if (masterSlider && typeof masterSlider._setValue === 'function') {
            requestAnimationFrame(() => masterSlider._setValue(0));
        }
    }

    refreshPresetList();
}