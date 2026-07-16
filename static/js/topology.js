const canvas = document.getElementById("topology-canvas");
const ctx = canvas.getContext("2d");
const scanBtn = document.getElementById("scan-btn");
const statusText = document.getElementById("topo-status");
const deviceList = document.getElementById("device-list");

let sweepAngle = 0;
let graphData = { nodes: [], edges: [] };

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", () => { resizeCanvas(); draw(); });

function layoutNodes(nodes) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const positioned = [];
  const others = nodes.filter((n) => n.type !== "router");
  const router = nodes.find((n) => n.type === "router");

  if (router) positioned.push({ ...router, x: cx, y: cy });

  const ringRadius = Math.min(cx, cy) * 0.7;
  others.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(others.length, 1);
    positioned.push({
      ...n,
      x: cx + ringRadius * Math.cos(angle),
      y: cy + ringRadius * Math.sin(angle),
    });
  });
  return positioned;
}

function colorForType(type) {
  if (type === "router") return "#8b7fe0";
  if (type === "this_device") return "#3ecb6e";
  return "#3ecbd9";
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxR = Math.min(cx, cy) * 0.9;

  ctx.strokeStyle = "rgba(139,127,224,0.12)";
  [0.33, 0.66, 1].forEach((f) => {
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * f, 0, 2 * Math.PI);
    ctx.stroke();
  });

  if (ctx.createConicGradient) {
    const grad = ctx.createConicGradient(sweepAngle, cx, cy);
    grad.addColorStop(0, "rgba(139,127,224,0.25)");
    grad.addColorStop(0.05, "rgba(139,127,224,0)");
    grad.addColorStop(1, "rgba(139,127,224,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, 0, 2 * Math.PI);
    ctx.fill();
  }

  const positioned = layoutNodes(graphData.nodes);
  const byId = Object.fromEntries(positioned.map((n) => [n.id, n]));

  ctx.strokeStyle = "rgba(201,202,214,0.25)";
  ctx.lineWidth = 1.5;
  graphData.edges.forEach((e) => {
    const from = byId[e.from];
    const to = byId[e.to];
    if (!from || !to) return;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });

  positioned.forEach((n) => {
    const r = n.type === "router" ? 12 : 8;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = colorForType(n.type);
    ctx.fill();

    ctx.fillStyle = "#c9cad6";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(n.label, n.x, n.y + r + 14);
  });
}

function animateSweep() {
  sweepAngle += 0.015;
  draw();
  requestAnimationFrame(animateSweep);
}

function renderDeviceList() {
  deviceList.innerHTML = "";
  graphData.nodes
    .filter((n) => n.type !== "router")
    .forEach((n) => {
      const div = document.createElement("div");
      div.className = "device-card";
      div.innerHTML = `
        <div class="name">${n.label}</div>
        <div class="ip">IP: ${n.ip || "-"}</div>
        <div class="mac">MAC: ${n.mac || "-"}</div>
      `;
      deviceList.appendChild(div);
    });
}

async function scanNetwork() {
  scanBtn.disabled = true;
  statusText.textContent = "Ag taraniyor...";
  try {
    const res = await fetch("/api/topology");
    const payload = await res.json();

    if (payload.status !== "success") {
      throw new Error(payload.message || "Bilinmeyen hata");
    }
    graphData = payload.data;
    statusText.textContent = `${graphData.nodes.length - 1} cihaz bulundu - ${graphData.scanned_at}`;
    renderDeviceList();
  } catch (err) {
    statusText.textContent = "Tarama basarisiz: " + err.message;
  } finally {
    scanBtn.disabled = false;
  }
}

scanBtn.addEventListener("click", scanNetwork);
resizeCanvas();
animateSweep();
scanNetwork();