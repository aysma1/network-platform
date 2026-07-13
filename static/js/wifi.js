// ── Wi-Fi Radar JS ────────────────────────────────────────

async function loadNetworks(isManualClick = false) {
    const btn = document.getElementById('scanBtn');
    const tbody = document.getElementById('networksBody');
    const loadingZone = document.getElementById('loadingZone');
    const tableZone = document.getElementById('tableZone');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> SCANNING...';
    loadingZone.classList.remove('d-none');
    tableZone.classList.add('d-none');

    try {
        const res = await fetch('/api/wifi-scan');
        const data = await res.json();

        if (data.status === 'error') {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-5">
                <i class="fa-solid fa-triangle-exclamation d-block fs-1 mb-3"></i>${data.message}</td></tr>`;
        } else if (!data.networks || data.networks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-5">
                <i class="fa-solid fa-wifi d-block fs-1 mb-3 text-secondary"></i>
                No wireless airspace signatures captured.</td></tr>`;
        } else {
            renderGroupedTable(data.networks, tbody);
        }

        document.getElementById('detectedCount').textContent =
            (data.networks ? data.networks.length : 0) + ' Networks Detected';

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-5">
            Scan error: ${err.message}</td></tr>`;
    } finally {
        loadingZone.classList.add('d-none');
        tableZone.classList.remove('d-none');
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function networkRowHtml(net, extraClass = '') {
    return `
        <tr class="clickable-row ${extraClass}">
            <td class="fw-bold">
                <i class="fa-solid ${net.security.includes('Open') ? 'fa-unlock text-success' : 'fa-lock text-danger'} me-2"></i>
                ${net.ssid}
            </td>
            <td><span class="font-monospace text-warning small">${net.bssid}</span></td>
            <td>
                <span class="${net.signal >= -60 ? 'wifi-signal-good' : net.signal >= -80 ? 'wifi-signal-medium' : 'wifi-signal-poor'}">
                    <i class="fa-solid fa-signal me-1"></i> ${net.signal} dBm
                </span>
            </td>
            <td class="font-monospace text-info fw-bold">${net.channel}</td>
            <td class="text-muted small">${net.frequency} MHz</td>
            <td><span class="badge bg-secondary text-dark fw-bold font-monospace">${net.width} MHz</span></td>
            <td><span class="badge ${net.band.includes('5') ? 'bg-primary' : 'bg-dark border border-secondary'}">${net.band} GHz</span></td>
            <td><span class="badge port-badge ${net.security.includes('Open') ? 'security-badge-open' : 'security-badge-wpa'}">${net.security}</span></td>
        </tr>
    `;
}

function renderGroupedTable(networks, tbody) {
    const groups = {};
    networks.forEach(net => {
        if (!groups[net.ssid]) groups[net.ssid] = [];
        groups[net.ssid].push(net);
    });
    tbody.innerHTML = '';

    Object.entries(groups).forEach(([ssid, nets]) => {
        if (nets.length === 1) {
            tbody.insertAdjacentHTML('beforeend', networkRowHtml(nets[0]));
            return;
        }
        const best = nets.reduce((a, b) => (a.signal > b.signal ? a : b));
        const signalClass = best.signal >= -60 ? 'wifi-signal-good' : best.signal >= -80 ? 'wifi-signal-medium' : 'wifi-signal-poor';
        const isOpen = best.security.includes('Open');

        const parentRow = document.createElement('tr');
        parentRow.className = 'clickable-row wifi-group-parent';
        parentRow.innerHTML = `
            <td colspan="8" class="p-0">
                <div class="wifi-group-summary">
                    <div class="wifi-group-left">
                        <i class="fa-solid ${isOpen ? 'fa-unlock text-success' : 'fa-lock text-danger'} wifi-group-lock"></i>
                        <span class="wifi-group-name">${ssid}</span>
                        <span class="badge wifi-ap-count-badge">
                            <i class="fa-solid fa-wifi me-1"></i>${nets.length} Access Points
                        </span>
                    </div>
                    <div class="wifi-group-right">
                        <span class="${signalClass} wifi-group-signal">
                            <i class="fa-solid fa-signal me-1"></i>${best.signal} dBm
                            <span class="text-muted small fw-normal">best</span>
                        </span>
                        <span class="badge port-badge ${isOpen ? 'security-badge-open' : 'security-badge-wpa'}">${best.security}</span>
                        <i class="fa-solid fa-angle-down toggle-icon"></i>
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(parentRow);

        const childrenWrapper = document.createElement('tr');
        childrenWrapper.className = 'wifi-group-children';
        childrenWrapper.innerHTML = `
            <td colspan="8" class="p-0">
                <div class="wifi-children-collapse">
                    <table class="table align-middle mb-0">
                        <tbody>${nets.map(n => networkRowHtml(n, 'wifi-child-row')).join('')}</tbody>
                    </table>
                </div>
            </td>
        `;
        tbody.appendChild(childrenWrapper);

        const collapseEl = childrenWrapper.querySelector('.wifi-children-collapse');
        parentRow.addEventListener('click', () => {
            const isOpenNow = collapseEl.classList.contains('open');
            collapseEl.classList.toggle('open', !isOpenNow);
            parentRow.querySelector('.toggle-icon').classList.toggle('rotated', !isOpenNow);
        });
    });
}

// ── Event Listeners ───────────────────────────────────────
document.getElementById('scanBtn').addEventListener('click', async () => {
    document.getElementById('btn-pdf').disabled = true;
    await loadNetworks(true);
    const hasData = document.querySelectorAll('#networksBody tr').length > 0;
    document.getElementById('btn-pdf').disabled = !hasData;
});

