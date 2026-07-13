// ── Sekme Yönetimi ───────────────────────────────────────
function switchTab(name) {
    document.querySelectorAll('.it-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.it-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[onclick="switchTab('${name}')"]`).classList.add('active');
    document.getElementById(`panel-${name}`).classList.add('active');
}

function quickQuery(tab, value) {
    switchTab(tab);
    if (tab === 'whois')  { document.getElementById('whois-input').value = value;  runWhois(); }
    if (tab === 'dns')    { document.getElementById('dns-input').value = value;    runDns(); }
    if (tab === 'ipinfo') { document.getElementById('ipinfo-input').value = value; runIpInfo(); }
}

// ── DNS tip pill toggle ───────────────────────────────────
document.querySelectorAll('.it-type-pill[data-type]').forEach(pill => {
    pill.addEventListener('click', () => pill.classList.toggle('selected'));
});

function getSelectedTypes() {
    return [...document.querySelectorAll('.it-type-pill[data-type].selected')]
        .map(p => p.dataset.type);
}

// ── Loading / Error yardımcıları ──────────────────────────
function showLoading(container) {
    document.getElementById(container).innerHTML = `
        <div class="it-loading">
            <div class="it-spinner"></div>
            <span>Sorgulanıyor...</span>
        </div>`;
}

function showError(container, msg) {
    document.getElementById(container).innerHTML =
        `<div class="it-error"><i class="fa-solid fa-circle-xmark me-2"></i>${msg}</div>`;
}

function fieldHtml(label, value, accent = false, full = false) {
    if (!value && value !== 0) return '';
    const val = Array.isArray(value) ? value.join(', ') : value;
    return `
        <div class="it-field${full ? ' full' : ''}">
            <div class="it-field-label">${label}</div>
            <div class="it-field-value${accent ? ' accent' : ''}">${val}</div>
        </div>`;
}

// ── WHOIS ─────────────────────────────────────────────────
async function runWhois() {
    const target = document.getElementById('whois-input').value.trim();
    if (!target) return;
    const btn = document.getElementById('whois-btn');
    btn.disabled = true;
    showLoading('whois-result');

    try {
        const res  = await fetch(`/api/whois?target=${encodeURIComponent(target)}`);
        const data = await res.json();

        if (data.error) { showError('whois-result', data.error); return; }

        // Status pilleri
        const statusHtml = (data.status || []).length
            ? `<div class="it-pill-list">${data.status.map(s =>
                `<span class="it-status-pill">${s.split(' ')[0]}</span>`).join('')}</div>`
            : '<span style="color:#334155;">—</span>';

        // Nameserver pilleri
        const nsHtml = (data.name_servers || []).length
            ? `<div class="it-pill-list">${data.name_servers.map(n =>
                `<span class="it-ns-pill">${n}</span>`).join('')}</div>`
            : '<span style="color:#334155;">—</span>';

        document.getElementById('whois-result').innerHTML = `
            <div class="it-whois-grid">
                ${fieldHtml('Domain Adı',      data.domain_name,      true)}
                ${fieldHtml('Kayıt Şirketi',   data.registrar)}
                ${fieldHtml('WHOIS Sunucusu',  data.whois_server)}
                ${fieldHtml('Kayıt Tarihi',    data.creation_date)}
                ${fieldHtml('Son Kullanma',    data.expiration_date)}
                ${fieldHtml('Güncelleme',      data.updated_date)}
                ${fieldHtml('Ülke',            data.country)}
                ${fieldHtml('Şehir',           data.city)}
                ${fieldHtml('Org / Sahip',     data.org || data.name)}
                ${fieldHtml('DNSSEC',          data.dnssec)}
                <div class="it-field">
                    <div class="it-field-label">Durum</div>
                    ${statusHtml}
                </div>
                <div class="it-field full">
                    <div class="it-field-label">Name Servers</div>
                    ${nsHtml}
                </div>
            </div>`;
    } catch (err) {
        showError('whois-result', `İstek başarısız: ${err.message}`);
    } finally {
        btn.disabled = false;
    }
}

// ── DNS ───────────────────────────────────────────────────
async function runDns() {
    const target = document.getElementById('dns-input').value.trim();
    if (!target) return;
    const types  = getSelectedTypes();
    const btn    = document.getElementById('dns-btn');
    btn.disabled = true;
    showLoading('dns-result');

    try {
        const params = new URLSearchParams({ target });
        if (types.length) params.set('types', types.join(','));
        const res  = await fetch(`/api/dns?${params}`);
        const data = await res.json();

        if (data.error) { showError('dns-result', data.error); return; }

        const records = data.records || {};
        if (!Object.keys(records).length) {
            document.getElementById('dns-result').innerHTML = `
                <div class="it-empty">
                    <i class="fa-solid fa-circle-question"></i>
                    <p>'${data.query}' için seçili tiplerde kayıt bulunamadı.</p>
                </div>`;
            return;
        }

        // Her kayıt tipi için section oluştur
        const typeIcons = {
            A: 'fa-arrow-right', AAAA: 'fa-arrow-right', MX: 'fa-envelope',
            NS: 'fa-server', TXT: 'fa-file-lines', CNAME: 'fa-link',
            SOA: 'fa-gear', SRV: 'fa-wrench', CAA: 'fa-certificate', PTR: 'fa-rotate-left',
        };

        let html = `<div style="margin-bottom:8px; font-size:0.78rem; color:#334155;">
            <i class="fa-solid fa-check-circle me-1" style="color:#a78bfa;"></i>
            <strong style="color:#a78bfa;">${data.total}</strong> kayıt bulundu — <span style="font-family:monospace;">${data.query}</span>
        </div>`;

        for (const [rtype, recs] of Object.entries(records)) {
            const icon = typeIcons[rtype] || 'fa-circle';
            const list = Array.isArray(recs) ? recs : [recs];

            html += `
                <div class="it-dns-section">
                    <div class="it-dns-type-header">
                        <span class="it-dns-type-badge"><i class="fa-solid ${icon} me-1"></i>${rtype}</span>
                        <span class="it-dns-count">${list.length} kayıt</span>
                    </div>
                    ${list.map(r => {
                        if (typeof r === 'string') {
                            return `<div class="it-dns-record"><span>${r}</span></div>`;
                        }
                        if (rtype === 'MX') {
                            return `<div class="it-dns-record">
                                <span class="key">priority</span><span>${r.priority}</span>
                                &nbsp;&nbsp;<span class="key">exchange</span><span>${r.exchange}</span>
                            </div>`;
                        }
                        if (rtype === 'SOA') {
                            return `<div class="it-dns-record">
                                <span class="key">mname</span><span>${r.mname}</span>
                                &nbsp;&nbsp;<span class="key">serial</span><span>${r.serial}</span>
                                &nbsp;&nbsp;<span class="key">refresh</span><span>${r.refresh}s</span>
                            </div>`;
                        }
                        if (rtype === 'SRV') {
                            return `<div class="it-dns-record">
                                <span class="key">target</span><span>${r.target}</span>
                                &nbsp;&nbsp;<span class="key">port</span><span>${r.port}</span>
                                &nbsp;&nbsp;<span class="key">priority</span><span>${r.priority}</span>
                            </div>`;
                        }
                        if (rtype === 'CAA') {
                            return `<div class="it-dns-record">
                                <span class="key">${r.tag}</span><span>${r.value}</span>
                            </div>`;
                        }
                        return `<div class="it-dns-record"><span>${JSON.stringify(r)}</span></div>`;
                    }).join('')}
                </div>`;
        }

        document.getElementById('dns-result').innerHTML = html;
    } catch (err) {
        showError('dns-result', `İstek başarısız: ${err.message}`);
    } finally {
        btn.disabled = false;
    }
}

// ── IP Geolocation ────────────────────────────────────────
async function runIpInfo() {
    const ip  = document.getElementById('ipinfo-input').value.trim();
    if (!ip) return;
    const btn = document.getElementById('ipinfo-btn');
    btn.disabled = true;
    showLoading('ipinfo-result');

    try {
        const res  = await fetch(`/api/ip-info?ip=${encodeURIComponent(ip)}`);
        const data = await res.json();

        if (data.error) { showError('ipinfo-result', data.error); return; }

        document.getElementById('ipinfo-result').innerHTML = `
            <div class="it-ip-grid">
                ${fieldHtml('IP Adresi',   data.ip, true)}
                ${fieldHtml('Ülke',        data.country ? `${data.country} (${data.country_code})` : null)}
                ${fieldHtml('Bölge / Şehir', [data.region, data.city].filter(Boolean).join(' / ') || null)}
                ${fieldHtml('Posta Kodu',  data.zip)}
                ${fieldHtml('Timezone',    data.timezone)}
                ${fieldHtml('Koordinatlar', data.lat && data.lon ? `${data.lat}, ${data.lon}` : null)}
                ${fieldHtml('ISP',         data.isp)}
                ${fieldHtml('Org',         data.org)}
                ${fieldHtml('AS',          data.as)}
            </div>
            ${data.lat && data.lon ? `
            <div class="mt-3">
                <a href="https://www.openstreetmap.org/?mlat=${data.lat}&mlon=${data.lon}&zoom=10"
                   target="_blank" rel="noopener"
                   style="font-size:0.78rem; color:#a78bfa; text-decoration:none;">
                    <i class="fa-solid fa-map-location-dot me-1"></i>
                    OpenStreetMap'te Görüntüle (${data.lat}, ${data.lon})
                </a>
            </div>` : ''}`;
    } catch (err) {
        showError('ipinfo-result', `İstek başarısız: ${err.message}`);
    } finally {
        btn.disabled = false;
    }
}