const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
let ws;

// debug overlay (dev only)
const DEBUG = true;
function ensureDebugOverlay(){
  if (!DEBUG) return null;
  let d = document.getElementById('dbg');
  if (d) return d;
  d = document.createElement('pre');
  d.id = 'dbg';
  d.style.position = 'fixed';
  d.style.right = '6px';
  d.style.bottom = '6px';
  d.style.background = 'rgba(0,0,0,0.6)';
  d.style.color = '#0f0';
  d.style.padding = '8px';
  d.style.fontSize = '11px';
  d.style.zIndex = 9999;
  d.style.maxWidth = '320px';
  d.style.maxHeight = '40vh';
  d.style.overflow = 'auto';
  d.textContent = '';
  document.body.appendChild(d);
  return d;
}
function dbg(msg){
  if (!DEBUG) return;
  const d = ensureDebugOverlay();
  if (d) d.textContent = msg + '\n' + d.textContent;
  try{ console.debug('[DBG]', msg) }catch(e){}
}

function log(msg) {
  const el = document.getElementById('log');
  el.textContent = msg + '\n' + el.textContent;
}

function createChannelElement(i, state) {
  const c = document.createElement('div');
  c.className = 'channel';
  c.id = 'ch-' + i;
  // header
  const header = document.createElement('div');
  header.className = 'channel-header';
  header.textContent = 'CH ' + (i+1);
  c.appendChild(header);

  // strip container: VU + fader + controls
  const strip = document.createElement('div');
  strip.className = 'strip';
  // VU column (continuous vertical meter)
  const vu = document.createElement('div');
  vu.className = 'vu';
  const vum = document.createElement('div');
  vum.className = 'vumeter';
  const level = document.createElement('div');
  level.className = 'level';
  vum.appendChild(level);
  vu.appendChild(vum);
  strip.appendChild(vu);

  // fader (custom vertical slider)
  const faderWrap = document.createElement('div');
  faderWrap.className = 'fader-wrapper';
  const vslider = document.createElement('div');
  vslider.className = 'vslider';
  vslider.innerHTML = '<div class="track"></div><div class="fill"></div><div class="thumb"></div>';
  // ensure minimum inline sizing so layout exists even if external CSS fails to load
  vslider.style.width = vslider.style.width || '28px';
  vslider.style.height = vslider.style.height || '220px';
  const valueLabel = document.createElement('div');
  valueLabel.className = 'valuelabel';
  faderWrap.appendChild(vslider);
  faderWrap.appendChild(valueLabel);
  strip.appendChild(faderWrap);

  const fill = vslider.querySelector('.fill');
  const thumb = vslider.querySelector('.thumb');
  const track = vslider.querySelector('.track');
  // safety inline styles for track/fill/thumb
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
  const min = -60, max = 12, range = max - min;

  // attach helper to vslider so initialization can be done after element is in DOM
  // helper: robust rect getter with fallback when getBoundingClientRect returns zeros
  function getRectWithFallback(el){
    const r = el.getBoundingClientRect();
    if (r && r.height > 0) return r;
    // fallback: compute top using offsetParent chain and use clientHeight
    let topAcc = 0;
    let node = el;
    while(node){ topAcc += node.offsetTop || 0; node = node.offsetParent; }
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const top = topAcc - scrollY;
    const h = el.clientHeight || parseInt(getComputedStyle(el).height) || 220;
    return { top: top, bottom: top + h, height: h, left: 0, right: 0 };
  }

  vslider._setValue = function(v){
    const pct = Math.max(0, Math.min(1, (v - min) / range));
    // set fill height
    fill.style.height = (pct * 100) + '%';
    // position thumb using pixel top for robustness
    const rect = getRectWithFallback(this);
    const trackTop = 8;
    const trackBottom = rect.height - 8;
    const trackH = Math.max(8, trackBottom - trackTop);
    const thumbCenter = trackTop + (1 - pct) * trackH;
    const th = thumb.offsetHeight || parseInt(thumb.style.height) || 14;
    const ty = (thumbCenter - th / 2);
    // position thumb via transform (translateX + translateY in px) for smoother GPU-accelerated updates
    thumb.style.transform = 'translate(-50%, ' + (ty) + 'px)';
    valueLabel.textContent = Math.round(v * 10) / 10 + ' dB';
  };

  let activePointer = null;
  function pointerToValue(clientY){
    const rect = getRectWithFallback(vslider);
    const trackTop = rect.top + 8;
    const trackBottom = rect.bottom - 8;
    const h = Math.max(8, trackBottom - trackTop);
    let pos = clientY - trackTop;
    pos = Math.max(0, Math.min(h, pos));
    const pct = 1 - (pos / h);
    const value = min + pct * range;
    return {value, pct};
  }

  // unified pointer handlers (works for thumb and track)
  function onPointerDown(ev){
    ev.preventDefault();
    activePointer = ev.pointerId;
    dbg('pointerdown ch'+i+' y='+ev.clientY+' id='+ev.pointerId);
    // try to capture pointer to ensure we receive move/up
    try{ if (vslider.setPointerCapture) vslider.setPointerCapture(ev.pointerId); }catch(e){}
    try{ if (thumb.setPointerCapture) thumb.setPointerCapture(ev.pointerId); }catch(e){}
    // attach global move/up handlers
    function onPointerMove(e){
      if (activePointer !== e.pointerId) return;
      let pv = pointerToValue(e.clientY);
      // if rect measurement fails (height==0) and we have a dragState, compute pct from delta
      try{
        const r = getRectWithFallback(vslider);
        if (r.height <= 0 && vslider._dragState){
          const ds = vslider._dragState;
          const dy = e.clientY - ds.startY;
          let newPct = ds.startPct - (dy / ds.trackH);
          newPct = Math.max(0, Math.min(1, newPct));
          const value = min + newPct * range;
          pv = { value: value, pct: newPct };
        }
      }catch(e){ /* ignore */ }
      dbg('move ch'+i+' y='+e.clientY+' pct='+Math.round(pv.pct*100)+' val='+pv.value.toFixed(2));
      const {value, pct} = pv;
      vslider._setValue(value);
      // extra diagnostics: report slider rect and thumb computed position
      try{
        const r = vslider.getBoundingClientRect();
        const tt = vslider.querySelector('.thumb');
        const fillEl = vslider.querySelector('.fill');
        dbg('rect top='+Math.round(r.top)+' bottom='+Math.round(r.bottom)+' h='+Math.round(r.height)+' thumbTop='+ (tt.style.top||'<none>') + ' offH=' + (tt.offsetHeight||0) + ' fillH=' + (fillEl.style.height||'<none>'));
      }catch(e){ dbg('diag error '+e.message) }
      sendThrottled({type:'set_channel_level', payload:{channel:i, level_db:parseFloat(value)}});
    }
    function onPointerUp(e){
      if (activePointer !== e.pointerId) return;
      dbg('pointerup ch'+i+' id='+e.pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      try{ if (vslider.releasePointerCapture) vslider.releasePointerCapture(e.pointerId); }catch(e){}
      try{ if (thumb.releasePointerCapture) thumb.releasePointerCapture(e.pointerId); }catch(e){}
      activePointer = null;
      vslider._dragState = null;
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    // set initial value
    const pv0 = pointerToValue(ev.clientY);
    vslider._setValue(pv0.value);
    send({type:'set_channel_level', payload:{channel:i, level_db:parseFloat(pv0.value)}})
    // store drag fallback state in case rect measurements are zero
    try{
      const r = getRectWithFallback(vslider);
      const trackH = Math.max(8, (r.height - 16));
      const startPct = pv0.pct;
      vslider._dragState = { startY: ev.clientY, startPct: startPct, trackH: trackH };
    }catch(e){ vslider._dragState = null }
  }
  vslider.addEventListener('pointerdown', onPointerDown);
  // also handle pointerdown on the thumb element
  thumb.addEventListener('pointerdown', onPointerDown);

  // fallback for mouse (in case pointer events behave unexpectedly)
  // mouse fallback for older browsers: attach to both track and thumb
  function onMouseDown(ev){
    ev.preventDefault();
    function onMove(e){
      const pv = pointerToValue(e.clientY);
      dbg('mouse move ch'+i+' y='+e.clientY+' pct='+Math.round(pv.pct*100)+' val='+pv.value.toFixed(2));
      const {value} = pv;
      vslider._setValue(value);
      try{
        const r = vslider.getBoundingClientRect();
        const tt = vslider.querySelector('.thumb');
        const fillEl = vslider.querySelector('.fill');
        dbg('mouse rect top='+Math.round(r.top)+' bottom='+Math.round(r.bottom)+' h='+Math.round(r.height)+' thumbTop='+ (tt.style.top||'<none>') + ' offH=' + (tt.offsetHeight||0) + ' fillH=' + (fillEl.style.height||'<none>'));
      }catch(e){ dbg('diag error '+e.message) }
      sendThrottled({type:'set_channel_level', payload:{channel:i, level_db:parseFloat(value)}});
    }
    function onUp(e){
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    onMove(ev);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  vslider.addEventListener('mousedown', onMouseDown);
  thumb.addEventListener('mousedown', onMouseDown);

  // small controls (gain, eq, mute, solo, reset)
  const ctrlWrap = document.createElement('div');
  ctrlWrap.style.display = 'flex';
  ctrlWrap.style.flexDirection = 'column';
  ctrlWrap.style.gap = '6px';

  const gain = document.createElement('button');
  gain.className = 'btn'; gain.textContent = 'GAIN';
  gain.onclick = ()=>{ alert('GAIN placeholder') }
  ctrlWrap.appendChild(gain);

  const eqHi = document.createElement('button');
  eqHi.className = 'btn'; eqHi.textContent = 'HI';
  eqHi.onclick = ()=>{ alert('HI placeholder') }
  ctrlWrap.appendChild(eqHi);

  const eqLo = document.createElement('button');
  eqLo.className = 'btn'; eqLo.textContent = 'LO';
  eqLo.onclick = ()=>{ alert('LO placeholder') }
  ctrlWrap.appendChild(eqLo);

  const mute = document.createElement('button');
  mute.className = 'btn small'; mute.textContent = 'M';
  if (state.mute) mute.classList.add('state-on');
  mute.onclick = ()=>{ state.mute = !state.mute; if(state.mute) mute.classList.add('state-on'); else mute.classList.remove('state-on'); send({type:'set_channel_mute', payload:{channel:i, mute:!!state.mute}}) }
  ctrlWrap.appendChild(mute);

  const solo = document.createElement('button');
  solo.className = 'btn small'; solo.textContent = 'S';
  if (state.solo) solo.classList.add('state-solo');
  solo.onclick = ()=>{ state.solo = !state.solo; if(state.solo) solo.classList.add('state-solo'); else solo.classList.remove('state-solo'); send({type:'set_channel_solo', payload:{channel:i, solo:!!state.solo}}) }
  ctrlWrap.appendChild(solo);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn'; resetBtn.textContent = 'RST';
  resetBtn.onclick = ()=>{
    send({type:'set_channel_level', payload:{channel:i, level_db:0}})
    send({type:'set_channel_mute', payload:{channel:i, mute:false}})
    send({type:'set_channel_solo', payload:{channel:i, solo:false}})
  }
  ctrlWrap.appendChild(resetBtn);

  strip.appendChild(ctrlWrap);

  c.appendChild(strip);

  return c;
}

function renderMixer(state) {
  const container = document.getElementById('mixer');
  container.innerHTML = '';
  (state.channels || []).forEach((ch, i)=>{
    const el = createChannelElement(i, ch);
    container.appendChild(el);
    // initialize slider position after element is in DOM and after layout
    const vslider = el.querySelector('.vslider');
    if (vslider && typeof vslider._setValue === 'function'){
      requestAnimationFrame(()=> vslider._setValue(ch.level_db || 0));
    }
  })
}

// applyState: update existing DOM with new mixer state without rebuilding elements
function applyState(state){
  (state.channels || []).forEach((ch, i)=>{
    const el = document.getElementById('ch-' + i);
    if (!el) return;
    // update slider value only if user is not actively dragging it
    const vslider = el.querySelector('.vslider');
    if (vslider && typeof vslider._setValue === 'function'){
      if (!vslider._dragState) vslider._setValue(ch.level_db || 0);
    }
    // update mute/solo button visual states if present
    const muteBtn = el.querySelector('.btn.small');
    if (muteBtn){
      if (ch.mute) muteBtn.classList.add('state-on'); else muteBtn.classList.remove('state-on');
    }
    const soloBtn = Array.from(el.querySelectorAll('.btn.small')).find(b=>b.textContent==='S');
    if (soloBtn){
      if (ch.solo) soloBtn.classList.add('state-solo'); else soloBtn.classList.remove('state-solo');
    }
  })
}

function updateLevels(levels) {
  levels.forEach(l => {
    const levelEl = document.querySelector('#ch-' + l.channel + ' .vumeter .level');
    if (levelEl) {
      const v = Math.max(-60, Math.min(12, l.level_db));
      const pct = Math.round(((v + 60) / 72) * 100);
      levelEl.style.height = pct + '%';
    }
  })
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// throttled sender: batch frequent messages (like set_channel_level) while dragging
let _sendTimer = null;
let _sendPending = null;
const SEND_THROTTLE_MS = 80;
function sendThrottled(obj){
  // keep only the latest set_channel_level for a channel to avoid flooding
  if (!obj) return;
  if (obj.type === 'set_channel_level'){
    // merge into pending
    _sendPending = obj;
    if (!_sendTimer){
      _sendTimer = setTimeout(()=>{
        if (_sendPending && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(_sendPending));
        _sendPending = null; _sendTimer = null;
      }, SEND_THROTTLE_MS);
    }
  } else {
    // non-throttled messages go immediately
    send(obj);
  }
}

// decide whether to send now or defer during drag (local-only mode)
function maybeSend(vslider, obj){
  const cb = document.getElementById('localDuringDrag');
  const localOnly = cb ? cb.checked : false;
  if (localOnly){
    // store pending on slider instance; will be flushed on pointerup
    vslider._pendingSend = obj;
  }else{
    sendThrottled(obj);
  }
}

function init() {
  ws = new WebSocket(WS_URL);
  ws.addEventListener('open', ()=>{ log('WS connected'); send({type:'subscribe_levels', payload:{interval_ms:200}}) })
  ws.addEventListener('message', (ev)=>{
    try{
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state'){
        // if mixer DOM not yet created, render full UI, otherwise apply state without rebuilding
        const mixerEl = document.getElementById('mixer');
        if (!mixerEl || mixerEl.children.length === 0) renderMixer(msg.payload);
        else applyState(msg.payload);
      }
      else if (msg.type === 'levels') updateLevels(msg.payload.channels);
      else log('msg: ' + JSON.stringify(msg));
    }catch(e){ console.error(e) }
  })
  ws.addEventListener('close', ()=>log('WS closed'))
}

async function refreshPresetList(){
  try{
    const res = await fetch('/api/presets');
    const data = await res.json();
    const sel = document.getElementById('presetList');
    sel.innerHTML = '';
    (data.presets||[]).forEach(p=>{ const o=document.createElement('option'); o.value=p; o.textContent=p; sel.appendChild(o) })
  }catch(e){ console.error(e) }
}

window.addEventListener('load', ()=>{
  init();
  document.getElementById('savePreset').addEventListener('click', ()=>{
    const name = document.getElementById('presetName').value || ('preset_' + Date.now());
    send({type:'save_preset', payload:{name:name}});
    setTimeout(refreshPresetList, 300);
  })
  document.getElementById('loadPreset').addEventListener('click', ()=>{
    const sel = document.getElementById('presetList');
    const name = sel.value;
    if (name) send({type:'load_preset', payload:{name:name}})
  })
  document.getElementById('resetAll').addEventListener('click', ()=>{
    const el = document.getElementById('mixer');
    // send resets for all channels
    const items = el.querySelectorAll('.channel');
    items.forEach((chEl, idx)=>{
      send({type:'set_channel_level', payload:{channel:idx, level_db:0}})
      send({type:'set_channel_mute', payload:{channel:idx, mute:false}})
      send({type:'set_channel_solo', payload:{channel:idx, solo:false}})
    })
  })
  document.getElementById('exportCurrent').addEventListener('click', async ()=>{
    try{
      const res = await fetch('/api/presets/current');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data.state, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'camillamixer-state.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }catch(e){ console.error(e) }
  })

  document.getElementById('importFile').addEventListener('change', async (ev)=>{
    const f = ev.target.files[0];
    if (!f) return;
    const txt = await f.text();
    try{
      const obj = JSON.parse(txt);
      const name = document.getElementById('presetName').value || ('import_' + Date.now());
      await fetch('/api/presets', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:name, state:obj})});
      setTimeout(refreshPresetList, 200);
    }catch(e){ alert('JSON invalide') }
  })
  refreshPresetList();
})
// init already called in load handler above
