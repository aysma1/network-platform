const btn               = document.getElementById('btn-scan');
const tbody             = document.getElementById('device-table');
const ipRangeBadge      = document.getElementById('ip-range');
const myIpBadge         = document.getElementById('my-ip');
const deviceCountBadge  = document.getElementById('device-count');
const autoTimerBadge    = document.getElementById('auto-timer');
const autoScanToggle    = document.getElementById('auto-scan-toggle');
const scanGroupContainer= document.getElementById('scan-group-container');
const lastScanTimeDiv   = document.getElementById('last-scan-time');

const filterIp       = document.getElementById('filter-ip');
const filterHostname = document.getElementById('filter-hostname');
const filterMac      = document.getElementById('filter-mac');
const filterVendor   = document.getElementById('filter-vendor');
const filterSecurity = document.getElementById('filter-security');
const filterDevtype  = document.getElementById('filter-devtype');
const filterTagsEl   = document.getElementById('active-filter-tags');
const resetBtn       = document.getElementById('btn-filter-reset');

const CRITICAL_PORTS = [21, 22, 23, 139, 445, 3389];
const DEVICE_TYPE_KEYWORDS = {
    windows: ['windows'], linux: ['linux'], ios: ['ios', 'macos', 'apple'],
    android: ['android', 'mobile'], router: ['router', 'gateway'],
    printer: ['printer'], camera: ['camera', 'nvr'],
    vm: ['virtual'], iot: ['iot', 'unknown', 'node'],
};

let localDevices = [], countdown = 120, timerInterval;
let activePingIntervals = {};

// ── Filtre ────────────────────────────────────────────────
function getFilterState() {
    return {
        ip: filterIp.value.trim().toLowerCase(),
        hostname: filterHostname.value.trim().toLowerCase(),
        mac: filterMac.value.trim().toLowerCase(),
        vendor: filterVendor.value.trim().toLowerCase(),
        security: filterSecurity.value,
        devtype: filterDevtype.value,
    };
}

function applyFilters() {
    const f = getFilterState();
    const hasAny = f.ip || f.hostname || f.mac || f.vendor ||
                   f.security !== 'all' || f.devtype !== 'all';
    resetBtn.disabled = !hasAny;
    renderFilterTags(f);
    const filtered = localDevices.filter(d => {
        const ip = d.ip || '';
        const hostname = (d.name || '').toLowerCase();
        const mac = (d.mac || '').toLowerCase();
        const vendor = (d.properties.vendor || '').toLowerCase();
        const devType = (d.device_type || '').toLowerCase();
        const hasCritical = (d.properties.open_ports || []).some(p => CRITICAL_PORTS.includes(p.port));
        if (f.ip && !ip.includes(f.ip)) return false;
        if (f.hostname && !hostname.includes(f.hostname)) return false;
        if (f.mac && !mac.includes(f.mac)) return false;
        if (f.vendor && !vendor.includes(f.vendor)) return false;
        if (f.security === 'danger' && !hasCritical) return false;
        if (f.security === 'safe' && hasCritical) return false;
        if (f.devtype !== 'all') {
            const kws = DEVICE_TYPE_KEYWORDS[f.devtype] || [];
            if (!kws.some(k => devType.includes(k))) return false;
        }
        return true;
    });
    deviceCountBadge.innerText = `${filtered.length} Nodes`;
    renderTable(filtered);
}

function renderFilterTags(f) {
    const labels = {
        ip: { label: 'IP', val: f.ip }, hostname: { label: 'Hostname', val: f.hostname },
        mac: { label: 'MAC', val: f.mac }, vendor: { label: 'Vendor', val: f.vendor },
        security: { label: 'Status', val: f.security !== 'all' ? f.security : '' },
        devtype: { label: 'Type', val: f.devtype !== 'all' ? f.devtype : '' },
    };
    const tags = Object.entries(labels).filter(([, v]) => v.val);
    filterTagsEl.innerHTML = '';
    if (tags.length === 0) { filterTagsEl.classList.add('d-none'); return; }
    filterTagsEl.classList.remove('d-none');
    tags.forEach(([key, { label, val }]) => {
        const tag = document.createElement('span');
        tag.className = 'filter-tag';
        tag.innerHTML = `${label}: <strong>${val}</strong><span class="remove-tag" data-key="${key}">✕</span>`;
        tag.querySelector('.remove-tag').addEventListener('click', () => clearFilterField(key));
        filterTagsEl.appendChild(tag);
    });
}

