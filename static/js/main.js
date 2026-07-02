const btn               = document.getElementById('btn-scan');
const tbody             = document.getElementById('device-table');
const ipRangeBadge      = document.getElementById('ip-range');
const myIpBadge         = document.getElementById('my-ip');
const deviceCountBadge  = document.getElementById('device-count');
const autoTimerBadge    = document.getElementById('auto-timer');
const autoScanToggle    = document.getElementById('auto-scan-toggle');
const scanGroupContainer= document.getElementById('scan-group-container');
const lastScanTimeDiv   = document.getElementById('last-scan-time');

// ── Filtre alanları ────────────────────────────────────────
const filterIp       = document.getElementById('filter-ip');
const filterHostname = document.getElementById('filter-hostname');
const filterMac      = document.getElementById('filter-mac');
const filterVendor   = document.getElementById('filter-vendor');
const filterSecurity = document.getElementById('filter-security');
const filterDevtype  = document.getElementById('filter-devtype');
const filterTagsEl   = document.getElementById('active-filter-tags');
const resetBtn       = document.getElementById('btn-filter-reset');

const DEVICE_TYPE_KEYWORDS = {
    windows: ['windows'],
    linux:   ['linux'],
    ios:     ['ios', 'macos', 'apple'],
    android: ['android', 'mobile'],
    router:  ['router', 'gateway'],
    printer: ['printer'],
    camera:  ['camera', 'nvr'],
    vm:      ['virtual'],
    iot:     ['iot', 'unknown', 'node'],
};

function getFilterState() {
    return {
        ip:       filterIp.value.trim().toLowerCase(),
        hostname: filterHostname.value.trim().toLowerCase(),
        mac:      filterMac.value.trim().toLowerCase(),
        vendor:   filterVendor.value.trim().toLowerCase(),
        security: filterSecurity.value,
        devtype:  filterDevtype.value,
    };
}

