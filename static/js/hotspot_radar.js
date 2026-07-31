async function loadHotspotClients() {
    const banner = document.getElementById('statusBanner');
    const table = document.getElementById('hotspotTable');
    const tbody = document.getElementById('hotspotTableBody');

    banner.textContent = "Scanning...";
    banner.className = "status-banner active mb-3";
    table.style.display = "none";

    try {
        const response = await fetch('/api/hotspot-radar/scan');
        const data = await response.json();

        if (!data.active) {
            banner.textContent = data.message;
            banner.className = "status-banner inactive mb-3";
            table.style.display = "none";
            return;
        }

        banner.textContent = `Hotspot active on ${data.interface} (${data.gateway_ip}) — ${data.device_count} device(s) connected`;
        banner.className = "status-banner active mb-3";

        tbody.innerHTML = "";
        data.devices.forEach((dev, i) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="hotspot-row-num">${i + 1}</td>
                <td><span class="hotspot-ip-badge">${dev.ip}</span></td>
                <td class="hotspot-hostname">${dev.hostname}</td>
                <td class="hotspot-mac">${dev.mac}</td>
                <td><span class="hotspot-vendor-badge">${dev.vendor}</span></td>
            `;
            tbody.appendChild(row);
        });

        table.style.display = data.devices.length ? "table" : "none";
    } catch (err) {
        banner.textContent = "Failed to load hotspot data.";
        banner.className = "status-banner inactive mb-3";
        console.error(err);
    }
}

document.getElementById('refreshBtn').addEventListener('click', loadHotspotClients);
window.addEventListener('DOMContentLoaded', loadHotspotClients);