function clearFilterField(key) {
    const map = { ip: filterIp, hostname: filterHostname, mac: filterMac, vendor: filterVendor };
    if (map[key]) map[key].value = '';
    else if (key === 'security') filterSecurity.value = 'all';
    else if (key === 'devtype') filterDevtype.value = 'all';
    applyFilters();
}

function resetFilters() {
    filterIp.value = ''; filterHostname.value = '';
    filterMac.value = ''; filterVendor.value = '';
    filterSecurity.value = 'all'; filterDevtype.value = 'all';
    applyFilters();
}

function enableFilterInputs(enable) {
    [filterIp, filterHostname, filterMac, filterVendor, filterSecurity, filterDevtype]
        .forEach(el => el.disabled = !enable);
}

// ── Auto-Scan ─────────────────────────────────────────────
function startAutoScanTimer() {
    clearInterval(timerInterval);
    if (autoScanToggle.checked) {
        scanGroupContainer.classList.remove('disabled-state');
        autoTimerBadge.style.color = '#38bdf8';
        autoTimerBadge.innerHTML = `<i class="fa-solid fa-clock perfect-spin me-1"></i> Auto-Scan: ${countdown}s`;
    }
    timerInterval = setInterval(async () => {
        if (!autoScanToggle.checked) {
            scanGroupContainer.classList.add('disabled-state');
            autoTimerBadge.style.color = '#64748b';
            autoTimerBadge.innerHTML = `<i class="fa-solid fa-pause me-1"></i> Auto-Scan: Disabled`;
            return;
        }
        countdown--;
        if (countdown <= 0) {
            countdown = 120;
            autoTimerBadge.innerHTML = `<i class="fa-solid fa-arrows-rotate perfect-spin me-1"></i> Syncing...`;
            await triggerScan(true);
        } else {
            autoTimerBadge.style.color = '#38bdf8';
            autoTimerBadge.innerHTML = `<i class="fa-solid fa-clock perfect-spin me-1"></i> Auto-Scan: ${countdown}s`;
        }
    }, 1000);
}

// ── Tarama ────────────────────────────────────────────────
async function triggerScan(isSilent = false) {
    const pdfButton = document.getElementById('btn-pdf');
    if (!isSilent) {
        btn.disabled = true;
        enableFilterInputs(false);
        if (pdfButton) pdfButton.disabled = true;
        tbody.innerHTML = `
            <tr><td colspan="6" class="text-center py-5">
                <div class="d-flex justify-content-between align-items-center mx-auto mb-2" style="max-width:450px;">
                    <span class="text-danger fw-bold small" id="progress-status">
                        <i class="fa-solid fa-satellite-dish perfect-spin me-2"></i> [Stage 1/3] Initializing Socket & Resolving Subnet...
                    </span>
                    <span class="text-light small font-monospace fw-bold" id="progress-percent">25%</span>
                </div>
                <div class="mx-auto" style="max-width:450px;">
                    <div class="progress bg-dark border border-secondary" style="height:10px;border-radius:4px;">
                        <div id="progress-bar" class="progress-bar progress-bar-striped progress-bar-animated bg-danger" style="width:25%"></div>
                    </div>
                </div>
            </td></tr>`;
    }
    setTimeout(() => {
        const pb = document.getElementById('progress-bar');
        const ps = document.getElementById('progress-status');
        const pp = document.getElementById('progress-percent');
        if (!isSilent && pb) {
            pb.style.width = '60%';
            if (pp) pp.innerText = '60%';
            if (ps) ps.innerHTML = `<i class="fa-solid fa-network-wired fa-spin me-2"></i> [Stage 2/3] Executing ARP Sweep...`;
        }
    }, 400);
    try {
        const response = await fetch('/api/scan');
        const result = await response.json();
        if (result.status === 'success') {
            const pb = document.getElementById('progress-bar');
            const ps = document.getElementById('progress-status');
            const pp = document.getElementById('progress-percent');
            if (!isSilent && pb) {
                pb.style.width = '100%';
                if (pp) pp.innerText = '100%';
                if (ps) ps.innerHTML = `<i class="fa-solid fa-circle-check text-success me-2"></i> [Stage 3/3] Port Sweep Completed.`;
            }
            ipRangeBadge.innerText = `Active Range: ${result.range}`;
            myIpBadge.innerHTML = `<i class="fa-solid fa-desktop me-1"></i> Your IP: ${result.local_ip}`;
            localDevices = result.data;
            deviceCountBadge.innerText = `${localDevices.length} Nodes`;
            enableFilterInputs(true);
            if (pdfButton) pdfButton.disabled = false;
            setTimeout(() => renderTable(localDevices), 700);
            const now = new Date();
            lastScanTimeDiv.innerHTML = `<i class="fa-solid fa-history me-1"></i> Last Scan: ${now.toTimeString().split(' ')[0]}`;
        }
    } catch (err) {
        const ps = document.getElementById('progress-status');
        if (!isSilent && ps) {
            ps.innerHTML = `<i class="fa-solid fa-circle-xmark text-danger me-2"></i> Fatal: Subnet sweep aborted.`;
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-5">Fatal: API Connectivity Lost.</td></tr>`;
        }
    } finally {
        if (!isSilent) btn.disabled = false;
    }
}

