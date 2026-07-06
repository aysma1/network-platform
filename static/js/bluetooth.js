// static/js/bluetooth.js

const scanBtn = document.getElementById('bt-scan-btn');
const statusEl = document.getElementById('bt-status');
const resultsHeader = document.getElementById('bt-results-header');
const deviceCountEl = document.getElementById('bt-device-count');
const deviceListEl = document.getElementById('bt-device-list');
const emptyEl = document.getElementById('bt-empty');
const timeoutSelect = document.getElementById('bt-timeout');
const minRssiSelect = document.getElementById('bt-min-rssi');

scanBtn.addEventListener('click', runScan);

async function runScan() {
    const timeout = timeoutSelect.value;
    const minRssi = minRssiSelect.value;

    setScanning(true);
    showStatus(`Scanning for ${timeout} seconds...`, false);

    try {
        const response = await fetch(`/api/bluetooth/scan?timeout=${timeout}&min_rssi=${minRssi}`);
        const data = await response.json();

        if (!data.success) {
            showStatus(`Scan failed: ${data.error}`, true);
            renderDevices([]);
            return;
        }

        showStatus(`Last scan: ${data.count} device(s) found.`, false);
        renderDevices(data.devices);
    } catch (err) {
        showStatus(`Request failed: ${err.message}`, true);
        renderDevices([]);
    } finally {
        setScanning(false);
    }
}

function setScanning(isScanning) {
    scanBtn.disabled = isScanning;
    scanBtn.querySelector('.bt-scan-btn-text').textContent = isScanning ? 'Scanning...' : 'Start Scan';
}

function showStatus(message, isError) {
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.classList.toggle('error', isError);
}

function renderDevices(devices) {
    deviceListEl.innerHTML = '';

    if (!devices || devices.length === 0) {
        emptyEl.hidden = false;
        resultsHeader.hidden = true;
        return;
    }

    emptyEl.hidden = true;
    resultsHeader.hidden = false;
    deviceCountEl.textContent = `${devices.length} device${devices.length === 1 ? '' : 's'}`;

    devices.forEach(device => {
        deviceListEl.appendChild(buildDeviceCard(device));
    });
}

function buildDeviceCard(device) {
    const card = document.createElement('div');
    card.className = 'bt-device-card';

    // Name + name-source tag
    const nameEl = document.createElement('div');
    nameEl.className = 'bt-device-name';
    nameEl.appendChild(document.createTextNode(device.display_name));
    nameEl.appendChild(makeTag(device.name_source));
    card.appendChild(nameEl);

    // RSSI
    const rssiEl = document.createElement('div');
    rssiEl.className = 'bt-device-rssi';
    rssiEl.textContent = `${device.rssi} dBm`;
    card.appendChild(rssiEl);

    // MAC address — always shown, this is directly reported by the OS/radio
    const addressEl = document.createElement('div');
    addressEl.className = 'bt-device-address';
    addressEl.textContent = `MAC: ${device.address}`;
    card.appendChild(addressEl);

    // Signal distance estimate (always inferred, never treated as exact)
    const signalEl = document.createElement('div');
    signalEl.className = 'bt-signal-estimate';
    signalEl.textContent = `~ ${device.signal_estimate}`;
    card.appendChild(signalEl);

    // Extra details row: manufacturer guess, device type guess, services, tx power
    const detailsEl = document.createElement('div');
    detailsEl.className = 'bt-device-details';

    if (device.manufacturer_guess) {
        detailsEl.appendChild(makeInfoTag(`Vendor: ${device.manufacturer_guess}`, 'inferred'));
    }

    if (device.device_type_guess) {
        detailsEl.appendChild(makeInfoTag(device.device_type_guess, 'inferred'));
    }

    if (device.tx_power !== null && device.tx_power !== undefined) {
        detailsEl.appendChild(makeInfoTag(`TX power: ${device.tx_power} dBm`, 'known'));
    }

    if (device.service_uuids && device.service_uuids.length > 0) {
        detailsEl.appendChild(makeInfoTag(`${device.service_uuids.length} advertised service(s)`, 'known'));
    }

    if (detailsEl.children.length > 0) {
        card.appendChild(detailsEl);
    }

    return card;
}

function makeTag(nameSource) {
    const tag = document.createElement('span');
    if (nameSource === 'known') {
        tag.className = 'bt-tag bt-tag-known';
        tag.textContent = 'reported by device';
    } else if (nameSource === 'inferred') {
        tag.className = 'bt-tag bt-tag-inferred';
        tag.textContent = 'guessed';
    } else {
        tag.className = 'bt-tag bt-tag-unavailable';
        tag.textContent = 'no data';
    }
    return tag;
}

function makeInfoTag(text, kind) {
    const tag = document.createElement('span');
    tag.className = kind === 'known' ? 'bt-tag bt-tag-known' : 'bt-tag bt-tag-inferred';
    tag.textContent = text;
    return tag;
}