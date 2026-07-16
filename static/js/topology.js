const canvas     = document.getElementById("topology-canvas");
const ctx        = canvas.getContext("2d");
const scanBtn    = document.getElementById("scan-btn");
const statusEl   = document.getElementById("topo-status");
const deviceList = document.getElementById("device-list");
const countBadge = document.getElementById("device-count");

let sweepAngle = 0;
let graphData  = { nodes: [], edges: [] };

// ── Canvas boyutlandırma ──────────────────────────────────
function resizeCanvas() {
    canvas.width  = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", () => { resizeCanvas(); draw(); });

// ── Node düzeni ───────────────────────────────────────────
function layoutNodes(nodes) {
    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;
    const positioned = [];
    const router  = nodes.find(n => n.type === "router");
    const others  = nodes.filter(n => n.type !== "router");

    if (router) positioned.push({ ...router, x: cx, y: cy });

    const ringR = Math.min(cx, cy) * 0.68;
    others.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / Math.max(others.length, 1) - Math.PI / 2;
        positioned.push({
            ...n,
            x: cx + ringR * Math.cos(angle),
            y: cy + ringR * Math.sin(angle),
        });
    });
    return positioned;
}

// ── Renk ─────────────────────────────────────────────────
function colorForType(type) {
    if (type === "router")      return "#ff0033";
    if (type === "this_device") return "#4ade80";
    return "#818cf8";
}

// ── Çizim ─────────────────────────────────────────────────
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx   = canvas.width  / 2;
    const cy   = canvas.height / 2;
    const maxR = Math.min(cx, cy) * 0.88;

    // Radar halkaları
    ctx.strokeStyle = "rgba(129,140,248,0.08)";
    ctx.lineWidth   = 1;
    [0.33, 0.66, 1].forEach(f => {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * f, 0, 2 * Math.PI);
        ctx.stroke();
    });

    // Dönen radar taraması
    if (ctx.createConicGradient) {
        const grad = ctx.createConicGradient(sweepAngle, cx, cy);
        grad.addColorStop(0,    "rgba(129,140,248,0.18)");
        grad.addColorStop(0.06, "rgba(129,140,248,0)");
        grad.addColorStop(1,    "rgba(129,140,248,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxR, 0, 2 * Math.PI);
        ctx.fill();
    }

    const positioned = layoutNodes(graphData.nodes);
    const byId = Object.fromEntries(positioned.map(n => [n.id, n]));

    // Edge'ler
    ctx.strokeStyle = "rgba(129,140,248,0.2)";
    ctx.lineWidth   = 1.5;
    graphData.edges.forEach(e => {
        const from = byId[e.from];
        const to   = byId[e.to];
        if (!from || !to) return;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x,   to.y);
        ctx.stroke();
    });

    // Node'lar
    positioned.forEach(n => {
        const r     = n.type === "router" ? 13 : 8;
        const color = colorForType(n.type);

        // Glow halkası
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 5, 0, 2 * Math.PI);
        ctx.fillStyle = color.replace(")", ",0.12)").replace("rgb", "rgba");
        ctx.fill();

        // Ana daire
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        // Label
        ctx.fillStyle  = "#94a3b8";
        ctx.font       = "11px 'Segoe UI', monospace";
        ctx.textAlign  = "center";
        const label    = n.label.length > 16 ? n.label.slice(0, 14) + "…" : n.label;
        ctx.fillText(label, n.x, n.y + r + 14);
    });
}

function animateSweep() {
    sweepAngle += 0.015;
    draw();
    requestAnimationFrame(animateSweep);
}

// ── Cihaz listesi ─────────────────────────────────────────
function renderDeviceList() {
    const nonRouter = graphData.nodes.filter(n => n.type !== "router");
    countBadge.textContent = nonRouter.length;

    if (!nonRouter.length) {
        deviceList.innerHTML = `
            <div style="color:#334155;font-size:0.82rem;grid-column:1/-1;text-align:center;padding:24px 0;">
                <i class="fa-solid fa-diagram-project d-block mb-2" style="font-size:1.8rem;color:#1a1f2e;"></i>
                No devices found
            </div>`;
        return;
    }

    deviceList.innerHTML = nonRouter.map(n => `
        <div class="topo-device-card">
            <div class="dc-name">
                <i class="fa-solid fa-${n.type === 'this_device' ? 'desktop' : 'circle-nodes'} me-1"
                   style="color:${colorForType(n.type)};font-size:0.75rem;"></i>
                ${n.label}
            </div>
            <div class="dc-ip">IP: ${n.ip  || '—'}</div>
            <div class="dc-mac">MAC: ${n.mac || '—'}</div>
            <div class="dc-type">${n.type === 'this_device' ? 'This Device' : n.device_type || 'Network Node'}</div>
        </div>
    `).join('');
}

// ── Durum metni ───────────────────────────────────────────
function setStatus(msg, cls = '') {
    statusEl.className = 'topo-status ' + cls;
    statusEl.innerHTML = msg;
}

// ── Ağ tarama ─────────────────────────────────────────────
async function scanNetwork() {
    scanBtn.disabled = true;
    setStatus('<i class="fa-solid fa-satellite-dish fa-spin me-1"></i> Scanning network...', 'scanning');

    try {
        const res     = await fetch("/api/topology");
        const payload = await res.json();

        if (payload.status !== "success") throw new Error(payload.message || "Unknown error");

        graphData = payload.data;
        const deviceCount = graphData.nodes.filter(n => n.type !== "router").length;
        setStatus(
            `<i class="fa-solid fa-circle-check me-1"></i> ${deviceCount} device${deviceCount !== 1 ? 's' : ''} discovered — ${graphData.scanned_at}`,
            'done'
        );
        renderDeviceList();
    } catch (err) {
        setStatus(`<i class="fa-solid fa-circle-xmark me-1"></i> Scan failed: ${err.message}`, 'error');
    } finally {
        scanBtn.disabled = false;
    }
}

// ── Init ──────────────────────────────────────────────────
resizeCanvas();
animateSweep();
scanNetwork();