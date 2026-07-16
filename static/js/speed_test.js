const canvas = document.getElementById("gauge-canvas");
const ctx = canvas.getContext("2d");
const runBtn = document.getElementById("run-test-btn");
const statusText = document.getElementById("status-text");

const centerX = canvas.width / 2;
const centerY = canvas.height * 0.85;
const radius = canvas.width * 0.4;
const MAX_MBPS = 200; // gauge ust siniri, gerekirse degistir

function drawGauge(valueMbps) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const startAngle = Math.PI;
  const endAngle = 2 * Math.PI;

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, startAngle, endAngle);
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#23242f";
  ctx.stroke();

  const ratio = Math.min(valueMbps / MAX_MBPS, 1);
  const valueAngle = startAngle + ratio * Math.PI;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, startAngle, valueAngle);
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#8b7fe0";
  ctx.lineCap = "round";
  ctx.stroke();
}

function animateGauge(target) {
  let current = 0;
  const step = target / 40 || 1;
  const interval = setInterval(() => {
    current += step;
    if (current >= target) {
      current = target;
      clearInterval(interval);
    }
    drawGauge(current);
    document.getElementById("gauge-num").textContent = current.toFixed(1);
  }, 20);
}

async function runSpeedTest() {
  runBtn.disabled = true;
  statusText.textContent = "Test baslatiliyor, bu birkac saniye surebilir...";
  drawGauge(0);
  document.getElementById("gauge-num").textContent = "0.0";

  try {
    const res = await fetch("/api/speed-test");
    const payload = await res.json();

    if (payload.status !== "success") {
      throw new Error(payload.message || "Bilinmeyen hata");
    }
    const data = payload.data;

    animateGauge(data.download_mbps);
    document.getElementById("val-download").textContent = data.download_mbps;
    document.getElementById("val-upload").textContent = data.upload_mbps;
    document.getElementById("val-ping").textContent = data.ping_ms;
    document.getElementById("val-jitter").textContent = data.jitter_ms;
    statusText.textContent = `Tamamlandi - Sunucu: ${data.server.name}, ${data.server.location}`;

    loadHistory();
  } catch (err) {
    statusText.textContent = "Test basarisiz oldu: " + err.message;
  } finally {
    runBtn.disabled = false;
  }
}

async function loadHistory() {
  const res = await fetch("/api/speed-test/history");
  const payload = await res.json();
  const history = payload.data || [];
  const tbody = document.getElementById("history-body");
  tbody.innerHTML = "";

  history.slice().reverse().forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.timestamp}</td>
      <td>${row.download_mbps}</td>
      <td>${row.upload_mbps}</td>
      <td>${row.ping_ms}</td>
      <td>${row.jitter_ms}</td>
    `;
    tbody.appendChild(tr);
  });
}

runBtn.addEventListener("click", runSpeedTest);
drawGauge(0);
loadHistory();