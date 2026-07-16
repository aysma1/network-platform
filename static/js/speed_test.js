const canvas    = document.getElementById("gauge-canvas");
const ctx       = canvas.getContext("2d");
const runBtn    = document.getElementById("run-test-btn");
const statusEl  = document.getElementById("status-text");

const centerX   = canvas.width  / 2;
const centerY   = canvas.height * 0.85;
const radius    = canvas.width  * 0.4;
const MAX_MBPS  = 200;

// ── Gauge çizimi ──────────────────────────────────────────
function drawGauge(valueMbps) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const startAngle = Math.PI;
    const endAngle   = 2 * Math.PI;

    // Arka plan yayı
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.lineWidth   = 16;
    ctx.strokeStyle = "#1a1f2e";
    ctx.lineCap     = "round";
    ctx.stroke();

    // Değer yayı — gradient (turuncu → sarı)
    const ratio      = Math.min(valueMbps / MAX_MBPS, 1);
    const valueAngle = startAngle + ratio * Math.PI;

    if (ratio > 0) {
        const grad = ctx.createLinearGradient(
            centerX - radius, centerY,
            centerX + radius, centerY
        );
        grad.addColorStop(0,   "#f97316");
        grad.addColorStop(0.5, "#f97316");
        grad.addColorStop(1,   "#facc15");

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, valueAngle);
        ctx.lineWidth   = 16;
        ctx.strokeStyle = grad;
        ctx.lineCap     = "round";
        ctx.stroke();
    }

    // Tick işaretleri
    const ticks = [0, 50, 100, 150, 200];
    ticks.forEach(v => {
        const a   = Math.PI + (v / MAX_MBPS) * Math.PI;
        const x1  = centerX + (radius - 22) * Math.cos(a);
        const y1  = centerY + (radius - 22) * Math.sin(a);
        const x2  = centerX + (radius - 10) * Math.cos(a);
        const y2  = centerY + (radius - 10) * Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth   = 1.5;
        ctx.strokeStyle = "#334155";
        ctx.stroke();

        // Etiket
        const lx = centerX + (radius - 36) * Math.cos(a);
        const ly = centerY + (radius - 36) * Math.sin(a);
        ctx.fillStyle  = "#334155";
        ctx.font       = "9px Consolas, monospace";
        ctx.textAlign  = "center";
        ctx.fillText(v, lx, ly + 3);
    });
}

// ── Gauge animasyonu ──────────────────────────────────────
function animateGauge(target) {
    let current = 0;
    const step  = Math.max(target / 40, 0.5);
    const timer = setInterval(() => {
        current += step;
        if (current >= target) { current = target; clearInterval(timer); }
        drawGauge(current);
        document.getElementById("gauge-num").textContent = current.toFixed(1);
    }, 20);
}

// ── Durum metni ───────────────────────────────────────────
function setStatus(msg, cls = '') {
    statusEl.className = 'speed-status ' + cls;
    statusEl.innerHTML = msg;
}

// ── Hız testi ─────────────────────────────────────────────
async function runSpeedTest() {
    runBtn.disabled = true;
    setStatus('<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Starting test, this may take a few seconds...', 'running');

    drawGauge(0);
    document.getElementById("gauge-num").textContent = "0.0";
    ["download", "upload", "ping", "jitter"].forEach(id => {
        document.getElementById(`val-${id}`).textContent = "—";
    });

    try {
        const res     = await fetch("/api/speed-test");
        const payload = await res.json();

        if (payload.status !== "success") throw new Error(payload.message || "Unknown error");

        const data = payload.data;
        animateGauge(parseFloat(data.download_mbps));
        document.getElementById("val-download").textContent = data.download_mbps;
        document.getElementById("val-upload").textContent   = data.upload_mbps;
        document.getElementById("val-ping").textContent     = data.ping_ms;
        document.getElementById("val-jitter").textContent   = data.jitter_ms;

        const server = data.server
            ? `${data.server.name}, ${data.server.location}`
            : "N/A";
        setStatus(
            `<i class="fa-solid fa-circle-check me-1"></i> Test complete — Server: ${server}`,
            'done'
        );
        loadHistory();
    } catch (err) {
        setStatus(`<i class="fa-solid fa-circle-xmark me-1"></i> Test failed: ${err.message}`, 'error');
    } finally {
        runBtn.disabled = false;
    }
}

// ── Geçmiş ────────────────────────────────────────────────
async function loadHistory() {
    try {
        const res     = await fetch("/api/speed-test/history");
        const payload = await res.json();
        const history = payload.data || [];
        const tbody   = document.getElementById("history-body");

        if (!history.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#334155;padding:20px;">No test history yet</td></tr>`;
            return;
        }

        tbody.innerHTML = [...history].reverse().map(row => `
            <tr>
                <td style="color:#64748b;">${row.timestamp}</td>
                <td class="td-dl">${row.download_mbps}</td>
                <td class="td-ul">${row.upload_mbps}</td>
                <td class="td-ping">${row.ping_ms}</td>
                <td style="color:#facc15;">${row.jitter_ms}</td>
                <td style="color:#475569;font-size:0.75rem;">${row.server?.name || '—'}</td>
            </tr>
        `).join('');
    } catch {
        // Geçmiş yüklenemedi, sessizce geç
    }
}

// ── Init ──────────────────────────────────────────────────
drawGauge(0);
loadHistory();