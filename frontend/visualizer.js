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
            if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }
    });
    resizeObserver.observe(wrap);

    // Send subscribe request
    setTimeout(() => {
        send({ type: 'subscribe_spectrum', payload: { enabled: true } });
    }, 1000); // 1s delay to ensure socket open (simple approach)


    let masterDb = -60;
    const currentBars = new Float32Array(count).fill(-100);
    let useFallback = true;
    let lastUpdate = 0;

    function update(val) {
        if (Date.now() - lastUpdate > 1000) {
            useFallback = true;
        }
        if (useFallback) {
            if (typeof val === 'number') {
                masterDb = val;
            } else if (Array.isArray(val)) {
                masterDb = Math.max(...val);
            }
        }
    }

    function mapToBars(spectrumDb) {
        const numBins = spectrumDb.length;
        // skip DC (0) and Nyquist slightly
        // Map log freq
        const minIdx = 1;
        const maxIdx = numBins - 1;

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
                if (spectrumDb[k] > maxVal) maxVal = spectrumDb[k];
            }

            // Smoothing
            if (maxVal > currentBars[i]) {
                currentBars[i] += (maxVal - currentBars[i]) * 0.5;
            } else {
                currentBars[i] += (maxVal - currentBars[i]) * 0.15;
            }
        }
    }

    function receiveData(payload) {
        if (payload.samples) {
            useFallback = false;
            lastUpdate = Date.now();
            const spec = computeSpectrum(payload.samples);
            mapToBars(spec);
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

        ctx.clearRect(0, 0, width, height);
        const barWidth = (width / count) - 2;

        // Gradient
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#2ecc71');
        gradient.addColorStop(0.5, '#f1c40f');
        gradient.addColorStop(1, '#e74c3c');
        ctx.fillStyle = gradient;

        if (useFallback) {
            // Fallback animation
            const now = performance.now();
            // Updated scale: -80dB to 0dB
            const masterMag = Math.min(1, Math.max(0, (masterDb + 80) / 80));
            for (let i = 0; i < count; i++) {
                const p = i / (count - 1);
                const shape = 1.0 - (p * 0.6);
                const speed = 0.002 + (p * 0.008);
                const n1 = Math.sin((now * speed) + i);
                const n2 = Math.cos((now * speed * 1.3) + (i * 0.5));
                const noise = (n1 + n2 + 2) / 4;
                let targetH = Math.pow(masterMag, 1.5) * shape * (0.5 + noise);

                // Reusing currentBars for fallback smoothing
                if (targetH > currentBars[i]) currentBars[i] += (targetH - currentBars[i]) * 0.3;
                else currentBars[i] += (targetH - currentBars[i]) * 0.1;

                const h = Math.max(0.01, Math.min(1, currentBars[i]));
                ctx.fillRect(i * (barWidth + 2), height - (h * height), barWidth, h * height);
            }
        } else {
            // Real spectrum
            // Range: currentBars is in dB, from -100 to 0. (Usually -120 to 0)
            // Normalize: -80dB -> 0, 0dB -> 1
            for (let i = 0; i < count; i++) {
                const db = currentBars[i];
                let h = (db + 80) / 80;
                h = Math.max(0.01, Math.min(1, h));
                ctx.fillRect(i * (barWidth + 2), height - (h * height), barWidth, h * height);
            }
        }

        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return { element: wrap, update, receiveData };
}