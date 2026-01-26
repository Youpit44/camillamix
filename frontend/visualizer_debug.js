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
        if (useFallback) {
            lastLevelUpdate = Date.now();
            if (typeof val === 'number') {
                masterDb = val;
            } else if (Array.isArray(val)) {
                masterDb = Math.max(...val);
            }
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
        // Robust drawing
        if (width <= 0 || height <= 0) return;

        const points = [];
        for (let i = 0; i < count; i++) {
            let val = 0;
            if (useFallback) {
                // Fallback simulation inside draw loop
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

                    // Smooth
                    if (targetH > ((currentBars[i] + 100) / 100)) {
                        currentBars[i] = (targetH * 100) - 100;
                    } else {
                        // Decay
                        currentBars[i] -= 2.0; // dB decay
                        if (currentBars[i] < -100) currentBars[i] = -100;
                    }
                }

                const safeDb = Math.max(-100, currentBars[i]);
                val = (safeDb + 100) / 100;
            } else {
                // Real Data
                const safeDb = Math.max(-100, currentBars[i]);
                val = (safeDb + 100) / 100;
            }
            // Clamp 0.02 .. 1.0
            points.push(Math.max(0.02, Math.min(1.0, val)));
        }

        ctx.beginPath();
        ctx.moveTo(0, height);

        for (let i = 0; i < count; i++) {
            const x = (i / (count - 1)) * width;
            const y = height - (points[i] * height);
            ctx.lineTo(x, y);
        }

        ctx.lineTo(width, height);
        ctx.closePath();

        // Gradient
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, 'rgba(46, 204, 113, 0.4)');
        gradient.addColorStop(0.5, 'rgba(241, 196, 15, 0.6)');
        gradient.addColorStop(1, 'rgba(231, 76, 60, 0.8)');
        ctx.fillStyle = gradient;
        ctx.fill();

        // Outline
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
            const x = (i / (count - 1)) * width;
            const y = height - (points[i] * height);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
    }

    function drawWaveform(width, height) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#2ecc71';
        ctx.beginPath();

        const midY = height / 2;
        const scaleY = height / 2;

        if (useFallback || !currentSamples || currentSamples.length === 0) {
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
    }

    function tick() {
        if (!ctx) {
            ctx = canvas.getContext('2d');
            if (ctx) console.log('Visualizer context created');
            else {
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