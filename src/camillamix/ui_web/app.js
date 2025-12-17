(() => {
  const DEFAULT_CHANNELS = 8;
  const SEGMENTS = 20;
  const mixer = document.getElementById('mixer');
  const presetListEl = document.getElementById('presetList');
  const presetNameEl = document.getElementById('presetName');
  const saveBtn = document.getElementById('savePreset');
  const loadBtn = document.getElementById('loadPreset');
  const deleteBtn = document.getElementById('deletePreset');
  const themeToggle = document.getElementById('themeToggle');

  let ws;
  let channels = [];

  function createVu(container){
    // create SEGMENTS divs (bottom-first)
    for(let s=0;s<SEGMENTS;s++){
      const div = document.createElement('div');
      div.className = 'vu-seg';
      // color zones
      const ratio = (s+1)/SEGMENTS;
      if (ratio > 0.85) div.classList.add('red');
      else if (ratio > 0.6) div.classList.add('yellow');
      else div.classList.add('green');
      container.appendChild(div);
    }
  }

  // Add pointer/touch drag support to vertical fader wrappers so sliders work reliably
  function attachFaderPointer(wrapper, input) {
    function setFromClientY(clientY) {
      const rect = wrapper.getBoundingClientRect();
      const y = clientY - rect.top;
      let ratio = 1 - (y / rect.height);
      if (Number.isNaN(ratio)) ratio = 0;
      ratio = Math.max(0, Math.min(1, ratio));
      const v = Math.round(ratio * 100);
      if (input.value !== String(v)) {
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    let moving = false;
    function onPointerDown(e) {
      e.preventDefault();
      moving = true;
      attachPointerListeners();
      setFromClientY(e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY));
    }

    function onPointerMove(e) {
      if (!moving) return;
      setFromClientY(e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY));
    }

    function onPointerUp() {
      moving = false;
      detachPointerListeners();
    }

    function attachPointerListeners(){
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    }
    function detachPointerListeners(){
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
    }

    wrapper.addEventListener('pointerdown', onPointerDown);
    wrapper.addEventListener('touchstart', (e) => { e.preventDefault(); onPointerDown(e.touches[0]); }, { passive: false });
  }

  function makeChannel(i){
    const el = document.createElement('div'); el.className='channel';
    // top area: VU + fader
    const top = document.createElement('div'); top.className='ch-top';
    const vu = document.createElement('div'); vu.className='vu-vert';
    createVu(vu);

    const faderWrap = document.createElement('div'); faderWrap.className='fader-wrap';
    const fader = document.createElement('input'); fader.type='range'; fader.min=0; fader.max=100; fader.value=75; fader.className='fader';
    const levelNum = document.createElement('div'); levelNum.className='level-num'; levelNum.innerText=(fader.value/100).toFixed(2);
    fader.addEventListener('input', ()=> { levelNum.innerText=(fader.value/100).toFixed(2); sendControl(i,'volume',+(fader.value/100)); });
    faderWrap.appendChild(fader);
    faderWrap.appendChild(levelNum);
    // ensure fader responds to pointer/touch drag even when rotated/styled
    attachFaderPointer(faderWrap, fader);

    top.appendChild(vu);
    top.appendChild(faderWrap);

    // bottom: name, pan knob, mute/solo
    const bottom = document.createElement('div'); bottom.className='ch-bottom';
    const name = document.createElement('div'); name.className='ch-name';
    const nameInput = document.createElement('input'); nameInput.value=`Ch ${i+1}`;
    nameInput.addEventListener('change', ()=> sendControl(i,'name',nameInput.value));
    name.appendChild(nameInput);

    // rotary pan using a small range to set rotation
    const panWrap = document.createElement('div'); panWrap.className='rotary';
    const knob = document.createElement('div'); knob.className='knob'; knob.textContent='C';
    panWrap.appendChild(knob);
    let panVal = 0; // -1..1
    panWrap.addEventListener('wheel', (ev)=> {
      ev.preventDefault();
      panVal = Math.max(-1, Math.min(1, panVal + (ev.deltaY > 0 ? -0.05 : 0.05)));
      updateKnob();
      sendControl(i,'pan',panVal);
    });
    panWrap.addEventListener('click', ()=> { panVal = (panVal >= 0.9) ? -1 : Math.min(1, panVal + 0.5); updateKnob(); sendControl(i,'pan',panVal); });
    function updateKnob(){ const deg = panVal * 40; knob.style.transform = `rotate(${deg}deg)`; if(Math.abs(panVal)<0.25) knob.textContent='C'; else knob.textContent = panVal>0?'R':'L'; }

    const controls = document.createElement('div'); controls.className='controls';
    const mute = document.createElement('button'); mute.className='btn'; mute.innerText='M';
    const solo = document.createElement('button'); solo.className='btn'; solo.innerText='S';
    mute.addEventListener('click', ()=> { mute.classList.toggle('active'); sendControl(i,'mute',mute.classList.contains('active')); });
    solo.addEventListener('click', ()=> { solo.classList.toggle('active'); sendControl(i,'solo',solo.classList.contains('active')); });

    controls.appendChild(mute); controls.appendChild(solo);

    bottom.appendChild(name);
    bottom.appendChild(panWrap);
    bottom.appendChild(controls);

    el.appendChild(top);
    el.appendChild(bottom);

    // insert before master if present
    const masterRef = document.getElementById('master');
    if (masterRef && masterRef.parentElement === mixer) mixer.insertBefore(el, masterRef);
    else mixer.appendChild(el);

    // collect segment elements for fast update
    const segs = Array.from(vu.querySelectorAll('.vu-seg')).reverse(); // reverse so index 0 = bottom
    channels.push({segs,fader,levelNum,nameInput,panWrap,knob,mute,solo});
    updateKnob();
  }

  function buildMixer(n=DEFAULT_CHANNELS){
    // clear mixing area but keep master element if present
    const masterEl = document.getElementById('master');
    mixer.innerHTML='';
    for(let i=0;i<n;i++) makeChannel(i);
    if(masterEl) mixer.appendChild(masterEl);
  }

  function wsConnect(){
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/ui`;
    ws = new WebSocket(url);
    ws.onopen = ()=> log('WS connecté');
    ws.onmessage = (ev)=> {
      try{
        const msg = JSON.parse(ev.data);
        if(msg.type === 'meters' && Array.isArray(msg.levels)){
          msg.levels.forEach((v,i)=> {
            const ch = channels[i];
            if(!ch) return;
            const lit = Math.round(v * SEGMENTS);
            ch.segs.forEach((seg, idx) => {
              if(idx < lit) seg.style.opacity = '1';
              else seg.style.opacity = '0.14';
            });
          });
        }
      }catch(e){ /* ignore */ }
    };
    ws.onclose = ()=> setTimeout(wsConnect,1500);
    ws.onerror = ()=> {};
  }

  function sendControl(channel, control, value){
    const payload = {type:'control', channel, control, value};
    if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    log(`ch${channel+1} ${control}=${typeof value==='number'?value.toFixed?value.toFixed(2):value:value}`);
  }

  async function fetchPresets(){
    try{
      const r = await fetch('/api/presets');
      const data = await r.json();
      renderPresets(data || {});
    }catch(e){ renderPresets({}); }
  }

  function renderPresets(map){
    presetListEl.innerHTML='';
    Object.keys(map).forEach(name=>{
      const item = document.createElement('div'); item.className='preset-item';
      const l = document.createElement('span'); l.textContent = name;
      const b = document.createElement('div');
      const load = document.createElement('button'); load.className='btn'; load.textContent='Load';
      load.addEventListener('click', ()=> applyPreset(map[name]));
      b.appendChild(load);
      item.appendChild(l); item.appendChild(b);
      presetListEl.appendChild(item);
    });
  }

  async function savePreset(){
    const name = presetNameEl.value.trim();
    if(!name){ alert('Donnez un nom de preset'); return; }
    const data = {channels: channels.map(c=>({
      name: c.nameInput.value,
      volume: +(c.fader.value/100).toFixed(3),
      mute: c.mute.classList.contains('active'),
      solo: c.solo.classList.contains('active'),
      pan: c.knob ? c.knob.textContent : 'C'
    }))};
    await fetch('/api/presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})});
    await fetchPresets();
    log(`Preset "${name}" sauvegardé`);
  }

  function applyPreset(p){
    if(!p || !Array.isArray(p.channels)) return;
    p.channels.forEach((ch,i)=> {
      const c = channels[i];
      if(!c) return;
      if(ch.name !== undefined) c.nameInput.value = ch.name;
      if(ch.volume !== undefined){ c.fader.value = Math.round(ch.volume*100); c.levelNum.innerText = (ch.volume).toFixed(2); sendControl(i,'volume',ch.volume); }
      if(ch.mute !== undefined) c.mute.classList.toggle('active', !!ch.mute);
      if(ch.solo !== undefined) c.solo.classList.toggle('active', !!ch.solo);
      if(ch.pan !== undefined) c.knob && (c.knob.textContent = ch.pan);
    });
    log('Preset appliqué');
  }

  async function deletePreset(){
    const name = presetNameEl.value.trim();
    if(!name) return alert('Indiquez le nom du preset à supprimer');
    await fetch(`/api/presets/${encodeURIComponent(name)}`,{method:'DELETE'});
    await fetchPresets();
    log(`Preset "${name}" supprimé`);
  }

  function log(msg){ const l=document.getElementById('log'); const t=document.createElement('div'); t.className='small'; t.textContent=msg; l.prepend(t); }

  // events
  saveBtn.addEventListener('click', savePreset);
  loadBtn && loadBtn.addEventListener('click', ()=> {
    const n = presetNameEl.value.trim();
    if(!n){ alert('Nom du preset requis'); return; }
    fetch('/api/presets').then(r=>r.json()).then(map=>{ if(map[n]) applyPreset(map[n]); else alert('Preset introuvable'); });
  });
  deleteBtn && deleteBtn.addEventListener('click', deletePreset);
  themeToggle && themeToggle.addEventListener('change', ()=> document.body.classList.toggle('light', themeToggle.checked));

  // init
  buildMixer(DEFAULT_CHANNELS);
  fetchPresets();
  wsConnect();
})();
