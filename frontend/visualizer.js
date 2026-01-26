import { send } from './socket.js';

// Simple FFT implementation (Real-valued input, Magnitude output)
// Size must be power of 2
function computeSpectrum(samples, sampleRate = 44100) {
    const n = samples.length;
    let windowed = samples;

    // Ensure power of 2
    if ((n & (n - 1)) !== 0) {
        const p2 = Math.pow(2, Math.floor(Math.log2(n)));
        windowed = samples.slice(0, p2);
    }

    const N = windowed.length;
    // Windowing (Hanning)
    const windowedData = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const win = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
        windowedData[i] = windowed[i] * win;
    }

    // Perform FFT (using a simple implementation)
    const real = new Float32Array(windowedData);
    const imag = new Float32Array(N).fill(0);

    fft(real, imag);

    // Compute magnitude and dB
    const magnitudes = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) {
        const r = real[i];
        const im = imag[i];
        let mag = Math.sqrt(r * r + im * im) / (N / 2); // Normalize
        if (mag < 1e-9) mag = 1e-9;
        magnitudes[i] = 20 * Math.log10(mag); // dB
    }
    return magnitudes;
}

// In-place FFT for power of 2 arrays
function fft(real, imag) {
    const n = real.length;
    if (n <= 1) return;

    // Bit-reverse
    let j = 0;
    for (let i = 0; i < n; i++) {
        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
        let m = n >> 1;
        while (m >= 1 && j >= m) {
            j -= m;
            m >>= 1;
        }
        j += m;
    }

    // Butterfly
    for (let s = 1; s < n; s <<= 1) { // Stage
        const m = s << 1;
        const w_step_r = Math.cos(-Math.PI / s);
        const w_step_i = Math.sin(-Math.PI / s);

        for (let k = 0; k < n; k += m) { // Block
            let wr = 1.0;
            let wi = 0.0;
            for (let j = 0; j < s; j++) {
                const i1 = k + j;
                const i2 = i1 + s;
                const tr = wr * real[i2] - wi * imag[i2];
                const ti = wr * imag[i2] + wi * real[i2];

                real[i2] = real[i1] - tr;
                imag[i2] = imag[i1] - ti;
                real[i1] = real[i1] + tr;
                imag[i1] = imag[i1] + ti;

                // Rotate factor
                const old_wr = wr;
                wr = wr * w_step_r - wi * w_step_i;
                wi = old_wr * w_step_i + wi * w_step_r;
            }
        }
    }
}

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
            if (!ctx) ctx = canvas.getContext('2d');
            if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }
    });
    resizeObserver.observe(wrap);

    // Send subscribe request
    setTimeout(() => {
        send({ type: 'subscribe_spectrum', payload: { enabled: true } });
    }, 1000); // 1s delay to ensure socket open (simple approach)


    let masterDb = -50;
    const currentBars = new Float32Array(count).fill(-100);
    let useFallback = true;
    let lastUpdate = 0;
    let lastLevelUpdate = 0;

    // View mode: 'spectrum' | 'waveform' | 'off'
    let mode = 'spectrum';
    let currentSamples = null;

    function setMode(newMode) {
        mode = newMode;
        if (mode === 'off' && ctx) {
            ctx.clearRect(0, 0, width, height);
        }
    }

    function update(val) {
        if (Date.now() - lastUpdate > 1000) {
            useFallback = true;
        }

        // Always update masterDb (needed for visual scaling)
        if (typeof val === 'number') {
            masterDb = val;
        } else if (Array.isArray(val)) {
            masterDb = Math.max(...val);
        }

        if (useFallback) {
            lastLevelUpdate = Date.now();
        }
    }

    function mapToBars(spectrumDb) {
        const numBins = spectrumDb.length;

        // Freq range settings (approx for 44.1/48k)
        // Bin 0 = DC, Bin 1 ~ 11Hz
        const minIdx = 3; // ~33Hz 
        const maxIdx = Math.min(numBins - 1, 1500); // ~16kHz

        // 3dB/octave tilt compensation (Pink Noise)
        const tiltPerOctave = 3.0;

        // Log scale: bin = exp( log(min) + p * (log(max)-log(min)) )
        const logMin = Math.log(minIdx);
        const logMax = Math.log(maxIdx);

        for (let i = 0; i < count; i++) {
            const pStart = i / count;
            const pEnd = (i + 1) / count;

            let idx1 = Math.floor(Math.exp(logMin + pStart * (logMax - logMin)));
            let idx2 = Math.ceil(Math.exp(logMin + pEnd * (logMax - logMin)));

            if (idx2 > maxIdx) idx2 = maxIdx;
            if (idx1 < minIdx) idx1 = minIdx;
            if (idx1 > idx2) idx2 = idx1;

            let maxVal = -120;
            for (let k = idx1; k <= idx2; k++) {
                // Apply tilt: roughly log2(k) * slope
                // We normalize to minIdx to have 0 tilt at bottom
                const octaves = Math.log2(k / minIdx);
                const tilt = octaves * tiltPerOctave;
                const val = spectrumDb[k] + tilt;
                if (val > maxVal) maxVal = val;
            }

            // Smoothing
            if (maxVal > currentBars[i]) {
                currentBars[i] += (maxVal - currentBars[i]) * 0.5;
            } else {
                currentBars[i] += (maxVal - currentBars[i]) * 0.2; // Slightly faster decay
            }
        }
    }

    function receiveData(payload) {
        if (payload.samples) {
            useFallback = false;
            lastUpdate = Date.now();

            // Store reference/copy of samples
            currentSamples = payload.samples;

            if (mode === 'spectrum') {
                const spec = computeSpectrum(payload.samples);
                mapToBars(spec);
            }
        }
    }

    function drawSpectrum(width, height, barWidth) {
        const points = [];
        for (let i = 0; i < count; i++) {
            let val = 0;
            if (useFallback) {
                // Fallback (simulation)
                const db = currentBars[i];

                if (useFallback) {
                    const now = performance.now();
                    const masterMag = Math.min(1, Math.max(0, (masterDb + 100) / 100)); // 0..1 based on -100..0dB

                    const p = i / (count - 1);
                    const shape = 1.0 - (p * 0.5);
                    const speed = 0.002 + (p * 0.005);
                    const n1 = Math.sin((now * speed) + i);
                    const noise = (n1 + 2) / 3;
                    let targetH = Math.pow(masterMag, 1.2) * shape * (0.3 + noise * 0.7);

                    if (targetH > ((currentBars[i] + 100) / 100)) currentBars[i] = (targetH * 100) - 100;
                    else currentBars[i] -= 2.0;
                    if (currentBars[i] < -100) currentBars[i] = -100;
                }
                const safeDb = Math.max(-100, currentBars[i]);
                val = (safeDb + 100) / 100;
            } else {
                // Real Data
                const safeDb = Math.max(-100, currentBars[i]);
                val = (safeDb + 100) / 100;
            }
            points.push(val);
        }

        // -------------------------------------------------------------
        // DRAW BARS (Not lines) - Restoring ORIGINAL behavior
        // -------------------------------------------------------------

        // Dynamic scaling based on Master Volume (SAME AS WAVEFORM)
        const safeMaster = (typeof masterDb === 'number') ? masterDb : -50;
        const refDb = -20.0;
        // Boost base height at -20dB (x1.5)
        const baseBoost = 1.5;
        const dbDiff = safeMaster - refDb;
        const dynamicFactor = Math.pow(10, dbDiff / 30.0);

        // Create Gradient (Green -> Yellow -> Red)
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#2ecc71'); // Green bottom
        gradient.addColorStop(0.6, '#f1c40f'); // Yellow mid
        gradient.addColorStop(1, '#e74c3c'); // Red top

        ctx.fillStyle = gradient;

        for (let i = 0; i < count; i++) {
            const h = points[i] * height * dynamicFactor * baseBoost;
            const x = i * (barWidth + 2);
            const y = height - h;
            ctx.fillRect(x, y, barWidth, h);
        }
    }

    function drawWaveform(width, height) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#2ecc71';
        // Add glow/shadow for more "volume"
        ctx.shadowBlur = 6;
        ctx.shadowColor = '#2ecc71';

        ctx.beginPath();

        const midY = height / 2;

        // Dynamic Amplification
        const safeMaster = (typeof masterDb === 'number') ? masterDb : -50;

        // Calibration:
        // At -20dB, we want a gain of ~60 (Balanced between "too small" and "too big")
        // We use a modified exponent divisor (30.0) to smooth the growth
        // so it doesn't disappear too fast at low volumes.
        const refDb = -20.0;
        const baseGain = 60.0;
        const dbDiff = safeMaster - refDb; // e.g. 0dB -> +20
        const dynamicFactor = Math.pow(10, dbDiff / 30.0);

        const scaleY = (height / 2) * baseGain * dynamicFactor;

        if (useFallback || !currentSamples || currentSamples.length === 0) {
            ctx.shadowBlur = 0; // Reset glow for text
            // Draw a flat line + text
            ctx.strokeStyle = '#666';
            ctx.moveTo(0, midY);
            ctx.lineTo(width, midY);
            ctx.stroke();

            ctx.fillStyle = '#aaa';
            ctx.font = '12px sans-serif';
            ctx.fillText('Waiting for signal...', 10, 20);
            return;
        }

        const len = currentSamples.length;
        // Interpolate across width
        const ratio = len / width;

        for (let x = 0; x < width; x++) {
            const idx = Math.floor(x * ratio);
            const val = currentSamples[idx >= len ? len - 1 : idx];

            const y = midY - (val * scaleY);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Reset properties
        ctx.shadowBlur = 0;
    }

    let lastLog = 0;

    function tick() {
        if (!ctx) {
            ctx = canvas.getContext('2d');
            if (!ctx) {
                requestAnimationFrame(tick);
                return;
            }
        }

        ctx.clearRect(0, 0, width, height);

        if (mode === 'spectrum') {
            const barWidth = (width / count) - 2;
            drawSpectrum(width, height, barWidth);
        } else if (mode === 'waveform') {
            drawWaveform(width, height);
        }

        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return { element: wrap, update, receiveData, setMode };
}