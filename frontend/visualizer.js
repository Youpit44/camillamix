export function createSpectrumVisualizer(count = 28) {
  const wrap = document.createElement('div');
  wrap.className = 'spectrum';
  
  // Create Canvas element
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  wrap.appendChild(canvas);
  
  let ctx = null;
  let width = 0;
  let height = 0;
  
  // Resize observer to handle responsive layout
  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      const rect = entry.contentRect;
      width = rect.width;
      height = rect.height;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
  });
  resizeObserver.observe(wrap);
  
  let masterDb = -60;
  // Per-bar current values for smoothing
  let currentHeights = new Array(count).fill(0);

  function update(val) {
    // Accept master level in dB
    if (typeof val === 'number') {
      masterDb = val;
    } else if (Array.isArray(val)) {
      // Fallback if array passed: max value
      masterDb = Math.max(...val);
    }
  }

  function tick() {
    if (!ctx) {
      ctx = canvas.getContext('2d');
      if (!ctx) {
        requestAnimationFrame(tick);
        return;
      }
    }

    const now = performance.now();
    // Normalize master dB to 0..1 (range -60dB to +12dB)
    const masterMag = Math.max(0, (masterDb + 60) / 72);
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    const barWidth = (width / count) - 2; // 2px gap
    
    // Gradient for bars
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#2ecc71'); // Green bottom
    gradient.addColorStop(0.5, '#f1c40f'); // Yellow mid
    gradient.addColorStop(1, '#e74c3c'); // Red top
    ctx.fillStyle = gradient;

    for (let i = 0; i < count; i++) {
      // Normalized frequency position (0 = bass, 1 = treble)
      const p = i / (count - 1);
      
      // 1. Spectral Shape (Pink Noise-ish): Bass naturally higher than Treble
      // Linear dropoff: 1.0 -> 0.4
      const shape = 1.0 - (p * 0.6);
      
      // 2. Animation / Noise
      // Use sine waves at different frequencies to simulate random movement
      // Bass moves slower, Treble moves faster
      const speed = 0.002 + (p * 0.008); 
      
      // Combine a few sine waves for "random" look
      const n1 = Math.sin((now * speed) + i);
      const n2 = Math.cos((now * speed * 1.3) + (i * 0.5));
      const noise = (n1 + n2 + 2) / 4; // 0..1 roughly
      
      // 3. Calculate Target Height
      // Base height on Master Volume * Shape * Noise
      // Add a non-linear response (square) to make it punchier
      let targetH = Math.pow(masterMag, 1.5) * shape * (0.5 + noise);
      
      // 4. Smoothing / Decay
      // Attack is fast, decay is slower
      if (targetH > currentHeights[i]) {
        currentHeights[i] += (targetH - currentHeights[i]) * 0.3; // Fast attack
      } else {
        currentHeights[i] += (targetH - currentHeights[i]) * 0.1; // Slow decay
      }
      
      // Clamp and draw
      const h = Math.max(0.02, Math.min(1, currentHeights[i]));
      const barHeight = h * height;
      
      // Draw rounded rect (simplified as rect for performance)
      ctx.fillRect(i * (barWidth + 2), height - barHeight, barWidth, barHeight);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return { element: wrap, update };
}