function applyFilters() {
    const f = getFilterState();
    const hasAny = f.ip || f.hostname || f.mac || f.vendor ||
                   f.security !== 'all' || f.devtype !== 'all';

    resetBtn.disabled = !hasAny;
    renderFilterTags(f);

    const filtered = localDevices.filter(d => {
        const ip       = d.ip || '';
        const hostname = (d.name || '').toLowerCase();
        const mac      = (d.mac || '').toLowerCase();
        const vendor   = (d.properties.vendor || '').toLowerCase();
        const devType  = (d.device_type || '').toLowerCase();

        // Open port'ları tara — kritik port var mı?
        const hasCritical = (d.properties.open_ports || [])
            .some(p => CRITICAL_PORTS.includes(p.port));

        if (f.ip       && !ip.includes(f.ip))           return false;
        if (f.hostname && !hostname.includes(f.hostname)) return false;
        if (f.mac      && !mac.includes(f.mac))           return false;
        if (f.vendor   && !vendor.includes(f.vendor))     return false;

        if (f.security === 'danger' && !hasCritical) return false;
        if (f.security === 'safe'   &&  hasCritical) return false;

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
        ip:       { label: 'IP',       val: f.ip },
        hostname: { label: 'Hostname', val: f.hostname },
        mac:      { label: 'MAC',      val: f.mac },
        vendor:   { label: 'Vendor',   val: f.vendor },
        security: { label: 'Status',   val: f.security !== 'all' ? f.security : '' },
        devtype:  { label: 'Type',     val: f.devtype  !== 'all' ? f.devtype  : '' },
    };

    const tags = Object.entries(labels).filter(([, v]) => v.val);
    filterTagsEl.innerHTML = '';
    if (tags.length === 0) {
        filterTagsEl.classList.add('d-none');
        return;
    }
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
    if (map[key]) {
        map[key].value = '';
    } else if (key === 'security') {
        filterSecurity.value = 'all';
    } else if (key === 'devtype') {
        filterDevtype.value = 'all';
    }
    applyFilters();
}

function resetFilters() {
    filterIp.value       = '';
    filterHostname.value = '';
    filterMac.value      = '';
    filterVendor.value   = '';
    filterSecurity.value = 'all';
    filterDevtype.value  = 'all';
    applyFilters();
}

function enableFilterInputs(enable) {
    [filterIp, filterHostname, filterMac, filterVendor, filterSecurity, filterDevtype]
        .forEach(el => el.disabled = !enable);
}

const CRITICAL_PORTS    = [21, 22, 23, 139, 445, 3389];

let localDevices        = [];
let countdown           = 120;
let timerInterval;
let activePingIntervals = {};

// ── Auto-Scan Zamanlayıcısı ────────────────────────────────

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

// ── Tarama Tetikleyici ────────────────────────────────────

async function triggerScan(isSilent = false) {
    const pdfButton = document.getElementById('btn-pdf');

    if (!isSilent) {
        btn.disabled = true;
        enableFilterInputs(false);
        if (pdfButton) pdfButton.disabled = true;

        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-5">
                    <div class="d-flex justify-content-between align-items-center mx-auto mb-2" style="max-width: 450px;">
                        <span class="text-danger fw-bold small" id="progress-status">
                            <i class="fa-solid fa-radar perfect-spin me-2"></i> [Stage 1/3] Initializing Socket & Resolving Subnet...
                        </span>
                        <span class="text-light small font-monospace fw-bold" id="progress-percent">25%</span>
                    </div>
                    <div class="mx-auto" style="max-width: 450px;">
                        <div class="progress bg-dark border border-secondary" style="height: 10px; border-radius: 4px;">
                            <div id="progress-bar" class="progress-bar progress-bar-striped progress-bar-animated bg-danger" role="progressbar" style="width: 25%"></div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    setTimeout(() => {
        const progressBar    = document.getElementById('progress-bar');
        const progressStatus = document.getElementById('progress-status');
        const progressPercent= document.getElementById('progress-percent');
        if (!isSilent && progressBar) {
            progressBar.style.width = '60%';
            if (progressPercent) progressPercent.innerText = '60%';
            if (progressStatus) progressStatus.innerHTML =
                `<i class="fa-solid fa-network-wired fa-spin me-2"></i> [Stage 2/3] Executing ARP Sweep & Identifying Live Nodes...`;
        }
    }, 400);

    try {
        const response = await fetch('/api/scan');
        const result   = await response.json();

        if (result.status === 'success') {
            const progressBar    = document.getElementById('progress-bar');
            const progressStatus = document.getElementById('progress-status');
            const progressPercent= document.getElementById('progress-percent');

            if (!isSilent && progressBar) {
                progressBar.style.width = '100%';
                if (progressPercent) progressPercent.innerText = '100%';
                if (progressStatus) progressStatus.innerHTML =
                    `<i class="fa-solid fa-circle-check text-success me-2"></i> [Stage 3/3] Port Sweep Completed. Injecting Security Matrix...`;
            }

            ipRangeBadge.innerText = `Active Range: ${result.range}`;
            myIpBadge.innerHTML = `<i class="fa-solid fa-desktop me-1"></i> Your IP: ${result.local_ip}`;
            localDevices = result.data;
            deviceCountBadge.innerText = `${localDevices.length} Nodes`;
            enableFilterInputs(true);
            if (pdfButton) pdfButton.disabled = false;

            setTimeout(() => renderTable(localDevices), 700);

            const now = new Date();
            lastScanTimeDiv.innerHTML =
                `<i class="fa-solid fa-history me-1"></i> Last Scan: ${now.toTimeString().split(' ')[0]}`;
        }
    } catch (err) {
        const progressStatus = document.getElementById('progress-status');
        if (!isSilent && progressStatus) {
            progressStatus.innerHTML = `<i class="fa-solid fa-circle-xmark text-danger me-2"></i> Fatal: Subnet sweep aborted.`;
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-5">Fatal: API Connectivity Lost.</td></tr>`;
        }
    } finally {
        if (!isSilent) btn.disabled = false;
    }
}

// ── Tablo Render ──────────────────────────────────────────

function buildPortsHtml(openPorts) {
    if (!openPorts || openPorts.length === 0) {
        return {
            html: `<div class="feature-value port-none-detected font-monospace small"><i class="fa-solid fa-lock me-2"></i>None Detected (Secured Subnet Node)</div>`,
            hasCritical: false,
        };
    }

    let html = '';
    let hasCritical = false;

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
        const hostnameStr = device.name
            ? `<span class="text-light fw-semibold text-break">${device.name}</span>`
            : `<span class="na-text">N/A</span>`;
        const vendorStr = device.properties.vendor
            ? `<span>${device.properties.vendor}</span>`
            : `<span class="na-text">N/A</span>`;
        const macStr = device.mac
            ? `<span class="font-monospace text-warning small">${device.mac}</span>`
            : `<span class="na-text">N/A</span>`;

        const { html: portsHtml, hasCritical } = buildPortsHtml(device.properties.open_ports);

        const row = document.createElement('tr');
        row.className = `clickable-row ${hasCritical ? 'row-danger-alert' : 'row-success-alert'}`;
        row.innerHTML = `
            <td><strong>${device.id}</strong></td>
            <td><span class="badge ip-badge font-monospace fs-6 px-2 py-1">${device.ip}</span></td>
            <td>${hostnameStr}</td>
            <td>${macStr}</td>
            <td><span class="vendor-text-wrapper"><i class="fa-solid fa-microchip me-1"></i> ${vendorStr}</span></td>
            <td class="text-end align-middle" style="width: 60px; padding-right: 20px;">
                <div class="d-flex align-items-center justify-content-end w-100 h-100">
                    <i class="fa-solid fa-angle-down toggle-icon cursor-pointer" style="font-size: 1.1rem;"></i>
                </div>
            </td>
        `;
        tbody.appendChild(row);

        const portBoxStyle = hasCritical
            ? 'border-color: #ff0033; background-color: #210c0e;'
            : 'border-color: #22c55e; background-color: #0c2112;';
        const portBoxClass  = hasCritical ? 'text-danger' : 'text-success';
        const portBoxIcon   = hasCritical ? 'fa-radiation'  : 'fa-shield-halved';

        const detailRow = document.createElement('tr');
        detailRow.className = 'detail-row';
        detailRow.innerHTML = `
            <td colspan="6">
                <div id="wrapper-${i}" class="detail-wrapper">
                    <div class="d-flex flex-column gap-3">
                        <div class="row g-2">
                            <div class="col-md-3">
                                <div class="feature-box">
                                    <div class="feature-title">Discovered Class & Type</div>
                                    <div class="feature-value text-light fs-6"><i class="fa-solid ${device.device_icon} me-2 text-danger"></i>${device.device_type}</div>
                                </div>
                            </div>
                            <div class="col-md-3">
                                <div class="feature-box">
                                    <div class="feature-title">OS Signature & Kernel</div>
                                    <div class="feature-value text-success fs-6">${device.properties.estimated_os}</div>
                                </div>
                            </div>
                            <div class="col-md-3">
                                <div class="feature-box">
                                    <div class="feature-title">Link Speed / RSSI</div>
                                    <div class="feature-value text-light fs-6">${device.properties.connection_type}</div>
                                </div>
                            </div>
                            <div class="col-md-3">
                                <div class="feature-box" style="background-color: #111827; border-color: #1f2937;">
                                    <div class="feature-title text-info"><i class="fa-solid fa-gauge-high me-1"></i> Current Latency</div>
                                    <div class="feature-value text-info font-monospace fs-6">${device.properties.latency}</div>
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
                            <div class="col-lg-6">
                                <div class="feature-box">
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <div class="feature-title m-0"><i class="fa-solid fa-satellite-dish me-1 text-danger"></i> Interactive Ping Engine (-t mode)</div>
                                        <div class="d-flex gap-2">
                                            <button id="ping-btn-${i}" class="btn btn-sm btn-outline-light px-3 py-1" onclick="runPing('${device.ip}', ${i})">Execute Ping</button>
                                            <button id="ping-stop-btn-${i}" class="btn btn-sm btn-outline-danger px-3 py-1 d-none" onclick="stopPing(${i})">Stop</button>
                                        </div>
                                    </div>
                                    <div id="ping-terminal-${i}" class="cmd-terminal">C:\\Users\\admin> Press "Execute Ping" to start infinite ICMP sequence...</div>
                                </div>
                            </div>
                            <div class="col-lg-6">
                                <div class="feature-box">
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <div class="feature-title m-0"><i class="fa-solid fa-plug me-1 text-danger"></i> Remote Telnet Handshake</div>
                                        <div class="d-flex gap-2">
                                            <input type="number" id="port-${i}" class="form-control form-control-sm bg-dark text-white border-secondary text-center font-monospace" value="23" style="width: 70px;">
                                            <button class="btn btn-sm btn-outline-light px-3 py-1" onclick="runTelnet('${device.ip}', ${i})">Connect</button>
                                        </div>
                                    </div>
                                    <div id="telnet-terminal-${i}" class="cmd-terminal">Terminal Standby. Pick a target port and tap Connect...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(detailRow);

        // Detay paneli toggle
        // ── AKILLI DETAY PANELİ TOGGLE (Metin seçerken açılıp kapanmaz) ──
        row.addEventListener('click', (e) => {
            // Eğer kullanıcı fareyle yazı seçiyorsa (kopyalamak için), satırı tetikleme!
            const selection = window.getSelection().toString();
            if (selection.length > 0) {
                return; 
            }

            const wrapper    = document.getElementById(`wrapper-${i}`);
            const toggleIcon = row.querySelector('.toggle-icon');
            const isOpen     = wrapper.classList.contains('open');
            
            wrapper.classList.toggle('open', !isOpen);
            row.classList.toggle('active', !isOpen);
            if (toggleIcon) toggleIcon.classList.toggle('rotated', !isOpen);
        });
    });
}

// ── Ping ──────────────────────────────────────────────────

async function runPing(ip, index) {
    const term     = document.getElementById(`ping-terminal-${index}`);
    const startBtn = document.getElementById(`ping-btn-${index}`);
    const stopBtn  = document.getElementById(`ping-stop-btn-${index}`);

    if (activePingIntervals[index]) return;

    startBtn.disabled  = true;
    startBtn.innerText = "Running...";
    stopBtn.classList.remove('d-none');
    term.innerHTML = `C:\\Users\\admin> ping ${ip} -t\nSpawning continuous ICMP transmission socket...\n\n`;

    activePingIntervals[index] = setInterval(async () => {
        try {
            const response = await fetch('/api/ping', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ ip }),
            });
            const res = await response.json();
            if (res.status === 'success') {
                const lines = res.output.split('\n');
                const line  = lines.find(l =>
                    l.toLowerCase().includes('reply') ||
                    l.toLowerCase().includes('bytes from') ||
                    l.toLowerCase().includes('timed out')
                ) || "Request timed out.";
                term.innerHTML += line + "\n";
            } else {
                term.innerHTML += "Request timed out.\n";
            }
        } catch {
            term.innerHTML += "Transmission failure.\n";
        }
        term.scrollTop = term.scrollHeight;
    }, 1000);
}

function stopPing(index) {
    if (activePingIntervals[index]) {
        clearInterval(activePingIntervals[index]);
        delete activePingIntervals[index];
    }
    const term     = document.getElementById(`ping-terminal-${index}`);
    const startBtn = document.getElementById(`ping-btn-${index}`);
    const stopBtn  = document.getElementById(`ping-stop-btn-${index}`);

    startBtn.disabled  = false;
    startBtn.innerText = "Execute Ping";
    stopBtn.classList.add('d-none');
    term.innerHTML += `\n--- Ping statistics stopped by user ---\nC:\\Users\\admin> `;
    term.scrollTop = term.scrollHeight;
}

// ── Telnet ────────────────────────────────────────────────

async function runTelnet(ip, index) {
    const term    = document.getElementById(`telnet-terminal-${index}`);
    const portVal = document.getElementById(`port-${index}`).value;
    term.innerHTML = `TCP Handshake targeted at port ${portVal}...\nEstablishing socket transmission socket...`;
    try {
        const response = await fetch('/api/telnet', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ip, port: portVal }),
        });
        const res = await response.json();
        term.innerHTML = res.output;
    } catch {
        term.innerHTML = "Handshake aborted.";
    }
}

// ── PDF Export ────────────────────────────────────────────

async function exportNetworkReport() {
    const { jsPDF } = window.jspdf;
    const pdfButton = document.getElementById('btn-pdf');

    pdfButton.disabled = true;
    pdfButton.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Printing...`;

    const element = document.querySelector('.main-card');

    html2canvas(element, {
        backgroundColor: '#0d0f14',
        scale:    1.2,
        useCORS:  true,
        logging:  false,
    }).then(canvas => {
        const imgData  = canvas.toDataURL('image/png');
        const pdf      = new jsPDF('l', 'mm', 'a4');
        const imgWidth = 297;
        const pageHeight = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position   = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft > 0) {
            position = heightLeft - imgHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
        }

        pdf.save(`Network_Report_${new Date().toISOString().split('T')[0]}.pdf`);
        pdfButton.disabled = false;
        pdfButton.innerHTML = `<i class="fa-solid fa-file-pdf me-1"></i> PDF`;
    }).catch(() => {
        pdfButton.disabled = false;
        pdfButton.innerHTML = `<i class="fa-solid fa-file-pdf me-1"></i> PDF`;
    });
}

// ── Event Listener'lar ────────────────────────────────────

btn.addEventListener('click', async () => {
    await triggerScan(false);
    startAutoScanTimer();
});

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

// ── Filtre Event Listener'ları ────────────────────────────

[filterIp, filterHostname, filterMac, filterVendor].forEach(el => {
    el.addEventListener('input', applyFilters);
});
[filterSecurity, filterDevtype].forEach(el => {
    el.addEventListener('change', applyFilters);
});

window.onload = () => {
    triggerScan(false);
    startAutoScanTimer();
};