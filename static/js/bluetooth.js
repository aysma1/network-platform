// ── Bluetooth PDF Export ───────────────────────────────────
function loadScript(src) {
    return new Promise((resolve) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = resolve;
        document.head.appendChild(s);
    });
}

async function exportBluetoothReport() {
    const pdfButton = document.getElementById('btn-pdf');
    pdfButton.disabled = true;
    pdfButton.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Generating...`;

    try {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js");
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('l', 'mm', 'a4');

        // Başlık
        pdf.setFillColor(0, 15, 25);
        pdf.rect(0, 0, 297, 25, 'F');
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.setTextColor(0, 210, 255);
        pdf.text("BLUETOOTH RADAR — BLE AIRSPACE REPORT", 14, 16);
        pdf.setFontSize(9);
        pdf.setTextColor(150, 150, 150);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, 283, 16, { align: 'right' });

        // Tablo satırlarını DOM'dan çek
        const rows = document.querySelectorAll('#devicesBody tr');
        const bodyData = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 7) return;
            bodyData.push([
                cells[0].innerText.trim().split('\n')[0],  // Sadece isim, tag olmadan
                cells[1].innerText.trim(),
                cells[2].innerText.trim(),
                cells[3].innerText.trim(),
                cells[4].innerText.trim(),
                cells[5].innerText.trim(),
                cells[6].innerText.trim(),
            ]);
        });

        // Özet sayaçlar
        const total       = bodyData.length;
        const connectable = bodyData.filter(r => r[5].toLowerCase().includes('connectable') && !r[5].toLowerCase().includes('non')).length;
        const strong      = bodyData.filter(r => {
            const dbm = parseInt(r[2]);
            return !isNaN(dbm) && dbm >= -60;
        }).length;

        pdf.setFillColor(0, 15, 30);
        pdf.roundedRect(14, 30, 55, 18, 2, 2, 'F');
        pdf.roundedRect(74, 30, 55, 18, 2, 2, 'F');
        pdf.roundedRect(134, 30, 55, 18, 2, 2, 'F');

        pdf.setFontSize(18); pdf.setFont("helvetica", "bold");
        pdf.setTextColor(255, 255, 255); pdf.text(String(total), 41, 42, { align: 'center' });
        pdf.setTextColor(0, 210, 255);   pdf.text(String(connectable), 101, 42, { align: 'center' });
        pdf.setTextColor(134, 239, 172); pdf.text(String(strong), 161, 42, { align: 'center' });

        pdf.setFontSize(8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(148, 163, 184);
        pdf.text("TOTAL DEVICES", 41, 46, { align: 'center' });
        pdf.text("CONNECTABLE", 101, 46, { align: 'center' });
        pdf.text("STRONG SIGNAL (≥-60dBm)", 161, 46, { align: 'center' });

        pdf.autoTable({
            head: [['Device Name', 'MAC Address', 'Signal (dBm)', 'Est. Distance', 'Manufacturer', 'Connectable', 'Services']],
            body: bodyData,
            startY: 54,
            theme: 'grid',
            styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, valign: 'middle' },
            headStyles: { fillColor: [0, 100, 150], textColor: [255, 255, 255], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [245, 248, 252] },
            didParseCell(data) {
                if (data.column.index === 2 && data.section === 'body') {
                    const dbm = parseInt(data.cell.raw);
                    if (!isNaN(dbm)) {
                        data.cell.styles.textColor = dbm >= -60 ? [0, 150, 200] : dbm >= -80 ? [100, 160, 200] : [100, 100, 100];
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
                if (data.column.index === 5 && data.section === 'body') {
                    const v = (data.cell.raw || '').toLowerCase();
                    if (v.includes('non')) data.cell.styles.textColor = [100, 100, 100];
                    else data.cell.styles.textColor = [0, 180, 100];
                    data.cell.styles.fontStyle = 'bold';
                }
            },
            columnStyles: {
                0: { cellWidth: 50 }, 1: { cellWidth: 42 }, 2: { cellWidth: 28 },
                3: { cellWidth: 32 }, 4: { cellWidth: 40 }, 5: { cellWidth: 30 }, 6: { cellWidth: 35 }
            },
            margin: { left: 14, right: 14 }
        });

        // Footer
        const pageCount = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);
            pdf.setFontSize(7); pdf.setTextColor(150, 150, 150);
            pdf.text(`Network Platform — Bluetooth Radar Report  |  Page ${i} of ${pageCount}`, 148, 205, { align: 'center' });
        }

        pdf.save(`Bluetooth_Radar_Report_${new Date().toISOString().split('T')[0]}.pdf`);

    } catch (err) {
        console.error("PDF error:", err);
    } finally {
        pdfButton.disabled = false;
        pdfButton.innerHTML = `<i class="fa-solid fa-file-pdf me-1"></i> PDF`;
    }
}

// ── Bluetooth Scan Functions (from HTML) ──
async function loadDevices(isManualClick = false) {
    const btn = document.getElementById('scanBtn');
    const tbody = document.getElementById('devicesBody');
    const loadingZone = document.getElementById('loadingZone');
    const tableZone = document.getElementById('tableZone');
    const originalHtml = btn.innerHTML;

    const timeout = document.getElementById('btScanTimeout').value;
    const minRssi = document.getElementById('btMinRssi').value;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> SCANNING...';
    loadingZone.classList.remove('d-none');
    tableZone.classList.add('d-none');

    document.getElementById('progressStatus').innerHTML =
        '<i class="fa-brands fa-bluetooth-b perfect-spin me-2"></i> [Stage 1/2] Initializing BLE Radio...';
    document.getElementById('progressBar').style.width = '15%';
    document.getElementById('progressPercent').textContent = '15%';

    setTimeout(() => {
        document.getElementById('progressStatus').innerHTML =
            '<i class="fa-brands fa-bluetooth-b perfect-spin me-2"></i> [Stage 2/2] Listening for Advertisements...';
        document.getElementById('progressBar').style.width = '70%';
        document.getElementById('progressPercent').textContent = '70%';
    }, 600);

    try {
        const res = await fetch(`/api/bluetooth-scan?timeout=${timeout}&min_rssi=${minRssi}`);
        const data = await res.json();

        if (!data.success) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-5">
                <i class="fa-solid fa-triangle-exclamation d-block fs-1 mb-3"></i>${data.error}</td></tr>`;
        } else if (!data.devices || data.devices.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-5">
                <i class="fa-brands fa-bluetooth-b d-block fs-1 mb-3 text-secondary"></i>
                No Bluetooth devices captured.</td></tr>`;
        } else {
            tbody.innerHTML = data.devices.map(deviceRowHtml).join('');
        }

        document.getElementById('detectedCount').textContent =
            (data.devices ? data.devices.length : 0) + ' Devices Detected';

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-5">
            Scan failed: ${err.message}</td></tr>`;
    } finally {
        loadingZone.classList.add('d-none');
        tableZone.classList.remove('d-none');
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function sourceTag(source) {
    if (source === 'known')    return '<span class="bt-tag bt-tag-known">REPORTED</span>';
    if (source === 'inferred') return '<span class="bt-tag bt-tag-guessed">~ ESTIMATED</span>';
    return '<span class="bt-tag bt-tag-none">NO DATA</span>';
}

function signalClass(rssi) {
    if (rssi >= -60) return 'ble-signal-strong';
    if (rssi >= -80) return 'ble-signal-medium';
    return 'ble-signal-weak';
}

function deviceRowHtml(d) {
    const manufacturer = d.manufacturer_guess
        ? `<span class="bt-tag bt-tag-guessed">~ ${d.manufacturer_guess}</span>`
        : '<span class="na-text">N/A</span>';
    const deviceType = d.device_type_guess
        ? `<span class="bt-tag bt-tag-guessed">~ ${d.device_type_guess}</span>`
        : '<span class="na-text">N/A</span>';
    const services = (d.service_uuids && d.service_uuids.length > 0)
        ? `<span class="badge ble-type-badge">${d.service_uuids.length} advertised</span>`
        : '<span class="port-none-detected"><i class="fa-solid fa-check"></i> None</span>';

    return `
        <tr class="clickable-row">
            <td class="fw-bold">
                <i class="fa-brands fa-bluetooth-b me-2" style="color:#00d2ff;"></i>
                ${d.display_name}
                <div class="mt-1">${sourceTag(d.name_source)}</div>
            </td>
            <td><span class="font-monospace text-warning small">${d.address}</span></td>
            <td>
                <span class="${signalClass(d.rssi)}">
                    <i class="fa-solid fa-signal me-1"></i> ${d.rssi} dBm
                </span>
            </td>
            <td class="text-muted small fst-italic">~ ${d.signal_estimate}</td>
            <td>${manufacturer}</td>
            <td>${deviceType}</td>
            <td>${services}</td>
        </tr>
    `;
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadDevices();
    const hasData = document.querySelectorAll('#devicesBody tr').length > 0;
    document.getElementById('btn-pdf').disabled = !hasData;
});
document.getElementById('scanBtn').addEventListener('click', async () => {
    document.getElementById('btn-pdf').disabled = true;
    await loadDevices(true);
    const hasData = document.querySelectorAll('#devicesBody tr').length > 0;
    document.getElementById('btn-pdf').disabled = !hasData;
});
document.getElementById('btScanTimeout').addEventListener('change', () => loadDevices(true));
document.getElementById('btMinRssi').addEventListener('change', () => loadDevices(true));