// ── Tablo Render ──────────────────────────────────────────
function buildPortsHtml(openPorts) {
    if (!openPorts || openPorts.length === 0) {
        return { html: `<div class="feature-value port-none-detected font-monospace small"><i class="fa-solid fa-lock me-2"></i>None Detected (Secured Subnet Node)</div>`, hasCritical: false };
    }
    let html = '', hasCritical = false;
    openPorts.forEach(p => {
        if (CRITICAL_PORTS.includes(p.port)) {
            hasCritical = true;
            html += `<span class="badge port-badge port-critical me-2 mb-1"><i class="fa-solid fa-skull me-1"></i>${p.port} (${p.service})</span>`;
        } else {
            html += `<span class="badge port-badge port-neutral me-2 mb-1"><i class="fa-solid fa-door-open me-1"></i>${p.port} (${p.service})</span>`;
        }
    });
    return { html, hasCritical };
}

function renderTable(dataList) {
    tbody.innerHTML = '';
    if (dataList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No nodes matching search criteria.</td></tr>`;
        return;
    }
    dataList.forEach((device, i) => {
        const hostnameStr = device.name ? `<span class="text-light fw-semibold text-break">${device.name}</span>` : `<span class="na-text">N/A</span>`;
        const vendorStr = device.properties.vendor ? `<span>${device.properties.vendor}</span>` : `<span class="na-text">N/A</span>`;
        const macStr = device.mac ? `<span class="font-monospace text-warning small">${device.mac}</span>` : `<span class="na-text">N/A</span>`;
        const { html: portsHtml, hasCritical } = buildPortsHtml(device.properties.open_ports);
        const row = document.createElement('tr');
        row.className = `clickable-row ${hasCritical ? 'row-danger-alert' : 'row-success-alert'}`;
        row.innerHTML = `
            <td><strong>${device.id}</strong></td>
            <td><span class="badge ip-badge font-monospace fs-6 px-2 py-1">${device.ip}</span></td>
            <td>${hostnameStr}</td>
            <td>${macStr}</td>
            <td><span class="vendor-text-wrapper"><i class="fa-solid fa-microchip me-1"></i> ${vendorStr}</span></td>
            <td class="text-end align-middle" style="width:60px;padding-right:20px;">
                <div class="d-flex align-items-center justify-content-end w-100 h-100">
                    <i class="fa-solid fa-angle-down toggle-icon cursor-pointer" style="font-size:1.1rem;"></i>
                </div>
            </td>`;
        tbody.appendChild(row);

        const portBoxStyle = hasCritical ? 'border-color:#ff0033;background-color:#210c0e;' : 'border-color:#22c55e;background-color:#0c2112;';
        const portBoxClass = hasCritical ? 'text-danger' : 'text-success';
        const portBoxIcon  = hasCritical ? 'fa-radiation' : 'fa-shield-halved';
        const detailRow = document.createElement('tr');
        detailRow.className = 'detail-row';
        detailRow.innerHTML = `
            <td colspan="6">
                <div id="wrapper-${i}" class="detail-wrapper">
                    <div class="d-flex flex-column gap-3">
                        <div class="row g-2">
                            <div class="col-md-3"><div class="feature-box">
                                <div class="feature-title">Discovered Class & Type</div>
                                <div class="feature-value text-light fs-6"><i class="fa-solid ${device.device_icon} me-2 text-danger"></i>${device.device_type}</div>
                            </div></div>
                            <div class="col-md-3"><div class="feature-box">
                                <div class="feature-title">OS Signature & Kernel</div>
                                <div class="feature-value text-success fs-6">${device.properties.estimated_os}</div>
                            </div></div>
                            <div class="col-md-3"><div class="feature-box">
                                <div class="feature-title">Link Speed / RSSI</div>
                                <div class="feature-value text-light fs-6">${device.properties.connection_type}</div>
                            </div></div>
                            <div class="col-md-3">
                                <div class="feature-box" style="background-color:#111827;border-color:#1f2937;">
                                    <div class="feature-title" style="color: #00e5ff !important;"><i class="fa-solid fa-gauge-high me-1"></i> Current Latency</div>
                                    <div class="feature-value font-monospace fs-6" style="color: #00ffff !important; font-weight: bold;">${device.properties.latency}</div>
                                </div>
                            </div>
                        </div>
                        <div class="w-100">
                            <div class="feature-box port-box" style="${portBoxStyle}">
                                <div class="feature-title ${portBoxClass} mb-2">
                                    <i class="fa-solid ${portBoxIcon} me-1"></i> Live Automated Port Scan (Mini-Nmap Sweep)
                                </div>
                                <div class="d-flex flex-wrap align-items-center mt-1">${portsHtml}</div>
                            </div>
                        </div>
                        <div class="row g-3">
                            <div class="col-lg-6"><div class="feature-box">
                                <div class="d-flex justify-content-between align-items-center mb-1">
                                    <div class="feature-title m-0"><i class="fa-solid fa-satellite-dish me-1 text-danger"></i> Interactive Ping Engine</div>
                                    <div class="d-flex gap-2">
                                        <button id="ping-btn-${i}" class="btn btn-sm btn-outline-light px-3 py-1" onclick="runPing('${device.ip}',${i})">Execute Ping</button>
                                        <button id="ping-stop-btn-${i}" class="btn btn-sm btn-outline-danger px-3 py-1 d-none" onclick="stopPing(${i})">Stop</button>
                                    </div>
                                </div>
                                <div id="ping-terminal-${i}" class="cmd-terminal">C:\\Users\\admin> Press "Execute Ping" to start...</div>
                            </div></div>
                            <div class="col-lg-6"><div class="feature-box">
                                <div class="d-flex justify-content-between align-items-center mb-1">
                                    <div class="feature-title m-0"><i class="fa-solid fa-plug me-1 text-danger"></i> Remote Telnet Handshake</div>
                                    <div class="d-flex gap-2">
                                        <input type="number" id="port-${i}" class="form-control form-control-sm bg-dark text-white border-secondary text-center font-monospace" value="23" style="width:70px;">
                                        <button class="btn btn-sm btn-outline-light px-3 py-1" onclick="runTelnet('${device.ip}',${i})">Connect</button>
                                    </div>
                                </div>
                                <div id="telnet-terminal-${i}" class="cmd-terminal">Terminal Standby. Pick a port and tap Connect...</div>
                            </div></div>
                        </div>
                    </div>
                </div>
            </td>`;
        tbody.appendChild(detailRow);

        row.addEventListener('click', () => {
            if (window.getSelection().toString().length > 0) return;
            const wrapper = document.getElementById(`wrapper-${i}`);
            const toggleIcon = row.querySelector('.toggle-icon');
            const isOpen = wrapper.classList.contains('open');
            wrapper.classList.toggle('open', !isOpen);
            row.classList.toggle('active', !isOpen);
            if (toggleIcon) toggleIcon.classList.toggle('rotated', !isOpen);
        });
    });
}

// ── Ping ──────────────────────────────────────────────────
async function runPing(ip, index) {
    const term = document.getElementById(`ping-terminal-${index}`);
    const startBtn = document.getElementById(`ping-btn-${index}`);
    const stopBtn = document.getElementById(`ping-stop-btn-${index}`);
    if (activePingIntervals[index]) return;
    startBtn.disabled = true; startBtn.innerText = "Running...";
    stopBtn.classList.remove('d-none');
    term.innerHTML = `C:\\Users\\admin> ping ${ip} -t\n\n`;
    activePingIntervals[index] = setInterval(async () => {
        try {
            const res = await (await fetch('/api/ping', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ip }) })).json();
            const line = res.status === 'success'
                ? (res.output.split('\n').find(l => l.toLowerCase().includes('reply') || l.toLowerCase().includes('bytes from') || l.toLowerCase().includes('timed out')) || "Request timed out.")
                : "Request timed out.";
            term.innerHTML += line + "\n";
        } catch { term.innerHTML += "Transmission failure.\n"; }
        term.scrollTop = term.scrollHeight;
    }, 1000);
}

function stopPing(index) {
    if (activePingIntervals[index]) { clearInterval(activePingIntervals[index]); delete activePingIntervals[index]; }
    const term = document.getElementById(`ping-terminal-${index}`);
    const startBtn = document.getElementById(`ping-btn-${index}`);
    const stopBtn = document.getElementById(`ping-stop-btn-${index}`);
    startBtn.disabled = false; startBtn.innerText = "Execute Ping";
    stopBtn.classList.add('d-none');
    term.innerHTML += `\n--- Stopped ---\nC:\\Users\\admin> `;
    term.scrollTop = term.scrollHeight;
}

// ── Telnet ────────────────────────────────────────────────
async function runTelnet(ip, index) {
    const term = document.getElementById(`telnet-terminal-${index}`);
    const portVal = document.getElementById(`port-${index}`).value;
    term.innerHTML = `TCP Handshake to port ${portVal}...\n`;
    try {
        const res = await (await fetch('/api/telnet', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ip, port: portVal }) })).json();
        term.innerHTML = res.output;
    } catch { term.innerHTML = "Handshake aborted."; }
}

// ── PDF Export ────────────────────────────────────────────
async function exportNetworkReport() {
    const pdfButton = document.getElementById('btn-pdf');
    pdfButton.disabled = true;
    pdfButton.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Generating...`;
    try {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js");
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('l', 'mm', 'a4');

        // Başlık
        pdf.setFillColor(13, 15, 24);
        pdf.rect(0, 0, 297, 25, 'F');
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.setTextColor(255, 255, 255);
        pdf.text("IP RADAR — NETWORK SCAN REPORT", 14, 16);
        pdf.setFontSize(9);
        pdf.setTextColor(150, 150, 150);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, 200, 16, { align: 'right' });

        // Özet kutuları
        const total   = localDevices.length;
        const danger  = localDevices.filter(d => (d.properties.open_ports || []).some(p => CRITICAL_PORTS.includes(p.port))).length;
        const safe    = total - danger;

        pdf.setFillColor(20, 25, 40);
        pdf.roundedRect(14, 30, 55, 18, 2, 2, 'F');
        pdf.roundedRect(74, 30, 55, 18, 2, 2, 'F');
        pdf.roundedRect(134, 30, 55, 18, 2, 2, 'F');

        pdf.setFontSize(18); pdf.setFont("helvetica", "bold");
        pdf.setTextColor(255, 255, 255); pdf.text(String(total), 41, 42, { align: 'center' });
        pdf.setTextColor(248, 113, 113); pdf.text(String(danger), 101, 42, { align: 'center' });
        pdf.setTextColor(134, 239, 172); pdf.text(String(safe), 161, 42, { align: 'center' });

        pdf.setFontSize(8); pdf.setFont("helvetica", "normal");
        pdf.setTextColor(148, 163, 184);
        pdf.text("TOTAL DEVICES", 41, 46, { align: 'center' });
        pdf.text("CRITICAL PORTS", 101, 46, { align: 'center' });
        pdf.text("SECURED", 161, 46, { align: 'center' });

        // Tablo verisi
        const bodyData = localDevices.map(d => {
            const ports = (d.properties.open_ports || []).map(p => `${p.port}/${p.service}`).join(', ') || '—';
            const hasCrit = (d.properties.open_ports || []).some(p => CRITICAL_PORTS.includes(p.port));
            return [
                d.id,
                d.ip,
                d.name || '—',
                d.mac || '—',
                d.properties.vendor || '—',
                d.device_type || '—',
                d.properties.estimated_os || '—',
                d.properties.latency || '—',
                ports,
                hasCrit ? '⚠ RISK' : '✓ OK',
            ];
        });

        pdf.autoTable({
            head: [['#', 'IP Address', 'Hostname', 'MAC Address', 'Vendor', 'Device Type', 'OS', 'Latency', 'Open Ports', 'Status']],
            body: bodyData,
            startY: 54,
            theme: 'grid',
            styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, valign: 'middle', textColor: [30, 30, 30] },
            headStyles: { fillColor: [255, 0, 51], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            didParseCell(data) {
                if (data.column.index === 9 && data.section === 'body') {
                    data.cell.styles.textColor = data.cell.raw.includes('RISK') ? [220, 38, 38] : [22, 163, 74];
                    data.cell.styles.fontStyle = 'bold';
                }
            },
            columnStyles: {
                0: { cellWidth: 8 }, 1: { cellWidth: 28 }, 2: { cellWidth: 35 },
                3: { cellWidth: 35 }, 4: { cellWidth: 30 }, 5: { cellWidth: 30 },
                6: { cellWidth: 25 }, 7: { cellWidth: 18 }, 8: { cellWidth: 40 }, 9: { cellWidth: 18 }
            },
            margin: { left: 14, right: 14 }
        });

        // Footer
        const pageCount = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);
            pdf.setFontSize(7); pdf.setTextColor(150, 150, 150);
            pdf.text(`Network Platform — IP Radar Report  |  Page ${i} of ${pageCount}`, 148, 205, { align: 'center' });
        }

        pdf.save(`IP_Radar_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
        console.error("PDF error:", err);
    } finally {
        pdfButton.disabled = false;
        pdfButton.innerHTML = `<i class="fa-solid fa-file-pdf me-1"></i> PDF`;
    }
}

function loadScript(src) {
    return new Promise((resolve) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = resolve;
        document.head.appendChild(s);
    });
}

// ── Event Listeners ───────────────────────────────────────
btn.addEventListener('click', async () => { await triggerScan(false); startAutoScanTimer(); });
autoScanToggle.addEventListener('change', () => {
    if (autoScanToggle.checked) {
        countdown = 120;
        scanGroupContainer.classList.remove('disabled-state');
        autoTimerBadge.style.color = '#38bdf8';
        autoTimerBadge.innerHTML = `<i class="fa-solid fa-clock perfect-spin me-1"></i> Auto-Scan: ${countdown}s`;
        startAutoScanTimer();
    } else {
        clearInterval(timerInterval);
        scanGroupContainer.classList.add('disabled-state');
        autoTimerBadge.style.color = '#64748b';
        autoTimerBadge.innerHTML = `<i class="fa-solid fa-pause me-1"></i> Auto-Scan: Disabled`;
    }
});
[filterIp, filterHostname, filterMac, filterVendor].forEach(el => el.addEventListener('input', applyFilters));
[filterSecurity, filterDevtype].forEach(el => el.addEventListener('change', applyFilters));
window.onload = () => { triggerScan(false); startAutoScanTimer(); };