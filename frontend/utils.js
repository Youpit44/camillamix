
let debugEnabled = false;
let consoleEnabled = true;

try{
  const stored = localStorage.getItem('debugEnabled');
  if (stored !== null) debugEnabled = stored === '1';
  const storedConsole = localStorage.getItem('consoleEnabled');
  if (storedConsole !== null) consoleEnabled = storedConsole === '1';
}catch(e){}

export function ensureDebugOverlay(){
  if (!debugEnabled) return null;
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

export function removeDebugOverlay(){
  const d = document.getElementById('dbg');
  if (d && d.parentNode) d.parentNode.removeChild(d);
}

export function setDebugEnabled(flag){
  debugEnabled = !!flag;
  try{ localStorage.setItem('debugEnabled', debugEnabled ? '1' : '0'); }catch(e){}
  if (debugEnabled) ensureDebugOverlay(); else removeDebugOverlay();
}

export function setConsoleEnabled(flag){
  consoleEnabled = !!flag;
  try{ localStorage.setItem('consoleEnabled', consoleEnabled ? '1' : '0'); }catch(e){}
}

export function getConsoleEnabled() {
    return consoleEnabled;
}

export function log(...args){
  if(consoleEnabled) console.log(...args);
}

export function dbg(msg){
  if (!debugEnabled) return;
  const d = ensureDebugOverlay();
  if (d) d.textContent = msg + '\n' + d.textContent;
  try{ if(consoleEnabled) console.debug('[DBG]', msg) }catch(e){}
}

export function getDebugEnabled() {
    return debugEnabled;
}