document.addEventListener('DOMContentLoaded', async () => {
    await loadNetworks();
    const hasData = document.querySelectorAll('#networksBody tr').length > 0;
    document.getElementById('btn-pdf').disabled = !hasData;
});
// ── Wi-Fi PDF Export ──────────────────────────────────────
// wifi_scan.html'deki mevcut JS'in sonuna ekle,
// PDF butonunu da HTML'e ekle (aşağıda belirtildi)

function loadScript(src) {
    return new Promise((resolve) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = resolve;
        document.head.appendChild(s);
    });
}

async function exportWifiReport() {
    const pdfButton = document.getElementById('btn-pdf');
    pdfButton.disabled = true;
    pdfButton.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Generating...`;

    try {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js");
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('l', 'mm', 'a4');

        // Başlık
        pdf.setFillColor(0, 20, 10);
        pdf.rect(0, 0, 297, 25, 'F');
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.setTextColor(0, 255, 102);
        pdf.text("WI-FI RADAR — WIRELESS AIRSPACE REPORT", 14, 16);
        pdf.setFontSize(9);
        pdf.setTextColor(150, 150, 150);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, 283, 16, { align: 'right' });

        // Tablo satırlarını DOM'dan çek
        const rows = document.querySelectorAll('#networksBody tr');
        const bodyData = [];

        rows.forEach(row => {
            // Grup parent satırları (wifi-group-parent) — özet satır, ekle
            if (row.classList.contains('wifi-group-parent')) {
                const name = row.querySelector('.wifi-group-name')?.innerText?.trim() || '—';
                const signal = row.querySelector('.wifi-group-signal')?.innerText?.trim().replace(/\s+/g, ' ') || '—';
                const security = row.querySelector('.badge')?.innerText?.trim() || '—';
                bodyData.push([name, '(Multiple APs)', signal, '—', '—', '—', '—', security]);
                return;
            }
            // Normal veya child satırlar
            if (row.classList.contains('wifi-children-collapse') || row.classList.contains('wifi-group-children')) return;
            const cells = row.querySelectorAll('td');
            if (cells.length < 8) return;
            bodyData.push([
                cells[0].innerText.trim(),
                cells[1].innerText.trim(),
                cells[2].innerText.trim(),
                cells[3].innerText.trim(),
                cells[4].innerText.trim(),
                cells[5].innerText.trim(),
                cells[6].innerText.trim(),
                cells[7].innerText.trim(),
            ]);
        });

        // Özet sayaçlar
        const total   = bodyData.length;
        const openNet = bodyData.filter(r => r[7].toLowerCase().includes('open')).length;
        const secured = total - openNet;

        pdf.setFillColor(10, 20, 15);
        pdf.roundedRect(14, 30, 55, 18, 2, 2, 'F');
        pdf.roundedRect(74, 30, 55, 18, 2, 2, 'F');
        pdf.roundedRect(134, 30, 55, 18, 2, 2, 'F');

        pdf.setFontSize(18); pdf.setFont("helvetica", "bold");
        pdf.setTextColor(255, 255, 255); pdf.text(String(total), 41, 42, { align: 'center' });
        pdf.setTextColor(248, 113, 113); pdf.text(String(openNet), 101, 42, { align: 'center' });
        pdf.setTextColor(134, 239, 172); pdf.text(String(secured), 161, 42, { align: 'center' });

        pdf.setFontSize(8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(148, 163, 184);
        pdf.text("TOTAL NETWORKS", 41, 46, { align: 'center' });
        pdf.text("OPEN / UNSECURED", 101, 46, { align: 'center' });
        pdf.text("SECURED", 161, 46, { align: 'center' });

        pdf.autoTable({
            head: [['SSID', 'BSSID', 'Signal', 'Channel', 'Frequency', 'Width', 'Band', 'Security']],
            body: bodyData,
            startY: 54,
            theme: 'grid',
            styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, valign: 'middle' },
            headStyles: { fillColor: [0, 180, 60], textColor: [255, 255, 255], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [245, 250, 247] },
            didParseCell(data) {
                if (data.column.index === 7 && data.section === 'body') {
                    const v = (data.cell.raw || '').toLowerCase();
                    data.cell.styles.textColor = v.includes('open') ? [220, 38, 38] : [22, 163, 74];
                    data.cell.styles.fontStyle = 'bold';
                }
            },
            columnStyles: {
                0: { cellWidth: 55 }, 1: { cellWidth: 42 }, 2: { cellWidth: 28 },
                3: { cellWidth: 22 }, 4: { cellWidth: 28 }, 5: { cellWidth: 22 },
                6: { cellWidth: 20 }, 7: { cellWidth: 40 }
            },
            margin: { left: 14, right: 14 }
        });

        // Footer
        const pageCount = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);
            pdf.setFontSize(7); pdf.setTextColor(150, 150, 150);
            pdf.text(`Network Platform — Wi-Fi Radar Report  |  Page ${i} of ${pageCount}`, 148, 205, { align: 'center' });
        }

        pdf.save(`WiFi_Radar_Report_${new Date().toISOString().split('T')[0]}.pdf`);

    } catch (err) {
        console.error("PDF error:", err);
    } finally {
        pdfButton.disabled = false;
        pdfButton.innerHTML = `<i class="fa-solid fa-file-pdf me-1"></i> PDF`;
    }
}
// ── Wi-Fi PDF Export ──────────────────────────────────────
// wifi_scan.html'deki mevcut JS'in sonuna ekle,
// PDF butonunu da HTML'e ekle (aşağıda belirtildi)

// ── Wi-Fi PDF Export ──────────────────────────────────────
// wifi_scan.html'deki mevcut JS'in sonuna ekle,
// PDF butonunu da HTML'e ekle (aşağıda belirtildi)